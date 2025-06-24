// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Connessione MongoDB
mongoose.connect(process.env.MONGO_DB, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schema Prodotto
const productSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  quantita: { type: Number, required: true, default: 0 },
  quantitaMinima: { type: Number, required: true, default: 0 },
  unitaMisura: { type: String, default: 'pz' },
  createdAt: { type: Date, default: Date.now }
});

// Schema Utilizzo
const utilizzoSchema = new mongoose.Schema({
  prodottoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  nomeProdotto: { type: String, required: true },
  quantitaUtilizzata: { type: Number, required: true },
  dataUtilizzo: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Utilizzo = mongoose.model('Utilizzo', utilizzoSchema);

// Routes

// Ottenere tutti i prodotti
app.get('/api/prodotti', async (req, res) => {
  try {
    const prodotti = await Product.find().sort({ nome: 1 });
    res.json(prodotti);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Aggiungere un nuovo prodotto
app.post('/api/prodotti', async (req, res) => {
  try {
    const prodotto = new Product(req.body);
    const savedProdotto = await prodotto.save();
    res.status(201).json(savedProdotto);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Aggiornare quantità prodotto
app.put('/api/prodotti/:id', async (req, res) => {
  try {
    const prodotto = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(prodotto);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Utilizzare prodotto (-1)
app.post('/api/prodotti/:id/utilizza', async (req, res) => {
  try {
    const prodotto = await Product.findById(req.params.id);
    if (!prodotto) {
      return res.status(404).json({ message: 'Prodotto non trovato' });
    }

    if (prodotto.quantita <= 0) {
      return res.status(400).json({ message: 'Quantità insufficiente' });
    }

    // Decrementa quantità
    prodotto.quantita -= 1;
    await prodotto.save();

    // Registra utilizzo
    const utilizzo = new Utilizzo({
      prodottoId: prodotto._id,
      nomeProdotto: prodotto.nome,
      quantitaUtilizzata: 1
    });
    await utilizzo.save();

    res.json({ prodotto, utilizzo });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Ottenere utilizzi
app.get('/api/utilizzi', async (req, res) => {
  try {
    const { dataInizio, dataFine } = req.query;
    let filter = {};
    
    if (dataInizio || dataFine) {
      filter.dataUtilizzo = {};
      if (dataInizio) filter.dataUtilizzo.$gte = new Date(dataInizio);
      if (dataFine) filter.dataUtilizzo.$lte = new Date(dataFine);
    }

    const utilizzi = await Utilizzo.find(filter)
      .populate('prodottoId')
      .sort({ dataUtilizzo: -1 });
    
    res.json(utilizzi);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generare file Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const { dataInizio, dataFine } = req.query;
    let filter = {};
    
    if (dataInizio || dataFine) {
      filter.dataUtilizzo = {};
      if (dataInizio) filter.dataUtilizzo.$gte = new Date(dataInizio);
      if (dataFine) filter.dataUtilizzo.$lte = new Date(dataFine);
    }

    // Aggregazione utilizzi per prodotto
    const utilizziAggregati = await Utilizzo.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$prodottoId',
          nomeProdotto: { $first: '$nomeProdotto' },
          quantitaTotaleUtilizzata: { $sum: '$quantitaUtilizzata' }
        }
      }
    ]);

    // Ottenere informazioni sui prodotti
    const prodotti = await Product.find();
    const prodottiMap = {};
    prodotti.forEach(p => {
      prodottiMap[p._id.toString()] = p;
    });

    // Creare workbook Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Utilizzi Materiali');

    // Headers
    worksheet.columns = [
      { header: 'Prodotto', key: 'prodotto', width: 30 },
      { header: 'Quantità Utilizzata', key: 'quantitaUtilizzata', width: 20 },
      { header: 'Quantità Attuale', key: 'quantitaAttuale', width: 20 },
      { header: 'Quantità Minima', key: 'quantitaMinima', width: 20 },
      { header: 'Da Ordinare', key: 'daOrdinare', width: 15 },
      { header: 'Quantità da Ordinare', key: 'quantitaDaOrdinare', width: 20 }
    ];

    // Stile header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Aggiungere dati
    utilizziAggregati.forEach(utilizzo => {
      const prodotto = prodottiMap[utilizzo._id.toString()];
      if (prodotto) {
        const daOrdinare = prodotto.quantita <= prodotto.quantitaMinima;
        const quantitaDaOrdinare = daOrdinare 
          ? Math.max(0, prodotto.quantitaMinima - prodotto.quantita + utilizzo.quantitaTotaleUtilizzata)
          : 0;

        const row = worksheet.addRow({
          prodotto: utilizzo.nomeProdotto,
          quantitaUtilizzata: utilizzo.quantitaTotaleUtilizzata,
          quantitaAttuale: prodotto.quantita,
          quantitaMinima: prodotto.quantitaMinima,
          daOrdinare: daOrdinare ? 'SÌ' : 'NO',
          quantitaDaOrdinare: quantitaDaOrdinare
        });

        // Evidenziare prodotti da ordinare
        if (daOrdinare) {
          row.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFCCCC' }
          };
        }
      }
    });

    // Impostare response headers
    const fileName = `utilizzi_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Inviare file
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Errore generazione Excel:', error);
    res.status(500).json({ message: error.message });
  }
});

// Eliminare prodotto
app.delete('/api/prodotti/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: 'Prodotto eliminato' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Pulire utilizzi
app.delete('/api/utilizzi', async (req, res) => {
  try {
    await Utilizzo.deleteMany({});
    res.json({ message: 'Utilizzi cancellati' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
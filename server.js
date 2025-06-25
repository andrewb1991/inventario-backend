// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const ExcelJS = require('exceljs');
const bcrypt = require('bcrypt')
const jwt = require("jsonwebtoken")
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 7070;
app.use(express.json());

// Middleware
app.use(cors());
// const authenticateToken = require("./middleware")
// app.use(authenticateToken)

// Middleware di autenticazione 
function verificaToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send("Token mancante");

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send("Token non valido");
    req.utente = decoded;
    next();
  });
}

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
//   utenteId: {type: String},
  unitaMisura: { type: String, default: 'pz' },
  createdAt: { type: Date, default: Date.now }
});

// Schema Utilizzo
const utilizzoSchema = new mongoose.Schema({
  prodottoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  nomeProdotto: { type: String, required: true },
  quantitaUtilizzata: { type: Number, required: true },
  dataUtilizzo: { type: Date, default: Date.now },
  // utenteId: {type: String, type: mongoose.Schema.Types.ObjectId, ref: 'Utente', required: true},
});

// Schema Utente
const utenteSchema = new mongoose.Schema({
  nomeUtente: { type: String, required: true },
  cognomeUtente: { type: String, required: true },
  mailUtente: { type: String, required: true, unique: true},
  passwordUtente: { type: String, required: true, min: 8},
});

const Product = mongoose.model('Product', productSchema);
const Utilizzo = mongoose.model('Utilizzo', utilizzoSchema);
const Utente = mongoose.model('Utente', utenteSchema)

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
    const prodotto = await Product.findOneAndUpdate(
  { _id: req.params.id },
  req.body,
  { new: true }
    );
    if (!prodotto) return res.status(404).json({ message: 'Prodotto non trovato' });
    res.json(prodotto);
  } catch (e) {
    res.status(400).json({ message: e.message });
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

    // Creazione prodotto legato ad utenteId

//   app.post('/api/prodotti', async (req, res) => {
//   try {
//     const prodotto = new Product({
//       ...req.body,
//       utenteId: req.utente.id
//     });
//     const saved = await prodotto.save();
//     res.status(201).json(saved);
//   } catch (e) {
//     res.status(400).json({ message: e.message });
//   }
// });
    // Decrementa quantità
    prodotto.quantita -= 1;
    await prodotto.save();

    // Registra utilizzo
const utilizzo = new Utilizzo({
      prodottoId: prodotto._id,
      nomeProdotto: prodotto.nome,
      quantitaUtilizzata: 1,
      // utenteId: req.user.id 
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
        //   ? Math.max(0, prodotto.quantitaMinima - prodotto.quantita + utilizzo.quantitaTotaleUtilizzata)
        //   : 0;
        ? Math.max(0, prodotto.quantitaMinima - prodotto.quantita )
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

// // Utenti
app.get('/api/utenti', async (req, res) => {
  try {
    const utenti = await Utente.find().sort({ nomeUtente: 1 });
    res.json(utenti);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// // Login Utenti
app.get("api/login", async(req, res)=>{
    try {
        const allutenti = await Utente.find()
        res.status(200).send(allutenti)
    } catch (error) {
        res.status(500).send({
        message: "Internal server error",
        error: error    
        })
    }

})

// // Registrazione Utenti
app.post("/api/register", async(req, res)=>{
    const salt = await bcrypt.genSalt(10)
    const hashpassword = await bcrypt.hash(req.body.passwordUtente, salt)
    const utente = new Utente({
    nomeUtente: req.body.nomeUtente,
    cognomeUtente: req.body.cognomeUtente,
    mailUtente: req.body.mailUtente,
    passwordUtente: hashpassword,
    })
try {
    const newutente = await utente.save()
    res.status(200).send({
        message: "Utente aggiunto",
        payload: newutente,
    })
} catch (error) {
    res.status(500).send({
        message: "Internal Server Error",
        error: error,
    })
}
})

// // Login a seguito registrazione

app.post("/api/login", async(req, res)=>{
    const utente = await Utente.findOne({
    mailUtente: req.body.mailUtente,
    })
    if(!utente){
    return res.status(400).send("Utente non trovato")
    }
    const validPassword = await bcrypt.compare(req.body.passwordUtente, utente.passwordUtente)
    if(!validPassword){
    return res.status(400).send("Password non valida")
    }
    const token = jwt.sign({
        name: utente.nomeUtente,
        surname: utente.cognomeUtente,
        email: utente.mailUtente,
        id: utente._id,
    }, process.env.JWT_SECRET, {expiresIn: "15m"})
    res.header("Authorization", token).status(200).send(
    token
    )
    })



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
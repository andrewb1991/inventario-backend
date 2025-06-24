// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const ExcelJS = require('exceljs');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7070;

// Middleware
app.use(cors());
app.use(express.json());

// Connessione MongoDB
mongoose.connect('mongodb+srv://andreabramucci:HcvlnZT1IDuJrzjV@inventario.k0r6ima.mongodb.net/', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schema Prodotto
const productSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  quantita: { type: Number, required: true, default: 0 },
  quantitaMinima: { type: Number, required: true, default: 0 },
  unitaMisura: { type: String, default: 'pz' },
  createdAt: { type: Date, default: Date.now },
utenteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Utente', required: true },
});

// Schema Utilizzo
const utilizzoSchema = new mongoose.Schema({
  prodottoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  nomeProdotto: { type: String, required: true },
  quantitaUtilizzata: { type: Number, required: true },
  dataUtilizzo: { type: Date, default: Date.now },
utenteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Utente', required: true },
});

// Schema Utente
const utenteSchema = new mongoose.Schema({
  nomeUtente: { type: String, required: true },
  cognomeUtente: { type: String, required: true },
  mailUtente: { type: String, required: true, unique: true },
  passwordUtente: { type: String, required: true, min: 8 },
});

const Product = mongoose.model('Product', productSchema);
const Utilizzo = mongoose.model('Utilizzo', utilizzoSchema);
const Utente = mongoose.model('Utente', utenteSchema);

// Middleware autenticazione
function authenticateToken(req, res, next) {
  const token = req.header('Authorization');
  if (!token) return res.status(401).send('Accesso negato');

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send('Token non valido');
  }
}

// Routes

app.get('/api/prodotti', authenticateToken, async (req, res) => {
  try {
    const prodotti = await Product.find({ utenteId: req.user.id }).sort({ nome: 1 });
    res.json(prodotti);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/prodotti', authenticateToken, async (req, res) => {
  try {
    const prodotto = new Product({ ...req.body, utenteId: req.user.id });
    const savedProdotto = await prodotto.save();
    res.status(201).json(savedProdotto);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.put('/api/prodotti/:id', authenticateToken, async (req, res) => {
  try {
    const prodotto = await Product.findOneAndUpdate(
      { _id: req.params.id, utenteId: req.user.id },
      req.body,
      { new: true }
    );
    if (!prodotto) return res.status(404).json({ message: 'Prodotto non trovato' });
    res.json(prodotto);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post('/api/prodotti/:id/utilizza', authenticateToken, async (req, res) => {
  try {
    const prodotto = await Product.findOne({ _id: req.params.id, utenteId: req.user.id });
    if (!prodotto) return res.status(404).json({ message: 'Prodotto non trovato' });

    if (prodotto.quantita <= 0) return res.status(400).json({ message: 'Quantità insufficiente' });

    prodotto.quantita -= 1;
    await prodotto.save();

    const utilizzo = new Utilizzo({
      prodottoId: prodotto._id,
      nomeProdotto: prodotto.nome,
      quantitaUtilizzata: 1,
      utenteId: req.user.id
    });
    await utilizzo.save();

    res.json({ prodotto, utilizzo });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/utilizzi', authenticateToken, async (req, res) => {
  try {
    const { dataInizio, dataFine } = req.query;
    let filter = { utenteId: req.user.id };

    if (dataInizio || dataFine) {
      filter.dataUtilizzo = {};
      if (dataInizio) filter.dataUtilizzo.$gte = new Date(dataInizio);
      if (dataFine) filter.dataUtilizzo.$lte = new Date(dataFine);
    }

    const utilizzi = await Utilizzo.find(filter).populate('prodottoId').sort({ dataUtilizzo: -1 });
    res.json(utilizzi);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Login e Registrazione
app.post("/api/register", async (req, res) => {
  const salt = await bcrypt.genSalt(10);
  const hashpassword = await bcrypt.hash(req.body.passwordUtente, salt);
  const utente = new Utente({
    nomeUtente: req.body.nomeUtente,
    cognomeUtente: req.body.cognomeUtente,
    mailUtente: req.body.mailUtente,
    passwordUtente: hashpassword,
  });
  try {
    const newutente = await utente.save();
    res.status(200).send({ message: "Utente aggiunto", payload: newutente });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error", error });
  }
});

app.post("/api/login", async (req, res) => {
  const utente = await Utente.findOne({ mailUtente: req.body.mailUtente });
  if (!utente) return res.status(400).send("Utente non trovato");

  const validPassword = await bcrypt.compare(req.body.passwordUtente, utente.passwordUtente);
  if (!validPassword) return res.status(400).send("Password non valida");

  const token = jwt.sign({
    id: utente._id,
    nome: utente.nomeUtente,
    cognome: utente.cognomeUtente,
    email: utente.mailUtente
  }, process.env.JWT_SECRET, { expiresIn: "1h" });

  res.status(200).json({ token });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

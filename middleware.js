const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).send('Accesso negato');

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified; // Qui avrai id, nome, ecc.
    next();
  } catch (err) {
    res.status(400).send('Token non valido');
  }
};
module.exports = authenticateToken;

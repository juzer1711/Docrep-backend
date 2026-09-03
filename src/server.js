const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initPool, closePool } = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');

const authRoutes = require('./routes/authRoutes');
const facturasRoutes = require('./routes/facturasRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve las fotos guardadas
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/facturas', facturasRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Docrep backend activo' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;

async function start() {
  await initPool();
  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log('\n🛑 Cerrando servidor...');
    server.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
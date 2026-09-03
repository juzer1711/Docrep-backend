const oracledb = require('oracledb');
require('dotenv').config();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false; // manejamos commit manual por transacción

let pool;

async function initPool() {
  try {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
      poolMin: Number(process.env.DB_POOL_MIN) || 2,
      poolMax: Number(process.env.DB_POOL_MAX) || 10,
      poolIncrement: Number(process.env.DB_POOL_INCREMENT) || 1,
    });
    console.log('✅ Pool de conexiones Oracle inicializado');
  } catch (err) {
    console.error('❌ Error inicializando el pool de Oracle:', err);
    process.exit(1);
  }
}

async function getConnection() {
  if (!pool) {
    throw new Error('El pool de Oracle no ha sido inicializado. Llama initPool() primero.');
  }
  return pool.getConnection();
}

async function closePool() {
  if (pool) {
    await pool.close(10); // espera hasta 10s a que cierren las conexiones activas
    console.log('🔒 Pool de Oracle cerrado');
  }
}

module.exports = { initPool, getConnection, closePool, oracledb };
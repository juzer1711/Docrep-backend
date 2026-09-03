function errorHandler(err, req, res, next) {
  console.error('🔥 Error:', err.message);

  if (err.message && err.message.includes('ORA-')) {
    return res.status(400).json({
      ok: false,
      error: 'Error de base de datos',
      detalle: err.message,
    });
  }

  if (err instanceof require('multer').MulterError) {
    return res.status(400).json({ ok: false, error: err.message });
  }

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Error interno del servidor',
  });
}

module.exports = errorHandler;
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_docrep';

// 1. Verificar si el usuario adjuntó un Token válido en el Header (Authorization: Bearer <token>)
exports.verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extraer "Bearer <token>"

  if (!token) {
    return res.status(401).json({ ok: false, mensaje: 'Acceso denegado: No se proporcionó Token de autenticación' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded; // Guardamos los datos del usuario en req.usuario
    next();
  } catch (error) {
    return res.status(403).json({ ok: false, mensaje: 'Token inválido o expirado' });
  }
};

// 2. Verificar si el usuario tiene el rol requerido
exports.permitirRoles = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        ok: false,
        mensaje: `Acceso denegado: Se requiere rol de [${rolesPermitidos.join(', ')}] para esta acción`
      });
    }
    next();
  };
};
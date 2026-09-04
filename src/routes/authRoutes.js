const express = require('express');
const router = express.Router();
const { login, crearUsuario, actualizarUsuario, cambiarEstadoUsuario, obtenerUsuarioPorId, obtenerUsuarios } = require('../controllers/authController');
const { verificarToken, permitirRoles } = require('../middlewares/authMiddleware');

router.post('/login', login);

// PROTEGIDO: Solo usuarios con rol ADMINISTRADOR pueden crear nuevos usuarios

router.get(
  '/usuarios', 
  verificarToken, 
  permitirRoles('ADMINISTRADOR'), 
  obtenerUsuarios
);

router.get(
  '/usuarios/:id', 
  verificarToken, 
  permitirRoles('ADMINISTRADOR'), 
  obtenerUsuarioPorId
);

router.post(
  '/usuarios', 
  verificarToken, 
  permitirRoles('ADMINISTRADOR'), 
  crearUsuario
);

router.put(
  '/usuarios/:id', 
  verificarToken, 
  permitirRoles('ADMINISTRADOR'), 
  actualizarUsuario
);

router.patch(
  '/usuarios/:id/estado', 
  verificarToken, 
  permitirRoles('ADMINISTRADOR'), 
  cambiarEstadoUsuario
);

module.exports = router;
const express = require('express');

const router = express.Router();

const upload = require('../middlewares/upload');

const {
  verificarToken,
  permitirRoles,
} = require('../middlewares/authMiddleware');

const {
  crearFactura,
  listarFacturas,
  detalleFactura,
  revisarFactura,
  registrarNovedad,
  actualizarNovedad,
  resolverNovedad,
  entregarAdmin,
  finalizarFactura,
  actualizarFactura,
  eliminarFactura,
  eliminarNovedad,
} = require('../controllers/facturasController');

// Crear factura
router.post(
  '/',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  upload.single('foto'),
  crearFactura
);

// Listar facturas
router.get(
  '/',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR', 'CONTABILIDAD'),
  listarFacturas
);

// Detalle de factura
router.get(
  '/:id',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR', 'CONTABILIDAD'),
  detalleFactura
);

// Actualizar factura
router.put(
  '/:id',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  upload.single('foto'),
  actualizarFactura
);

// Eliminar factura
router.delete(
  '/:id',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  eliminarFactura
);

// Revisar factura
router.put(
  '/:id/revisar',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  revisarFactura
);

// Registrar novedad
router.post(
  '/:id/novedades',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  upload.single('foto_evidencia'),
  registrarNovedad
);

// Actualizar novedad
router.put(
  '/:id/novedades/:idNovedad',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  upload.single('foto_evidencia'),
  actualizarNovedad
);

// Resolver novedad
router.put(
  '/:id/novedades/:idNovedad/resolver',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  resolverNovedad
);

// Eliminar novedad
router.delete(
  '/:id/novedades/:idNovedad',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  eliminarNovedad
);

// Entregar a Administración
router.put(
  '/:id/entregar-admin',
  verificarToken,
  permitirRoles('BODEGA', 'ADMINISTRADOR'),
  entregarAdmin
);

// Finalizar factura
router.put(
  '/:id/finalizar',
  verificarToken,
  permitirRoles('CONTABILIDAD', 'ADMINISTRADOR'),
  finalizarFactura
);

module.exports = router;
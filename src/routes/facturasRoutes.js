const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const {
  crearFactura,
  listarFacturas,
  detalleFactura,
  revisarFactura,
  registrarNovedad,
  marcarNovedadFactura,
  entregarAdmin,
  finalizarFactura,
} = require('../controllers/facturasController');

router.post('/', upload.single('foto'), crearFactura);
router.post('/:id/novedades', upload.single('foto_evidencia'), registrarNovedad);
router.get('/', listarFacturas);
router.get('/:id', detalleFactura);
router.put('/:id/revisar', revisarFactura);
router.put('/:id/novedad', marcarNovedadFactura);
router.put('/:id/entregar-admin', entregarAdmin);
router.put('/:id/finalizar', finalizarFactura);

module.exports = router;
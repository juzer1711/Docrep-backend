const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const {
  crearFactura,
  listarFacturas,
  detalleFactura,
  revisarFactura,
} = require('../controllers/facturasController');

router.post('/', upload.single('foto'), crearFactura);
router.get('/', listarFacturas);
router.get('/:id', detalleFactura);
router.put('/:id/revisar', revisarFactura);

module.exports = router;
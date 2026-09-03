const fs = require('fs');
const { getConnection, oracledb } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/facturas
// FormData: numero_factura, proveedor, id_usuario, firma_base64, foto (file)
exports.crearFactura = asyncHandler(async (req, res) => {
  const { numero_factura, proveedor, id_usuario, firma_base64 } = req.body;
  const fotoFile = req.file;

  if (!numero_factura || !proveedor || !id_usuario || !firma_base64 || !fotoFile) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);
    return res.status(400).json({
      ok: false,
      error: 'Faltan campos obligatorios (numero_factura, proveedor, id_usuario, firma_base64, foto)',
    });
  }

  const urlFoto = `/uploads/${fotoFile.filename}`;

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `BEGIN
         pkg_recepciones.sp_registrar_factura(
           p_numero_factura => :p_numero_factura,
           p_proveedor      => :p_proveedor,
           p_url_foto       => :p_url_foto,
           p_id_usuario     => :p_id_usuario,
           p_firma_base64   => :p_firma_base64,
           o_id_factura     => :o_id_factura
         );
       END;`,
      {
        p_numero_factura: numero_factura,
        p_proveedor: proveedor,
        p_url_foto: urlFoto,
        p_id_usuario: Number(id_usuario),
        p_firma_base64: { val: firma_base64, type: oracledb.CLOB },
        o_id_factura: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    // El SP ya hace COMMIT internamente, pero por si acaso:
    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: 'Factura registrada correctamente',
      id_factura: result.outBinds.o_id_factura,
      url_foto: urlFoto,
    });
  } catch (err) {
    if (fotoFile) fs.unlinkSync(fotoFile.path); // limpia el archivo si el SP falla
    throw err;
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/facturas
exports.listarFacturas = asyncHandler(async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT id_factura, numero_factura, proveedor, url_foto, estado,
              id_usuario_recepcion, fecha_recepcion,
              id_usuario_revision, fecha_revision,
              id_usuario_admin, fecha_entrega_admin
         FROM facturas
        ORDER BY fecha_recepcion DESC`
    );

    res.json({ ok: true, facturas: result.rows });
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/facturas/:id
exports.detalleFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await getConnection();

    const facturaResult = await connection.execute(
      `SELECT * FROM facturas WHERE id_factura = :id`,
      { id: Number(id) }
    );

    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    }

    const novedadesResult = await connection.execute(
      `SELECT * FROM novedades_producto WHERE id_factura = :id`,
      { id: Number(id) }
    );

    const firmasResult = await connection.execute(
      `SELECT id_firma, tipo_etapa, id_usuario, fecha_registro
         FROM firmas_custodia
        WHERE id_factura = :id
        ORDER BY fecha_registro ASC`,
      { id: Number(id) }
    );

    res.json({
      ok: true,
      factura: facturaResult.rows[0],
      novedades: novedadesResult.rows,
      firmas: firmasResult.rows, // sin traer el CLOB completo de firma_base64 por tamaño
    });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/revisar
// body: { id_usuario, firma_base64 }
// Nota: el SP fija el estado a 'EN_REVISION' internamente, no se envía estado desde el cliente.
exports.revisarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { id_usuario, firma_base64 } = req.body;

  if (!id_usuario || !firma_base64) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan campos obligatorios (id_usuario, firma_base64)',
    });
  }

  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_recepciones.sp_revisar_factura(
           p_id_factura   => :p_id_factura,
           p_id_usuario   => :p_id_usuario,
           p_firma_base64 => :p_firma_base64
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_id_usuario: Number(id_usuario),
        p_firma_base64: { val: firma_base64, type: oracledb.CLOB },
      }
    );

    await connection.commit();

    res.json({ ok: true, mensaje: 'Factura marcada como EN_REVISION correctamente' });
  } finally {
    if (connection) await connection.close();
  }
});
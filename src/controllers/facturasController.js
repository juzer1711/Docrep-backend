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

    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: 'Factura registrada correctamente',
      id_factura: result.outBinds.o_id_factura,
      url_foto: urlFoto,
    });
  } catch (err) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);
    throw err;
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/facturas
exports.listarFacturas = asyncHandler(async (req, res) => {
  const estadosValidos = new Set([
    'RECIBIDA',
    'EN_REVISION',
    'CON_NOVEDAD',
    'ENTREGADA_ADMIN',
    'FINALIZADA',
  ]);
  const novedadesValidas = new Set(['con', 'sin']);
  const { buscar, estado, fecha_desde, fecha_hasta, novedades } = req.query;

  const parametroUnico = (valor) =>
    typeof valor === 'string' || valor === undefined;
  const fechaValida = (fecha) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia));
    return (
      fechaUtc.getUTCFullYear() === anio &&
      fechaUtc.getUTCMonth() === mes - 1 &&
      fechaUtc.getUTCDate() === dia
    );
  };

  if (![buscar, estado, fecha_desde, fecha_hasta, novedades].every(parametroUnico)) {
    return res.status(400).json({ ok: false, error: 'Los filtros deben tener un único valor.' });
  }

  const estadoNormalizado = estado?.trim().toUpperCase();
  const novedadesNormalizadas = novedades?.trim().toLowerCase();

  if (estadoNormalizado && !estadosValidos.has(estadoNormalizado)) {
    return res.status(400).json({ ok: false, error: 'El estado indicado no es válido.' });
  }

  if (novedadesNormalizadas && !novedadesValidas.has(novedadesNormalizadas)) {
    return res.status(400).json({ ok: false, error: 'El filtro novedades debe ser "con" o "sin".' });
  }

  if (fecha_desde && !fechaValida(fecha_desde)) {
    return res.status(400).json({ ok: false, error: 'fecha_desde debe tener el formato YYYY-MM-DD.' });
  }

  if (fecha_hasta && !fechaValida(fecha_hasta)) {
    return res.status(400).json({ ok: false, error: 'fecha_hasta debe tener el formato YYYY-MM-DD.' });
  }

  if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
    return res.status(400).json({ ok: false, error: 'fecha_desde no puede ser posterior a fecha_hasta.' });
  }

  const condiciones = [];
  const binds = {};

  if (buscar?.trim()) {
    condiciones.push(`(
      LOWER(f.numero_factura) LIKE LOWER(:buscar)
      OR LOWER(f.proveedor) LIKE LOWER(:buscar)
      OR TO_CHAR(f.id_factura) LIKE :buscar
    )`);
    binds.buscar = `%${buscar.trim()}%`;
  }

  if (estadoNormalizado) {
    condiciones.push('f.estado = :estado');
    binds.estado = estadoNormalizado;
  }

  if (fecha_desde) {
    condiciones.push("f.fecha_recepcion >= TO_DATE(:fecha_desde, 'YYYY-MM-DD')");
    binds.fecha_desde = fecha_desde;
  }

  if (fecha_hasta) {
    // El límite superior exclusivo incluye toda la fecha final sin depender de zona horaria.
    condiciones.push("f.fecha_recepcion < TO_DATE(:fecha_hasta, 'YYYY-MM-DD') + 1");
    binds.fecha_hasta = fecha_hasta;
  }

  if (novedadesNormalizadas) {
    const existeNovedad = `EXISTS (
      SELECT 1
        FROM novedades_producto n
       WHERE n.id_factura = f.id_factura
    )`;
    condiciones.push(novedadesNormalizadas === 'con' ? existeNovedad : `NOT ${existeNovedad}`);
  }

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT f.id_factura, f.numero_factura, f.proveedor, f.url_foto, f.estado,
              f.id_usuario_recepcion, f.fecha_recepcion,
              f.id_usuario_revision, f.fecha_revision,
              f.id_usuario_admin, f.fecha_entrega_admin,
              f.observaciones,
              (
                SELECT COUNT(*)
                  FROM novedades_producto n
                 WHERE n.id_factura = f.id_factura
              ) AS total_novedades
         FROM facturas f
        ${condiciones.length ? `WHERE ${condiciones.join('\n          AND ')}` : ''}
        ORDER BY f.fecha_recepcion DESC`,
      binds
    );

    res.json({ ok: true, facturas: result.rows });
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/facturas/:id
// Retorna la factura + firmas de custodia + novedades registradas
exports.detalleFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await getConnection();

    const facturaResult = await connection.execute(
      `SELECT id_factura, numero_factura, proveedor, url_foto, estado,
              id_usuario_recepcion, fecha_recepcion,
              id_usuario_revision, fecha_revision,
              id_usuario_admin, fecha_entrega_admin,
              observaciones
         FROM facturas 
        WHERE id_factura = :id`,
      { id: Number(id) }
    );

    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    }

    const firmasResult = await connection.execute(
      `SELECT id_firma, tipo_etapa, id_usuario, fecha_registro
         FROM firmas_custodia
        WHERE id_factura = :id
        ORDER BY fecha_registro ASC`,
      { id: Number(id) }
    );

    const novedadesResult = await connection.execute(
      `SELECT id_novedad, codigo_referencia, descripcion_producto, tipo_novedad,
              cantidad, observaciones, url_foto_evidencia, fecha_registro
         FROM novedades_producto
        WHERE id_factura = :id
        ORDER BY fecha_registro ASC`,
      { id: Number(id) }
    );

    res.json({
      ok: true,
      factura: facturaResult.rows[0],
      firmas: firmasResult.rows,
      novedades: novedadesResult.rows,
    });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/revisar
// body: { id_usuario, firma_base64 }
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

// PUT /api/facturas/:id/novedad
// body: { observacion }
exports.marcarNovedadFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { observacion } = req.body;

  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_recepciones.sp_marcar_novedad_factura(
           p_id_factura  => :p_id_factura,
           p_observacion => :p_observacion
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_observacion: observacion || 'Novedad registrada en la factura',
      }
    );

    await connection.commit();

    res.json({ ok: true, mensaje: 'Factura marcada como CON_NOVEDAD correctamente' });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/entregar-admin
// body: { id_usuario, firma_base64 }
exports.entregarAdmin = asyncHandler(async (req, res) => {
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
         pkg_recepciones.sp_entregar_admin(
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

    res.json({ ok: true, mensaje: 'Factura entregada a Administración correctamente' });
  } finally {
    if (connection) await connection.close();
  }
});

// POST /api/facturas/:id/novedades
// FormData: codigo_referencia, descripcion_producto, tipo_novedad, cantidad,
//           observaciones, foto_evidencia (file, opcional)
exports.registrarNovedad = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    codigo_referencia,
    descripcion_producto,
    tipo_novedad,
    cantidad,
    observaciones,
  } = req.body;
  const fotoFile = req.file;

  const tiposValidos = ['INCOMPLETO', 'AVERIADO', 'EXCEDENTE'];

  if (!tipo_novedad || !tiposValidos.includes(tipo_novedad)) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);
    return res.status(400).json({
      ok: false,
      error: `tipo_novedad es obligatorio y debe ser uno de: ${tiposValidos.join(', ')}`,
    });
  }

  const urlFotoEvidencia = fotoFile ? `/uploads/${fotoFile.filename}` : null;

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `BEGIN
         pkg_recepciones.sp_registrar_novedad(
           p_id_factura           => :p_id_factura,
           p_codigo_referencia    => :p_codigo_referencia,
           p_descripcion_producto => :p_descripcion_producto,
           p_tipo_novedad         => :p_tipo_novedad,
           p_cantidad             => :p_cantidad,
           p_observaciones        => :p_observaciones,
           p_url_foto_evidencia   => :p_url_foto_evidencia,
           o_id_novedad           => :o_id_novedad
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_codigo_referencia: codigo_referencia || null,
        p_descripcion_producto: descripcion_producto || null,
        p_tipo_novedad: tipo_novedad,
        p_cantidad: cantidad ? Number(cantidad) : 1,
        p_observaciones: observaciones || null,
        p_url_foto_evidencia: urlFotoEvidencia,
        o_id_novedad: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );

    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: 'Novedad registrada correctamente',
      id_novedad: result.outBinds.o_id_novedad,
      url_foto_evidencia: urlFotoEvidencia,
    });
  } catch (err) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);
    throw err;
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/finalizar
// Marca la factura como FINALIZADA
exports.finalizarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_recepciones.sp_finalizar_factura(
           p_id_factura => :p_id_factura
         );
       END;`,
      {
        p_id_factura: Number(id),
      }
    );

    await connection.commit();

    res.json({
      ok: true,
      mensaje: 'Factura marcada como FINALIZADA correctamente por Contabilidad',
    });
  } finally {
    if (connection) await connection.close();
  }
});

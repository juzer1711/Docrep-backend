const fs = require('fs');
const { getConnection, oracledb } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/facturas
// FormData: numero_factura, proveedor, nombre_firmante, firma_base64, foto
exports.crearFactura = asyncHandler(async (req, res) => {
  const {
    numero_factura,
    proveedor,
    nombre_firmante,
    firma_base64,
  } = req.body;

  const id_usuario = req.usuario.id_usuario;
  const fotoFile = req.file;

  if (
    !numero_factura ||
    !proveedor ||
    !nombre_firmante ||
    !firma_base64 ||
    !fotoFile
  ) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);

    return res.status(400).json({
      ok: false,
      error:
        'Faltan campos obligatorios (numero_factura, proveedor, nombre_firmante, firma_base64, foto)',
    });
  }

  const urlFoto = `/uploads/${fotoFile.filename}`;

  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `BEGIN
         pkg_facturas.sp_registrar_factura(
           p_numero_factura => :p_numero_factura,
           p_proveedor      => :p_proveedor,
           p_url_foto       => :p_url_foto,
           p_id_usuario     => :p_id_usuario,
           p_nombre_firmante => :p_nombre_firmante,
           p_firma_base64   => :p_firma_base64,
           o_id_factura     => :o_id_factura
         );
       END;`,
      {
        p_numero_factura: numero_factura,
        p_proveedor: proveedor,
        p_url_foto: urlFoto,
        p_id_usuario: Number(id_usuario),
        p_nombre_firmante: nombre_firmante,
        p_firma_base64: {
          val: firma_base64,
          type: oracledb.CLOB,
        },
        o_id_factura: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      }
    );

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

  if (
    ![buscar, estado, fecha_desde, fecha_hasta, novedades].every(
      parametroUnico
    )
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Los filtros deben tener un único valor.',
    });
  }

  const estadoNormalizado = estado?.trim().toUpperCase();
  const novedadesNormalizadas = novedades?.trim().toLowerCase();

  if (estadoNormalizado && !estadosValidos.has(estadoNormalizado)) {
    return res.status(400).json({
      ok: false,
      error: 'El estado indicado no es válido.',
    });
  }

  if (
    novedadesNormalizadas &&
    !novedadesValidas.has(novedadesNormalizadas)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'El filtro novedades debe ser "con" o "sin".',
    });
  }

  if (fecha_desde && !fechaValida(fecha_desde)) {
    return res.status(400).json({
      ok: false,
      error: 'fecha_desde debe tener el formato YYYY-MM-DD.',
    });
  }

  if (fecha_hasta && !fechaValida(fecha_hasta)) {
    return res.status(400).json({
      ok: false,
      error: 'fecha_hasta debe tener el formato YYYY-MM-DD.',
    });
  }

  if (fecha_desde && fecha_hasta && fecha_desde > fecha_hasta) {
    return res.status(400).json({
      ok: false,
      error: 'fecha_desde no puede ser posterior a fecha_hasta.',
    });
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
    condiciones.push(
      "f.fecha_recepcion >= TO_DATE(:fecha_desde, 'YYYY-MM-DD')"
    );
    binds.fecha_desde = fecha_desde;
  }

  if (fecha_hasta) {
    condiciones.push(
      "f.fecha_recepcion < TO_DATE(:fecha_hasta, 'YYYY-MM-DD') + 1"
    );
    binds.fecha_hasta = fecha_hasta;
  }

  if (novedadesNormalizadas) {
    const existeNovedad = `EXISTS (
      SELECT 1
        FROM novedades_producto n
       WHERE n.id_factura = f.id_factura
    )`;

    condiciones.push(
      novedadesNormalizadas === 'con'
        ? existeNovedad
        : `NOT ${existeNovedad}`
    );
  }

  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT f.id_factura,
              f.numero_factura,
              f.proveedor,
              f.url_foto,
              f.estado,
              f.id_usuario_recepcion,
              f.fecha_recepcion,
              f.id_usuario_revision,
              f.fecha_revision,
              f.id_usuario_admin,
              f.fecha_entrega_admin,
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

    res.json({
      ok: true,
      facturas: result.rows,
    });
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/facturas/:id
// Retorna factura + firmas + novedades
exports.detalleFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let connection;
  let firmasCursor;
  let novedadesCursor;

  try {
    connection = await getConnection();

    const facturaResult = await connection.execute(
      `SELECT id_factura,
              numero_factura,
              proveedor,
              url_foto,
              estado,
              id_usuario_recepcion,
              fecha_recepcion,
              id_usuario_revision,
              fecha_revision,
              id_usuario_admin,
              fecha_entrega_admin,
              observaciones
         FROM facturas
        WHERE id_factura = :id`,
      {
        id: Number(id),
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    if (facturaResult.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Factura no encontrada',
      });
    }

    // ============================
    // FIRMAS MEDIANTE PKG
    // ============================

    const firmasResult = await connection.execute(
      `BEGIN
         pkg_facturas.sp_listar_firmas_factura(
           p_id_factura => :p_id_factura,
           p_cursor     => :p_cursor
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_cursor: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },
      }
    );

    firmasCursor = firmasResult.outBinds.p_cursor;

    const firmasRows = await firmasCursor.getRows();

    // Convertimos los CLOB de Oracle a strings normales
    const firmas = await Promise.all(
      firmasRows.map(async (firma) => {
        let firmaBase64 = firma.FIRMA_BASE64;

        if (
          firmaBase64 &&
          typeof firmaBase64 === 'object' &&
          typeof firmaBase64.getData === 'function'
        ) {
          firmaBase64 = await firmaBase64.getData();
        }

        return {
          ID_FIRMA: firma.ID_FIRMA,
          ID_FACTURA: firma.ID_FACTURA,
          TIPO_ETAPA: firma.TIPO_ETAPA,
          ID_USUARIO: firma.ID_USUARIO,
          NOMBRE_USUARIO: firma.NOMBRE_USUARIO,
          NOMBRE_FIRMANTE: firma.NOMBRE_FIRMANTE,
          FIRMA_BASE64: firmaBase64,
          FECHA_REGISTRO: firma.FECHA_REGISTRO,
        };
      })
    );

    // ============================
    // NOVEDADES MEDIANTE PKG
    // ============================

    const novedadesResult = await connection.execute(
      `BEGIN
         pkg_facturas.sp_listar_novedades_factura(
           p_id_factura => :p_id_factura,
           p_cursor     => :p_cursor
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_cursor: {
          dir: oracledb.BIND_OUT,
          type: oracledb.CURSOR,
        },
      }
    );

    novedadesCursor = novedadesResult.outBinds.p_cursor;

    const novedades = await novedadesCursor.getRows();

    // ============================
    // RESPUESTA
    // ============================

    res.json({
      ok: true,
      factura: facturaResult.rows[0],
      firmas,
      novedades,
    });
  } finally {
    if (firmasCursor) {
      await firmasCursor.close();
    }

    if (novedadesCursor) {
      await novedadesCursor.close();
    }

    if (connection) {
      await connection.close();
    }
  }
});

// PUT /api/facturas/:id/revisar
// body: { nombre_firmante, firma_base64 }
exports.revisarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre_firmante, firma_base64 } = req.body;
  const id_usuario = req.usuario.id_usuario;

  if (!nombre_firmante || !firma_base64) {
    return res.status(400).json({
      ok: false,
      error:
        'Faltan los campos obligatorios nombre_firmante y firma_base64',
    });
  }

  let connection;

  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_revisar_factura(
           p_id_factura    => :p_id_factura,
           p_id_usuario    => :p_id_usuario,
           p_nombre_firmante => :p_nombre_firmante,
           p_firma_base64  => :p_firma_base64
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_id_usuario: Number(id_usuario),
        p_nombre_firmante: nombre_firmante,
        p_firma_base64: {
          val: firma_base64,
          type: oracledb.CLOB,
        },
      }
    );

    res.json({
      ok: true,
      mensaje: 'Factura marcada como EN_REVISION correctamente',
    });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/entregar-admin
// body: { nombre_firmante, firma_base64 }
exports.entregarAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre_firmante, firma_base64 } = req.body;
  const id_usuario = req.usuario.id_usuario;

  if (!nombre_firmante || !firma_base64) {
    return res.status(400).json({
      ok: false,
      error:
        'Faltan los campos obligatorios nombre_firmante y firma_base64',
    });
  }

  let connection;

  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_entregar_admin(
           p_id_factura      => :p_id_factura,
           p_id_usuario      => :p_id_usuario,
           p_nombre_firmante => :p_nombre_firmante,
           p_firma_base64    => :p_firma_base64
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_id_usuario: Number(id_usuario),
        p_nombre_firmante: nombre_firmante,
        p_firma_base64: {
          val: firma_base64,
          type: oracledb.CLOB,
        },
      }
    );

    res.json({
      ok: true,
      mensaje: 'Factura entregada a Administración correctamente',
    });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id
// body: { numero_factura, proveedor, observaciones }
// foto: opcional
exports.actualizarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    numero_factura,
    proveedor,
    observaciones,
  } = req.body;

  const fotoFile = req.file;

  let connection;

  try {
    connection = await getConnection();

    // Si llega una nueva foto, usamos esa.
    // Si no llega, conservamos la foto actual de la factura.
    let urlFoto;

    if (fotoFile) {
      urlFoto = `/uploads/${fotoFile.filename}`;
    } else {
      const facturaActual = await connection.execute(
        `SELECT url_foto
           FROM facturas
          WHERE id_factura = :id_factura`,
        {
          id_factura: Number(id),
        },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        }
      );

      if (facturaActual.rows.length === 0) {
        return res.status(404).json({
          ok: false,
          error: 'Factura no encontrada',
        });
      }

      urlFoto = facturaActual.rows[0].URL_FOTO;
    }

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_actualizar_factura(
           p_id_factura     => :p_id_factura,
           p_numero_factura => :p_numero_factura,
           p_proveedor      => :p_proveedor,
           p_url_foto       => :p_url_foto,
           p_observaciones  => :p_observaciones
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_numero_factura: numero_factura || null,
        p_proveedor: proveedor || null,
        p_url_foto: urlFoto,
        p_observaciones: observaciones || null,
      }
    );

    res.json({
      ok: true,
      mensaje: 'Factura actualizada correctamente',
      url_foto: urlFoto,
    });
  } catch (err) {
    if (fotoFile) {
      fs.unlinkSync(fotoFile.path);
    }

    throw err;
  } finally {
    if (connection) {
      await connection.close();
    }
  }
});

// DELETE /api/facturas/:id
exports.eliminarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let connection;

  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_eliminar_factura(
           p_id_factura => :p_id_factura
         );
       END;`,
      {
        p_id_factura: Number(id),
      }
    );

    res.json({
      ok: true,
      mensaje: 'Factura eliminada correctamente',
    });
  } finally {
    if (connection) await connection.close();
  }
});

// POST /api/facturas/:id/novedades
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

  const tiposValidos = [
    'INCOMPLETO',
    'AVERIADO',
    'EXCEDENTE',
  ];

  if (!tipo_novedad || !tiposValidos.includes(tipo_novedad)) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);

    return res.status(400).json({
      ok: false,
      error: `tipo_novedad es obligatorio y debe ser uno de: ${tiposValidos.join(', ')}`,
    });
  }

  const urlFotoEvidencia = fotoFile
    ? `/uploads/${fotoFile.filename}`
    : null;

  let connection;

  try {
    connection = await getConnection();

    const result = await connection.execute(
      `BEGIN
         pkg_facturas.sp_registrar_novedad(
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
        o_id_novedad: {
          dir: oracledb.BIND_OUT,
          type: oracledb.NUMBER,
        },
      }
    );

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

// PUT /api/facturas/:id/novedades/:idNovedad
exports.actualizarNovedad = asyncHandler(async (req, res) => {
  const { id, idNovedad } = req.params;

  const {
    codigo_referencia,
    descripcion_producto,
    tipo_novedad,
    cantidad,
    observaciones,
  } = req.body;

  const fotoFile = req.file;

  const tiposValidos = [
    'INCOMPLETO',
    'AVERIADO',
    'EXCEDENTE',
  ];

  if (!tipo_novedad || !tiposValidos.includes(tipo_novedad)) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);

    return res.status(400).json({
      ok: false,
      error: `tipo_novedad es obligatorio y debe ser uno de: ${tiposValidos.join(', ')}`,
    });
  }

  let connection;

  try {
    connection = await getConnection();

    const existeNovedad = await connection.execute(
      `SELECT url_foto_evidencia
         FROM novedades_producto
        WHERE id_novedad = :id_novedad
          AND id_factura = :id_factura`,
      {
        id_novedad: Number(idNovedad),
        id_factura: Number(id),
      }
    );

    if (existeNovedad.rows.length === 0) {
      if (fotoFile) fs.unlinkSync(fotoFile.path);

      return res.status(404).json({
        ok: false,
        error: 'Novedad no encontrada para la factura indicada',
      });
    }

    const urlFotoEvidencia = fotoFile
      ? `/uploads/${fotoFile.filename}`
      : existeNovedad.rows[0].URL_FOTO_EVIDENCIA;

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_actualizar_novedad(
           p_id_novedad           => :p_id_novedad,
           p_codigo_referencia    => :p_codigo_referencia,
           p_descripcion_producto => :p_descripcion_producto,
           p_tipo_novedad         => :p_tipo_novedad,
           p_cantidad             => :p_cantidad,
           p_observaciones        => :p_observaciones,
           p_url_foto_evidencia   => :p_url_foto_evidencia
         );
       END;`,
      {
        p_id_novedad: Number(idNovedad),
        p_codigo_referencia: codigo_referencia || null,
        p_descripcion_producto: descripcion_producto || null,
        p_tipo_novedad: tipo_novedad,
        p_cantidad: cantidad ? Number(cantidad) : 1,
        p_observaciones: observaciones || null,
        p_url_foto_evidencia: urlFotoEvidencia,
      }
    );

    res.json({
      ok: true,
      mensaje: 'Novedad actualizada correctamente',
      url_foto_evidencia: urlFotoEvidencia,
    });
  } catch (err) {
    if (fotoFile) fs.unlinkSync(fotoFile.path);
    throw err;
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/novedades/:idNovedad/resolver
exports.resolverNovedad = asyncHandler(async (req, res) => {
  const { id, idNovedad } = req.params;
  const { observacion_resolucion } = req.body;
  const id_usuario = req.usuario.id_usuario;

  let connection;

  try {
    connection = await getConnection();

    const existeNovedad = await connection.execute(
      `SELECT 1
         FROM novedades_producto
        WHERE id_novedad = :id_novedad
          AND id_factura = :id_factura`,
      {
        id_novedad: Number(idNovedad),
        id_factura: Number(id),
      }
    );

    if (existeNovedad.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Novedad no encontrada para la factura indicada',
      });
    }

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_resolver_novedad(
           p_id_novedad             => :p_id_novedad,
           p_observacion_resolucion => :p_observacion_resolucion,
           p_id_usuario_resolucion  => :p_id_usuario_resolucion
         );
       END;`,
      {
        p_id_novedad: Number(idNovedad),
        p_observacion_resolucion:
          observacion_resolucion || null,
        p_id_usuario_resolucion: Number(id_usuario),
      }
    );

    res.json({
      ok: true,
      mensaje: 'Novedad resuelta correctamente',
    });
  } finally {
    if (connection) await connection.close();
  }
});

// DELETE /api/facturas/:id/novedades/:idNovedad
exports.eliminarNovedad = asyncHandler(async (req, res) => {
  const { id, idNovedad } = req.params;

  let connection;

  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_eliminar_novedad(
           p_id_novedad => :p_id_novedad
         );
       END;`,
      {
        p_id_novedad: Number(idNovedad),
      }
    );

    res.json({
      ok: true,
      mensaje: 'Novedad eliminada correctamente',
    });
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/facturas/:id/finalizar
// body: { nombre_firmante, firma_base64 }
exports.finalizarFactura = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    nombre_firmante,
    firma_base64,
  } = req.body;

  const id_usuario = req.usuario.id_usuario;

  if (!nombre_firmante || !firma_base64) {
    return res.status(400).json({
      ok: false,
      error:
        'Faltan los campos obligatorios nombre_firmante y firma_base64',
    });
  }

  let connection;

  try {
    connection = await getConnection();

    await connection.execute(
      `BEGIN
         pkg_facturas.sp_finalizar_factura(
           p_id_factura      => :p_id_factura,
           p_id_usuario      => :p_id_usuario,
           p_nombre_firmante => :p_nombre_firmante,
           p_firma_base64    => :p_firma_base64
         );
       END;`,
      {
        p_id_factura: Number(id),
        p_id_usuario: Number(id_usuario),
        p_nombre_firmante: nombre_firmante,
        p_firma_base64: {
          val: firma_base64,
          type: oracledb.CLOB,
        },
      }
    );

    res.json({
      ok: true,
      mensaje:
        'Factura marcada como FINALIZADA correctamente por Contabilidad',
    });
  } finally {
    if (connection) await connection.close();
  }
});
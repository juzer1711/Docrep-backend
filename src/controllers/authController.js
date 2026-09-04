const { getConnection, oracledb } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_docrep';

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { pin, correo, password } = req.body;

  if (!pin && !correo) {
    return res.status(400).json({ ok: false, error: 'El PIN o correo es obligatorio' });
  }

  let connection;
  try {
    connection = await getConnection();
    let query = '';
    let params = {};

    if (pin) {
      query = `SELECT id_usuario, nombre, correo, rol, codigo_pin, password_hash, estado 
                 FROM usuarios 
                WHERE codigo_pin = :pin`;
      params = { pin: String(pin) };
    } else {
      query = `SELECT id_usuario, nombre, correo, rol, codigo_pin, password_hash, estado 
                 FROM usuarios 
                WHERE correo = :correo`;
      params = { correo };
    }

    const result = await connection.execute(query, params, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const usuario = result.rows[0];

    if (usuario.ESTADO && usuario.ESTADO !== 'ACTIVO') {
      return res.status(403).json({ ok: false, error: 'Usuario inactivo' });
    }

    // Verificar contraseña encriptada en caso de ingresar con correo/password
    if (password && usuario.PASSWORD_HASH) {
      const validPassword = await bcrypt.compare(password, usuario.PASSWORD_HASH);
      if (!validPassword) {
        return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
      }
    }

    // Generar Token JWT
    const token = jwt.sign(
      {
        id_usuario: usuario.ID_USUARIO,
        nombre: usuario.NOMBRE,
        correo: usuario.CORREO,
        rol: usuario.ROL,
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      ok: true,
      mensaje: 'Inicio de sesión exitoso',
      token,
      usuario: {
        id_usuario: usuario.ID_USUARIO,
        nombre: usuario.NOMBRE,
        correo: usuario.CORREO,
        rol: usuario.ROL,
      },
    });
  } finally {
    if (connection) await connection.close();
  }
});

// POST /api/auth/usuarios (Crear nuevos usuarios - Solo Admin)
exports.crearUsuario = asyncHandler(async (req, res) => {
  const { nombre, correo, rol, codigo_pin, password } = req.body;

  if (!nombre || !rol || !codigo_pin) {
    return res.status(400).json({ ok: false, error: 'Nombre, Rol y PIN son obligatorios' });
  }

  let connection;
  try {
    connection = await getConnection();

    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    await connection.execute(
      `INSERT INTO usuarios (nombre, correo, rol, codigo_pin, password_hash) 
       VALUES (:nombre, :correo, :rol, :codigo_pin, :password_hash)`,
      {
        nombre,
        correo: correo || null,
        rol: rol.toUpperCase(),
        codigo_pin: String(codigo_pin),
        password_hash: hashedPassword,
      }
    );

    await connection.commit();

    res.status(201).json({
      ok: true,
      mensaje: 'Usuario registrado correctamente',
    });
  } catch (error) {
    if (error.message.includes('ORA-00001')) {
      return res.status(400).json({ ok: false, error: 'El correo o PIN ya está registrado' });
    }
    throw error;
  } finally {
    if (connection) await connection.close();
  }
});

// PUT /api/auth/usuarios/:id (Editar información de usuario)
exports.actualizarUsuario = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { nombre, correo, rol, codigo_pin, password } = req.body;

  let connection;
  try {
    connection = await getConnection();

    let query = `UPDATE usuarios 
                    SET nombre = COALESCE(:nombre, nombre),
                        correo = COALESCE(:correo, correo),
                        rol = COALESCE(:rol, rol),
                        codigo_pin = COALESCE(:codigo_pin, codigo_pin)`;
    
    const params = {
      id_usuario: id,
      nombre: nombre || null,
      correo: correo || null,
      rol: rol ? rol.toUpperCase() : null,
      codigo_pin: codigo_pin ? String(codigo_pin) : null
    };

    // Si se envía una nueva contraseña, la encriptamos y la actualizamos
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += `, password_hash = :password_hash`;
      params.password_hash = hashedPassword;
    }

    query += ` WHERE id_usuario = :id_usuario`;

    const result = await connection.execute(query, params);
    await connection.commit();

    if (result.rowsAffected === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({
      ok: true,
      mensaje: 'Usuario actualizado correctamente'
    });
  } catch (error) {
    if (error.message.includes('ORA-00001')) {
      return res.status(400).json({ ok: false, error: 'El correo o PIN ya está registrado por otro usuario' });
    }
    throw error;
  } finally {
    if (connection) await connection.close();
  }
});

// PATCH /api/auth/usuarios/:id/estado (Activar / Desactivar usuario)
exports.cambiarEstadoUsuario = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body; // Expects 'ACTIVO' or 'INACTIVO'

  if (!estado || !['ACTIVO', 'INACTIVO'].includes(estado.toUpperCase())) {
    return res.status(400).json({ ok: false, error: 'Estado inválido. Debe ser ACTIVO o INACTIVO' });
  }

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `UPDATE usuarios 
          SET estado = :estado 
        WHERE id_usuario = :id_usuario`,
      {
        estado: estado.toUpperCase(),
        id_usuario: id
      }
    );

    await connection.commit();

    if (result.rowsAffected === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({
      ok: true,
      mensaje: `Usuario marcado como ${estado.toUpperCase()} correctamente`
    });
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/auth/usuarios (Listar todos los usuarios - Solo Admin/Administración)
exports.obtenerUsuarios = asyncHandler(async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT id_usuario, nombre, correo, rol, codigo_pin, estado, fecha_creacion
         FROM usuarios
        ORDER BY id_usuario DESC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json({
      ok: true,
      usuarios: result.rows
    });
  } finally {
    if (connection) await connection.close();
  }
});

// GET /api/auth/usuarios/:id (Obtener detalle de un usuario específico)
exports.obtenerUsuarioPorId = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT id_usuario, nombre, correo, rol, codigo_pin, estado, fecha_creacion
         FROM usuarios
        WHERE id_usuario = :id`,
      { id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({
      ok: true,
      usuario: result.rows[0]
    });
  } finally {
    if (connection) await connection.close();
  }
});
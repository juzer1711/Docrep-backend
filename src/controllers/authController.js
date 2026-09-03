const { getConnection, oracledb } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/auth/login  { pin: '1234' }
exports.login = asyncHandler(async (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ ok: false, error: 'El PIN es obligatorio' });
  }

  let connection;
  try {
    connection = await getConnection();

    const result = await connection.execute(
      `SELECT id_usuario, nombre, rol
         FROM usuarios
        WHERE codigo_pin = :pin`,
      { pin },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'PIN inválido' });
    }

    const usuario = result.rows[0];

    // En un entorno real aquí generarías un JWT.
    res.json({
      ok: true,
      usuario: {
        id_usuario: usuario.ID_USUARIO,
        nombre: usuario.NOMBRE,
        rol: usuario.ROL, // 'BODEGA' | 'ADMINISTRADOR' | 'CONTABILIDAD'
      },
    });
  } finally {
    if (connection) await connection.close();
  }
});
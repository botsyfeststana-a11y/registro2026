const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Mangy123';

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicialización de la Base de Datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('Base de datos SQLite conectada correctamente.');
  }
});

// Crear tablas si no existen
db.serialize(() => {
  // Tabla de Competencias
  db.run(`CREATE TABLE IF NOT EXISTS competencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE
  )`);

  // Tabla de Equipos (pertenecientes a una competencia)
  db.run(`CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competencia_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    FOREIGN KEY (competencia_id) REFERENCES competencias (id),
    UNIQUE(competencia_id, nombre)
  )`);

  // Tabla de Participantes
  db.run(`CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_completo TEXT NOT NULL,
    edad INTEGER NOT NULL,
    whatsapp TEXT NOT NULL,
    carrera TEXT NOT NULL,
    equipo_id INTEGER NOT NULL,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (equipo_id) REFERENCES equipos (id)
  )`);
});

// ==========================================
// RUTAS DE LA API (PÚBLICAS)
// ==========================================

// 1. Obtener competencias y sus equipos con el conteo de inscritos (Max 3)
app.get('/api/competencias', (req, res) => {
  const query = `
    SELECT 
      c.id AS competencia_id, 
      c.nombre AS competencia_nombre,
      e.id AS equipo_id,
      e.nombre AS equipo_nombre,
      COUNT(p.id) AS total_inscritos
    FROM competencias c
    LEFT JOIN equipos e ON c.id = e.competencia_id
    LEFT JOIN participantes p ON e.id = p.equipo_id
    GROUP BY c.id, e.id
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Error al consultar datos.' });
    }

    // Estructurar respuesta agrupada por competencia
    const competenciasMap = {};
    rows.forEach(row => {
      if (!competenciasMap[row.competencia_id]) {
        competenciasMap[row.competencia_id] = {
          id: row.competencia_id,
          nombre: row.competencia_nombre,
          equipos: []
        };
      }

      if (row.equipo_id) {
        competenciasMap[row.competencia_id].equipos.push({
          id: row.equipo_id,
          nombre: row.equipo_nombre,
          total_inscritos: row.total_inscritos,
          disponible: row.total_inscritos < 3
        });
      }
    });

    res.json(Object.values(competenciasMap));
  });
});

// 2. Registrar participante (CON VALIDACIÓN DE MÁXIMO 3 PERSONAS)
app.post('/api/registro', (req, res) => {
  const { nombre_completo, edad, whatsapp, carrera, equipo_id } = req.body;

  if (!nombre_completo || !edad || !whatsapp || !carrera || !equipo_id) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  // Transacción atómica para evitar duplicados simultáneos
  db.serialize(() => {
    db.get('SELECT COUNT(*) AS count FROM participantes WHERE equipo_id = ?', [equipo_id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Error al verificar disponibilidad del equipo.' });
      }

      if (row.count >= 3) {
        return res.status(400).json({ 
          error: 'Este equipo ya alcanzó el límite máximo de 3 participantes.' 
        });
      }

      // Insertar el nuevo participante
      const insertQuery = `
        INSERT INTO participantes (nombre_completo, edad, whatsapp, carrera, equipo_id)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.run(insertQuery, [nombre_completo, edad, whatsapp, carrera, equipo_id], function (err) {
        if (err) {
          return res.status(500).json({ error: 'Error al completar el registro.' });
        }

        res.json({ 
          mensaje: 'Inscripción realizada con éxito.', 
          id: this.lastID,
          cupos_restantes: 3 - (row.count + 1)
        });
      });
    });
  });
});

// ==========================================
// RUTAS DE LA API (ADMINISTRADOR)
// ==========================================

// Middleware de verificación de clave admin
const checkAdmin = (req, res, next) => {
  const authHeader = req.headers['x-admin-password'];
  if (authHeader === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
  }
};

// 3. Crear una nueva competencia (Admin)
app.post('/api/admin/competencia', checkAdmin, (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });

  db.run('INSERT INTO competencias (nombre) VALUES (?)', [nombre], function (err) {
    if (err) {
      return res.status(400).json({ error: 'La competencia ya existe o hubo un error.' });
    }
    res.json({ mensaje: 'Competencia creada exitosamente.', id: this.lastID });
  });
});

// 4. Crear un nuevo equipo dentro de una competencia (Admin)
app.post('/api/admin/equipo', checkAdmin, (req, res) => {
  const { competencia_id, nombre } = req.body;
  if (!competencia_id || !nombre) {
    return res.status(400).json({ error: 'Competencia y nombre de equipo requeridos.' });
  }

  db.run('INSERT INTO equipos (competencia_id, nombre) VALUES (?, ?)', [competencia_id, nombre], function (err) {
    if (err) {
      return res.status(400).json({ error: 'El equipo ya existe en esta competencia o hubo un error.' });
    }
    res.json({ mensaje: 'Equipo creado exitosamente.', id: this.lastID });
  });
});

// 5. Descargar reporte de inscritos en Excel (.xlsx) (Admin)
app.get('/api/admin/exportar-excel', (req, res) => {
  const clave = req.query.password;
  if (clave !== ADMIN_PASSWORD) {
    return res.status(401).send('Acceso denegado: Contraseña incorrecta.');
  }

  const query = `
    SELECT 
      c.nombre AS competencia,
      e.nombre AS equipo,
      p.nombre_completo,
      p.edad,
      p.whatsapp,
      p.carrera,
      p.fecha_registro
    FROM participantes p
    JOIN equipos e ON p.equipo_id = e.id
    JOIN competencias c ON e.competencia_id = c.id
    ORDER BY c.nombre, e.nombre, p.fecha_registro ASC
  `;

  db.all(query, [], async (err, rows) => {
    if (err) {
      return res.status(500).send('Error al consultar la base de datos.');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inscritos');

    // Estructura de columnas
    worksheet.columns = [
      { header: 'Competencia', key: 'competencia', width: 25 },
      { header: 'Equipo', key: 'equipo', width: 25 },
      { header: 'Nombre Completo', key: 'nombre_completo', width: 35 },
      { header: 'Edad', key: 'edad', width: 10 },
      { header: 'WhatsApp', key: 'whatsapp', width: 20 },
      { header: 'Carrera', key: 'carrera', width: 30 },
      { header: 'Fecha de Registro', key: 'fecha_registro', width: 25 }
    ];

    // Estilar encabezados
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2563EB' }
    };

    // Agregar filas
    rows.forEach(row => worksheet.addRow(row));

    // Configurar respuesta de archivo descargable
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Inscritos_Competencias.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});

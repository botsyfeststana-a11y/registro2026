const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Límite por defecto por competencia
const LIMITE_PARTICIPANTES_POR_COMPETENCIA = 3; 

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Base de datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error("Error al conectar BD:", err.message);
  else console.log("Base de datos SQLite lista.");
});

// Activar Claves Foráneas en SQLite para eliminación en cascada
db.run("PRAGMA foreign_keys = ON;");

// Crear Tablas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS competencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    max_cupos INTEGER DEFAULT 3
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competencia_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    FOREIGN KEY (competencia_id) REFERENCES competencias(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    edad INTEGER NOT NULL,
    whatsapp TEXT NOT NULL,
    carrera TEXT NOT NULL,
    equipo_id INTEGER NOT NULL,
    FOREIGN KEY (equipo_id) REFERENCES equipos(id) ON DELETE CASCADE
  )`);
});

// Middleware Autenticación Admin
function authAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'] || req.query.password;
  if (pass === ADMIN_PASSWORD) next();
  else res.status(401).json({ error: "Contraseña de administrador incorrecta" });
}

// ---------------- RUTAS PÚBLICAS ----------------

// Obtener competencias con conteo de cupos disponibles
app.get('/api/competencias', (req, res) => {
  const sql = `
    SELECT c.id, c.nombre, c.max_cupos,
           COUNT(p.id) as total_inscritos
    FROM competencias c
    LEFT JOIN equipos e ON c.id = e.competencia_id
    LEFT JOIN participantes p ON e.id = p.equipo_id
    GROUP BY c.id
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const competenciasConCupos = rows.map(c => {
      const limite = c.max_cupos || LIMITE_PARTICIPANTES_POR_COMPETENCIA;
      const cuposRestantes = Math.max(0, limite - c.total_inscritos);
      return {
        id: c.id,
        nombre: c.nombre,
        max_cupos: limite,
        total_inscritos: c.total_inscritos,
        cupos_restantes: cuposRestantes,
        lleno: cuposRestantes === 0
      };
    });

    res.json(competenciasConCupos);
  });
});

// Registro de participante con validación de cupos
app.post('/api/registro', (req, res) => {
  const { nombre, edad, whatsapp, carrera, competencia_id } = req.body;

  if (!nombre || !edad || !whatsapp || !carrera || !competencia_id) {
    return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  const sqlVerificar = `
    SELECT c.max_cupos, COUNT(p.id) as total_inscritos
    FROM competencias c
    LEFT JOIN equipos e ON c.id = e.competencia_id
    LEFT JOIN participantes p ON e.id = p.equipo_id
    WHERE c.id = ?
    GROUP BY c.id
  `;

  db.get(sqlVerificar, [competencia_id], (err, comp) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!comp) return res.status(404).json({ error: "La competencia seleccionada no existe." });

    const limite = comp.max_cupos || LIMITE_PARTICIPANTES_POR_COMPETENCIA;
    if (comp.total_inscritos >= limite) {
      return res.status(400).json({ error: "Esta competencia ya ha alcanzado el límite máximo de participantes." });
    }

    const queryBuscarEquipo = `
      SELECT e.id, COUNT(p.id) as total_integrantes
      FROM equipos e
      LEFT JOIN participantes p ON e.id = p.equipo_id
      WHERE e.competencia_id = ?
      GROUP BY e.id
      HAVING total_integrantes < 3
      LIMIT 1
    `;

    db.get(queryBuscarEquipo, [competencia_id], (err, equipoDisponible) => {
      if (err) return res.status(500).json({ error: err.message });

      if (equipoDisponible) {
        insertarParticipante(equipoDisponible.id);
      } else {
        db.get(`SELECT COUNT(*) as total FROM equipos WHERE competencia_id = ?`, [competencia_id], (err, row) => {
          const numEquipo = (row ? row.total : 0) + 1;
          const nombreNuevoEquipo = `Equipo ${numEquipo}`;

          db.run(`INSERT INTO equipos (competencia_id, nombre) VALUES (?, ?)`, [competencia_id, nombreNuevoEquipo], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            insertarParticipante(this.lastID);
          });
        });
      }

      function insertarParticipante(equipoId) {
        const sql = `INSERT INTO participantes (nombre, edad, whatsapp, carrera, equipo_id) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [nombre, edad, whatsapp, carrera, equipoId], function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ mensaje: "¡Inscripción realizada con éxito!" });
        });
      }
    });
  });
});

// ---------------- RUTAS ADMINISTRADOR ----------------

// Crear Competencia
app.post('/api/admin/competencia', authAdmin, (req, res) => {
  const { nombre, max_cupos } = req.body;
  const cupos = max_cupos ? parseInt(max_cupos) : LIMITE_PARTICIPANTES_POR_COMPETENCIA;

  db.run(`INSERT INTO competencias (nombre, max_cupos) VALUES (?, ?)`, [nombre, cupos], function (err) {
    if (err) return res.status(400).json({ error: "La competencia ya existe o es inválida." });
    res.json({ mensaje: "Competencia creada exitosamente." });
  });
});

// Editar Competencia
app.put('/api/admin/competencia/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  const { nombre, max_cupos } = req.body;

  if (!nombre || !max_cupos) {
    return res.status(400).json({ error: "Nombre y cantidad de cupos son obligatorios." });
  }

  const sql = `UPDATE competencias SET nombre = ?, max_cupos = ? WHERE id = ?`;
  db.run(sql, [nombre, parseInt(max_cupos), id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Competencia no encontrada." });
    res.json({ mensaje: "Competencia actualizada exitosamente." });
  });
});

// Eliminar Competencia (Elimina también sus equipos y participantes asociados)
app.delete('/api/admin/competencia/:id', authAdmin, (req, res) => {
  const { id } = req.params;

  // Eliminar la competencia de la base de datos
  db.run(`DELETE FROM competencias WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Competencia no encontrada." });

    // Limpiar equipos y participantes huérfanos por seguridad
    db.run(`DELETE FROM participantes WHERE equipo_id NOT IN (SELECT id FROM equipos)`);
    db.run(`DELETE FROM equipos WHERE competencia_id NOT IN (SELECT id FROM competencias)`);

    res.json({ mensaje: "Competencia y sus registros eliminados exitosamente." });
  });
});

// Exportar Excel
app.get('/api/admin/exportar-excel', authAdmin, async (req, res) => {
  const sql = `
    SELECT p.id, p.nombre, p.edad, p.whatsapp, p.carrera, e.nombre as equipo, c.nombre as competencia
    FROM participantes p
    JOIN equipos e ON p.equipo_id = e.id
    JOIN competencias c ON e.competencia_id = c.id
    ORDER BY c.nombre, e.nombre
  `;

  db.all(sql, [], async (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Participantes');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Nombre Completo', key: 'nombre', width: 25 },
      { header: 'Edad', key: 'edad', width: 10 },
      { header: 'WhatsApp', key: 'whatsapp', width: 18 },
      { header: 'Carrera', key: 'carrera', width: 25 },
      { header: 'Competencia', key: 'competencia', width: 20 },
      { header: 'Equipo Asignado', key: 'equipo', width: 15 }
    ];

    rows.forEach(r => worksheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Reporte_Inscritos.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  });
});

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));

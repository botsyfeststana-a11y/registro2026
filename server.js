const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Base de datos SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error("Error al conectar BD:", err.message);
  else console.log("Base de datos SQLite lista.");
});

// Crear Tablas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS competencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competencia_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    FOREIGN KEY (competencia_id) REFERENCES competencias(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    edad INTEGER NOT NULL,
    whatsapp TEXT NOT NULL,
    carrera TEXT NOT NULL,
    equipo_id INTEGER NOT NULL,
    FOREIGN KEY (equipo_id) REFERENCES equipos(id)
  )`);
});

// Middleware Autenticación Admin
function authAdmin(req, res, next) {
  const pass = req.headers['x-admin-password'] || req.query.password;
  if (pass === ADMIN_PASSWORD) next();
  else res.status(401).json({ error: "Contraseña de administrador incorrecta" });
}

// ---------------- RUTAS PÚBLICAS ----------------

// Obtener competencias
app.get('/api/competencias', (req, res) => {
  db.all(`SELECT * FROM competencias`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Registro de participante con asignación automática de equipo (máx 3 por equipo)
app.post('/api/registro', (req, res) => {
  const { nombre, edad, whatsapp, carrera, competencia_id } = req.body;

  if (!nombre || !edad || !whatsapp || !carrera || !competencia_id) {
    return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  // Buscar un equipo en esta competencia que tenga menos de 3 integrantes
  const queryBuscarEquipo = `
    SELECT e.id, e.nombre, COUNT(p.id) as total_integrantes
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
      // Registrar en el equipo encontrado
      insertarParticipante(equipoDisponible.id);
    } else {
      // Si no hay equipo con cupo, crear un nuevo equipo automáticamente
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

// ---------------- RUTAS ADMINISTRADOR ----------------

// Crear Competencia
app.post('/api/admin/competencia', authAdmin, (req, res) => {
  const { nombre } = req.body;
  db.run(`INSERT INTO competencias (nombre) VALUES (?)`, [nombre], function (err) {
    if (err) return res.status(400).json({ error: "La competencia ya existe o es inválida." });
    res.json({ mensaje: "Competencia creada exitosamente." });
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

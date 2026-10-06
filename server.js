const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
app.use(express.json());

// Servir los archivos HTML de la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Puerto adaptable para Render
const PORT = process.env.PORT || 3000;
let db;

async function initDB() {
  db = await open({
    filename: path.join(__dirname, 'database.db'),
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = ON;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      max_capacity INTEGER DEFAULT 3
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      whatsapp TEXT NOT NULL,
      career TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    )
  `);

  const existingTeams = await db.all('SELECT * FROM teams');
  if (existingTeams.length === 0) {
    await db.run('INSERT INTO teams (id, name) VALUES (?, ?)', ['equipo-1', 'Equipo Alfa']);
    await db.run('INSERT INTO teams (id, name) VALUES (?, ?)', ['equipo-2', 'Equipo Beta']);
    await db.run('INSERT INTO teams (id, name) VALUES (?, ?)', ['equipo-3', 'Equipo Gamma']);
  }
}

app.get('/api/teams', async (req, res) => {
  try {
    const teams = await db.all(`
      SELECT 
        t.id, 
        t.name, 
        t.max_capacity,
        COUNT(p.id) AS current_count
      FROM teams t
      LEFT JOIN participants p ON t.id = p.team_id
      GROUP BY t.id
    `);
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener equipos.' });
  }
});

app.post('/api/register', async (req, res) => {
  const { teamId, fullName, age, whatsapp, career } = req.body;
  if (!teamId || !fullName || !age || !whatsapp || !career) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
  }

  try {
    await db.run('BEGIN TRANSACTION');

    const team = await db.get(`
      SELECT t.max_capacity, COUNT(p.id) AS current_count
      FROM teams t
      LEFT JOIN participants p ON t.id = p.team_id
      WHERE t.id = ?
      GROUP BY t.id
    `, [teamId]);

    if (!team) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'El equipo no existe.' });
    }

    if (team.current_count >= team.max_capacity) {
      await db.run('ROLLBACK');
      return res.status(400).json({ error: 'Este equipo ya no tiene cupos disponibles (Máximo 3).' });
    }

    await db.run(`
      INSERT INTO participants (team_id, full_name, age, whatsapp, career)
      VALUES (?, ?, ?, ?, ?)
    `, [teamId, fullName, Number(age), whatsapp, career]);

    await db.run('COMMIT');
    return res.json({ success: true, message: 'Inscripción exitosa.' });

  } catch (error) {
    await db.run('ROLLBACK');
    return res.status(500).json({ error: 'Error interno en el servidor.' });
  }
});

app.get('/api/export-excel', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT 
        t.name AS team_name,
        p.full_name,
        p.age,
        p.whatsapp,
        p.career,
        p.created_at
      FROM participants p
      JOIN teams t ON p.team_id = t.id
      ORDER BY t.name ASC, p.created_at ASC
    `);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inscriptos');

    worksheet.columns = [
      { header: 'Equipo', key: 'team_name', width: 20 },
      { header: 'Nombre Completo', key: 'full_name', width: 30 },
      { header: 'Edad', key: 'age', width: 10 },
      { header: 'WhatsApp', key: 'whatsapp', width: 20 },
      { header: 'Carrera', key: 'career', width: 25 },
      { header: 'Fecha Registro', key: 'created_at', width: 22 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };

    rows.forEach(row => worksheet.addRow(row));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Reporte_Inscriptos.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).send('Error al generar Excel.');
  }
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
  });
});

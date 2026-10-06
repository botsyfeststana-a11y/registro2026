// ---------------- RUTAS ADMINISTRADOR (AGREGAR AL SERVER.JS) ----------------

// Obtener lista completa de participantes para el Admin
app.get('/api/admin/participantes', authAdmin, (req, res) => {
  const sql = `
    SELECT p.id, p.nombre, p.edad, p.whatsapp, p.carrera, e.nombre as equipo, c.nombre as competencia
    FROM participantes p
    JOIN equipos e ON p.equipo_id = e.id
    JOIN competencias c ON e.competencia_id = c.id
    ORDER BY p.id DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Eliminar un participante individual
app.delete('/api/admin/participante/:id', authAdmin, (req, res) => {
  const { id } = req.params;

  db.run(`DELETE FROM participantes WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Participante no encontrado." });

    res.json({ mensaje: "Inscripción eliminada correctamente." });
  });
});

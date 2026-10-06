const ExcelJS = require('exceljs');

// Ruta del backend para exportar el reporte
app.get('/admin/exportar-excel', async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Inscritos');

  // Definir columnas con los campos requeridos
  worksheet.columns = [
    { header: 'Competencia', key: 'competencia', width: 20 },
    { header: 'Equipo', key: 'equipo', width: 20 },
    { header: 'Nombre Completo', key: 'nombre', width: 30 },
    { header: 'Edad', key: 'edad', width: 10 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'Carrera', key: 'carrera', width: 25 }
  ];

  // Obtener registros de la base de datos (Ejemplo)
  const inscritos = await obtenerInscritosDesdeBD();

  inscritos.forEach(registro => {
    worksheet.addRow(registro);
  });

  // Configurar la descarga en el navegador
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Inscritos_Competencias.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
});

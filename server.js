const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { procesarEmpresas } = require('./scraper');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Multer en memoria (no guarda archivos)
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// WebSocket connections
let wsClients = new Set();

wss.on('connection', (ws) => {
    wsClients.add(ws);
    console.log('Cliente WebSocket conectado');

    ws.on('close', () => {
        wsClients.delete(ws);
        console.log('Cliente WebSocket desconectado');
    });
});

function broadcast(data) {
    const message = JSON.stringify(data);
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Endpoint para parsear el Excel (solo lectura en memoria)
app.post('/api/parse-excel', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibio archivo' });
        }

        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: '' });

        // Filtrar filas vacias y la cabecera si existe
        const empresas = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const nombre = String(row.A || '').trim();
            const rut = String(row.B || '').trim();
            const clave = String(row.C || '').trim();

            if (!nombre || !rut || !clave) continue;
            // Saltar cabecera
            if (nombre.toLowerCase() === 'nombre' || nombre.toLowerCase() === 'empresa') continue;

            empresas.push({ nombre, rut, clave });
        }

        if (empresas.length === 0) {
            return res.status(400).json({ error: 'No se encontraron empresas validas en el archivo. Verifica la estructura del Excel.' });
        }

        res.json({ empresas });
    } catch (error) {
        console.error('Error parseando Excel:', error);
        res.status(500).json({ error: 'Error al procesar el archivo Excel' });
    }
});

// Endpoint para iniciar el procesamiento
app.post('/api/procesar', (req, res) => {
    const { empresas, mes, anio } = req.body;

    if (!empresas || !Array.isArray(empresas) || empresas.length === 0) {
        return res.status(400).json({ error: 'No hay empresas para procesar' });
    }
    if (!mes || !anio) {
        return res.status(400).json({ error: 'Debe seleccionar mes y anio' });
    }

    // Responder inmediatamente
    res.json({ message: 'Procesamiento iniciado', total: empresas.length });

    // Procesar en background
    procesarEmpresas(empresas, mes, anio, broadcast).catch(err => {
        console.error('Error en procesamiento:', err);
        broadcast({ type: 'error', message: 'Error general en el procesamiento: ' + err.message });
    });
});

// Endpoint para descargar el Excel generado (un archivo por empresa)
app.post('/api/descargar-excel', (req, res) => {
    try {
        const { empresas, mes, anio } = req.body;

        const downloadsPath = path.join(os.homedir(), 'Downloads');
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const mesNombre = meses[parseInt(mes) - 1] || mes;

        const archivosGenerados = [];

        // Generar un Excel por cada empresa que tenga boletas
        empresas.forEach(emp => {
            const boletas = emp.boletas || [];
            if (boletas.length === 0) return;

            const wb = XLSX.utils.book_new();

            // Hoja con las boletas
            const sheetData = [
                ['N Boleta', 'Estado', 'Fecha', 'RUT Emisor', 'Nombre Emisor', 'Soc. Prof.', 'Brutos', 'Retenido', 'Pagado']
            ];

            boletas.forEach(b => {
                sheetData.push([
                    b.numero, b.estado, b.fecha, b.rutEmisor, b.nombreEmisor, b.socProf,
                    b.brutos, b.retenido, b.pagado
                ]);
            });

            const wsData = XLSX.utils.aoa_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(wb, wsData, 'Boletas');

            // Limpiar el RUT para usarlo en el nombre del archivo
            const rutLimpio = (emp.rut || 'sin-rut').replace(/\./g, '').replace(/\//g, '');
            const fileName = `Honorarios_${rut}_${mesNombre}_${anio}.xlsx`;
            const filePath = path.join(downloadsPath, fileName);

            XLSX.writeFile(wb, filePath);
            archivosGenerados.push({ fileName, path: filePath, empresa: emp.nombre });
        });

        if (archivosGenerados.length === 0) {
            return res.status(400).json({ error: 'No hay boletas para descargar' });
        }

        res.json({
            message: `${archivosGenerados.length} archivo(s) Excel descargado(s) exitosamente`,
            archivos: archivosGenerados,
            path: downloadsPath
        });
    } catch (error) {
        console.error('Error generando Excel:', error);
        res.status(500).json({ error: 'Error al generar el archivo Excel' });
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// ========== STATE ==========
let empresasData = [];
let empresasResults = {};
let selectedFile = null;
let ws = null;
let processingComplete = false;

// ========== DOM ELEMENTS ==========
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const filenameEl = document.getElementById('filename');
const companiesPreview = document.getElementById('companies-preview');
const companiesChips = document.getElementById('companies-chips');
const previewCount = document.getElementById('preview-count');
const btnStart = document.getElementById('btn-start');
const viewConfig = document.getElementById('view-config');
const viewProcessing = document.getElementById('view-processing');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressPercentage = document.getElementById('progress-percentage');
const progressStatus = document.getElementById('progress-status');
const logConsole = document.getElementById('log-console');
const empresasGrid = document.getElementById('empresas-grid');
const btnDownload = document.getElementById('btn-download');
const processingPeriod = document.getElementById('processing-period');
const resultsSummary = document.getElementById('results-summary');

// ========== MESES NAMES ==========
const mesesNombres = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ========== DRAG & DROP ==========
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// ========== FILE HANDLING ==========
function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls'].includes(ext)) {
        showNotification('Solo se admiten archivos .xlsx o .xls', 'error');
        return;
    }

    selectedFile = file;
    filenameEl.textContent = file.name;
    dropzone.classList.add('has-file');

    // Parse locally for instant preview
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 'A', defval: '' });

            empresasData = [];
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                const nombre = String(row.A || '').trim();
                const rut = String(row.B || '').trim();
                const clave = String(row.C || '').trim();

                if (!nombre || !rut || !clave) continue;
                if (nombre.toLowerCase() === 'nombre' || nombre.toLowerCase() === 'empresa') continue;

                empresasData.push({ nombre, rut, clave });
            }

            if (empresasData.length === 0) {
                showNotification('No se encontraron empresas validas. Revisa la estructura del Excel.', 'error');
                return;
            }

            showCompaniesPreview();
            updateStartButton();
        } catch (err) {
            console.error('Error parsing Excel:', err);
            showNotification('Error al leer el archivo Excel', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

function showCompaniesPreview() {
    companiesPreview.classList.add('visible');
    previewCount.textContent = empresasData.length;
    companiesChips.innerHTML = '';

    empresasData.forEach((emp, i) => {
        const chip = document.createElement('span');
        chip.className = 'company-chip';
        chip.style.animationDelay = `${i * 0.05}s`;
        chip.innerHTML = `
            <span class="chip-dot"></span>
            ${escapeHtml(emp.nombre)}
        `;
        companiesChips.appendChild(chip);
    });
}

function updateStartButton() {
    const mes = document.getElementById('select-mes').value;
    const anio = document.getElementById('select-anio').value;
    btnStart.disabled = !(empresasData.length > 0 && mes && anio);
}

// Listen for date changes
document.getElementById('select-mes').addEventListener('change', updateStartButton);
document.getElementById('select-anio').addEventListener('change', updateStartButton);

// ========== START PROCESSING ==========
btnStart.addEventListener('click', async () => {
    if (empresasData.length === 0) return;

    const mes = document.getElementById('select-mes').value;
    const anio = document.getElementById('select-anio').value;
    const mesNombre = mesesNombres[parseInt(mes) - 1];

    // Switch to processing view
    viewConfig.classList.remove('active');
    viewProcessing.classList.add('active');
    processingPeriod.textContent = `${mesNombre} ${anio}`;

    // Reset state
    processingComplete = false;
    empresasResults = {};
    logConsole.innerHTML = '';
    empresasGrid.innerHTML = '';
    btnDownload.style.display = 'none';
    progressBar.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressText.textContent = 'Conectando...';

    // Build empresa cards immediately
    buildEmpresaCards();

    // Connect WebSocket
    connectWebSocket();

    // Send processing request
    try {
        const response = await fetch('/api/procesar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresas: empresasData,
                mes: mes,
                anio: anio
            })
        });

        const result = await response.json();
        if (!response.ok) {
            addLog('Error: ' + result.error, 'error');
        } else {
            addLog(result.message, 'info');
        }
    } catch (error) {
        addLog('Error de conexion: ' + error.message, 'error');
    }
});

// ========== BUILD EMPRESA CARDS ==========
function buildEmpresaCards() {
    empresasGrid.innerHTML = '';
    empresasData.forEach((emp, i) => {
        const card = document.createElement('div');
        card.className = 'empresa-card';
        card.id = `card-${i}`;
        card.style.animationDelay = `${i * 0.1}s`;

        const initials = emp.nombre.substring(0, 2).toUpperCase();

        card.innerHTML = `
            <div class="empresa-card-header" onclick="toggleCard(${i})">
                <div class="empresa-card-info">
                    <div class="empresa-avatar">${initials}</div>
                    <div>
                        <div class="empresa-name">${escapeHtml(emp.nombre)}</div>
                        <div class="empresa-rut">${escapeHtml(emp.rut)}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span class="empresa-status-badge pending" id="badge-${i}">Pendiente</span>
                    <svg class="empresa-toggle-icon" viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                </div>
            </div>
            <div class="empresa-card-body">
                <div class="empresa-card-content" id="content-${i}">
                    <div class="no-data">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                        <p>Esperando procesamiento...</p>
                    </div>
                </div>
            </div>
        `;

        empresasGrid.appendChild(card);
    });
}

// ========== TOGGLE CARD ==========
function toggleCard(index) {
    const card = document.getElementById(`card-${index}`);
    if (card) {
        card.classList.toggle('expanded');
    }
}

// ========== WEBSOCKET ==========
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        addLog('Conexion establecida con el servidor', 'info');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
    };

    ws.onclose = () => {
        if (!processingComplete) {
            addLog('Conexion perdida. Reintentando...', 'error');
            setTimeout(connectWebSocket, 3000);
        }
    };

    ws.onerror = () => {
        addLog('Error en la conexion WebSocket', 'error');
    };
}

function handleWSMessage(data) {
    switch (data.type) {
        case 'start':
            progressText.textContent = data.message;
            addLog(data.message, 'info');
            break;

        case 'progress':
            const pct = Math.round(((data.index) / data.total) * 100);
            progressBar.style.width = `${pct}%`;
            progressPercentage.textContent = `${pct}%`;
            progressText.textContent = `Procesando ${data.index + 1} de ${data.total}`;
            progressStatus.textContent = data.message;
            addLog(data.message, 'info');

            // Update badge
            updateBadge(data.index, 'processing', 'Procesando');
            break;

        case 'empresa-result':
            const pctResult = Math.round(((data.index + 1) / data.total) * 100);
            progressBar.style.width = `${pctResult}%`;
            progressPercentage.textContent = `${pctResult}%`;
            progressText.textContent = `Procesado ${data.index + 1} de ${data.total}`;

            // Store result
            empresasResults[data.index] = data;

            // Update badge and content
            if (data.status === 'success') {
                updateBadge(data.index, 'success', `${data.boletas.length} boletas`);
                updateCardContent(data.index, data);
                addLog(`${data.empresa}: ${data.boletas.length} boletas encontradas`, 'success');
            } else {
                updateBadge(data.index, 'error', 'Error');
                updateCardContentError(data.index, data.message);
                addLog(data.message, 'error');
            }

            updateResultsSummary();
            break;

        case 'complete':
            processingComplete = true;
            progressBar.style.width = '100%';
            progressPercentage.textContent = '100%';
            progressText.textContent = 'Procesamiento completado';
            progressStatus.textContent = '';
            btnDownload.style.display = 'inline-flex';
            addLog(data.message, 'success');
            break;

        case 'error':
            addLog(data.message, 'error');
            break;
    }
}

// ========== UPDATE UI ==========
function updateBadge(index, status, text) {
    const badge = document.getElementById(`badge-${index}`);
    if (badge) {
        badge.className = `empresa-status-badge ${status}`;
        badge.textContent = text;
    }
}

function updateCardContent(index, data) {
    const content = document.getElementById(`content-${index}`);
    if (!content) return;

    const boletas = data.boletas || [];
    const totales = data.totales || {};

    if (boletas.length === 0) {
        content.innerHTML = `
            <div class="no-data">
                <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 12H5V8h14v10z"/></svg>
                <p>No se encontraron boletas para el periodo seleccionado</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="boletas-summary">
            <div class="summary-item">
                <div class="label">Total Brutos</div>
                <div class="value">$${totales.brutos || '0'}</div>
            </div>
            <div class="summary-item">
                <div class="label">Total Retenido</div>
                <div class="value">$${totales.retenido || '0'}</div>
            </div>
            <div class="summary-item">
                <div class="label">Total Pagado</div>
                <div class="value success">$${totales.pagado || '0'}</div>
            </div>
        </div>
        <div class="boletas-table-container">
            <table class="boletas-table">
                <thead>
                    <tr>
                        <th>N&deg;</th>
                        <th>Estado</th>
                        <th>Fecha</th>
                        <th>RUT Emisor</th>
                        <th>Nombre Emisor</th>
                        <th>Soc. Prof.</th>
                        <th>Brutos</th>
                        <th>Retenido</th>
                        <th>Pagado</th>
                    </tr>
                </thead>
                <tbody>
    `;

    boletas.forEach(b => {
        const estadoClass = b.estado === 'VIG' ? 'vig' : 'anulada';
        html += `
            <tr>
                <td>${escapeHtml(b.numero)}</td>
                <td><span class="estado-badge ${estadoClass}">${escapeHtml(b.estado)}</span></td>
                <td>${escapeHtml(b.fecha)}</td>
                <td>${escapeHtml(b.rutEmisor)}</td>
                <td>${escapeHtml(b.nombreEmisor)}</td>
                <td>${escapeHtml(b.socProf)}</td>
                <td>$${escapeHtml(b.brutos)}</td>
                <td>$${escapeHtml(b.retenido)}</td>
                <td>$${escapeHtml(b.pagado)}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    content.innerHTML = html;
}

function updateCardContentError(index, message) {
    const content = document.getElementById(`content-${index}`);
    if (!content) return;

    content.innerHTML = `
        <div class="no-data">
            <svg viewBox="0 0 24 24" style="fill:var(--error)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <p style="color:var(--error)">${escapeHtml(message)}</p>
        </div>
    `;
}

function updateResultsSummary() {
    const total = empresasData.length;
    const processed = Object.keys(empresasResults).length;
    const success = Object.values(empresasResults).filter(r => r.status === 'success').length;
    const errors = Object.values(empresasResults).filter(r => r.status === 'error').length;
    resultsSummary.textContent = `${processed}/${total} procesadas | ${success} exitosas | ${errors} errores`;
}

// ========== LOG ==========
function addLog(message, type = 'info') {
    const now = new Date();
    const time = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${time}]</span><span>${escapeHtml(message)}</span>`;

    logConsole.appendChild(entry);
    logConsole.scrollTop = logConsole.scrollHeight;
}

// ========== DOWNLOAD EXCEL ==========
async function downloadExcel() {
    const mes = document.getElementById('select-mes').value;
    const anio = document.getElementById('select-anio').value;

    // Build empresas with results
    const empresasWithResults = empresasData.map((emp, i) => {
        const result = empresasResults[i] || {};
        return {
            nombre: emp.nombre,
            rut: emp.rut,
            status: result.status || 'pending',
            boletas: result.boletas || [],
            totales: result.totales || {}
        };
    });

    try {
        btnDownload.disabled = true;
        btnDownload.textContent = 'Generando...';

        const response = await fetch('/api/descargar-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresas: empresasWithResults,
                mes: mes,
                anio: anio
            })
        });

        const result = await response.json();

        if (response.ok) {
            addLog(result.message, 'success');
            if (result.archivos) {
                result.archivos.forEach(a => {
                    addLog(`  -> ${a.empresa}: ${a.fileName}`, 'success');
                });
            }
            showNotification(`${result.archivos.length} Excel(s) guardados en Downloads`, 'success');
        } else {
            addLog('Error al descargar Excel: ' + result.error, 'error');
        }
    } catch (error) {
        addLog('Error: ' + error.message, 'error');
    } finally {
        btnDownload.disabled = false;
        btnDownload.innerHTML = `
            <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            Descargar Excel
        `;
    }
}

// ========== NAVIGATION ==========
function goBack() {
    viewProcessing.classList.remove('active');
    viewConfig.classList.add('active');

    // Close WebSocket
    if (ws) {
        ws.close();
        ws = null;
    }
}

// ========== NOTIFICATION ==========
function showNotification(message, type = 'info') {
    // Create a floating notification
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        padding: 14px 24px;
        border-radius: 12px;
        font-family: 'Inter', sans-serif;
        font-size: 0.85rem;
        font-weight: 500;
        z-index: 9999;
        animation: fadeInDown 0.3s ease-out;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        max-width: 400px;
    `;

    if (type === 'error') {
        notif.style.background = 'rgba(239, 68, 68, 0.9)';
        notif.style.color = '#fff';
        notif.style.border = '1px solid rgba(239, 68, 68, 0.5)';
    } else if (type === 'success') {
        notif.style.background = 'rgba(16, 185, 129, 0.9)';
        notif.style.color = '#fff';
        notif.style.border = '1px solid rgba(16, 185, 129, 0.5)';
    } else {
        notif.style.background = 'rgba(48, 104, 200, 0.9)';
        notif.style.color = '#fff';
        notif.style.border = '1px solid rgba(48, 104, 200, 0.5)';
    }

    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => notif.remove(), 300);
    }, 4000);
}

// ========== UTILS ==========
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const puppeteer = require('puppeteer');

const SII_LOGIN_URL = 'https://zeusr.sii.cl//AUT2000/InicioAutenticacion/IngresoRutClave.html?https://misiir.sii.cl/cgi_misii/siihome.cgi';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Delays originales - el SII necesita tiempo para procesar
function randomDelay(min = 800, max = 2000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function procesarEmpresa(browser, empresa, mes, anio, broadcast, index, total) {
    const page = await browser.newPage();
    const empresaNombre = empresa.nombre;
    const rut = empresa.rut;
    const clave = empresa.clave;

    try {
        broadcast({
            type: 'progress',
            empresa: empresaNombre,
            index: index,
            total: total,
            status: 'login',
            message: `Iniciando sesion para ${empresaNombre}...`
        });

        // 1. Ir al login del SII
        await page.goto(SII_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(1000, 2000);

        // 2. Ingresar RUT
        const rutLimpio = rut.replace(/\./g, '').replace(/-/g, '');
        await page.waitForSelector('#rutcntr', { timeout: 10000 });
        await page.click('#rutcntr');
        await page.type('#rutcntr', rutLimpio, { delay: 50 });
        await randomDelay(500, 1000);

        // 3. Ingresar clave
        await page.waitForSelector('#clave', { timeout: 10000 });
        await page.click('#clave');
        await page.type('#clave', clave, { delay: 50 });
        await randomDelay(500, 1000);

        // 4. Click boton ingresar + esperar navegacion
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
            page.click('#bt_ingresar')
        ]).catch(() => { });

        await randomDelay(2000, 3000);

        broadcast({
            type: 'progress',
            empresa: empresaNombre,
            index: index,
            total: total,
            status: 'navigating',
            message: `Navegando al portal de ${empresaNombre}...`
        });

        // Verificar login exitoso
        const currentUrl = page.url();
        if (currentUrl.includes('IngresoRutClave') || currentUrl.includes('AUT2000')) {
            const errorMsg = await page.evaluate(() => {
                const el = document.querySelector('.error-message, .alert-danger, #avisos, .text-danger');
                return el ? el.textContent.trim() : null;
            }).catch(() => null);

            broadcast({
                type: 'empresa-result',
                empresa: empresaNombre,
                rut: empresa.rut,
                index: index,
                total: total,
                status: 'error',
                message: `Error de login para ${empresaNombre}: ${errorMsg || 'Credenciales invalidas'}`,
                boletas: []
            });
            await page.close();
            return;
        }

        // 5. Click en "Tramites en linea"
        await page.evaluate(() => {
            const spans = document.querySelectorAll('li span');
            for (const span of spans) {
                if (span.textContent.includes('mites en l')) {
                    span.closest('li').click();
                    return;
                }
            }
        }).catch(() => { });

        await randomDelay(1500, 2500);

        // 6. Click en "Boletas de honorarios electronicas"
        broadcast({
            type: 'progress',
            empresa: empresaNombre,
            index: index,
            total: total,
            status: 'navigating',
            message: `Buscando seccion de boletas para ${empresaNombre}...`
        });

        await page.evaluate(() => {
            const elements = document.querySelectorAll('h4, h4 span');
            for (const el of elements) {
                if (el.textContent.includes('Boletas de honorarios electr')) {
                    el.click();
                    return;
                }
            }
        }).catch(() => { });

        await randomDelay(2000, 3000);

        // 7. Cerrar modal "IMPORTANTE" si aparece
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('.modal-footer button, button[data-dismiss="modal"]');
            for (const btn of buttons) {
                if (btn.textContent.includes('Cerrar')) {
                    btn.click();
                    return;
                }
            }
            const closeBtn = document.querySelector('.modal .close, button.close');
            if (closeBtn) closeBtn.click();
        }).catch(() => { });

        await randomDelay(1500, 2500);

        // 8. Click en "Emisor de boleta de honorarios" - NAVEGA a otra pagina
        try {
            const linkFound = await page.evaluate(() => {
                const links = document.querySelectorAll('a');
                for (const link of links) {
                    if (link.textContent.includes('Emisor de boleta de honorarios')) {
                        return true;
                    }
                }
                return false;
            });

            if (linkFound) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                    page.evaluate(() => {
                        const links = document.querySelectorAll('a');
                        for (const link of links) {
                            if (link.textContent.includes('Emisor de boleta de honorarios')) {
                                link.click();
                                return;
                            }
                        }
                    })
                ]);
            }
        } catch (e) {
            // Si falla la navegacion, puede que ya estemos en la pagina correcta
        }

        await randomDelay(2000, 3000);

        // 9. Click en "Consultas sobre boletas de honorarios electronicas"
        await page.evaluate(() => {
            const elements = document.querySelectorAll('a, h4, .panel-title a');
            for (const el of elements) {
                if (el.textContent.includes('Consultas sobre boletas de honorarios electr') ||
                    el.textContent.includes('Consultas sobre boletas')) {
                    el.click();
                    return;
                }
            }
        }).catch(() => { });

        await randomDelay(2000, 3000);

        // 10. Click en "Consultar boletas recibidas" - puede abrir iframe o navegar
        try {
            await page.evaluate(() => {
                const links = document.querySelectorAll('a');
                for (const link of links) {
                    if (link.textContent.includes('Consultar boletas recibidas')) {
                        link.click();
                        return;
                    }
                }
            });
        } catch (e) {
            // Contexto destruido = navego exitosamente
        }

        await randomDelay(3000, 5000);

        broadcast({
            type: 'progress',
            empresa: empresaNombre,
            index: index,
            total: total,
            status: 'extracting',
            message: `Consultando boletas de ${empresaNombre} (${mes}/${anio})...`
        });

        // Buscar el frame o pagina que tiene los selectores de fecha
        let targetFrame = page;

        const findSelectFrame = async () => {
            const hasSelectMain = await page.$('select[name="cbmesinformemensual"]').catch(() => null);
            if (hasSelectMain) return page;

            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const hasSelect = await frame.$('select[name="cbmesinformemensual"]');
                    if (hasSelect) return frame;
                } catch (e) { }
            }
            return null;
        };

        // Intentar varias veces encontrar el frame con los selectores
        for (let attempt = 0; attempt < 5; attempt++) {
            targetFrame = await findSelectFrame();
            if (targetFrame) break;
            await delay(1500);
        }

        if (!targetFrame) {
            broadcast({
                type: 'empresa-result',
                empresa: empresaNombre,
                rut: empresa.rut,
                index: index,
                total: total,
                status: 'error',
                message: `No se encontro la pagina de consulta de boletas para ${empresaNombre}`,
                boletas: []
            });
            await page.close();
            return;
        }

        // 11. Seleccionar mes
        await targetFrame.select('select[name="cbmesinformemensual"]', mes).catch(() => { });
        await randomDelay(500, 1000);

        // 12. Seleccionar anio
        await targetFrame.select('select[name="cbanoinformemensual"]', anio).catch(() => { });
        await randomDelay(500, 1000);

        // 13. Click en boton Consultar
        try {
            await targetFrame.evaluate(() => {
                const btn = document.querySelector('#cmdconsultar1') || document.querySelector('input[name="cmdconsultar1"]');
                if (btn) btn.click();
            });
        } catch (e) { }

        // Esperar a que cargue la tabla de resultados
        await randomDelay(3000, 5000);

        // Buscar el frame con la tabla de resultados
        const findTableFrame = async () => {
            const hasTableMain = await page.$('form[name="formulario"] table').catch(() => null);
            if (hasTableMain) return page;

            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const hasTable = await frame.$('form[name="formulario"] table');
                    if (hasTable) return frame;
                } catch (e) { }
            }
            return null;
        };

        let tableFrame = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            tableFrame = await findTableFrame();
            if (tableFrame) break;
            await delay(1500);
        }

        if (!tableFrame) {
            broadcast({
                type: 'empresa-result',
                empresa: empresaNombre,
                rut: empresa.rut,
                index: index,
                total: total,
                status: 'success',
                message: `${empresaNombre}: Sin boletas para el periodo ${mes}/${anio}`,
                boletas: [],
                totales: null
            });
            await page.close();
            return;
        }

        // 14. Extraer datos de la tabla
        const boletas = await tableFrame.evaluate(() => {
            const rows = document.querySelectorAll('form[name="formulario"] table tr.reporte');
            const data = [];

            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 10) {
                    const firstCellText = cells[0].textContent.trim();
                    if (firstCellText.includes('Totales') || firstCellText.includes('Total')) continue;

                    const boleta = {
                        numero: cells[1] ? cells[1].textContent.trim() : '',
                        estado: cells[2] ? cells[2].textContent.trim() : '',
                        fecha: cells[3] ? cells[3].textContent.trim() : '',
                        rutEmisor: cells[4] ? cells[4].textContent.trim() : '',
                        nombreEmisor: cells[5] ? cells[5].textContent.trim().replace(/\s+/g, ' ') : '',
                        socProf: cells[6] ? cells[6].textContent.trim() : '',
                        brutos: cells[7] ? cells[7].textContent.trim() : '',
                        retenido: cells[8] ? cells[8].textContent.trim() : '',
                        pagado: cells[9] ? cells[9].textContent.trim() : ''
                    };

                    if (boleta.numero && boleta.numero !== '') {
                        data.push(boleta);
                    }
                }
            }

            // Extraer totales
            let totales = null;
            for (const row of rows) {
                if (row.textContent.includes('Totales')) {
                    const tds = row.querySelectorAll('td');
                    if (tds.length >= 10) {
                        totales = {
                            brutos: tds[7] ? tds[7].textContent.trim() : '0',
                            retenido: tds[8] ? tds[8].textContent.trim() : '0',
                            pagado: tds[9] ? tds[9].textContent.trim() : '0'
                        };
                    }
                    break;
                }
            }

            return { boletas: data, totales };
        }).catch(() => ({ boletas: [], totales: null }));

        broadcast({
            type: 'empresa-result',
            empresa: empresaNombre,
            rut: empresa.rut,
            index: index,
            total: total,
            status: 'success',
            message: `${empresaNombre}: ${boletas.boletas.length} boletas encontradas`,
            boletas: boletas.boletas,
            totales: boletas.totales
        });

    } catch (error) {
        console.error(`Error procesando ${empresaNombre}:`, error.message);
        broadcast({
            type: 'empresa-result',
            empresa: empresaNombre,
            rut: empresa.rut,
            index: index,
            total: total,
            status: 'error',
            message: `Error procesando ${empresaNombre}: ${error.message}`,
            boletas: []
        });
    } finally {
        await page.close().catch(() => { });
    }
}

async function procesarEmpresas(empresas, mes, anio, broadcast) {
    broadcast({
        type: 'start',
        total: empresas.length,
        message: `Iniciando procesamiento de ${empresas.length} empresa(s)...`
    });

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 800 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        for (let i = 0; i < empresas.length; i++) {
            await procesarEmpresa(browser, empresas[i], mes, anio, broadcast, i, empresas.length);
            // Esperar entre empresas
            if (i < empresas.length - 1) {
                await randomDelay(2000, 4000);
            }
        }

        broadcast({
            type: 'complete',
            message: 'Procesamiento completado para todas las empresas'
        });

    } catch (error) {
        console.error('Error general:', error);
        broadcast({
            type: 'error',
            message: 'Error general: ' + error.message
        });
    } finally {
        await browser.close().catch(() => { });
    }
}

module.exports = { procesarEmpresas };

'use strict';

const puppeteer = require('puppeteer');
const { validarURLZonaJobs } = require('./lib/seguridad');

const API_URL = process.env.APPS_SCRIPT_WEBAPP_URL || '';
const TOKEN = process.env.ZONAJOBS_BATCH_TOKEN || '';
const PATRON_AVISO_ZONAJOBS = /\/empleos\/[a-z0-9-]+-\d+\.html?/i;

function validarEntorno() {
  if (!API_URL.startsWith('https://script.google.com/macros/s/') || !API_URL.endsWith('/exec')) {
    throw new Error('APPS_SCRIPT_WEBAPP_URL no parece una URL /exec válida de Apps Script.');
  }
  if (TOKEN.length < 32) {
    throw new Error('ZONAJOBS_BATCH_TOKEN falta o es demasiado corto.');
  }
}

async function llamarApi(accion, datos = {}) {
  const respuesta = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion, token: TOKEN, ...datos }),
    signal: AbortSignal.timeout(60000)
  });
  const texto = await respuesta.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch (_error) {
    throw new Error(`Apps Script no devolvió JSON (HTTP ${respuesta.status}): ${texto.slice(0, 200)}`);
  }
  if (!respuesta.ok || !json.ok) {
    throw new Error(`Apps Script rechazó ${accion}: ${json.error || respuesta.status}`);
  }
  return json;
}

async function renderizarTrabajo(navegador, trabajo) {
  const url = validarURLZonaJobs(trabajo.url);
  const pagina = await navegador.newPage();
  const inicio = Date.now();

  try {
    await pagina.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await pagina.setViewport({ width: 1366, height: 900 });
    await pagina.setRequestInterception(true);
    pagina.on('request', (solicitud) => {
      const tipo = solicitud.resourceType();
      if (solicitud.isNavigationRequest() && solicitud.frame() === pagina.mainFrame()) {
        try {
          validarURLZonaJobs(solicitud.url());
          solicitud.continue();
        } catch (_error) {
          solicitud.abort('blockedbyclient');
        }
        return;
      }
      if (tipo === 'image' || tipo === 'media' || tipo === 'font') solicitud.abort();
      else solicitud.continue();
    });

    const navegacion = await pagina.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    const httpStatus = navegacion ? navegacion.status() : null;
    if (httpStatus && httpStatus >= 400) {
      throw new Error(`ZonaJobs respondió HTTP ${httpStatus}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    const html = await pagina.content();
    const urlFinal = pagina.url();
    validarURLZonaJobs(urlFinal);

    const avisos = await pagina.evaluate((patronStr) => {
      const patron = new RegExp(patronStr, 'i');
      const anclas = Array.from(document.querySelectorAll('a[href]'));
      const vistos = {};
      const resultado = [];

      anclas.forEach((ancla) => {
        const href = ancla.getAttribute('href') || '';
        if (!patron.test(href)) return;

        let urlAviso;
        try {
          const candidata = new URL(href, location.origin);
          if (candidata.protocol !== 'https:' || candidata.hostname !== location.hostname) return;
          urlAviso = candidata.toString();
        } catch (_error) {
          return;
        }
        if (vistos[urlAviso]) return;
        vistos[urlAviso] = true;

        const titulo = (ancla.innerText || ancla.textContent || '')
          .split('\n')
          .map((linea) => linea.trim())
          .find((linea) => linea.length > 0) || '';

        let nodo = ancla;
        let contexto = ancla.innerText || '';
        for (let nivel = 0; nivel < 5; nivel++) {
          if (!nodo.parentElement) break;
          nodo = nodo.parentElement;
          const texto = nodo.innerText || '';
          if (texto.length > contexto.length) contexto = texto;
          if (texto.length > 600) break;
        }
        resultado.push({
          url: urlAviso,
          titulo,
          contexto: contexto.substring(0, 1500)
        });
      });
      return resultado;
    }, PATRON_AVISO_ZONAJOBS.source);

    const textoPlano = await pagina.evaluate(() => (
      document.body ? document.body.innerText.toLowerCase() : ''
    ));
    const posibleBloqueo = /captcha|verifica que sos humano|acceso denegado|unusual traffic|robot/i.test(textoPlano);

    return {
      ok: true,
      httpStatus,
      urlFinal,
      cantidadAvisos: avisos.length,
      avisos,
      htmlLength: html.length,
      posibleBloqueo,
      tiempoMs: Date.now() - inicio
    };
  } finally {
    await pagina.close().catch(() => {});
  }
}

async function ejecutar() {
  validarEntorno();
  const reserva = await llamarApi('reservar');
  const trabajos = Array.isArray(reserva.trabajos) ? reserva.trabajos : [];

  if (trabajos.length === 0) {
    console.log(reserva.completa
      ? 'Prueba completa: no quedan trabajos pendientes.'
      : 'No hay trabajos disponibles en esta ejecución.');
    return;
  }

  console.log(`Trabajos reservados: ${trabajos.length}.`);
  const navegador = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  let huboErrorDeEntrega = false;
  try {
    for (const trabajo of trabajos) {
      let respuesta;
      try {
        respuesta = await renderizarTrabajo(navegador, trabajo);
        console.log(`${trabajo.termino} p.${trabajo.pagina}: ${respuesta.cantidadAvisos} avisos.`);
      } catch (error) {
        respuesta = {
          ok: false,
          error: String(error && error.message ? error.message : error)
        };
        console.error(`${trabajo.termino} p.${trabajo.pagina}: ${respuesta.error}`);
      }

      try {
        await llamarApi('resultado', { id: trabajo.id, respuesta });
      } catch (errorEntrega) {
        huboErrorDeEntrega = true;
        console.error(`No se pudo entregar el resultado ${trabajo.id}: ${errorEntrega.message}`);
      }
    }
  } finally {
    await navegador.close().catch(() => {});
  }

  if (huboErrorDeEntrega) process.exitCode = 1;
}

ejecutar().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

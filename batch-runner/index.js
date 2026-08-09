'use strict';

const puppeteer = require('puppeteer');
const { PATRON_AVISO_ZONAJOBS, validarURLZonaJobs } = require('./lib/seguridad');

const API_URL = process.env.APPS_SCRIPT_WEBAPP_URL || '';
const TOKEN = process.env.ZONAJOBS_BATCH_TOKEN || '';
const CONCURRENCIA = 3;
const MAX_TRABAJOS_POR_CORRIDA = 200;

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

    // La red ya quedó inactiva; esta pausa breve permite terminar el pintado
    // de las tarjetas sin demorar artificialmente cada página.
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

        let urlAviso;
        try {
          const candidata = new URL(href, location.origin);
          if (candidata.protocol !== 'https:' || candidata.hostname !== location.hostname) return;
          if (!patron.test(candidata.pathname)) return;
          urlAviso = candidata.toString();
        } catch (_error) {
          return;
        }
        if (vistos[urlAviso]) return;
        vistos[urlAviso] = true;

        const texto = (elemento) => (elemento && (elemento.innerText || elemento.textContent) || '').trim();
        const titulo = texto(ancla.querySelector('h2')) || (ancla.innerText || ancla.textContent || '')
          .split('\n')
          .map((linea) => linea.trim())
          .find((linea) => linea.length > 0 && !/^(publicado|actualizado)/i.test(linea)) || '';
        const detalles = Array.from(ancla.querySelectorAll('h3'))
          .map(texto)
          .filter((linea) => linea.length > 0);
        const fechaTexto = detalles.find((linea) => /^(publicado|actualizado)/i.test(linea)) || '';
        const campos = detalles.filter((linea) => linea !== fechaTexto);
        const empresa = campos[0] || '';
        const ubicacion = campos[1] || '';
        const modalidad = campos[2] || '';

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
          empresa,
          ubicacion,
          modalidad,
          fechaTexto,
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
  const inicio = await llamarApi('iniciar');
  console.log(`Ciclo: ${inicio.modo || 'sin modo'}${inicio.preparada ? ' (cola preparada)' : ''}.`);
  let navegador = null;
  let huboErrorDeEntrega = false;
  let totalProcesados = 0;
  try {
    while (!huboErrorDeEntrega) {
      const reserva = await llamarApi('reservar');
      const trabajos = Array.isArray(reserva.trabajos) ? reserva.trabajos : [];
      if (trabajos.length === 0) {
        console.log(reserva.completa
          ? `Ciclo completo. Páginas procesadas por esta corrida: ${totalProcesados}.`
          : 'No hay trabajos disponibles; la cola puede estar pausada o reservada por otra corrida.');
        break;
      }

      if (!navegador) {
        navegador = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ]
        });
      }

      for (let posicion = 0; posicion < trabajos.length; posicion += CONCURRENCIA) {
        const grupo = trabajos.slice(posicion, posicion + CONCURRENCIA);
        const resultados = await Promise.all(grupo.map(async (trabajo) => {
          try {
            const respuesta = await renderizarTrabajo(navegador, trabajo);
            console.log(`${trabajo.modo} | ${trabajo.termino} p.${trabajo.pagina}: ${respuesta.cantidadAvisos} avisos.`);
            return { trabajo, respuesta };
          } catch (error) {
            const respuesta = { ok: false, error: String(error && error.message ? error.message : error) };
            console.error(`${trabajo.modo} | ${trabajo.termino} p.${trabajo.pagina}: ${respuesta.error}`);
            return { trabajo, respuesta };
          }
        }));

        // Las entregas se hacen de a una para no superar la escritura segura
        // de Google Sheets. La navegación, que es lo lento, ya fue paralela.
        for (const item of resultados) {
          try {
            await llamarApi('resultado', { id: item.trabajo.id, respuesta: item.respuesta });
            totalProcesados++;
          } catch (errorEntrega) {
            huboErrorDeEntrega = true;
            console.error(`No se pudo entregar el resultado ${item.trabajo.id}: ${errorEntrega.message}`);
            break;
          }
        }
        if (huboErrorDeEntrega) break;
        if (totalProcesados >= MAX_TRABAJOS_POR_CORRIDA) {
          throw new Error(`Límite de seguridad alcanzado: ${MAX_TRABAJOS_POR_CORRIDA} trabajos.`);
        }
      }
    }
  } finally {
    if (navegador) await navegador.close().catch(() => {});
  }

  if (huboErrorDeEntrega) process.exitCode = 1;
}

ejecutar().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

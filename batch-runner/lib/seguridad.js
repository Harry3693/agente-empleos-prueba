'use strict';

const HOST_PERMITIDO = 'www.zonajobs.com.ar';

/**
 * La prueba sólo puede abrir búsquedas HTTPS del dominio exacto de ZonaJobs.
 * Devuelve una URL normalizada o lanza un error antes de iniciar Puppeteer.
 */
function validarURLZonaJobs(valor) {
  let url;
  try {
    url = new URL(valor);
  } catch (_error) {
    throw new Error('URL inválida.');
  }

  if (url.protocol !== 'https:') throw new Error('La URL debe usar HTTPS.');
  if (url.hostname !== HOST_PERMITIDO) throw new Error('Dominio no permitido.');
  if (url.port) throw new Error('No se permiten puertos personalizados.');
  if (url.username || url.password) throw new Error('No se permiten credenciales en la URL.');
  if (!/^\/empleos-busqueda-[a-z0-9-]+\.html$/.test(url.pathname)) {
    throw new Error('Ruta de búsqueda no permitida.');
  }
  if (/-pagina-\d+\.html$/.test(url.pathname)) {
    throw new Error('El formato antiguo -pagina-N.html no está permitido.');
  }
  if (url.hash) throw new Error('No se permiten fragmentos en la URL.');

  const parametros = Array.from(url.searchParams.keys());
  if (parametros.length > 0) {
    const paginas = url.searchParams.getAll('page');
    if (parametros.length !== 1 || parametros[0] !== 'page' || paginas.length !== 1 || !/^[2-9]\d*$/.test(paginas[0])) {
      throw new Error('La URL sólo admite el parámetro page con un entero mayor o igual a 2.');
    }
  }

  return url.toString();
}

module.exports = { HOST_PERMITIDO, validarURLZonaJobs };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarURLZonaJobs } = require('../lib/seguridad');

test('acepta páginas de búsqueda válidas de ZonaJobs', () => {
  assert.equal(
    validarURLZonaJobs('https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html'),
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html'
  );
  assert.equal(
    validarURLZonaJobs('https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial-pagina-5.html'),
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial-pagina-5.html'
  );
});

test('rechaza HTTP, otros dominios, puertos y rutas ajenas', () => {
  const prohibidas = [
    'http://www.zonajobs.com.ar/empleos-busqueda-gerente.html',
    'https://zonajobs.com.ar/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar.ejemplo.com/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar:8443/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar/',
    'https://127.0.0.1/empleos-busqueda-gerente.html',
    'file:///etc/passwd'
  ];
  prohibidas.forEach((url) => assert.throws(() => validarURLZonaJobs(url)));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PATRON_AVISO_ZONAJOBS, validarURLZonaJobs } = require('../lib/seguridad');

test('acepta páginas de búsqueda válidas de ZonaJobs', () => {
  assert.equal(
    validarURLZonaJobs('https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html'),
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html'
  );
  assert.equal(
    validarURLZonaJobs('https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html?page=5'),
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente-comercial.html?page=5'
  );
});

test('acepta avisos reales aunque el slug contenga puntos u otros caracteres', () => {
  assert.equal(
    PATRON_AVISO_ZONAJOBS.test('/empleos/gerente-de-operaciones-desarrollo-empresariales-s.a-2187623.html'),
    true
  );
  assert.equal(
    PATRON_AVISO_ZONAJOBS.test('/empleos/gerente-comercial-omnicanal-|-grupo-de-marcas-2186743.html'),
    true
  );
  assert.equal(PATRON_AVISO_ZONAJOBS.test('/empleos-busqueda-gerente-comercial.html'), false);
});

test('rechaza HTTP, otros dominios, puertos y rutas ajenas', () => {
  const prohibidas = [
    'http://www.zonajobs.com.ar/empleos-busqueda-gerente.html',
    'https://zonajobs.com.ar/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar.ejemplo.com/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar:8443/empleos-busqueda-gerente.html',
    'https://www.zonajobs.com.ar/',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente-pagina-2.html',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=1',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=0',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=dos',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=2&orden=fecha',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=2&page=3',
    'https://www.zonajobs.com.ar/empleos-busqueda-gerente.html?page=2#resultados',
    'https://127.0.0.1/empleos-busqueda-gerente.html',
    'file:///etc/passwd'
  ];
  prohibidas.forEach((url) => assert.throws(() => validarURLZonaJobs(url)));
});


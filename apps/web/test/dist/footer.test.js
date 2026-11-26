// (CI) Pie de página: aviso de no afiliación, enlaces legales, contacto y licencia de la fuente, en todas las páginas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAND } from '@tienda/contracts/brand';
import { fmt, pie } from '@tienda/contracts/i18n';
import { atributo, buscar, leerDist, paginasDeDist, parsear, texto } from './support/html.js';

const aviso = fmt(pie.noAfiliacion, { marca: BRAND.name });
const paginas = paginasDeDist();

test('pie: en cada página hay un único <footer> con el aviso de no afiliación y los enlaces legales', () => {
  for (const pagina of paginas) {
    const pies = buscar(parsear(leerDist(pagina)), 'footer');
    assert.equal(pies.length, 1, `${pagina}: debería haber un <footer>`);
    assert.ok(texto(pies[0]).includes(aviso), `${pagina}: falta el aviso`);
    const enlaces = buscar(pies[0], 'a').map((a) => [texto(a), atributo(a, 'href')]);
    assert.ok(
      enlaces.some(([t, h]) => t === pie.aviso && h === '/legal/aviso'),
      `${pagina}: aviso legal`,
    );
    assert.ok(
      enlaces.some(([t, h]) => t === pie.privacidad && h === '/legal/privacidad'),
      `${pagina}: privacidad`,
    );
    assert.ok(
      enlaces.some(([t, h]) => t === pie.licencias && h === '/licencias/oxanium-OFL.txt'),
      `${pagina}: licencias`,
    );
  }
});

test('pie: el contacto es el correo de BRAND o, mientras no exista, "pendiente"', () => {
  const contacto = texto(buscar(parsear(leerDist('index.html')), 'footer')[0]);
  if (BRAND.contactEmail) assert.ok(contacto.includes(BRAND.contactEmail));
  else assert.ok(contacto.includes(`${pie.contacto}: ${pie.pendiente}`), contacto);
});

test('pie: el aviso de la licencia OFL de la fuente se publica tal cual el del paquete', () => {
  const publicada = leerDist('licencias/oxanium-OFL.txt');
  const paquete = readFileSync(
    new URL('../../../../node_modules/@fontsource-variable/oxanium/LICENSE', import.meta.url),
    'utf8',
  );
  assert.equal(publicada, paquete);
});

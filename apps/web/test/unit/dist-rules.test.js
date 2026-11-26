import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atributo, buscar, parsear, reglasGlobales, rutasProhibidasEnDist, texto } from '../dist/support/html.js';

const AVISO = 'Tienda LIVE no está afiliado a TikTok.';

/** Una página correcta; cada prueba la rompe en un solo punto. */
function pagina({
  lang = 'lang="es"',
  cabeza = '<title>t</title>',
  salto = '<a class="skip-link" href="#contenido">Ir al contenido</a>',
  cuerpo = '<h1>Título</h1>',
  pie = `<footer><p>${AVISO}</p></footer>`,
} = {}) {
  return `<!doctype html><html ${lang}><head>${cabeza}</head><body>${salto}<main id="contenido">${cuerpo}</main>${pie}</body></html>`;
}

const problemas = (html) => reglasGlobales(html, { aviso: AVISO });

test('helpers: parsear, buscar, atributo y texto leen un HTML real', () => {
  const doc = parsear('<p class="a b">Hola   <b>mundo</b>\n!</p><p>otro</p>');
  const ps = buscar(doc, 'p');
  assert.equal(ps.length, 2);
  assert.equal(atributo(ps[0], 'class'), 'a b');
  assert.equal(atributo(ps[0], 'id'), null);
  assert.equal(texto(ps[0]), 'Hola mundo !');
});

test('globales: una página correcta no da problemas', () => {
  assert.deepEqual(problemas(pagina()), []);
});

test('globales: lang tiene que ser es', () => {
  assert.ok(problemas(pagina({ lang: 'lang="en"' })).some((p) => p.includes('lang')));
  assert.ok(problemas(pagina({ lang: '' })).some((p) => p.includes('lang')));
});

test('globales: exactamente un h1', () => {
  assert.ok(problemas(pagina({ cuerpo: '<p>sin título</p>' })).some((p) => p.includes('h1')));
  assert.ok(problemas(pagina({ cuerpo: '<h1>a</h1><h1>b</h1>' })).some((p) => p.includes('h1')));
});

test('globales: las imágenes llevan alt (vacío vale para decorativas)', () => {
  assert.ok(problemas(pagina({ cuerpo: '<h1>t</h1><img src="/a.png">' })).some((p) => p.includes('alt')));
  assert.deepEqual(problemas(pagina({ cuerpo: '<h1>t</h1><img src="/a.png" alt="">' })), []);
});

test('globales: los controles tienen nombre (label for, label envolvente, aria-label o aria-labelledby)', () => {
  const sin = '<h1>t</h1><input type="text" id="x">';
  assert.ok(problemas(pagina({ cuerpo: sin })).some((p) => p.includes('control')));
  const buenos = [
    '<h1>t</h1><label for="x">Correo</label><input type="email" id="x">',
    '<h1>t</h1><label>Correo <input type="email"></label>',
    '<h1>t</h1><input type="email" aria-label="Correo">',
    '<h1>t</h1><span id="l">Correo</span><select aria-labelledby="l"></select>',
    '<h1>t</h1><input type="hidden" name="a"><input type="submit" value="Enviar">',
  ];
  for (const cuerpo of buenos) assert.deepEqual(problemas(pagina({ cuerpo })), [], cuerpo);
  // un label que apunta a otro id no cuenta
  assert.ok(problemas(pagina({ cuerpo: '<h1>t</h1><label for="y">a</label><input id="x">' })).length > 0);
});

test('globales: el enlace para saltar es el primero y apunta a un id que existe', () => {
  assert.ok(problemas(pagina({ salto: '' })).some((p) => p.includes('saltar')));
  assert.ok(problemas(pagina({ salto: '<a href="#nada">Ir</a>' })).some((p) => p.includes('saltar')));
  assert.ok(problemas(pagina({ salto: '<a href="/inicio">Inicio</a>' })).some((p) => p.includes('saltar')));
});

test('globales: sin scripts ni estilos en línea, ni style=', () => {
  assert.ok(
    problemas(pagina({ cabeza: '<title>t</title><script>alert(1)</script>' })).some((p) => p.includes('script')),
  );
  assert.ok(problemas(pagina({ cabeza: '<title>t</title><style>a{}</style>' })).some((p) => p.includes('<style>')));
  assert.ok(problemas(pagina({ cuerpo: '<h1 style="color:red">t</h1>' })).some((p) => p.includes('style=')));
  // un script con src es de archivo, no en línea
  assert.deepEqual(
    problemas(pagina({ cabeza: '<title>t</title><script type="module" src="/_astro/a.js"></script>' })),
    [],
  );
});

test('globales: sin fuentes ni recursos de otro origen (los enlaces <a> a otros sitios sí valen)', () => {
  for (const cabeza of [
    '<title>t</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">',
    '<title>t</title><link rel="preconnect" href="https://fonts.gstatic.com">',
    '<title>t</title><link rel="preload" as="font" href="//cdn.test/a.woff2">',
    '<title>t</title><script src="https://cdn.jsdelivr.net/npm/a.js"></script>',
  ]) {
    assert.ok(
      problemas(pagina({ cabeza })).some((p) => p.includes('externo')),
      cabeza,
    );
  }
  assert.ok(
    problemas(pagina({ cuerpo: '<h1>t</h1><img src="https://x.test/a.png" alt="">' })).some((p) =>
      p.includes('externo'),
    ),
  );
  // canonical y enlaces normales no son recursos
  assert.deepEqual(
    problemas(
      pagina({
        cabeza:
          '<title>t</title><link rel="canonical" href="https://ejemplo.test/"><link rel="stylesheet" href="/_astro/a.css">',
        cuerpo: '<h1>t</h1><a href="https://tiktok.com">TikTok</a>',
      }),
    ),
    [],
  );
});

test('globales: el pie lleva el aviso de no afiliación', () => {
  assert.ok(problemas(pagina({ pie: '' })).some((p) => p.includes('aviso')));
  assert.ok(problemas(pagina({ pie: '<footer><p>otra cosa</p></footer>' })).some((p) => p.includes('aviso')));
  // el aviso fuera del <footer> no cuenta
  assert.ok(problemas(pagina({ pie: '', cuerpo: `<h1>t</h1><p>${AVISO}</p>` })).some((p) => p.includes('aviso')));
});

test('rutas: en dist no hay /juegos, /categorias ni /como-funciona (sí /juegos/asedio)', () => {
  assert.deepEqual(rutasProhibidasEnDist(['index.html', 'juegos/asedio.html', '404.html', 'legal/aviso.html']), []);
  for (const mala of [
    'juegos.html',
    'juegos/index.html',
    'categorias.html',
    'categorias/accion.html',
    'como-funciona.html',
  ]) {
    assert.ok(rutasProhibidasEnDist(['index.html', mala]).length > 0, mala);
  }
});

test('rutas: ningún enlace apunta a /juegos, /categorias ni /como-funciona', () => {
  const malo = pagina({ cuerpo: '<h1>t</h1><a href="/juegos">Juegos</a><a href="/categorias/accion">A</a>' });
  assert.equal(problemas(malo).filter((p) => p.includes('ruta que no existe')).length, 2);
  assert.deepEqual(problemas(pagina({ cuerpo: '<h1>t</h1><a href="/juegos/asedio">ASEDIO</a>' })), []);
});

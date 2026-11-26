import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { ConfigError } from '@tienda/kit/sim/config.js';
import { normWord } from '@tienda/kit/sim/words.js';
import { PAISES } from '../public/js/data/paises.js';
import { PALETA } from '../public/js/data/paleta.js';
import { describePair, secondChoices } from '../public/js/sim/matchup.js';

// CB-1 y CB-2: la lista curada de 22 países (solo datos) y sus reglas de integridad.
const GP = fileURLToPath(new URL('..', import.meta.url));

/** Archivos del juego (sin node_modules), de forma recursiva. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const FILES = walk(GP);
const TEXT = /\.(html|css|js|mjs|json|svg|txt|md)$/i;
const rel = (f) => path.relative(GP, f).replaceAll('\\', '/');

const teamDef = (c) => ({ id: c.id, name: c.name, iso: c.iso, aliases: c.aliases, firstOnly: c.firstOnly });
const byId = Object.fromEntries(PAISES.map((c) => [c.id, c]));

/** Todos los pares sin orden: 22 países dan 231. */
const PARES = PAISES.flatMap((a, i) => PAISES.slice(i + 1).map((b) => [a, b]));

test('CB-1: 22 entradas con id e ISO únicos y solo los campos permitidos', () => {
  assert.equal(PAISES.length, 22);
  assert.equal(new Set(PAISES.map((c) => c.id)).size, 22);
  assert.equal(new Set(PAISES.map((c) => c.iso)).size, 22);
  assert.equal(PARES.length, 231);
  for (const c of PAISES) {
    assert.deepEqual(Object.keys(c).sort(), ['aliases', 'colors', 'firstOnly', 'id', 'iso', 'name'], c.id);
    assert.match(c.id, /^[A-Z]{2}$/);
    assert.equal(c.iso, c.id);
    assert.ok(typeof c.name === 'string' && c.name.trim() === c.name && c.name.length > 0);
    assert.ok(Array.isArray(c.aliases) && c.aliases.length > 0, c.id);
    assert.ok(Array.isArray(c.firstOnly));
  }
});

test('CB-1: la lista A de 18 más CU, PR, US y GQ de la lista B', () => {
  const lista = 'AR BO CL CO CR DO EC ES GT HN MX NI PA PE PY SV UY VE'.split(' ');
  for (const id of [...lista, 'CU', 'PR', 'US', 'GQ']) assert.ok(byId[id], id);
});

test('CB-1: cada país trae al menos 2 colores candidatos, distintos y de la paleta', () => {
  const ids = new Set(PALETA.colors.map((c) => c.id));
  for (const c of PAISES) {
    assert.ok(c.colors.length >= 2, c.id);
    assert.equal(new Set(c.colors).size, c.colors.length, `${c.id}: sin colores repetidos`);
    for (const color of c.colors) assert.ok(ids.has(color), `${c.id}: ${color} no está en la paleta`);
  }
});

test('CB-2: sin campos ni archivos de bandera, escudo, himno, imagen o emblema, ni filas de píxeles por país', () => {
  const banned = /flag|bandera|escudo|himno|anthem|crest|coat|emblem|image|imagen|stripe|franja|pixel|row|grid/i;
  for (const c of PAISES) {
    for (const k of Object.keys(c)) assert.doesNotMatch(k, banned, `${c.id}.${k}`);
    // los datos de un país son texto y listas de texto: nunca filas ni rejillas de números
    for (const v of Object.values(c)) {
      if (Array.isArray(v)) for (const item of v) assert.equal(typeof item, 'string', c.id);
    }
  }
  const nombres = FILES.map(rel).filter((f) =>
    /flag|bandera|escudo|himno|anthem|crest|coat|emblem/i.test(path.basename(f)),
  );
  assert.deepEqual(nombres, []);
});

test('CB-2 y KIT-6: ninguna fuente del juego contiene indicadores regionales (U+1F1E6 a U+1F1FF)', () => {
  const regional = new RegExp('[\\u{1F1E6}-\\u{1F1FF}]', 'u');
  for (const f of FILES.filter((x) => TEXT.test(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), regional, rel(f));
  }
});

test('KIT-7: los alias normalizados de los 231 pares son disjuntos (se arma un registro con cada par)', () => {
  for (const [a, b] of PARES) {
    for (const teams of [
      [a, b],
      [b, a],
    ]) {
      try {
        createRegistry({ teams: teams.map(teamDef) });
      } catch (e) {
        assert.fail(`par ${teams[0].id}-${teams[1].id}: ${e.message}`);
      }
    }
  }
});

test('KIT-7: un alias repetido entre dos países de la lista sí se detecta con el par en el mensaje', () => {
  const [a, b] = PARES[0];
  const roto = { ...teamDef(b), aliases: [...b.aliases, a.aliases[0]] };
  assert.throws(
    () => createRegistry({ teams: [teamDef(a), roto] }),
    (e) => e instanceof ConfigError && e.message.includes(`"${a.aliases[0]}"`),
  );
});

test('los alias ya vienen normalizados y no hay alias sueltos que sean números', () => {
  for (const c of PAISES) {
    for (const alias of [...c.aliases, ...c.firstOnly]) {
      assert.equal(normWord(alias), alias, `${c.id}: "${alias}"`);
      assert.doesNotMatch(alias, /^\d+$/);
    }
    // un alias no está a la vez en las dos listas
    for (const alias of c.firstOnly) assert.ok(!c.aliases.includes(alias), `${c.id}: "${alias}" repetido`);
  }
});

test('KIT-6 (nota del coordinador): normWord(nombre) es un alias de cada país y por eso unirse por nombre funciona', () => {
  for (const c of PAISES) {
    const nombre = normWord(c.name);
    // Chile es la excepción de diseño: "chile" solo une como primer token (firstOnly), así que "chile con carne" no une
    assert.ok(
      c.aliases.includes(nombre) || c.firstOnly.includes(nombre),
      `${c.id}: normWord("${c.name}") = "${nombre}"`,
    );
    // ... y con el registro de verdad: el nombre completo como comentario une al país, enfrentado a otro cualquiera
    const otro = PAISES.find((x) => x.id !== c.id);
    const r = createRegistry({ teams: [c, otro].map(teamDef) });
    assert.equal(r.joinFromChat({ userId: 'u', nickname: 'U', text: c.name }, 0, 1)?.team, 1, `${c.id}: "${c.name}"`);
    assert.equal(r.joinFromChat({ userId: 'w', nickname: 'W', text: c.name.toUpperCase() + '!!!' }, 0, 1)?.team, 1);
  }
  // todos los nombres menos Chile están entre los alias normales
  const soloPrimero = PAISES.filter((c) => !c.aliases.includes(normWord(c.name))).map((c) => c.id);
  assert.deepEqual(soloPrimero, ['CL']);
});

test('CB-1: alias de dos palabras costarica, elsalvador y guineaecuatorial', () => {
  assert.ok(byId.CR.aliases.includes('costarica'));
  assert.ok(byId.SV.aliases.includes('elsalvador'));
  assert.ok(byId.GQ.aliases.includes('guineaecuatorial'));
  const unir = (id, otro, text) => {
    const r = createRegistry({ teams: [byId[id], byId[otro]].map(teamDef) });
    return r.joinFromChat({ userId: 'u', nickname: 'U', text }, 0, 1)?.team ?? 0;
  };
  assert.equal(unir('CR', 'MX', 'viva costa rica'), 1);
  assert.equal(unir('SV', 'MX', 'viva el salvador'), 1);
  assert.equal(unir('GQ', 'MX', 'vamos guinea ecuatorial'), 1);
  assert.equal(unir('CR', 'MX', 'costa'), 0, '"costa" sola nunca une');
});

test('CB-1: "salvador" y "guanaco" son firstOnly de SV y "guinea" de GQ', () => {
  assert.deepEqual([...byId.SV.firstOnly].sort(), ['guanaco', 'salvador']);
  assert.deepEqual(byId.GQ.firstOnly, ['guinea']);
  const unir = (id, text) => {
    const r = createRegistry({ teams: [byId[id], byId.MX].map(teamDef) });
    return r.joinFromChat({ userId: 'u', nickname: 'U', text }, 0, 1)?.team ?? 0;
  };
  assert.equal(unir('SV', 'salvador!'), 1);
  assert.equal(unir('SV', 'guanaco'), 1);
  assert.equal(unir('SV', 'mi tío salvador'), 0);
  assert.equal(unir('GQ', 'guinea'), 1);
  assert.equal(unir('GQ', 'mi guinea'), 0);
});

test('CB-1: el escaneo de listas de pares prohibidos no halla nada y no se dispara con usuarios bloqueados ni nombres-vetados.js', () => {
  // el patrón se arma por partes para que este archivo no se encuentre a sí mismo
  const PAR_BLOQUEADO = new RegExp(
    ['pares?[-_ ]?bloque' + 'ados', 'blocked' + 'Pairs', 'pair' + 'Blocklist'].join('|'),
    'i',
  );
  for (const f of FILES.filter((x) => TEXT.test(x))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), PAR_BLOQUEADO, rel(f));
    assert.doesNotMatch(path.basename(f), PAR_BLOQUEADO);
  }
  const positivos = [
    'pares ' + 'bloqueados',
    'pares-bloque' + 'ados.json',
    'blocked' + 'Pairs',
    'pair' + 'Blocklist',
    'pares_bloque' + 'ados',
  ];
  for (const s of positivos) {
    assert.match(s, PAR_BLOQUEADO, s);
  }
  for (const s of ['los usuarios bloqueados', 'nombres-vetados.js', 'usuarios_bloqueados']) {
    assert.doesNotMatch(s, PAR_BLOQUEADO, s);
  }
});

// ---------- selector de pares y descriptores de equipo (CB-1, CB-2, CB-3) ----------

test('CB-1: tras elegir X, la lista de segundos países es exactamente los otros 21, sin importar el orden de las elecciones', () => {
  for (const x of PAISES) {
    const otros = secondChoices(PAISES, x.id);
    assert.equal(otros.length, 21);
    assert.deepEqual(
      otros.map((c) => c.id),
      PAISES.filter((c) => c.id !== x.id).map((c) => c.id),
    );
  }
  // simetría: Y está entre los segundos de X si y solo si X está entre los segundos de Y
  for (const [a, b] of PARES) {
    assert.ok(secondChoices(PAISES, a.id).some((c) => c.id === b.id));
    assert.ok(secondChoices(PAISES, b.id).some((c) => c.id === a.id));
  }
  assert.deepEqual(secondChoices(PAISES, 'XX'), [], 'un país desconocido no ofrece segundos');
});

test('CB-1: los 231 pares, en los dos órdenes, se pueden empezar; un país desconocido o dos iguales se rechazan', () => {
  for (const [a, b] of PARES) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const r = describePair(PAISES, x.id, y.id);
      assert.equal(r.ok, true, `${x.id}-${y.id}`);
      assert.equal(r.teams.length, 2);
    }
  }
  for (const [x, y] of [
    ['XX', 'PE'],
    ['PE', 'XX'],
    ['PE', 'PE'],
    [undefined, 'PE'],
  ]) {
    const r = describePair(PAISES, x, y);
    assert.equal(r.ok, false, `${x}-${y}`);
    assert.equal(typeof r.error, 'string');
    assert.equal('teams' in r, false);
  }
});

test('CB-2 y CB-3: el descriptor de cualquier par tiene lado, UN color, chip con el nombre, siluetas distintas y banderín liso', () => {
  for (const [a, b] of PARES) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const { teams } = describePair(PAISES, x.id, y.id);
      const [izq, der] = teams;
      assert.deepEqual([izq.side, der.side], ['left', 'right']);
      assert.deepEqual([izq.id, der.id], [x.id, y.id]);
      assert.notEqual(izq.art, der.art);
      assert.deepEqual([izq.art, der.art], ['base-fortin', 'base-ciudadela']);
      for (const t of teams) {
        const pais = byId[t.id];
        assert.deepEqual(
          Object.keys(t).sort(),
          ['art', 'chip', 'color', 'colorId', 'id', 'iso', 'name', 'pennant', 'side'],
          'solo estos campos: nada para dibujar símbolos nacionales',
        );
        assert.match(t.color, /^#[0-9A-F]{6}$/);
        assert.equal(typeof t.color, 'string', 'UN solo color, no una lista');
        assert.equal(t.color, PALETA.colors.find((c) => c.id === t.colorId).hex);
        assert.equal(t.name, pais.name);
        assert.equal(t.chip.text, pais.name);
        assert.equal(t.chip.bg, t.color);
        assert.equal(t.chip.fg, PALETA.ink);
        assert.deepEqual(t.pennant, { fill: t.color });
      }
      assert.notEqual(izq.color, der.color);
    }
  }
});

test('CB-3: los colores del descriptor no dependen de qué país va a la izquierda', () => {
  for (const [a, b] of PARES) {
    const ab = describePair(PAISES, a.id, b.id).teams;
    const ba = describePair(PAISES, b.id, a.id).teams;
    const color = (teams, id) => teams.find((t) => t.id === id).color;
    assert.equal(color(ab, a.id), color(ba, a.id), `${a.id}-${b.id}`);
    assert.equal(color(ab, b.id), color(ba, b.id));
  }
});

test('CB-3: el override pairColors llega al descriptor', () => {
  const r = describePair(PAISES, 'PE', 'MX', { pairColors: { 'MX-PE': ['azul', 'oro'] } });
  assert.deepEqual(
    r.teams.map((t) => [t.id, t.colorId]),
    [
      ['PE', 'oro'],
      ['MX', 'azul'],
    ],
  );
});

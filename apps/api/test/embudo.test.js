import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fake } from './support/d1-fake.js';
import { buildEmbudoSql, formatEmbudo, extractRows, EMBUDO_SQL, VENTANA_DIAS } from '../src/report/embudo.js';
import { CATEGORIES, STREAM_TYPES } from '@tienda/contracts/enums';
import { EVENT_NAMES } from '@tienda/contracts/events';

const HOY = '2026-11-05';
const T = '2026-11-01T10:00:00.000Z';

let contador = 0;
/** Inserta una persona; `confirmada` la deja confirmada. */
function anotar(db, { email, live = 'semanal', tipo = 'gaming', intereses = ['accion'], confirmada = true }) {
  contador += 1;
  db.sqlite
    .prepare(
      `INSERT INTO waitlist (email, live_frequency, stream_type, interests, consent_version, consent_at, created_at,
         updated_at, confirmed_at, token_hash, token_expires_at)
       VALUES (?1, ?2, ?3, ?4, 'v1', ?5, ?5, ?5, ?6, ?7, ?8)`,
    )
    .run(
      email,
      live,
      tipo,
      JSON.stringify(intereses),
      T,
      confirmada ? T : null,
      confirmada ? null : contador.toString(16).padStart(64, '0'),
      confirmada ? null : '2026-11-03T10:00:00.000Z',
    );
}

const evento = (db, day, event, count) =>
  db.sqlite.prepare('INSERT INTO funnel_daily (day, event, count) VALUES (?, ?, ?)').run(day, event, count);

function informe(db, hoy = HOY) {
  const filas = db.sqlite
    .prepare(buildEmbudoSql(hoy))
    .all()
    .map((f) => ({ ...f }));
  return formatEmbudo(filas, { hoy });
}

test('embudo: con la base vacía todo da cero, con las 4 categorías, los 4 tipos y 14 días en cero', () => {
  const texto = informe(createD1Fake());
  assert.match(texto, /Anotados confirmados: 0$/m);
  assert.match(texto, /Con LIVE activo.*: 0$/m);
  assert.match(texto, /Pendientes de confirmar.*: 0$/m);
  for (const c of CATEGORIES) assert.match(texto, new RegExp(`^\\s+${c}\\s+0$`, 'm'), c);
  for (const t of STREAM_TYPES) assert.match(texto, new RegExp(`^\\s+${t}\\s+0$`, 'm'), t);
  assert.equal((texto.match(/^\s+\d{4}-\d{2}-\d{2}\s/gm) ?? []).length, VENTANA_DIAS);
  assert.match(texto, /Criterio H1: 50 anotados \/ 20 con LIVE activo/);
});

test('embudo: cuenta los confirmados desde confirmed_at y deja a los pendientes aparte (FM-5)', () => {
  const db = createD1Fake();
  anotar(db, { email: 'a@example.com' });
  anotar(db, { email: 'b@example.com' });
  anotar(db, { email: 'c@example.com', confirmada: false });
  anotar(db, { email: 'd@example.com', confirmada: false });
  anotar(db, { email: 'e@example.com', confirmada: false });
  // eventos que NO deben influir en los anotados
  evento(db, HOY, 'form_open', 40);
  const texto = informe(db);
  assert.match(texto, /Anotados confirmados: 2$/m);
  assert.match(texto, /Pendientes de confirmar.*: 3$/m);
});

test('embudo: LIVE activo = confirmados con una frecuencia distinta de "todavia-no"', () => {
  const db = createD1Fake();
  anotar(db, { email: 'a@example.com', live: 'diario' });
  anotar(db, { email: 'b@example.com', live: 'ocasional' });
  anotar(db, { email: 'c@example.com', live: 'todavia-no' });
  anotar(db, { email: 'd@example.com', live: 'diario', confirmada: false });
  const texto = informe(db);
  assert.match(texto, /Anotados confirmados: 3$/m);
  assert.match(texto, /Con LIVE activo.*: 2$/m);
});

test('embudo: el interés cuenta una vez por categoría elegida por cada confirmado; los pendientes no suman', () => {
  const db = createD1Fake();
  anotar(db, { email: 'a@example.com', intereses: ['accion', 'metas'] });
  anotar(db, { email: 'b@example.com', intereses: ['accion'] });
  anotar(db, { email: 'c@example.com', intereses: ['accion', 'publico', 'relax', 'metas'], confirmada: false });
  const texto = informe(db);
  assert.match(texto, /^\s+accion\s+2$/m);
  assert.match(texto, /^\s+metas\s+1$/m);
  assert.match(texto, /^\s+publico\s+0$/m);
  assert.match(texto, /^\s+relax\s+0$/m);
});

test('embudo: reparte los confirmados por tipo de LIVE', () => {
  const db = createD1Fake();
  anotar(db, { email: 'a@example.com', tipo: 'musica' });
  anotar(db, { email: 'b@example.com', tipo: 'musica' });
  anotar(db, { email: 'c@example.com', tipo: 'charla' });
  const texto = informe(db);
  assert.match(texto, /^\s+musica\s+2$/m);
  assert.match(texto, /^\s+charla\s+1$/m);
  assert.match(texto, /^\s+gaming\s+0$/m);
});

test('embudo: la tabla de eventos cubre los últimos 14 días UTC con ceros y deja fuera lo más viejo', () => {
  const db = createD1Fake();
  evento(db, '2026-11-05', 'form_open', 7);
  evento(db, '2026-11-05', 'video_play', 3);
  evento(db, '2026-10-23', 'form_open', 2); // primer día de la ventana (hoy - 13)
  evento(db, '2026-10-22', 'form_open', 99); // fuera
  const texto = informe(db);
  const dias = [...texto.matchAll(/^\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\s+(\d+)$/gm)];
  assert.equal(dias.length, 14);
  assert.equal(dias[0][1], '2026-10-23');
  assert.equal(dias.at(-1)[1], '2026-11-05');
  const columnas = texto
    .match(/^\s+día\s+(.*)$/m)[1]
    .trim()
    .split(/\s+/);
  assert.deepEqual(columnas, [...EVENT_NAMES]);
  const celda = (dia, evento) => {
    const fila = dias.find((d) => d[1] === dia);
    return Number(fila[2 + columnas.indexOf(evento)]);
  };
  assert.equal(celda('2026-11-05', 'form_open'), 7);
  assert.equal(celda('2026-11-05', 'video_play'), 3);
  assert.equal(celda('2026-10-23', 'form_open'), 2);
  assert.equal(celda('2026-11-04', 'form_open'), 0);
  assert.doesNotMatch(texto, /2026-10-22/);
  assert.doesNotMatch(texto, /\b99\b/);
});

test('embudo: la línea del criterio H1 dice cuánto falta y cuándo se cumple', () => {
  const db = createD1Fake();
  anotar(db, { email: 'a@example.com', live: 'diario' });
  const poco = informe(db);
  assert.match(poco, /Criterio H1: 50 anotados \/ 20 con LIVE activo/);
  assert.match(poco, /Anotados: 1 de 50 \(faltan 49\)/);
  assert.match(poco, /Con LIVE activo: 1 de 20 \(faltan 19\)/);

  const lleno = createD1Fake();
  for (let i = 0; i < 50; i += 1) anotar(lleno, { email: `p${i}@example.com`, live: i < 20 ? 'diario' : 'todavia-no' });
  const completo = informe(lleno);
  assert.match(completo, /Anotados: 50 de 50 \(cumplido\)/);
  assert.match(completo, /Con LIVE activo: 20 de 20 \(cumplido\)/);
});

test('embudo: el informe no imprime correos ni usuarios', () => {
  const db = createD1Fake();
  anotar(db, { email: 'secreta@example.com' });
  anotar(db, { email: 'otra@example.com', confirmada: false });
  const texto = informe(db);
  assert.doesNotMatch(texto, /secreta|otra@|example\.com|@/);
});

test('embudo: la consulta cabe en el límite de D1 de 5 términos por SELECT compuesto (lo midió wrangler)', () => {
  const terminos = buildEmbudoSql(HOY).match(/\bSELECT\b/g) ?? [];
  assert.ok(terminos.length <= 5, `tiene ${terminos.length} términos`);
});

test('embudo: buildEmbudoSql solo acepta una fecha AAAA-MM-DD (no se puede colar SQL)', () => {
  assert.throws(() => buildEmbudoSql("2026-11-05' OR 1=1 --"), /fecha/);
  assert.throws(() => buildEmbudoSql('hoy'), /fecha/);
  assert.match(buildEmbudoSql('2026-11-05'), /day >= '2026-10-23'/);
  assert.equal(typeof EMBUDO_SQL, 'string');
});

test('embudo: extractRows acepta la salida --json de wrangler (lista de resultados) y también filas sueltas', () => {
  const filas = [{ k: 'confirmados', v: 2 }];
  assert.deepEqual(extractRows([{ results: filas, success: true, meta: {} }]), filas);
  assert.deepEqual(extractRows({ results: filas }), filas);
  assert.deepEqual(extractRows(filas), filas);
  assert.deepEqual(extractRows([]), []);
  assert.throws(() => extractRows('texto'), /salida/);
});

test('embudo: formatEmbudo ignora claves desconocidas y tolera filas faltantes', () => {
  const texto = formatEmbudo(
    [
      { k: 'inventada', v: 5 },
      { k: 'confirmados', v: 1 },
    ],
    { hoy: HOY },
  );
  assert.match(texto, /Anotados confirmados: 1$/m);
  assert.match(texto, /Con LIVE activo.*: 0$/m);
});

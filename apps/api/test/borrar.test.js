import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1Fake } from './support/d1-fake.js';
import { buildDeleteSql, parseBorrarArgs, formatBorrado } from '../scripts/borrar.mjs';
import { buildD1Args, parseWranglerJson, rowCountOf, interpretWranglerRun } from '../scripts/wrangler-d1.mjs';
import { parseEmbudoArgs } from '../scripts/embudo.mjs';

function anotar(db, email) {
  db.sqlite
    .prepare(
      `INSERT INTO waitlist (email, live_frequency, stream_type, interests, consent_version, consent_at, created_at,
         updated_at) VALUES (?1, 'diario', 'charla', '["relax"]', 'v1', ?2, ?2, ?2)`,
    )
    .run(email, '2026-11-05T12:00:00.000Z');
}
const correos = (db) =>
  db.sqlite
    .prepare('SELECT email FROM waitlist ORDER BY email')
    .all()
    .map((f) => f.email);

test('borrar: el correo se normaliza igual que al guardarlo (recorta y pasa a minúsculas)', () => {
  assert.equal(
    buildDeleteSql('  Ana@Example.COM '),
    "DELETE FROM waitlist WHERE email = 'ana@example.com' RETURNING id",
  );
});

test('borrar: borra la fila de esa persona, confirmada o no, y solo esa', () => {
  const db = createD1Fake();
  anotar(db, 'ana@example.com');
  anotar(db, 'otra@example.com');
  db.sqlite
    .prepare("UPDATE waitlist SET confirmed_at = '2026-11-05T13:00:00.000Z' WHERE email = 'ana@example.com'")
    .run();
  const { changes } = db.sqlite.prepare(buildDeleteSql('Ana@example.com')).run();
  assert.equal(Number(changes), 1);
  assert.deepEqual(correos(db), ['otra@example.com']);
  assert.equal(Number(db.sqlite.prepare(buildDeleteSql('ana@example.com')).run().changes), 0);
});

test('borrar: la comilla simple se escapa duplicándola; un correo con comillas no puede colar SQL', () => {
  assert.equal(
    buildDeleteSql("o'brien@example.com"),
    "DELETE FROM waitlist WHERE email = 'o''brien@example.com' RETURNING id",
  );
  const db = createD1Fake();
  anotar(db, "o'brien@example.com");
  anotar(db, 'a@example.com');
  anotar(db, "a'--@example.com");
  assert.equal(Number(db.sqlite.prepare(buildDeleteSql("o'brien@example.com")).run().changes), 1);
  assert.equal(Number(db.sqlite.prepare(buildDeleteSql("a'--@example.com")).run().changes), 1);
  assert.deepEqual(correos(db), ['a@example.com']);
});

test('borrar: un correo inválido falla sin repetir lo que se escribió', () => {
  for (const malo of ['', 'sin-arroba', 'a b@example.com', 'x@y', `${'a'.repeat(260)}@example.com`]) {
    assert.throws(
      () => buildDeleteSql(malo),
      (error) => /correo inválido/.test(error.message) && (malo === '' || !error.message.includes(malo)),
      malo,
    );
  }
});

test('borrar: argumentos -> correo y --remote opcional; faltante, sobrante o desconocido falla', () => {
  assert.deepEqual(parseBorrarArgs(['ana@example.com']), { email: 'ana@example.com', remote: false });
  assert.deepEqual(parseBorrarArgs(['ana@example.com', '--remote']), { email: 'ana@example.com', remote: true });
  assert.deepEqual(parseBorrarArgs(['--remote', 'ana@example.com']), { email: 'ana@example.com', remote: true });
  assert.throws(() => parseBorrarArgs([]), /falta el correo/);
  assert.throws(() => parseBorrarArgs(['--remote']), /falta el correo/);
  assert.throws(() => parseBorrarArgs(['a@example.com', 'b@example.com']), /un solo correo/);
  assert.throws(() => parseBorrarArgs(['a@example.com', '--todo']), /opción desconocida/);
});

test('borrar: el resultado impreso dice cuántas filas se borraron y no menciona el correo', () => {
  assert.equal(formatBorrado(1, { remote: false }), 'Filas borradas (base local): 1');
  assert.equal(formatBorrado(0, { remote: true }), 'Filas borradas (base remota): 0');
});

test('wrangler-d1: arma el comando con --local por defecto y --remote solo si se pide', () => {
  const local = buildD1Args({ sql: 'SELECT 1', remote: false });
  assert.deepEqual(local, ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', 'SELECT 1']);
  const remoto = buildD1Args({ sql: 'SELECT 1', remote: true });
  assert.deepEqual(remoto, ['wrangler', 'd1', 'execute', 'DB', '--remote', '--json', '--command', 'SELECT 1']);
});

test('wrangler-d1: parseWranglerJson salta líneas de aviso antes del JSON', () => {
  const salida =
    ' ⛅️ wrangler 4.157.0\n-------------------\n[\n  { "results": [{ "k": "confirmados", "v": 2 }], "success": true, "meta": { "changes": 0 } }\n]\n';
  assert.deepEqual(parseWranglerJson(salida)[0].results, [{ k: 'confirmados', v: 2 }]);
  assert.deepEqual(parseWranglerJson('{"a":1}'), { a: 1 });
  assert.throws(() => parseWranglerJson('sin json'), /salida de wrangler/);
  assert.throws(() => parseWranglerJson('[ roto'), /salida de wrangler/);
});

test('wrangler-d1: rowCountOf cuenta las filas del primer resultado (DELETE ... RETURNING)', () => {
  assert.equal(rowCountOf([{ results: [{ id: 1 }, { id: 2 }], success: true, meta: { duration: 1 } }]), 2);
  assert.equal(rowCountOf([{ results: [], success: true, meta: { duration: 1 } }]), 0);
  assert.equal(rowCountOf({ results: [{ id: 7 }] }), 1);
  assert.throws(() => rowCountOf([{ success: true, meta: {} }]), /results/);
});

test('wrangler-d1: interpretWranglerRun acepta código 0 con JSON y rechaza código 0 sin JSON o con { error }', () => {
  const bien = JSON.stringify([{ results: [], success: true, meta: { changes: 1 } }]);
  assert.deepEqual(interpretWranglerRun({ status: 0, stdout: bien, stderr: '' })[0].meta.changes, 1);
  assert.throws(() => interpretWranglerRun({ status: 0, stdout: 'nada', stderr: '' }), /código 0/);
  const conError = JSON.stringify({ error: { text: 'too many terms in compound SELECT' } });
  assert.throws(() => interpretWranglerRun({ status: 0, stdout: conError, stderr: '' }), /too many terms/);
  assert.throws(() => interpretWranglerRun({ status: 1, stdout: conError, stderr: '' }), /código 1/);
});

test('wrangler-d1: la caída de Node al salir en Windows (3221226505) con resultados completos no cuenta como fallo', () => {
  const bien = JSON.stringify([{ results: [{ k: 'confirmados', v: 1 }], success: true, meta: {} }]);
  const caida = 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
  assert.equal(interpretWranglerRun({ status: 3221226505, stdout: bien, stderr: caida })[0].success, true);
  // sin resultados completos, o con un resultado fallido, sigue siendo un fallo
  assert.throws(() => interpretWranglerRun({ status: 3221226505, stdout: '', stderr: caida }), /3221226505/);
  const mal = JSON.stringify([{ results: [], success: false, meta: {} }]);
  assert.throws(() => interpretWranglerRun({ status: 3221226505, stdout: mal, stderr: caida }), /3221226505/);
  assert.throws(() => interpretWranglerRun({ status: 1, stdout: '[]', stderr: '' }), /código 1/);
});

test('embudo: argumentos -> --remote opcional; cualquier otra cosa falla', () => {
  assert.deepEqual(parseEmbudoArgs([]), { remote: false });
  assert.deepEqual(parseEmbudoArgs(['--remote']), { remote: true });
  assert.throws(() => parseEmbudoArgs(['--otra']), /opción desconocida/);
  assert.throws(() => parseEmbudoArgs(['algo']), /opción desconocida/);
});

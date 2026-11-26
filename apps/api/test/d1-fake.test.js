import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1Fake, readMigrations } from './support/d1-fake.js';

const TABLA = 'CREATE TABLE t (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, n INTEGER, ok INTEGER)';

function conTabla() {
  return createD1Fake({ migrations: [TABLA] });
}

test('d1-fake: run() devuelve la forma de D1 {success, results, meta}', async () => {
  const db = conTabla();
  const res = await db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind('a').run();
  assert.equal(res.success, true);
  assert.deepEqual(res.results, []);
  assert.equal(res.meta.changes, 1);
  assert.equal(res.meta.last_row_id, 1);
});

test('d1-fake: all() devuelve las filas como objetos planos', async () => {
  const db = conTabla();
  await db.prepare('INSERT INTO t (nombre, n) VALUES (?1, ?2)').bind('a', 7).run();
  await db.prepare('INSERT INTO t (nombre, n) VALUES (?1, ?2)').bind('b', 8).run();
  const res = await db.prepare('SELECT nombre, n FROM t ORDER BY id').all();
  assert.equal(res.success, true);
  assert.deepEqual(res.results, [
    { nombre: 'a', n: 7 },
    { nombre: 'b', n: 8 },
  ]);
  assert.equal(Object.getPrototypeOf(res.results[0]), Object.prototype);
});

test('d1-fake: first() devuelve la fila, una columna o null si no hay filas', async () => {
  const db = conTabla();
  assert.equal(await db.prepare('SELECT nombre FROM t').first(), null);
  assert.equal(await db.prepare('SELECT nombre FROM t').first('nombre'), null);
  await db.prepare('INSERT INTO t (nombre, n) VALUES (?1, ?2)').bind('a', 7).run();
  assert.deepEqual(await db.prepare('SELECT nombre, n FROM t').first(), { nombre: 'a', n: 7 });
  assert.equal(await db.prepare('SELECT nombre, n FROM t').first('n'), 7);
});

test('d1-fake: bind() no muta la sentencia: devuelve una nueva, como D1', async () => {
  const db = conTabla();
  const base = db.prepare('INSERT INTO t (nombre) VALUES (?1)');
  const a = base.bind('a');
  const b = base.bind('b');
  assert.notEqual(a, base);
  await a.run();
  await b.run();
  const res = await db.prepare('SELECT nombre FROM t ORDER BY id').all();
  assert.deepEqual(
    res.results.map((f) => f.nombre),
    ['a', 'b'],
  );
});

test('d1-fake: rechaza undefined en un bind (D1 lo rechaza), pero acepta null', async () => {
  const db = conTabla();
  await assert.rejects(async () => db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind(undefined).run(), /undefined/);
  const res = await db.prepare('INSERT INTO t (nombre, n) VALUES (?1, ?2)').bind('a', null).run();
  assert.equal(res.meta.changes, 1);
  assert.equal(await db.prepare('SELECT n FROM t').first('n'), null);
});

test('d1-fake: rechaza parámetros con nombre (:a, @a, $a); D1 solo admite ? y ?NNN', () => {
  const db = conTabla();
  for (const sql of [
    'INSERT INTO t (nombre) VALUES (:nombre)',
    'INSERT INTO t (nombre) VALUES (@nombre)',
    'INSERT INTO t (nombre) VALUES ($nombre)',
  ]) {
    assert.throws(() => db.prepare(sql), /nombre/, sql);
  }
});

test('d1-fake: los dos puntos, la arroba y el dólar dentro de un texto SQL no cuentan como parámetros con nombre', async () => {
  const db = conTabla();
  const res = await db.prepare("INSERT INTO t (nombre) SELECT 'a:b @c $d' WHERE ?1 = '12:30'").bind('12:30').run();
  assert.equal(res.meta.changes, 1);
  assert.equal(await db.prepare('SELECT nombre FROM t').first('nombre'), 'a:b @c $d');
});

test('d1-fake: los números enteros se guardan como INTEGER y los booleanos como 1 y 0', async () => {
  const db = conTabla();
  await db.prepare('INSERT INTO t (nombre, n, ok) VALUES (?1, ?2, ?3)').bind('a', 5, true).run();
  await db.prepare('INSERT INTO t (nombre, n, ok) VALUES (?1, ?2, ?3)').bind('b', 5, false).run();
  const res = await db.prepare('SELECT typeof(n) AS tn, ok FROM t ORDER BY id').all();
  assert.deepEqual(res.results, [
    { tn: 'integer', ok: 1 },
    { tn: 'integer', ok: 0 },
  ]);
});

test('d1-fake: batch() es una transacción: si una sentencia falla no queda ninguna', async () => {
  const db = conTabla();
  await assert.rejects(() =>
    db.batch([
      db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind('a'),
      db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind(null), // viola NOT NULL
    ]),
  );
  assert.equal(await db.prepare('SELECT COUNT(*) AS c FROM t').first('c'), 0);
});

test('d1-fake: batch() sin errores aplica todo y devuelve un resultado por sentencia', async () => {
  const db = conTabla();
  const res = await db.batch([
    db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind('a'),
    db.prepare('INSERT INTO t (nombre) VALUES (?1)').bind('b'),
    db.prepare('SELECT COUNT(*) AS c FROM t'),
  ]);
  assert.equal(res.length, 3);
  assert.equal(res[0].meta.changes, 1);
  assert.deepEqual(res[2].results, [{ c: 2 }]);
});

test('d1-fake: un error de SQL se propaga como rechazo de la promesa', async () => {
  const db = conTabla();
  await assert.rejects(() => db.prepare('INSERT INTO t (nombre) VALUES (NULL)').run());
});

test('readMigrations: lee los .sql de la carpeta en orden por nombre y salta lo demás', () => {
  const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.wrangler');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'migraciones-'));
  try {
    writeFileSync(path.join(dir, '0002_b.sql'), 'CREATE TABLE b (x);');
    writeFileSync(path.join(dir, '0001_a.sql'), 'CREATE TABLE a (x);');
    writeFileSync(path.join(dir, 'notas.txt'), 'no es una migración');
    assert.deepEqual(readMigrations(dir), ['CREATE TABLE a (x);', 'CREATE TABLE b (x);']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createD1Fake: ejecuta las migraciones en el orden dado', async () => {
  const db = createD1Fake({ migrations: ['CREATE TABLE a (x)', 'INSERT INTO a (x) VALUES (1)'] });
  assert.equal(await db.prepare('SELECT x FROM a').first('x'), 1);
});

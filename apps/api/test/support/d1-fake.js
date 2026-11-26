// Doble de D1 para las pruebas: SQLite en memoria (node:sqlite) que ejecuta las migraciones reales.
// Imita lo que importa de D1: la forma de los resultados, bind() que devuelve otra sentencia, rechazo de undefined
// y de parámetros con nombre, first() que da null y batch() que es una transacción.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * Los .sql de una carpeta, en orden por nombre (0001_..., 0002_...), como los aplica `wrangler d1 migrations`.
 * @param {string} [dir]
 * @returns {string[]}
 */
export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((nombre) => nombre.endsWith('.sql'))
    .sort()
    .map((nombre) => readFileSync(path.join(dir, nombre), 'utf8'));
}

/** Quita los textos entre comillas simples para poder buscar parámetros con nombre sin falsos positivos. */
function sinTextos(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/** Convierte un valor de JS al que D1 le entrega a SQLite: enteros como INTEGER y booleanos como 1 y 0. */
function aSqlite(valor) {
  if (valor === undefined) throw new Error('D1_TYPE_ERROR: no se puede enlazar undefined (usa null)');
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'number' && Number.isSafeInteger(valor)) return BigInt(valor);
  return valor;
}

function plano(fila) {
  return { ...fila };
}

class Sentencia {
  #sqlite;
  #sql;
  #valores;

  constructor(sqlite, sql, valores = []) {
    if (/[:@$][A-Za-z_]/.test(sinTextos(sql))) {
      throw new Error('D1 no admite parámetros con nombre: usa ? o ?NNN');
    }
    this.#sqlite = sqlite;
    this.#sql = sql;
    this.#valores = valores;
  }

  bind(...valores) {
    return new Sentencia(this.#sqlite, this.#sql, valores.map(aSqlite));
  }

  /** Ejecuta y devuelve el resultado con la forma de D1. */
  ejecutar() {
    const stmt = this.#sqlite.prepare(this.#sql);
    if (stmt.columns().length > 0) {
      const results = stmt.all(...this.#valores).map(plano);
      return { success: true, results, meta: { changes: 0, last_row_id: 0, rows_read: results.length } };
    }
    const { changes, lastInsertRowid } = stmt.run(...this.#valores);
    return {
      success: true,
      results: [],
      meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid), rows_read: 0 },
    };
  }

  async run() {
    return this.ejecutar();
  }

  async all() {
    return this.ejecutar();
  }

  async first(columna) {
    const { results } = this.ejecutar();
    if (results.length === 0) return null;
    return columna === undefined ? results[0] : (results[0][columna] ?? null);
  }
}

/**
 * @param {{ migrations?: string[] }} [opciones] SQL de las migraciones; por defecto, las de apps/api/migrations.
 */
export function createD1Fake({ migrations = readMigrations() } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of migrations) sqlite.exec(sql);
  return {
    /** La base de SQLite por debajo, para que las pruebas inserten filas crudas o miren el esquema. */
    sqlite,
    prepare: (/** @type {string} */ sql) => new Sentencia(sqlite, sql),
    async batch(/** @type {Sentencia[]} */ sentencias) {
      sqlite.exec('BEGIN');
      try {
        const resultados = sentencias.map((s) => s.ejecutar());
        sqlite.exec('COMMIT');
        return resultados;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

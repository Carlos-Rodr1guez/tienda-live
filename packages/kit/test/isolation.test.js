import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// KIT-4: todo src/sim es ESM puro. Sin DOM, sin node:, sin azar ni reloj propios (se inyectan).
const SIM = fileURLToPath(new URL('../src/sim/', import.meta.url));
const BANNED = /Math\.random|Date\.now|\bdocument\b|\bwindow\b|from 'node:|from "node:|require\(/;
const files = fs.readdirSync(SIM).filter((f) => f.endsWith('.js'));

test('hay módulos que revisar en src/sim', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`aislamiento: ${file} no usa DOM, node:, Math.random ni Date.now`, async () => {
    const src = fs.readFileSync(path.join(SIM, file), 'utf8');
    assert.doesNotMatch(src, BANNED);
    // ningún indicador regional literal: las banderas no se producen para mostrar
    assert.doesNotMatch(src, /[\u{1F1E6}-\u{1F1FF}]/u);
    // el registry nunca toca el disco (KIT-13)
    assert.doesNotMatch(src, /\bfs\b|writeFile/);
    // el entorno donde corre el test no ofrece window, document ni require
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof globalThis.require, 'undefined');
    const mod = await import(pathToFileURL(path.join(SIM, file)).href);
    assert.ok(Object.keys(mod).length > 0);
  });
}

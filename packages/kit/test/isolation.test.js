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

// KIT-11 (marcado inerte) y KIT-27: src/client arma el DOM solo con textContent y no usa azar ni reloj propios.
// Un nombre de espectador nunca puede llegar a un sumidero de HTML.
const CLIENT = fileURLToPath(new URL('../src/client/', import.meta.url));
const HTML_SINKS = /innerHTML|outerHTML|insertAdjacentHTML|document\.write/;
const NO_CLOCK_OR_DICE = /Math\.random|Date\.now/;
const clientFiles = fs.readdirSync(CLIENT).filter((f) => f.endsWith('.js'));

test('el escáner de sumideros de HTML detecta cada uno de ellos con un nombre de por medio', () => {
  for (const sink of [
    'el.innerHTML = nombre',
    'el.outerHTML = nombre',
    'el.insertAdjacentHTML("beforeend", nombre)',
    'document.write(nombre)',
  ]) {
    assert.match(sink, HTML_SINKS, sink);
  }
  assert.doesNotMatch('el.textContent = nombre', HTML_SINKS);
});

test('src/client trae net, simulator-events y simulator', () => {
  for (const f of ['net.js', 'simulator-events.js', 'simulator.js']) assert.ok(clientFiles.includes(f), f);
});

for (const file of clientFiles) {
  test(`aislamiento: ${file} (cliente) sin innerHTML ni afines, sin Math.random ni Date.now`, () => {
    const src = fs.readFileSync(path.join(CLIENT, file), 'utf8');
    assert.doesNotMatch(src, HTML_SINKS);
    assert.doesNotMatch(src, NO_CLOCK_OR_DICE);
    assert.doesNotMatch(src, /[\u{1F1E6}-\u{1F1FF}]/u);
  });
}

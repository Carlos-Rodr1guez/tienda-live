import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, review, ACCEPTED_WARNINGS, EXCEPTIONS, OK, WARN, DENY } from './check-licenses.mjs';

test('licencias: las permisivas pasan', () => {
  for (const l of ['MIT', 'Apache-2.0', '0BSD', 'ISC', '(Apache-2.0 AND BSD-3-Clause)', '(MIT OR CC0-1.0)']) {
    assert.equal(evaluate(l), OK, l);
  }
});

test('licencias: copyleft fuerte, no comercial y sin licencia se bloquean', () => {
  for (const l of [
    'GPL-3.0-only',
    'AGPL-3.0-only',
    'SSPL-1.0',
    'BUSL-1.1',
    'CC-BY-NC-4.0',
    'GPL-2.0 WITH Classpath-exception-2.0',
    '',
    'UNLICENSED',
    'SEE LICENSE IN LICENSE.md',
  ]) {
    assert.equal(evaluate(l), DENY, l || '(vacía)');
  }
});

test('licencias: el copyleft débil solo avisa', () => {
  for (const l of ['LGPL-3.0-or-later', 'MPL-2.0', 'EPL-2.0']) assert.equal(evaluate(l), WARN, l);
});

test('licencias: con OR alcanza una opción permitida, con AND cuentan todas', () => {
  assert.equal(evaluate('(MIT OR GPL-3.0-only)'), OK);
  assert.equal(evaluate('(MIT OR LGPL-2.1)'), OK);
  assert.equal(evaluate('GPL-2.0 AND (MIT OR BSD-3-Clause)'), DENY);
  assert.equal(evaluate('(GPL-2.0 OR LGPL-2.1) AND MIT'), WARN);
});

// --- review: excepciones (DENY temporales) y avisos aceptados (WARN con motivo) ---

const MOTIVO = 'se usa sin modificar al construir y no viaja en el sitio.';
const aceptados = (...entradas) => entradas;
const paquete = (name, version, license) => ({ id: `${name}@${version}`, name, license });

test('review: lightningcss y sus binarios por plataforma quedan aceptados con su motivo', () => {
  const r = review(
    [paquete('lightningcss', '1.30.1', 'MPL-2.0'), paquete('lightningcss-win32-x64-msvc', '1.30.1', 'MPL-2.0')],
    { exceptions: {}, accepted: aceptados({ pattern: /^lightningcss(-.+)?$/, reason: MOTIVO }) },
  );
  assert.deepEqual(r.accepted, [
    `lightningcss-win32-x64-msvc@1.30.1 (MPL-2.0): ${MOTIVO}`,
    `lightningcss@1.30.1 (MPL-2.0): ${MOTIVO}`,
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.errors, []);
});

test('review: sharp en Windows (Apache-2.0 AND LGPL-3.0-or-later) queda aceptado', () => {
  const r = review([paquete('@img/sharp-win32-x64', '0.35.5', 'Apache-2.0 AND LGPL-3.0-or-later')], {
    exceptions: {},
    accepted: aceptados({ pattern: /^@img\/sharp-/, reason: MOTIVO }),
  });
  assert.deepEqual(r.accepted, [`@img/sharp-win32-x64@0.35.5 (Apache-2.0 AND LGPL-3.0-or-later): ${MOTIVO}`]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.errors, []);
});

test('review: libvips de Linux (LGPL-3.0-or-later) queda aceptado y sharp con Apache-2.0 ni se menciona', () => {
  const r = review(
    [
      paquete('@img/sharp-libvips-linux-x64', '1.3.4', 'LGPL-3.0-or-later'),
      paquete('@img/sharp-linux-x64', '0.35.5', 'Apache-2.0'),
    ],
    { exceptions: {}, accepted: aceptados({ pattern: /^@img\/sharp-/, reason: MOTIVO }) },
  );
  assert.deepEqual(r.accepted, [`@img/sharp-libvips-linux-x64@1.3.4 (LGPL-3.0-or-later): ${MOTIVO}`]);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.count['Apache-2.0'], 1);
  assert.equal(r.count['LGPL-3.0-or-later'], 1);
});

test('review: un MPL-2.0 que nadie aceptó sigue avisando', () => {
  const r = review([paquete('otro-paquete', '2.0.0', 'MPL-2.0')], {
    exceptions: {},
    accepted: aceptados({ pattern: /^lightningcss(-.+)?$/, reason: MOTIVO }),
  });
  assert.deepEqual(r.accepted, []);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /^otro-paquete@2\.0\.0 \(MPL-2\.0\): copyleft débil/);
  assert.match(r.warnings[1], /ya no hace falta/);
  assert.deepEqual(r.errors, []);
});

test('review: una entrada aceptada que no coincide con ningún paquete avisa que sobra, sin fallar', () => {
  const r = review([paquete('mit-paquete', '1.0.0', 'MIT')], {
    exceptions: {},
    accepted: aceptados({ pattern: /^@img\/sharp-/, reason: MOTIVO }),
  });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /@img/);
  assert.match(r.warnings[0], /ya no hace falta/);
  assert.deepEqual(r.errors, []);
});

test('review: lo aceptado vale solo para avisos: si el paquete es DENY igual falla', () => {
  const r = review([paquete('@img/sharp-malo', '1.0.0', 'GPL-3.0-only')], {
    exceptions: {},
    accepted: aceptados({ pattern: /^@img\/sharp-/, reason: MOTIVO }),
  });
  assert.deepEqual(r.accepted, []);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^@img\/sharp-malo@1\.0\.0 \(GPL-3\.0-only\): licencia prohibida/);
});

test('review: una entrada aceptada sin motivo es un error', () => {
  const r = review([paquete('lightningcss', '1.30.1', 'MPL-2.0')], {
    exceptions: {},
    accepted: aceptados({ pattern: /^lightningcss(-.+)?$/, reason: '   ' }),
  });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /sin motivo/);
  assert.deepEqual(r.accepted, []);
});

test('review: las excepciones temporales de DENY siguen funcionando igual', () => {
  const r = review([paquete('tiktok-live-connector', '2.5.0', 'GPL-3.0-only'), paquete('desconocido', '1.0.0', '')], {
    exceptions: { 'tiktok-live-connector': 'Se reemplaza en el H2.' },
    accepted: [],
  });
  assert.deepEqual(r.warnings, [
    'tiktok-live-connector@2.5.0 (GPL-3.0-only): excepción temporal. Se reemplaza en el H2.',
  ]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^desconocido@1\.0\.0 \(sin licencia\): no declara una licencia/);
});

test('review: una excepción temporal que ya no se usa avisa que hay que borrarla', () => {
  const r = review([paquete('mit-paquete', '1.0.0', 'MIT')], {
    exceptions: { 'tiktok-live-connector': 'Se reemplaza en el H2.' },
    accepted: [],
  });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /tiktok-live-connector/);
});

test('ACCEPTED_WARNINGS real: tiene lightningcss y sharp, todos con motivo, y lightningcss-win32-x64-msvc coincide', () => {
  assert.ok(ACCEPTED_WARNINGS.length >= 2);
  for (const { reason } of ACCEPTED_WARNINGS) assert.ok(reason.trim().length > 0);
  const r = review(
    [
      paquete('lightningcss-win32-x64-msvc', '1.30.1', 'MPL-2.0'),
      paquete('@img/sharp-win32-x64', '0.35.5', 'Apache-2.0 AND LGPL-3.0-or-later'),
      paquete('@img/sharp-libvips-linux-x64', '1.3.4', 'LGPL-3.0-or-later'),
    ],
    { exceptions: EXCEPTIONS, accepted: ACCEPTED_WARNINGS },
  );
  assert.equal(r.accepted.length, 3);
  assert.deepEqual(r.errors, []);
  // las excepciones de tiktok no se usaron en este caso, así que avisan; lo aceptado no genera avisos
  assert.ok(r.warnings.every((w) => /tiktok-live/.test(w)));
});

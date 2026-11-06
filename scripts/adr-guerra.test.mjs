import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// DOC-1: las seis ADR de Batalla de países (0010-0015) y sus filas de 4 columnas en el índice.
const CARPETA = fileURLToPath(new URL('../docs/adr/', import.meta.url));
const leer = (nombre) => readFileSync(CARPETA + nombre, 'utf8').replace(/\r\n/g, '\n');

const ADR = {
  '0010': { archivo: '0010-kit-compartido-v0.md', estado: 'Propuesta' },
  '0011': { archivo: '0011-paises-simbolos-y-contenido.md', estado: 'Aceptada' },
  '0012': { archivo: '0012-nombres-de-espectadores.md', estado: 'Propuesta' },
  '0013': { archivo: '0013-modo-narrador.md', estado: 'Aceptada' },
  '0014': { archivo: '0014-orden-publico-batalla-antes-que-carrera.md', estado: 'Aceptada' },
  '0015': { archivo: '0015-vista-batalla-canvas-2d.md', estado: 'Propuesta' },
};

const estadoDe = (texto) => /^- \*\*Estado:\*\* (.+)$/m.exec(texto)?.[1].trim();
const texto = (numero) => leer(ADR[numero].archivo);

test('DOC-1: existen los seis archivos y cada uno trae estado, fecha, "se decide en" y las cuatro secciones', () => {
  for (const [numero, { archivo, estado }] of Object.entries(ADR)) {
    assert.ok(existsSync(CARPETA + archivo), `falta ${archivo}`);
    const t = texto(numero);
    assert.match(t, new RegExp(`^# ADR-${numero.slice(1)}: `, 'm'), `${archivo}: título`);
    assert.equal(estadoDe(t), estado, `${archivo}: estado`);
    assert.match(t, /^- \*\*Fecha:\*\* 2026-11-06$/m, `${archivo}: fecha`);
    assert.match(t, /^- \*\*Se decide en:\*\* .+$/m, `${archivo}: se decide en`);
    for (const seccion of ['Contexto', 'Opciones', 'Consecuencias']) {
      assert.match(t, new RegExp(`^## ${seccion}$`, 'm'), `${archivo}: falta ${seccion}`);
    }
    const decision = estado === 'Aceptada' ? 'Decisión' : 'Decisión propuesta';
    assert.match(t, new RegExp(`^## ${decision}$`, 'm'), `${archivo}: la sección tiene que llamarse "${decision}"`);
  }
});

test('DOC-1: el índice tiene seis filas nuevas de 4 columnas, con el mismo estado que cada archivo', () => {
  const indice = leer('README.md');
  for (const [numero, { archivo, estado }] of Object.entries(ADR)) {
    const fila = indice.split('\n').find((l) => l.includes(`](${archivo})`));
    assert.ok(fila, `falta la fila de ${archivo}`);
    const celdas = fila
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    assert.equal(celdas.length, 4, `${archivo}: cuatro columnas`);
    assert.equal(celdas[0], `[${numero.slice(1)}](${archivo})`);
    assert.equal(celdas[2], estado, `${archivo}: estado en el índice`);
    assert.ok(celdas[1] && celdas[3], `${archivo}: decisión y "se decide en" no vacíos`);
  }
});

test('DOC-1: ADR-008 sigue Aceptada y su texto conserva H4, Acuario y Carrera', () => {
  const t = leer('0008-categorias-del-catalogo.md');
  assert.equal(estadoDe(t), 'Aceptada');
  assert.match(t, /H4/);
  assert.match(t, /Acuario/);
  assert.match(t, /Carrera/);
});

test('ADR 0014: nombra ADR-008, dice que Batalla va antes de Carrera y que lo decidió el dueño (Q2, #292)', () => {
  const t = texto('0014');
  assert.match(t, /ADR-008/);
  assert.match(t, /Batalla de países/);
  assert.match(t, /antes (de|que) Carrera/);
  assert.match(t, /decisión del dueño/);
  assert.match(t, /Q2/);
  assert.match(t, /#292/);
});

test('ADR 0011: no hay lista de pares bloqueados, registra las decisiones del dueño y que no hay banderas', () => {
  const t = texto('0011');
  assert.match(t, /no (existe|hay) (ninguna )?lista de pares bloqueados/i);
  assert.match(t, /decisiones del dueño/);
  assert.match(t, /sin banderas|no hay banderas/i);
  assert.match(t, /art\. 32 Bis/);
  assert.match(t, /Ley 32251/);
});

test('ADR 0012: nada se escribe a disco y la única copia fuera de la página es la RAM del servidor (KIT-28)', () => {
  const t = texto('0012');
  assert.match(t, /nada se escribe (en|a) disco/i);
  assert.match(t, /única copia fuera de la página/);
  assert.match(t, /RAM del servidor/);
  assert.match(t, /KIT-28/);
});

test('ADR 0013: cámara 2D, cámara automática de 7 s, movimiento reducido y sin control táctico del narrador ni del chat', () => {
  const t = texto('0013');
  assert.match(t, /cámara 2D/);
  assert.match(t, /7 s/);
  assert.match(t, /movimiento reducido/);
  assert.match(t, /ni el narrador ni el chat/);
});

test('ADR 0015: lista las tres opciones, decide Canvas 2D y dice que Batalla no depende de three', () => {
  const t = texto('0015');
  assert.match(t, /Three\.js con cámara inclinada/);
  assert.match(t, /Canvas 2D con sprites horneados/);
  assert.match(t, /biblioteca WebGL 2D/);
  assert.match(t, /Canvas 2D con sprites dibujados en código/);
  assert.match(t, /no depende de `three`/);
});

test('ADR 0010: kit v0, exports map con .js, /kit/ montado, regla de dos, ASEDIO migra en H2 y ADR-001 intacta', () => {
  const t = texto('0010');
  assert.match(t, /packages\/kit/);
  assert.match(t, /exports map/);
  assert.match(t, /\/kit\//);
  assert.match(t, /regla de dos/);
  assert.match(t, /H2/);
  assert.match(t, /ADR-001/);
});

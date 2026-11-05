import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormView } from '../../src/lib/form/controller.js';
import { SUMMARY_FOCUS_ID, initialState, reduce, validateForm } from '../../src/lib/form/model.js';

// Un DOM de mentira con lo justo que usa la vista: elementos con atributos, hijos, foco y clics. Los selectores que
// entiende son los que usa el código ("input, select, textarea, button" y "[tabindex]"), nada más.

const CONTROLES = ['input', 'select', 'textarea', 'button'];

function crearDoc() {
  const porId = new Map();
  const doc = {
    activo: null,
    getElementById: (id) => porId.get(id) ?? null,
    createElement: (etiqueta) => elemento(etiqueta),
  };
  function elemento(localName, id, atributos = {}) {
    const el = {
      localName,
      id,
      hidden: false,
      textContent: '',
      children: [],
      attrs: new Map(Object.entries(atributos)),
      oyentes: {},
      focos: 0,
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
      },
      removeAttribute(k) {
        this.attrs.delete(k);
      },
      getAttribute(k) {
        return this.attrs.get(k) ?? null;
      },
      // Sin toggleAttribute a propósito: en un DOM real escribe "" (inválido para aria-*) y ese eco escondió un bug.
      // Si el código vuelve a usarlo para un aria-*, estas pruebas fallan con TypeError.
      matches(selector) {
        if (selector === 'input, select, textarea, button, [tabindex]')
          return CONTROLES.includes(localName) || this.attrs.has('tabindex');
        throw new Error(`selector no soportado: ${selector}`);
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] ?? null;
      },
      querySelectorAll(selector) {
        if (selector !== 'input, select, textarea, button' && selector !== 'input')
          throw new Error(`selector no soportado: ${selector}`);
        const permitidos = selector === 'input' ? ['input'] : CONTROLES;
        return this.children.filter((c) => permitidos.includes(c.localName));
      },
      append(...nodos) {
        this.children.push(...nodos);
      },
      replaceChildren(...nodos) {
        this.children = nodos;
      },
      addEventListener(tipo, f) {
        (this.oyentes[tipo] ??= []).push(f);
      },
      focus() {
        this.focos += 1;
        doc.activo = this;
      },
      clic() {
        const evento = {
          prevenido: false,
          preventDefault() {
            this.prevenido = true;
          },
        };
        for (const f of this.oyentes.click ?? []) f(evento);
        return evento;
      },
    };
    if (id) porId.set(id, el);
    return el;
  }
  return { doc, elemento };
}

/** La estructura de la portada que toca la vista: botón, resumen, éxito, ranura y los campos con sus errores. */
function armarPagina() {
  const { doc, elemento } = crearDoc();
  const form = elemento('form', 'anotarme-form');
  for (const id of ['anotarme-enviar', 'anotarme-exito', 'anotarme-exito-mensaje', 'anotarme-turnstile'])
    elemento('div', id);
  elemento('button', 'anotarme-enviar');
  elemento('div', 'anotarme-resumen', { tabindex: '-1' });
  elemento('p', 'anotarme-resumen-texto');
  elemento('ul', 'anotarme-lista-errores');
  elemento('div', 'anotarme-verificacion-error');
  elemento('button', 'anotarme-reintentar');
  for (const campo of ['email', 'tiktok-user', 'followers-range', 'country']) {
    elemento(campo === 'followers-range' || campo === 'country' ? 'select' : 'input', `campo-${campo}`);
  }
  elemento('input', 'campo-consent');
  for (const campo of [
    'email',
    'tiktok-user',
    'live-frequency',
    'stream-type',
    'interests',
    'followers-range',
    'country',
    'consent',
  ]) {
    elemento('p', `error-${campo}`).hidden = true;
  }
  // Los grupos: un <fieldset> con sus radios o casillas adentro
  const grupos = {};
  for (const [id, nombre, cuantos] of [
    ['campo-live-frequency', 'live_frequency', 3],
    ['campo-stream-type', 'stream_type', 2],
    ['campo-interests', 'interests', 4],
  ]) {
    const grupo = elemento('fieldset', id, { 'aria-describedby': `error-${id.replace('campo-', '')}` });
    for (let i = 0; i < cuantos; i += 1)
      grupo.append(elemento('input', undefined, { name: nombre, type: nombre === 'interests' ? 'checkbox' : 'radio' }));
    grupos[nombre] = grupo;
  }
  const vista = createFormView(doc, form);
  return { doc, form, vista, grupos, el: (id) => doc.getElementById(id) };
}

const crudoValido = () => ({
  email: 'a@b.co',
  tiktok_user: '',
  live_frequency: 'semanal',
  stream_type: 'gaming',
  interests: ['accion'],
  followers_range: '',
  country: '',
  consent: true,
});
const crudoVacio = () => ({
  ...crudoValido(),
  email: '',
  live_frequency: '',
  stream_type: '',
  interests: [],
  consent: false,
});

const estadoConErrores = (crudos) =>
  reduce(initialState(), { type: 'invalido', errores: validateForm(crudos, { turnstileToken: 't' }).errores });

// ---- aria-busy: "true" mientras envía, ausente después (toggleAttribute escribiría "", que se lee como false) ----

test('aria-busy: el formulario lleva aria-busy="true" mientras envía y el atributo desaparece después', () => {
  const p = armarPagina();
  assert.equal(p.form.getAttribute('aria-busy'), null);
  p.vista.renderState({ fase: 'enviando', errores: [], mensaje: null });
  assert.equal(p.form.getAttribute('aria-busy'), 'true');
  p.vista.renderState(initialState());
  assert.equal(p.form.getAttribute('aria-busy'), null);
  p.vista.renderState({ fase: 'enviando', errores: [], mensaje: null });
  p.vista.renderState({ fase: 'error', errores: [], mensaje: 'x' });
  assert.equal(p.form.getAttribute('aria-busy'), null);
});

// ---- (a) aria-invalid: en los controles, nunca en el <fieldset> ----

test('aria-invalid: un grupo de radios o casillas lo lleva en cada control, no en el <fieldset> (rol no admitido)', () => {
  const p = armarPagina();
  p.vista.renderState(estadoConErrores(crudoVacio()));

  for (const nombre of ['live_frequency', 'stream_type', 'interests']) {
    const grupo = p.grupos[nombre];
    assert.equal(grupo.getAttribute('aria-invalid'), null, `${nombre}: el fieldset no lleva aria-invalid`);
    assert.ok(grupo.children.length >= 2, nombre);
    for (const control of grupo.children) assert.equal(control.getAttribute('aria-invalid'), 'true', nombre);
  }
  // el fieldset conserva aria-describedby hacia su texto de error
  assert.equal(p.grupos.live_frequency.getAttribute('aria-describedby'), 'error-live-frequency');
  assert.equal(p.grupos.interests.getAttribute('aria-describedby'), 'error-interests');
  // los campos sueltos siguen igual: aria-invalid en el propio control
  assert.equal(p.el('campo-email').getAttribute('aria-invalid'), 'true');
  assert.equal(p.el('campo-email').getAttribute('aria-describedby'), 'error-email');
});

test('aria-invalid: solo los grupos con error se marcan, y se quita de todos sus controles cuando el grupo vuelve a ser válido', () => {
  const p = armarPagina();
  p.vista.renderState(estadoConErrores({ ...crudoValido(), stream_type: '' }));
  assert.ok(p.grupos.stream_type.children.every((c) => c.getAttribute('aria-invalid') === 'true'));
  assert.ok(p.grupos.live_frequency.children.every((c) => c.getAttribute('aria-invalid') === null));
  assert.ok(p.grupos.interests.children.every((c) => c.getAttribute('aria-invalid') === null));
  assert.equal(p.el('campo-email').getAttribute('aria-invalid'), null);

  // al corregirlo y volver a pintar sin errores, no queda nada marcado
  p.vista.renderState(initialState());
  for (const grupo of Object.values(p.grupos)) {
    assert.equal(grupo.getAttribute('aria-invalid'), null);
    assert.equal(grupo.getAttribute('aria-describedby'), null, 'y se quita aria-describedby del grupo sin error');
    assert.ok(grupo.children.every((c) => c.getAttribute('aria-invalid') === null));
  }
  assert.equal(p.el('error-stream-type').hidden, true);
});

test('aria-invalid: un error de la API sobre un grupo también marca sus controles', () => {
  const p = armarPagina();
  p.vista.renderState({
    fase: 'error',
    mensaje: 'x',
    errores: [
      {
        campo: 'interests',
        mensaje: 'Elige entre 1 y 4 categorías.',
        idCampo: 'campo-interests',
        idError: 'error-interests',
      },
    ],
  });
  assert.ok(p.grupos.interests.children.every((c) => c.getAttribute('aria-invalid') === 'true'));
  assert.equal(p.grupos.interests.getAttribute('aria-invalid'), null);
  assert.equal(p.el('error-interests').textContent, 'Elige entre 1 y 4 categorías.');
  assert.equal(p.el('error-interests').hidden, false);
});

// ---- (b) los enlaces del resumen mueven el foco ----

test('resumen: cada error es un enlace al campo; pulsarlo lleva el foco al primer control del grupo (no solo desplaza la página)', () => {
  const p = armarPagina();
  p.vista.renderState(estadoConErrores(crudoVacio()));
  const enlaces = p.el('anotarme-lista-errores').children.map((li) => li.children[0]);
  assert.deepEqual(
    enlaces.map((a) => a.href),
    ['#campo-email', '#campo-live-frequency', '#campo-stream-type', '#campo-interests', '#campo-consent'],
  );

  const aGrupo = enlaces[1].clic();
  assert.equal(aGrupo.prevenido, true, 'se evita el salto de ancla a un <fieldset> que no recibe foco');
  assert.equal(p.doc.activo, p.grupos.live_frequency.children[0]);

  enlaces[3].clic();
  assert.equal(p.doc.activo, p.grupos.interests.children[0], 'casillas: la primera');

  enlaces[0].clic();
  assert.equal(p.doc.activo, p.el('campo-email'), 'un campo suelto recibe el foco él mismo');
  enlaces[4].clic();
  assert.equal(p.doc.activo, p.el('campo-consent'));
});

test('resumen: con un solo error y luego ninguno, la lista se vacía', () => {
  const p = armarPagina();
  p.vista.renderState(estadoConErrores({ ...crudoValido(), email: 'x' }));
  assert.equal(p.el('anotarme-lista-errores').children.length, 1);
  p.vista.renderState(initialState());
  assert.equal(p.el('anotarme-lista-errores').children.length, 0);
  assert.equal(p.el('anotarme-resumen').hidden, true);
});

// ---- (c) el foco tras un error del servidor va al resumen ----

test('foco: el resumen de errores se puede enfocar (tabindex -1) y focusId lo enfoca a él mismo', () => {
  const p = armarPagina();
  p.vista.renderState({ fase: 'error', errores: [], mensaje: 'No pudimos conectar.' });
  assert.equal(p.el('anotarme-resumen').hidden, false);
  p.vista.focusId(SUMMARY_FOCUS_ID);
  assert.equal(p.doc.activo, p.el('anotarme-resumen'));
});

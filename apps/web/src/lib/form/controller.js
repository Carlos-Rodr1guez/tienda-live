// @ts-check
// Controlador del formulario de la lista de espera. La lógica vive en model.js (pura y probada); acá se decide CUÁNDO:
//  - al abrir el formulario: cuenta "form_open" (una vez por vista de página) y pinta Turnstile una sola vez;
//  - al enviar: valida con el mismo validador de la API, exige el token de Turnstile, bloquea el botón mientras envía,
//    pinta los errores junto a cada campo y mueve el foco al primer error o al título de éxito;
//  - tras cada envío el token se gastó: se reinicia el widget para poder reintentar.
// Las funciones de DOM (`initFormPage`) son un pegamento mínimo; todo lo demás se prueba con una vista de mentira.

import {
  buildRequest,
  describedBy,
  focusTarget,
  initialState,
  isSubmitDisabled,
  reduce,
  submitLabel,
  validateForm,
  fieldId,
  fieldLabel,
  errorId,
} from './model.js';
import { createAnalytics, isTrackedPath } from '../analytics.js';
import { createTurnstile } from '../turnstile.js';

/**
 * Lo que el controlador necesita de la página. `initFormPage` arma una con el DOM real; las pruebas, una de mentira.
 * @typedef {object} VistaFormulario
 * @property {unknown} slot  contenedor donde se pinta Turnstile
 * @property {() => import('./model.js').CamposCrudos} readFields
 * @property {(estado: import('./model.js').EstadoFormulario) => void} renderState
 * @property {(id: string) => void} focusId
 * @property {(hayError: boolean) => void} showVerificationError
 */

/**
 * @param {{
 *   ui: VistaFormulario,
 *   analytics: { track: (nombre: string) => unknown },
 *   turnstile: { render: (slot: unknown, m: import('../turnstile.js').ManejadoresWidget) => Promise<string>, reset: (id: string | null | undefined) => void },
 *   fetchFn: (url: string, init: RequestInit) => Promise<{ status: number, json: () => Promise<unknown> }>,
 * }} entrada
 */
export function createFormController({ ui, analytics, turnstile, fetchFn }) {
  let estado = initialState();
  /** @type {string | null} */
  let token = null;
  /** @type {string | null} */
  let widgetId = null;
  /** @type {Promise<void> | null} */
  let verificacion = null;

  /** @param {import('./model.js').EstadoFormulario} nuevo */
  function pintar(nuevo) {
    estado = nuevo;
    ui.renderState(estado);
  }

  function pintarVerificacion() {
    // Una sola vez: abrir y cerrar el formulario no apila widgets
    verificacion ??= turnstile
      .render(ui.slot, {
        onToken: (valor) => {
          token = valor;
        },
        onExpire: () => {
          token = null;
        },
        onError: () => {
          token = null;
          ui.showVerificationError(true);
        },
      })
      .then((id) => {
        widgetId = id;
        ui.showVerificationError(false);
      })
      .catch(() => {
        // Se olvida el intento fallido para que "Intentar de nuevo" lo repita
        verificacion = null;
        ui.showVerificationError(true);
      });
    return verificacion;
  }

  async function enviar() {
    if (estado.fase === 'enviando' || estado.fase === 'exito') return;

    const validacion = validateForm(ui.readFields(), { turnstileToken: token ?? '' });
    if (!validacion.ok) {
      pintar(reduce(estado, { type: 'invalido', errores: validacion.errores }));
      const destino = focusTarget(estado);
      if (destino) ui.focusId(destino);
      return;
    }
    if (!token) {
      pintar(reduce(estado, { type: 'sinVerificacion' }));
      return;
    }

    pintar(reduce(estado, { type: 'enviar' }));
    const { url, init } = buildRequest(validacion.body);
    try {
      const respuesta = await fetchFn(url, init);
      /** @type {unknown} */
      let cuerpo;
      try {
        cuerpo = await respuesta.json();
      } catch {
        cuerpo = undefined;
      }
      pintar(reduce(estado, { type: 'respuesta', status: respuesta.status, body: cuerpo }));
    } catch {
      pintar(reduce(estado, { type: 'falloRed' }));
    }
    // El token es de un solo uso, salga bien o mal el envío
    token = null;
    turnstile.reset(widgetId);
    const destino = focusTarget(estado);
    if (destino) ui.focusId(destino);
  }

  return {
    /** Pinta el estado inicial (el botón nace deshabilitado en el HTML: acá se habilita). */
    mount() {
      pintar(initialState());
    },

    /** @param {boolean} abierto */
    async onToggle(abierto) {
      if (!abierto) return;
      analytics.track('form_open');
      await pintarVerificacion();
    },

    onSubmit: enviar,

    /** "Intentar de nuevo" tras un fallo al cargar la verificación. */
    retryVerification: () => pintarVerificacion(),

    getState: () => estado,
  };
}

/**
 * Pegamento con el DOM real de la portada. Devuelve null si la página no trae el formulario.
 * @param {Document} [doc]
 * @param {Window} [win]
 */
export function initFormPage(doc = document, win = window) {
  const detalles = /** @type {HTMLDetailsElement | null} */ (doc.getElementById('anotarme'));
  const form = /** @type {HTMLFormElement | null} */ (doc.getElementById('anotarme-form'));
  if (!detalles || !form) return null;

  /** @param {string} id */
  const porId = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`falta el elemento #${id} en el formulario`);
    return el;
  };
  const boton = /** @type {HTMLButtonElement} */ (porId('anotarme-enviar'));
  const resumen = porId('anotarme-resumen');
  const exito = porId('anotarme-exito');
  const mensajeExito = porId('anotarme-exito-mensaje');
  const slot = porId('anotarme-turnstile');
  const errorVerificacion = porId('anotarme-verificacion-error');
  const reintentar = porId('anotarme-reintentar');
  const listaErrores = porId('anotarme-lista-errores');

  /** @param {string} nombre */
  const valor = (nombre) => /** @type {HTMLInputElement | HTMLSelectElement} */ (form.elements.namedItem(nombre)).value;
  const camposConError = [
    'email',
    'tiktok_user',
    'live_frequency',
    'stream_type',
    'interests',
    'followers_range',
    'country',
    'consent',
  ];

  /** @type {VistaFormulario} */
  const ui = {
    slot,
    readFields: () => ({
      email: valor('email'),
      tiktok_user: valor('tiktok_user'),
      live_frequency: form.querySelector('input[name="live_frequency"]:checked') ? valor('live_frequency') : '',
      stream_type: form.querySelector('input[name="stream_type"]:checked') ? valor('stream_type') : '',
      interests: [...form.querySelectorAll('input[name="interests"]:checked')].map(
        (el) => /** @type {HTMLInputElement} */ (el).value,
      ),
      followers_range: valor('followers_range'),
      country: valor('country'),
      consent: /** @type {HTMLInputElement} */ (form.elements.namedItem('consent')).checked,
    }),
    renderState(estado) {
      boton.disabled = isSubmitDisabled(estado);
      boton.textContent = submitLabel(estado);
      form.toggleAttribute('aria-busy', estado.fase === 'enviando');

      // Errores junto a cada campo: aria-invalid en el control y aria-describedby hacia su texto
      for (const campo of camposConError) {
        const control = doc.getElementById(fieldId(campo));
        const texto = doc.getElementById(errorId(campo));
        const error = estado.errores.find((e) => e.campo === campo);
        if (control) {
          if (error) control.setAttribute('aria-invalid', 'true');
          else control.removeAttribute('aria-invalid');
          const ref = describedBy(estado, campo);
          if (ref) control.setAttribute('aria-describedby', ref);
          else control.removeAttribute('aria-describedby');
        }
        if (texto) {
          texto.textContent = error ? error.mensaje : '';
          texto.hidden = !error;
        }
      }

      // Resumen con role="alert": el mensaje general y la lista de campos a revisar
      const hayMensaje = estado.fase === 'editando' || estado.fase === 'error' ? estado.mensaje : null;
      resumen.hidden = !hayMensaje;
      porId('anotarme-resumen-texto').textContent = hayMensaje ?? '';
      listaErrores.replaceChildren(
        ...estado.errores.map((e) => {
          const li = doc.createElement('li');
          const enlace = doc.createElement('a');
          enlace.href = `#${e.idCampo}`;
          enlace.textContent = `${fieldLabel(e.campo)}: ${e.mensaje}`;
          li.append(enlace);
          return li;
        }),
      );

      // Éxito: el formulario se reemplaza por el mensaje de la API
      exito.hidden = estado.fase !== 'exito';
      form.hidden = estado.fase === 'exito';
      mensajeExito.textContent = estado.fase === 'exito' ? estado.mensaje : '';
    },
    focusId(id) {
      const el = doc.getElementById(id);
      if (!el) return;
      // un grupo (fieldset) no recibe foco: se manda al primer control de adentro
      const destino = el.matches('input, select, textarea, button, [tabindex]')
        ? el
        : el.querySelector('input, select, textarea, button');
      /** @type {HTMLElement} */ (destino ?? el).focus();
    },
    showVerificationError(hay) {
      errorVerificacion.hidden = !hay;
    },
  };

  const analytics = createAnalytics({
    enabled: doc.documentElement.dataset.analytics === 'on' && isTrackedPath(win.location.pathname),
  });
  const turnstile = createTurnstile({
    doc,
    win,
    siteKey: form.dataset.sitekey,
  });
  const controlador = createFormController({
    ui,
    analytics,
    turnstile,
    fetchFn: (url, init) => win.fetch(url, init),
  });

  controlador.mount();
  detalles.addEventListener('toggle', () => void controlador.onToggle(detalles.open));
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    void controlador.onSubmit();
  });
  reintentar.addEventListener('click', () => void controlador.retryVerification());

  // El botón de la portada y cualquier enlace a #anotarme abren el formulario y llevan el foco al correo
  const abrir = () => {
    detalles.open = true;
    detalles.scrollIntoView({ block: 'start' });
    doc.getElementById(fieldId('email'))?.focus({ preventScroll: true });
  };
  for (const enlace of doc.querySelectorAll('a[href="#anotarme"]')) {
    enlace.addEventListener('click', (evento) => {
      evento.preventDefault();
      abrir();
    });
  }
  if (win.location.hash === '#anotarme') abrir();

  return controlador;
}

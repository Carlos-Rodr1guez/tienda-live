// @ts-check
// Contadores del embudo: manda "form_open" y "video_play" a POST /v1/events. No lleva cookies ni identificadores.
// Si falla, falla en silencio: medir nunca puede romper ni frenar la página.

import { validateEvent } from '@tienda/contracts/events';

/** Ruta de la API de eventos (mismo origen). */
export const EVENTS_URL = '/v1/events';

/**
 * /confirmar no mide nada: su URL lleva un enlace personal.
 * @param {string} pathname
 * @returns {boolean}
 */
export function isTrackedPath(pathname) {
  return pathname !== '/confirmar' && pathname !== '/confirmar.html';
}

/**
 * @param {{ fetch?: typeof fetch, enabled?: boolean }} [opciones]  `fetch` se inyecta en las pruebas
 */
export function createAnalytics({ fetch: fetchFn = globalThis.fetch, enabled = true } = {}) {
  /** Eventos ya mandados en esta vista de página. */
  const enviados = new Set();

  return {
    /**
     * Manda un evento, una sola vez por vista de página.
     * @param {unknown} nombre
     * @returns {Promise<boolean>}  true si se intentó enviar; false si se descartó
     */
    async track(nombre) {
      if (!enabled || typeof fetchFn !== 'function') return false;
      const evento = validateEvent({ name: nombre });
      if (!evento.ok || enviados.has(evento.value.name)) return false;
      enviados.add(evento.value.name);
      try {
        await fetchFn(EVENTS_URL, {
          method: 'POST',
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: evento.value.name }),
        });
      } catch {
        // silencioso a propósito
      }
      return true;
    },
  };
}

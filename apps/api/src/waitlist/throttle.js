// @ts-check
// Límite de reenvíos por correo (WL-5), exacto sobre las últimas 24 horas. Es una función pura: recibe los instantes
// de los envíos anteriores (ISO-8601, como se guardan en `recent_sends`) y decide si toca enviar.

export const COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_SENDS = 5;
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * @param {readonly string[]} recentSends Instantes (ISO) de los envíos anteriores, en cualquier orden.
 * @param {number} now Milisegundos desde la época.
 * @returns {{ send: boolean, recentSends: string[] }}
 *   Si `send` es false, la lista vuelve igual que entró. Si es true, vuelve sin los vencidos, con `now` al final y
 *   con un máximo de MAX_SENDS (los más recientes).
 */
export function planSend(recentSends, now) {
  // Un envío cuenta mientras tenga menos de 24 h; a las 24 h justas ya salió de la ventana.
  const vigentes = recentSends
    .map((instante) => ({ instante, ms: Date.parse(instante) }))
    .filter(({ ms }) => now - ms < WINDOW_MS)
    .sort((a, b) => a.ms - b.ms);

  const ultimo = vigentes.at(-1);
  const enfriando = ultimo !== undefined && now - ultimo.ms < COOLDOWN_MS;
  if (enfriando || vigentes.length >= MAX_SENDS) return { send: false, recentSends: [...recentSends] };

  const instantes = [...vigentes.map(({ instante }) => instante), new Date(now).toISOString()];
  return { send: true, recentSends: instantes.slice(-MAX_SENDS) };
}

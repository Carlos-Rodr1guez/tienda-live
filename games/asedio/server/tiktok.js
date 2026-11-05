// Conexión con el TikTok LIVE del streamer. Reintenta sola mientras el directo no esté activo.

import { createNormalizer } from './normalize.js';

export function cleanUsername(u) {
  const s = String(u || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '')
    .replace(/\/live\/?$/i, '')
    .replace(/^@/, '')
    .trim();
  if (!s || s === 'tu_usuario_de_tiktok') return '';
  return s;
}

export function createTikTokBridge(config, { onEvent, onStatus, log = console }) {
  const username = cleanUsername(config.tiktokUsername);
  let status = { state: username ? 'conectando' : 'sin-usuario', username };
  const setStatus = (s) => {
    status = { username, ...s };
    onStatus?.(status);
  };

  if (!username) {
    setStatus({ state: 'sin-usuario', message: 'Pon tu usuario de TikTok en config.json para conectar el LIVE.' });
    return {
      get status() {
        return status;
      },
      stop() {},
    };
  }

  let conn = null;
  let timer = null;
  let stopped = false;
  let retryMs = 10000;
  const norm = createNormalizer();

  const schedule = (why) => {
    if (stopped) return;
    clearTimeout(timer);
    log.info?.(`[tiktok] ${why}. Reintento en ${Math.round(retryMs / 1000)} s`);
    timer = setTimeout(connect, retryMs);
    retryMs = Math.min(Math.round(retryMs * 1.5), 60000);
  };

  async function connect() {
    if (stopped) return;
    let lib;
    try {
      lib = await import('tiktok-live-connector');
    } catch (err) {
      setStatus({ state: 'error', message: 'Falta instalar dependencias: ejecuta npm install.' });
      log.error?.('[tiktok] no se pudo cargar tiktok-live-connector', err);
      return;
    }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
    if (conn) {
      try {
        conn.removeAllListeners();
        await conn.disconnect();
      } catch {
        /* ignorar */
      }
    }
    setStatus({ state: 'conectando' });
    conn = new TikTokLiveConnection(username, {
      signApiKey: config.signApiKey || undefined,
      // false: pedir la lista de regalos exige una firma de Euler que ahora es del plan Business
      // y sin ella el connect falla. Cada regalo ya trae nombre, monedas y tipo en `gift`.
      enableExtendedGiftInfo: false,
      processInitialData: false,
    });
    const emit = (e) => {
      if (e) onEvent(e);
    };
    conn.on(WebcastEvent.CHAT, (d) => {
      const e = norm.chat(d);
      log.info?.(`[chat] ${e.uniqueId || e.nickname}: ${e.text.slice(0, 80)}`);
      emit(e);
    });
    conn.on(WebcastEvent.GIFT, (d) => {
      for (const e of norm.gift(d)) emit(e);
    });
    conn.on(WebcastEvent.LIKE, (d) => emit(norm.like(d)));
    conn.on(WebcastEvent.FOLLOW, (d) => emit(norm.social(d, 'follow')));
    conn.on(WebcastEvent.SHARE, (d) => emit(norm.social(d, 'share')));
    conn.on(WebcastEvent.STREAM_END, () => {
      setStatus({ state: 'fin', message: 'El LIVE terminó. Esperando que vuelva…' });
      schedule('LIVE terminado');
    });
    conn.on(ControlEvent.DISCONNECTED, () => {
      if (stopped) return;
      setStatus({ state: 'desconectado' });
      schedule('desconectado');
    });
    conn.on(ControlEvent.ERROR, ({ info, exception }) => {
      log.warn?.('[tiktok] error:', info || '', exception?.message || '');
    });

    try {
      const state = await conn.connect();
      retryMs = 10000;
      setStatus({ state: 'conectado', roomId: state?.roomId });
      log.info?.(`[tiktok] conectado al LIVE de @${username} (sala ${state?.roomId})`);
    } catch (err) {
      const msg = String(err?.message || err);
      const kind = `${err?.name || ''} ${err?.constructor?.name || ''} ${msg}`;
      const offline =
        (lib.UserOfflineError && err instanceof lib.UserOfflineError) ||
        /offline|not live|isn't live|UserOffline/i.test(kind);
      const limited =
        (lib.SignatureRateLimitError && err instanceof lib.SignatureRateLimitError) || /rate.?limit/i.test(kind);
      let message = `No se pudo conectar: ${msg}`;
      if (offline) message = `@${username} no está en vivo todavía. Inicia el LIVE y se conectará solo.`;
      else if (limited)
        message =
          'Límite del servidor de firmas alcanzado. Espera un poco o pon una signApiKey de eulerstream.com en config.json.';
      setStatus({ state: offline ? 'offline' : 'error', message });
      schedule(offline ? 'el usuario no está en vivo' : `error: ${msg}`);
    }
  }

  connect();
  return {
    get status() {
      return status;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      try {
        conn?.removeAllListeners();
        conn?.disconnect();
      } catch {
        /* ignorar */
      }
    },
  };
}

// Conexión con el puente local (server/index.js), que reenvía los eventos de TikTok LIVE.

export function connectBridge(url, { onEvent, onStatus }) {
  let ws = null;
  let retry = 1000;
  let closed = false;

  const open = () => {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      retry = 1000;
      onStatus?.({ state: 'bridge' });
    };
    ws.onmessage = (m) => {
      let evt;
      try {
        evt = JSON.parse(m.data);
      } catch {
        return;
      }
      if (evt.type === 'status') onStatus?.(evt);
      else onEvent?.(evt);
    };
    ws.onclose = () => {
      onStatus?.({ state: 'bridge-lost' });
      schedule();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  };

  const schedule = () => {
    if (closed) return;
    setTimeout(open, retry);
    retry = Math.min(retry * 1.7, 10000);
  };

  open();
  return {
    close() {
      closed = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

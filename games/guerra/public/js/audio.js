// Sonido (6.10): la base de `games/asedio/public/js/audio.js` (volumen, canal de música, silenciar con `M`), sin los efectos
// sintetizados de ASEDIO (dependen de sus propios efectos de juego). La música está APAGADA por defecto. Todavía no hay archivos
// de audio (Duda 8): con la lista vacía el módulo queda mudo, no crea ningún contexto de audio y no pide nada a la red (cero
// 404). Cuando haya archivos se listan en `SOUNDS` (y en `CREDITOS.md` con su licencia).

/** Los sonidos que existen en `public/sounds/` (ninguno por ahora). */
export const SOUNDS = Object.freeze(/** @type {string[]} */ ([]));

export class Sfx {
  /**
   * @param {{volume?: number, musicVolume?: number, music?: boolean, base?: string, files?: readonly string[],
   *   fetch?: (url: string) => Promise<any>, AudioContextCtor?: any}} [o]
   */
  constructor(o = {}) {
    this.volume = o.volume ?? 0.5;
    this.musicVolume = o.musicVolume ?? 0.35;
    this.musicOn = o.music === true;
    this.base = o.base ?? 'sounds/';
    this.files = o.files ?? SOUNDS;
    this.fetch = o.fetch ?? ((u) => globalThis.fetch(u));
    this.AudioContextCtor = o.AudioContextCtor;
    this.muted = false;
    this.ctx = null;
    this.master = null;
    this.buf = /** @type {Record<string, any>} */ ({});
  }

  /** Crea el contexto de audio al primer gesto del narrador; sin archivos no crea nada. */
  unlock() {
    if (this.files.length === 0) return;
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = this.AudioContextCtor;
    if (typeof AC !== 'function') return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  /** Baja los archivos que existen (ninguno hoy: no hay pedidos). La música solo si está encendida. */
  async load() {
    if (!this.ctx || this.files.length === 0) return;
    await Promise.all(
      this.files.map(async (name) => {
        try {
          const res = await this.fetch(`${this.base}${name}.mp3`);
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          this.buf[name] = await new Promise((ok, bad) => this.ctx.decodeAudioData(ab, ok, bad));
        } catch {
          // un archivo que no decodifica se queda sin sonido
        }
      }),
    );
  }

  /** `M`: silenciar o volver a oír. Devuelve si quedó en silencio. */
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  /** Reproduce un archivo cargado; `false` si no hay (sin archivos, siempre). */
  play(name, { vol = 0.5 } = {}) {
    const b = this.buf[name];
    if (!b || !this.ctx || this.muted) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }
}

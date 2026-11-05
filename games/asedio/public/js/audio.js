// Sonido: efectos reales CC0 (Kenney) desde /sounds, música de fondo y, si algún archivo
// falta, efectos sintetizados con WebAudio como respaldo.

const SOUNDS = [
  'laser_s1', 'laser_s2', 'laser_s3', 'laser_s4', 'laser_s5', 'laser_l1', 'laser_l2', 'laser_r1', 'laser_r2', 'laser_r3',
  'boom_s1', 'boom_s2', 'boom_s3', 'boom_l1', 'boom_l2', 'hit_1', 'hit_2', 'hit_3', 'hit_4',
  'warp_1', 'warp_2', 'spawn_1', 'spawn_2', 'spawn_3', 'power', 'big_in', 'win', 'lose',
  'whoosh', 'start', 'likes', 'incoming', 'coin',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Sfx {
  constructor(volume = 0.5, opts = {}) {
    this.volume = volume;
    this.musicVolume = opts.musicVolume ?? 0.35;
    this.musicOn = opts.music !== false;
    this.base = opts.base ?? 'sounds/';
    this.muted = false;
    this.ctx = null;
    this.last = new Map();
    this.buf = {};
  }

  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    // la música va por su propio canal para poder bajarla en los momentos grandes
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
    const len = ctx.sampleRate;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.load();
  }

  async decode(name) {
    try {
      let ab;
      const emb = window.ASEDIO_SOUNDS?.[name];
      if (emb) {
        const bin = atob(emb);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ab = bytes.buffer;
      } else if (!window.ASEDIO_DEMO) {
        const res = await fetch(`${this.base}${name}.mp3`);
        if (!res.ok) return null;
        ab = await res.arrayBuffer();
      } else return null;
      return await new Promise((ok, bad) => this.ctx.decodeAudioData(ab, ok, bad));
    } catch {
      return null;
    }
  }

  async load() {
    await Promise.all(SOUNDS.map(async (n) => { const b = await this.decode(n); if (b) this.buf[n] = b; }));
    if (this.musicOn) {
      const m = await this.decode('music');
      if (m) this.startMusic(m);
    }
  }

  startMusic(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.music = src;
  }

  // baja la música un momento (regalos grandes, fin de ronda)
  duck(amount = 0.35, sec = 2.5) {
    if (!this.musicGain) return;
    const g = this.musicGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.musicVolume * amount, t, 0.08);
    g.setTargetAtTime(this.musicVolume, t + sec, 0.6);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  can(name, gap) {
    if (!this.ctx || this.muted) return false;
    const t = this.ctx.currentTime;
    if (t - (this.last.get(name) ?? -1) < gap) return false;
    this.last.set(name, t);
    return true;
  }

  out(pan = 0) {
    const ctx = this.ctx;
    if (!ctx.createStereoPanner) return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  // reproduce un archivo; devuelve false si no está cargado (para usar el sintetizado)
  play(name, { vol = 0.5, rate = 1, vary = 0.06, pan = 0, delay = 0 } = {}) {
    const b = this.buf[name];
    if (!b) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.out(pan));
    src.start(ctx.currentTime + delay);
    return true;
  }

  noiseBurst({ dur = 0.1, freq = 1000, freqEnd, q = 1, type = 'bandpass', vol = 0.1, pan = 0, attack = 0.003 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone({ type = 'sine', f0 = 440, f1, dur = 0.2, vol = 0.1, pan = 0, attack = 0.005, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // golpe grave que da peso a las explosiones grandes
  thump(size, pan, delay = 0) {
    this.tone({ type: 'sine', f0: 110, f1: 32, dur: 0.3 + size * 0.1, vol: Math.min(0.5, 0.1 + size * 0.06), pan, delay });
  }

  boom(size, pan) {
    if (size >= 4) {
      if (!this.play('boom_l1', { vol: Math.min(1, 0.45 + size * 0.07), pan, vary: 0.08 })) {
        this.noiseBurst({ dur: 0.25 + size * 0.14, freq: Math.max(160, 900 - size * 120), type: 'lowpass', q: 0.7, vol: Math.min(0.5, 0.1 + size * 0.06), pan });
      }
      this.play(pick(['boom_s2', 'boom_s3']), { vol: 0.5, rate: 0.8, pan });
      this.thump(size, pan);
    } else if (size >= 1.6) {
      if (!this.play(pick(['boom_s2', 'boom_s3']), { vol: 0.25 + size * 0.07, rate: 1.05 - size * 0.04, pan })) {
        this.noiseBurst({ dur: 0.3, freq: 600, type: 'lowpass', q: 0.7, vol: 0.18, pan });
      }
      if (size >= 2.5) this.play('boom_l2', { vol: 0.35, pan });
    } else if (!this.play(pick(['boom_s1', 'boom_s2']), { vol: 0.16 + size * 0.06, rate: 1.25, pan, vary: 0.1 })) {
      this.noiseBurst({ dur: 0.12, freq: 900, q: 0.8, vol: 0.06, pan });
    }
  }

  handle(list) {
    if (!this.ctx || this.muted) return;
    for (const e of list) {
      const pan = e.x !== undefined ? e.x / 16 : e.x1 !== undefined ? e.x1 / 16 : 0;
      switch (e.t) {
        case 'shot':
          if (e.w === 'laser') {
            if (this.can('laser', 0.09) && !this.play(pick(['laser_l1', 'laser_l2']), { vol: 0.32, pan, rate: e.team ? 0.9 : 1.05 })) {
              this.tone({ type: 'sawtooth', f0: 1400, f1: 260, dur: 0.14, vol: 0.05, pan });
            }
          } else if (e.w === 'turret') {
            if (this.can('turret', 0.1) && !this.play(pick(['laser_r1', 'laser_r2', 'laser_r3']), { vol: 0.2, pan, rate: 1.1 })) {
              this.noiseBurst({ dur: 0.07, freq: 1700, q: 1.2, vol: 0.07, pan });
            }
          } else if (e.cmd) {
            if (this.can('cmd', 0.07) && !this.play(pick(['laser_s1', 'laser_s3']), { vol: 0.22, pan, rate: 1.3 })) {
              this.noiseBurst({ dur: 0.06, freq: 3000, q: 1, vol: 0.07, pan });
            }
          } else if (this.can('rifle', 0.045) && !this.play(pick(['laser_s1', 'laser_s2', 'laser_s3', 'laser_s4', 'laser_s5']), { vol: 0.09, pan, rate: e.team ? 0.88 : 1.08, vary: 0.1 })) {
            this.noiseBurst({ dur: 0.045, freq: 2400 + Math.random() * 800, q: 0.9, vol: 0.035, pan });
          }
          break;
        case 'launch':
          if (e.w === 'cannon') {
            if (this.can('cannon', 0.08)) {
              this.noiseBurst({ dur: 0.22, freq: 500, type: 'lowpass', vol: 0.14, pan });
              this.tone({ f0: 95, f1: 45, dur: 0.22, vol: 0.12, pan });
              this.play('laser_r2', { vol: 0.12, rate: 0.55, pan });
            }
          } else if (this.can('rocket', 0.05)) this.noiseBurst({ dur: 0.2, freq: 700, freqEnd: 2600, q: 2, vol: 0.05, pan });
          break;
        case 'boom':
          if (this.can('boom', 0.05)) this.boom(e.r * 0.6, pan);
          break;
        case 'death':
          if (e.kind === 'acorazado') {
            this.boom(6, pan);
            this.play('boom_l2', { vol: 0.8, pan, delay: 0.3 });
            this.play('boom_l1', { vol: 1, rate: 0.85, pan, delay: 1.05 });
            this.thump(7, pan, 1.05);
            this.duck(0.25, 3);
          } else if (e.kind === 'coloso') { this.boom(4.5, pan); this.duck(0.5, 1.5); }
          else if (e.kind === 'bombardero') { if (this.can('dbomb', 0.08)) this.boom(2.4, pan); }
          else if (e.kind === 'comandante') {
            this.boom(3, pan);
            this.tone({ type: 'triangle', f0: 600, f1: 120, dur: 0.6, vol: 0.12 });
          } else if (this.can('dsmall', 0.05)) this.boom(1, pan);
          break;
        case 'spawn':
          if (e.big) {
            const friendly = e.team === 0;
            if (!this.play(friendly ? 'warp_1' : 'warp_2', { vol: 0.75, rate: e.kind === 'acorazado' ? 0.7 : 0.9, pan })) {
              this.noiseBurst({ dur: 1.2, freq: 300, freqEnd: 3000, q: 1.5, vol: 0.08, pan });
            }
            if (friendly) this.play('power', { vol: 0.55, delay: 0.15 });
            else this.play('big_in', { vol: 0.6, delay: 0.1 });
            if (e.kind === 'acorazado') this.thump(5, pan, 0.25);
            if (e.owner && !e.cpu) this.play('coin', { vol: 0.5, rate: 0.8 });
            this.duck(0.35, e.kind === 'acorazado' ? 4.2 : 2.4);
          } else if (!e.cpu && this.can('spawn', 0.07)) {
            if (!this.play(pick(['spawn_1', 'spawn_2', 'spawn_3']), { vol: 0.12, pan, rate: e.team === 0 ? 1.15 : 0.95 })) {
              this.tone({ type: 'triangle', f0: e.team === 0 ? 880 : 660, f1: e.team === 0 ? 1320 : 440, dur: 0.08, vol: 0.035, pan });
            }
            if (e.owner && e.owner.id !== 'likes' && this.can('coin', 0.12)) this.play('coin', { vol: 0.22, rate: 1 + Math.random() * 0.15 });
          }
          break;
        case 'strikeMark':
          if (!this.play('incoming', { vol: 0.5, rate: 0.8, pan })) this.tone({ type: 'sine', f0: 300, f1: 1400, dur: 0.7, vol: 0.06, pan });
          break;
        case 'strike':
          this.boom(5, pan);
          break;
        case 'baseHit':
          if (this.can('base', 0.22) && !this.play(pick(['hit_1', 'hit_2', 'hit_3', 'hit_4']), { vol: 0.32, pan: (Math.random() - 0.5) * 0.4 })) {
            this.tone({ type: 'square', f0: 140, f1: 90, dur: 0.12, vol: 0.05 });
          }
          break;
        case 'baseDestroyed':
          this.boom(7, 0);
          this.play('boom_l1', { vol: 1, rate: 0.7, delay: 0.5 });
          this.thump(8, 0, 0.5);
          break;
        case 'dash':
          if (!this.play('whoosh', { vol: 0.4, pan })) this.noiseBurst({ dur: 0.18, freq: 1200, freqEnd: 300, q: 1, vol: 0.06, pan });
          break;
        case 'cmdUp':
          if (!this.play('power', { vol: 0.4, rate: 1.2 })) this.tone({ type: 'triangle', f0: 400, f1: 900, dur: 0.3, vol: 0.08 });
          break;
        case 'likes':
          if (this.can('likes', 0.3)) this.play('likes', { vol: 0.3 });
          break;
        case 'round':
          if (e.state === 'battle') {
            this.play('start', { vol: 0.5 });
            [523, 659, 784].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.18, vol: 0.04, delay: i * 0.09 }));
          }
          if (e.state === 'end') {
            this.duck(0.15, 6);
            if (e.winner === 0) {
              this.play('win', { vol: 0.7 });
              [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.07, delay: 0.2 + i * 0.16 }));
            } else if (!this.play('lose', { vol: 0.6 })) {
              [392, 330, 262, 196].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.09, delay: i * 0.16 }));
            }
          }
          break;
        default:
          break;
      }
    }
  }
}

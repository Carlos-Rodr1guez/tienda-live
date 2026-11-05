// Controles del streamer: teclado + mouse en PC, tocar/arrastrar en celular.

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(surface, renderer, hooks = {}) {
    this.surface = surface;
    this.r = renderer;
    this.hooks = hooks;
    this.keys = new Set();
    this.aim = null;
    this.strike = false;
    this.dash = false;
    this.moveTo = null;
    this.pointer = null;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('pointermove', (e) => this.onMove(e));
    surface.addEventListener('pointerdown', (e) => this.onDown(e));
    surface.addEventListener('pointerup', (e) => this.onUp(e));
    surface.addEventListener('pointercancel', () => { this.pointer = null; this.moveTo = null; });
    surface.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.aim = null; });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const code = e.code;
    if (MOVE_KEYS[code]) {
      if (down) this.keys.add(code); else this.keys.delete(code);
      e.preventDefault();
      return;
    }
    if (!down) return;
    if (code === 'Space') { this.strike = true; e.preventDefault(); }
    else if (code === 'ShiftLeft' || code === 'ShiftRight') this.dash = true;
    else if (code === 'F1') { e.preventDefault(); this.hooks.toggleSim?.(); }
    else if (code === 'F3') { e.preventDefault(); this.hooks.toggleSafe?.(); }
    else if (code === 'KeyM') this.hooks.toggleMute?.();
    else if (code === 'KeyH') this.hooks.toggleHud?.();
    else if (code === 'KeyN') this.hooks.toggleNames?.();
    else if (code === 'KeyC') this.hooks.toggleCam?.();
    else if (code === 'Enter') this.hooks.start?.();
  }

  ground(e) {
    const rect = this.surface.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    return this.r.groundAt(nx, ny);
  }

  onMove(e) {
    const g = this.ground(e);
    if (!g) return;
    this.aim = g;
    if (this.pointer && e.pointerId === this.pointer.id && e.pointerType !== 'mouse') {
      const moved = Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y);
      if (moved > 12 || performance.now() - this.pointer.t > 220) this.moveTo = g;
    }
  }

  onDown(e) {
    const g = this.ground(e);
    if (g) this.aim = g;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.strike = true;
      else if (e.button === 2) this.moveTo = g;
      return;
    }
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  onUp(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.moveTo = null;
      return;
    }
    if (this.pointer && e.pointerId === this.pointer.id) {
      const quick = performance.now() - this.pointer.t < 220;
      const moved = Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y);
      if (quick && moved < 12) this.strike = true; // toque corto = bombardeo
    }
    this.pointer = null;
    this.moveTo = null;
  }

  // Estado para el mundo; los disparadores de un solo uso se limpian al leerlos.
  read() {
    let mx = 0, mz = 0;
    for (const k of this.keys) { mx += MOVE_KEYS[k][0]; mz += MOVE_KEYS[k][1]; }
    const out = {
      moveX: Math.sign(mx), moveZ: Math.sign(mz),
      aim: this.aim, strike: this.strike, dash: this.dash, moveTo: this.moveTo,
    };
    this.strike = false;
    this.dash = false;
    return out;
  }
}

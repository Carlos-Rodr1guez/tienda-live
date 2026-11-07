// Capa 3 del dibujo: las bases (arte prerenderizado por estado), sus torretas vivas y el banderín. Va en LOW: el
// arte y las torretas no se mueven con la pasada de dispositivo. Solo lee `scene.bases`; los estados por HP son
// cosméticos (ninguna regla los lee) y se pueden cambiar sin tocar el sim.

import { PALETA } from '../data/paleta.js';
import { BASE_W, BASE_Y0, baseState, bakeBase, BASE_STATE_THRESHOLDS } from './base-art.js';
import { disc, line } from './pixel.js';
import { pennant } from './pennant.js';
import { shade, tint } from './sprites.js';

const INK = PALETA.ink;
const RUINA = '#141A26';

/**
 * @param {{createCanvas: (w: number, h: number) => any, worldW: number, thresholds?: typeof BASE_STATE_THRESHOLDS}} o
 */
export function createBaseLayer({ createCanvas, worldW, thresholds = BASE_STATE_THRESHOLDS }) {
  /** @type {any[][]} por lado, los 4 estados */
  const art = [[], []];
  const hex = ['#888888', '#888888'];
  let bakes = 0;

  /**
   * Hornea las dos bases para los colores del partido. `arts` son los ids del campo (`field.sides[i].art`).
   * @param {[string, string]} colors
   * @param {[string, string]} arts
   */
  function bake(colors, arts) {
    for (let s = 0; s < 2; s++) {
      hex[s] = colors[s];
      art[s] = bakeBase({ createCanvas }, /** @type {any} */ (arts[s]), colors[s], s === 1);
      bakes++;
    }
  }

  function torreta(ctx, t, side, hexTeam, time, cd) {
    const dir = side === 0 ? 1 : -1;
    const px = Math.round(t.x);
    const py = Math.round(t.y) - 3;
    if (!(t.on && t.hp > 0)) {
      ctx.fillStyle = RUINA;
      disc(ctx, px, py + 3, 6);
      return;
    }
    const tgt = t.tgt;
    const ang = tgt ? Math.atan2(tgt.y - t.y, tgt.x - t.x) : dir > 0 ? 0 : Math.PI;
    const desde = cd - t.cd; // pasos desde el último disparo
    const len = 11 - (desde >= 0 && desde < 3 ? 3 - desde : 0);
    const ex = px + Math.cos(ang) * len;
    const ey = py + Math.sin(ang) * len;
    ctx.fillStyle = INK;
    disc(ctx, px, py, 5);
    ctx.fillStyle = shade(hexTeam, 0.35);
    disc(ctx, px, py, 4);
    ctx.fillStyle = hexTeam;
    disc(ctx, px - 1, py - 1, 3);
    ctx.fillStyle = tint(hexTeam, 0.25);
    disc(ctx, px - 1, py - 2, 1);
    ctx.fillStyle = INK;
    line(ctx, px, py - 1, ex, ey - 1);
    line(ctx, px, py + 1, ex, ey + 1);
    ctx.fillStyle = '#8794AB';
    line(ctx, px, py, ex, ey);
    // menos de la mitad de HP: grietas sobre la torreta
    if (t.hp < t.maxHp / 2) {
      ctx.fillStyle = INK;
      line(ctx, px - 3, py - 4, px - 1, py);
      line(ctx, px + 2, py - 3, px + 4, py + 1);
    }
    void time;
  }

  return {
    bake,
    get bakeCount() {
      return bakes;
    },
    /** @param {any} P proyector en LOW (`mul` 1) */
    layer(P) {
      const scene = P.frame.scene;
      if (!scene?.bases || !art[0].length) return;
      const ctx = P.ctx;
      const time = P.frame.time;
      const reduced = Boolean(P.frame.reduced);
      const cooldown = Math.round((scene.cfg?.turret?.cooldown ?? 0.33) * 30);
      for (let s = 0; s < 2; s++) {
        const b = scene.bases[s];
        const x0 = s === 1 ? worldW - BASE_W : 0;
        if (x0 > P.vx1 + 60 || x0 + BASE_W < P.vx0 - 60) continue;
        const st = baseState(b.hp / b.maxHp, b.fell, thresholds);
        P.img(art[s][st], P.x(x0), P.y(BASE_Y0));
        // en coordenadas de mundo para las torretas y el banderín
        ctx.setTransform(1, 0, 0, 1, P.offX, P.offY);
        for (const t of b.turrets) torreta(ctx, t, s, hex[s], time, cooldown);
        pennant(
          (part, c, x, y, w, h) => {
            ctx.fillStyle = c;
            ctx.fillRect(x, y, w, h);
            P.stats.drawCalls++;
          },
          { hex: hex[s], side: /** @type {0|1} */ (s), worldW, time, ruined: st === 3, reduced },
        );
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    },
  };
}

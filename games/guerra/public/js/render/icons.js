// Íconos de rol de los grupos (CB-21, CB-22, diseño D22): la flecha (ATAQUE, id `arrow`) y el ícono de defensa (id
// `shield`) se dibujan por código, sin ningún archivo ráster, y se hornean una vez por color de equipo.
//
//  - En el MUNDO un píxel del ícono es un px de mundo: crece con el zoom como el resto del arte (pequeño en k = 1) y
//    se sigue dibujando con el LOD de marcas. Va en la capa 10 de D21, centrado sobre la formación y arriba de su
//    miembro más alto, y con alfa 0,55 mientras el grupo forma.
//  - En el HUD el mismo dibujo va en espacio de UI, con tamaño fijo por la escala entera `u` (el lote 6 lo ubica).
//
// La geometría, los descriptores y los conteos son puros: sin DOM, sin reloj y sin lienzo propio (el horneado recibe la
// fábrica de lienzos inyectada). Solo LEE el estado del sim.

import { squadBox } from '../sim/squads.js';
import { PALETA } from '../data/paleta.js';
import { tint } from './sprites.js';
import { projectAxis } from './project.js';

const INK = PALETA.ink;
/** El borde claro del ícono es el color del equipo aclarado en esta fracción (D22). */
export const ICON_TINT = 0.45;
/** Un paso del sim en segundos, para interpolar el ancla del grupo entre el paso anterior y el actual. */
const PASO = 1 / 30;

/**
 * Las filas del prototipo v3 aprobado. `o` es el contorno INK, `h` el borde claro (el color del equipo aclarado 45 %),
 * `T` el relleno del color del equipo y `.` está vacío. Los 10×8 y 9×10 INCLUYEN el contorno.
 */
const FORMAS = {
  // flecha de 10×8 que apunta al este (hacia el enemigo del equipo izquierdo); el equipo derecho la espeja
  arrow: [
    '.....oo...',
    '.....oTo..',
    'oooooohTo.',
    'ohhhhhhTTo',
    'oTTTTTTTTo',
    'ooooooTTo.',
    '.....oTo..',
    '.....oo...',
  ],
  // ícono de defensa de 9×10, simétrico
  shield: [
    'ooooooooo',
    'ohhhhhhho',
    'ohTTTTTho',
    'ohTTTTTho',
    'ohTTTTTho',
    'ohTTTTTho',
    '.ohTTTho.',
    '..ohTho..',
    '...oho...',
    '....o....',
  ],
};

/** Los íconos: ancho, alto y las filas (`o`, `h`, `T` y `.`). */
export const ICONS = Object.freeze(
  Object.fromEntries(
    Object.entries(FORMAS).map(([id, rows]) => [
      id,
      Object.freeze({ id, w: rows[0].length, h: rows.length, rows: Object.freeze([...rows]) }),
    ]),
  ),
);

/** Qué ícono lleva cada rol del comandante: DEFENSA con el ícono de defensa y ATAQUE con la flecha. */
export const ICON_ROLE = Object.freeze({ defensa: 'shield', ataque: 'arrow' });

/** Config `render.icons`: la opacidad mientras el grupo forma, recortada a [0,3, 1]. @param {{formingAlpha?: number}} [cfg] */
export function resolveIcons(cfg) {
  const n = Number(cfg?.formingAlpha);
  return { formingAlpha: Number.isFinite(n) ? Math.min(1, Math.max(0.3, n)) : 0.55 };
}

// ---------------------------------------------------------------------------------------------------------------
// horneado

/**
 * Hornea los íconos por color de equipo: normal y espejado de cada uno, en DOS capas del tamaño del ícono (10×8 y 9×10,
 * con el contorno dentro): `line` con el contorno INK y el borde claro, y `fill` con el relleno del color del equipo.
 * Mientras un grupo forma, solo `fill` lleva la opacidad de "formando": el borde claro al 0,55 daría menos de 3:1
 * contra el terreno (CB-21). El horneado cuenta una vez por color y nunca por cuadro.
 * @param {{createCanvas: (w: number, h: number) => any}} o
 */
export function createIconBank({ createCanvas }) {
  /** @type {Record<string, any>[]} */
  const teams = [];
  const byColor = new Map();
  let bakeCount = 0;

  function pintar(id, hex, espejo) {
    const ic = ICONS[id];
    const capa = (colores) => {
      const c = createCanvas(ic.w, ic.h);
      const g = c.getContext('2d');
      for (const [letra, color] of colores) {
        g.fillStyle = color;
        for (let y = 0; y < ic.h; y++)
          for (let x = 0; x < ic.w; x++) if (ic.rows[y][x] === letra) g.fillRect(espejo ? ic.w - 1 - x : x, y, 1, 1);
      }
      return c;
    };
    return {
      line: capa([
        ['o', INK],
        ['h', tint(hex, ICON_TINT)],
      ]),
      fill: capa([['T', hex]]),
    };
  }

  return {
    get bakeCount() {
      return bakeCount;
    },
    /** Hornea (una vez por color) y devuelve el índice del equipo. @param {string} hex */
    bake(hex) {
      const prev = byColor.get(hex);
      if (prev !== undefined) return prev;
      const t = {};
      for (const id of Object.keys(ICONS)) t[id] = [pintar(id, hex, false), pintar(id, hex, true)];
      teams.push(t);
      byColor.set(hex, teams.length - 1);
      bakeCount++;
      return teams.length - 1;
    },
    /** Las dos capas horneadas de un ícono, `{line, fill}`; `espejo` lo hace mirar al oeste. */
    layers(team, id, espejo) {
      return teams[team][id][espejo ? 1 : 0];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// descriptores en el mundo

const nuevoDescriptor = () => ({
  id: '',
  role: '',
  side: 0,
  squad: 0,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  alpha: 1,
  mirror: false,
});

/**
 * Un descriptor por grupo con miembros (D22): el ícono de su rol, centrado en x sobre la formación y arriba de su
 * miembro más alto, en px de mundo. `x`/`y` es la esquina del ícono (de `w`×`h`, el contorno va dentro). El ancla se
 * interpola entre el paso anterior y el actual, igual que los sprites. Con `marks` (LOD de marcas) el ícono va arriba de
 * la marca más alta (su alto más 1 px de contorno) y no de la cima del sprite, como las etiquetas. Escribe en `out`
 * (se reutiliza) y devuelve cuántos descriptores hay.
 * @param {{squads: any[], cfg: any, field: any, alpha: number, spriteAy: Record<string, number>,
 *   formingAlpha: number, marks?: boolean, marksSize?: Record<string, number[]>,
 *   out: ReturnType<typeof nuevoDescriptor>[]}} a
 */
export function roleIcons({ squads, cfg, field, alpha, spriteAy, formingAlpha, marks = false, marksSize, out }) {
  let n = 0;
  for (let i = 0; i < squads.length; i++) {
    const sq = squads[i];
    if (sq.members.length === 0) continue;
    const id = ICON_ROLE[sq.role];
    const ic = id ? ICONS[id] : null;
    if (!ic) continue;
    const dir = field.sides[sq.side].dir;
    const caja = squadBox(cfg, sq);
    const a = sq.anchor;
    const ax = a.x - a.vx * PASO * (1 - alpha);
    const ay = a.y - a.vy * PASO * (1 - alpha);
    const d = out[n] ?? (out[n] = nuevoDescriptor());
    n++;
    d.id = id;
    d.role = sq.role;
    d.side = sq.side;
    d.squad = sq.id;
    d.w = ic.w;
    d.h = ic.h;
    d.x = ax - (dir * caja.fondo) / 2 - ic.w / 2;
    const marca = marks ? marksSize?.[sq.kind] : undefined;
    const cima = marca ? marca[1] + 1 : (spriteAy[sq.kind] ?? 0);
    d.y = ay - caja.hw + cfg.units[sq.kind].foot[1] / 2 - cima - ic.h;
    d.alpha = sq.state === 'forming' ? formingAlpha : 1;
    d.mirror = dir < 0;
  }
  return n;
}

/**
 * El rectángulo del ícono en pantalla (px de dispositivo): lo que las etiquetas tienen que esquivar. Usa la misma
 * proyección que el dibujo.
 * @param {{x: number, y: number, w: number, h: number}} d
 * @param {{s: number, ox: number, oy: number, device: boolean}} v
 */
export function iconScreenRect(d, v) {
  return {
    x: projectAxis(d.x, v, v.ox),
    y: projectAxis(d.y, v, v.oy),
    w: d.w * v.s,
    h: d.h * v.s,
  };
}

/**
 * La capa 10 de D21: dibuja los íconos de rol en el proyector del cuadro (LOW o pasada de dispositivo). Se llama aunque
 * el LOD esté en marcas. Deja los descriptores del cuadro en `descs` (y cuántos hay en `count`) para las etiquetas.
 * @param {{bank: ReturnType<typeof createIconBank>, team: number[], spriteAy: Record<string, number>,
 *   marksSize?: Record<string, number[]>, formingAlpha: number}} o
 */
export function createIconLayer({ bank, team, spriteAy, marksSize, formingAlpha }) {
  const out = [];
  /** @param {any} P proyector del cuadro @param {any[]} squads @param {any} cfg @param {any} field */
  function capa(P, squads, cfg, field) {
    const marks = P.stats?.marks === true;
    const n = roleIcons({
      squads,
      cfg,
      field,
      alpha: P.frame?.alpha ?? 1,
      spriteAy,
      formingAlpha,
      marks,
      marksSize,
      out,
    });
    capa.count = n;
    const mul = P.mul;
    const ctx = P.ctx;
    let dibujados = 0;
    for (let i = 0; i < n; i++) {
      const d = out[i];
      if (!P.visible(d.x, d.y, 30)) continue;
      const { line, fill } = bank.layers(team[d.side], d.id, d.mirror);
      const x = P.x(d.x);
      const y = P.y(d.y);
      // las líneas siempre opacas; solo el relleno lleva el alfa de "formando" (así el borde claro conserva 3:1)
      ctx.globalAlpha = 1;
      P.img(line, x, y, d.w * mul, d.h * mul);
      ctx.globalAlpha = d.alpha;
      P.img(fill, x, y, d.w * mul, d.h * mul);
      dibujados++;
    }
    ctx.globalAlpha = 1;
    capa.stats.drawn = dibujados;
  }
  capa.descs = out;
  capa.count = 0;
  capa.stats = { drawn: 0 };
  return capa;
}

// ---------------------------------------------------------------------------------------------------------------
// HUD (espacio de UI) y conteos

/** El rectángulo de un ícono del HUD: tamaño fijo por la escala entera `u`, nunca por el zoom. */
export function uiIconRect(id, x, y, u) {
  return { x, y, w: ICONS[id].w * u, h: ICONS[id].h * u };
}

/**
 * Dibuja un ícono en espacio de UI: `(x, y)` es su esquina. Son las dos capas, líneas y relleno, opacas.
 * @param {any} ctx @param {ReturnType<typeof createIconBank>} bank @param {number} team índice de `bank.bake`
 * @param {string} id @param {number} x @param {number} y @param {number} u escala entera de la interfaz
 * @param {boolean} [espejo]
 */
export function drawUiIcon(ctx, bank, team, id, x, y, u, espejo = false) {
  const ic = ICONS[id];
  const { line, fill } = bank.layers(team, id, espejo);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(line, x, y, ic.w * u, ic.h * u);
  ctx.drawImage(fill, x, y, ic.w * u, ic.h * u);
}

/**
 * Grupos SALIDOS por lado y rol, para la franja del HUD (CB-17). Se LEEN de los contadores del comandante del sim
 * (`world.cmd[lado].hud`), que no cuentan los grupos que todavía forman: aquí no se recuenta nada.
 * @param {any} world
 * @returns {{defensa: number, ataque: number}[]} izquierdo, derecho
 */
export function departedCounts(world) {
  return [0, 1].map((side) => {
    const h = world?.cmd?.[side]?.hud;
    return { defensa: h?.defensa ?? 0, ataque: h?.ataque ?? 0 };
  });
}

// Recetas de los sprites (diseño D21 punto 9; Q5 (a): arte en código). Es el pintor `pg` del prototipo v3 aprobado por el
// dueño, portado sin cambiar la forma de nada salvo el bombardero (que sigue el diseño: 44x34, bombas en soportes
// sueltos, bandas de equipo delimitadas). Solo desarrollo: `tools/sprites.mjs` corre estas recetas y escribe
// `public/js/data/sprites.js`, que es lo único que carga el navegador. Un artista puede redibujar editando filas de ese
// archivo o reemplazarlo con el mismo contrato.
//
// Paleta (una letra por color, ver `paleta` en el archivo generado): o contorno, d equipo oscuro, t equipo, h equipo
// claro, s piel, k negro, g gris oscuro, l gris claro, m metal, b casi negro, w blanco, y amarillo, r rojo, f naranja,
// a vidrio, c cromo. '.' es transparente. Los sprites miran al este (+x); el espejo se hornea al cargar.

/** Pintor de filas de texto indexadas por paleta. */
function pg(w, h) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const o = {
    p(c, x, y) {
      if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c;
      return o;
    },
    r(c, x, y, ww, hh) {
      for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) o.p(c, x + i, y + j);
      return o;
    },
    e(c, cx, cy, rx, ry) {
      for (let y = cy - ry; y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const a = (x - cx) / (rx + 0.4);
          const b = (y - cy) / (ry + 0.4);
          if (a * a + b * b <= 1) o.p(c, x, y);
        }
      }
      return o;
    },
    /** Contorno 'o' alrededor de todo lo pintado. */
    ol() {
      const n = g.map((r) => r.slice());
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (
            g[y][x] === '.' &&
            ((x > 0 && g[y][x - 1] !== '.') ||
              (x < w - 1 && g[y][x + 1] !== '.') ||
              (y > 0 && g[y - 1][x] !== '.') ||
              (y < h - 1 && g[y + 1][x] !== '.'))
          )
            n[y][x] = 'o';
        }
      }
      for (let y = 0; y < h; y++) g[y] = n[y];
      return o;
    },
    rows() {
      return g.map((r) => r.join(''));
    },
  };
  return o;
}

const rep = (s, n) => s.repeat(n);

/** Soldado 9x13: casco redondo visto desde arriba, hombros y fusil. `l`/`r`: largo de cada pierna; `fl`: fogonazo. */
const soldado = (l, r, fl) => {
  const P = pg(9, 13);
  P.r('t', 2, 1, 3, 2).p('h', 3, 1).p('d', 2, 3).r('s', 3, 3, 2, 1);
  P.r('t', 1, 4, 5, 3).r('h', 2, 4, 2, 1).r('d', 1, 7, 5, 2).r('k', 1, 7, 5, 1);
  P.p('s', 5, 6).p('k', 6, 6).p('g', 7, 6);
  const lg = (x, n) => {
    P.r('d', x, 9, 2, n - 1).r('k', x, 8 + n, 2, 1);
  };
  lg(1, l);
  lg(4, r);
  P.ol();
  if (fl) P.p('w', 8, 6).p('y', 8, 5).p('y', 8, 7);
  return P.rows();
};

const muerte = [
  pg(9, 13)
    .r('t', 3, 3, 3, 2)
    .p('s', 6, 4)
    .r('t', 2, 5, 4, 3)
    .r('d', 2, 8, 4, 1)
    .r('d', 1, 9, 2, 2)
    .r('k', 1, 11, 2, 1)
    .r('d', 4, 9, 2, 1)
    .p('k', 4, 10)
    .p('g', 6, 7)
    .p('k', 7, 8)
    .ol()
    .rows(),
  pg(9, 13)
    .r('t', 4, 6, 3, 2)
    .p('s', 7, 7)
    .r('t', 2, 7, 3, 3)
    .r('d', 2, 10, 3, 1)
    .r('d', 0, 9, 2, 2)
    .p('k', 0, 11)
    .p('g', 5, 9)
    .p('k', 6, 10)
    .ol()
    .rows(),
  pg(9, 13)
    .r('d', 0, 9, 3, 2)
    .r('k', 0, 9, 1, 2)
    .r('t', 3, 8, 3, 3)
    .r('d', 3, 11, 3, 1)
    .r('t', 6, 8, 2, 2)
    .p('s', 7, 10)
    .p('g', 3, 7)
    .p('k', 5, 7)
    .ol()
    .rows(),
];

/** Carcasa quemada: el equipo y el metal pasan a grises y negros. */
const quemar = (rows) =>
  rows.map((r) =>
    r.replace(/[htdylsmaf]/g, (c) => ({ h: 'g', t: 'k', d: 'b', y: 'k', l: 'g', s: 'k', m: 'g', a: 'k', f: 'k' })[c]),
  );

/** Jeep 22x16 en 3/4: capó, parabrisas, cabina abierta, artillero con ametralladora en poste y rueda de auxilio. */
const jeep = (wh, rec) => {
  const P = pg(22, 16);
  P.r('k', 1, 6, 2, 3).p('g', 1, 7);
  P.r('h', 3, 5, 1, 4)
    .r('h', 4, 5, 8, 1)
    .r('k', 4, 6, 8, 1)
    .r('b', 4, 7, 6, 2)
    .r('g', 10, 6, 2, 1)
    .r('k', 10, 7, 2, 1)
    .r('g', 10, 8, 2, 1);
  P.r('t', 3, 9, 5, 1)
    .r('b', 8, 9, 4, 1)
    .r('t', 8, 10, 4, 1)
    .r('d', 3, 10, 5, 2)
    .r('d', 8, 11, 4, 1)
    .r('d', 12, 10, 7, 2);
  P.p('l', 12, 4).r('a', 12, 5, 1, 4).p('l', 12, 9);
  P.r('h', 13, 5, 6, 1).r('t', 13, 6, 6, 4).p('y', 18, 6).p('y', 18, 8).r('k', 19, 6, 1, 3);
  const gx = rec ? 8 : 9;
  P.r('g', 8, 5, 1, 2)
    .r('m', gx, 3, 7, 1)
    .r('l', gx + 1, 3, 2, 1)
    .p('k', gx + 7, 3)
    .r('k', 7, 3, 2, 2);
  P.r('t', 4, 1, 3, 2)
    .p('h', 5, 1)
    .p('d', 4, 3)
    .r('s', 5, 3, 2, 1)
    .r('t', 4, 4, 3, 3)
    .p('h', 5, 4)
    .p('d', 4, 6)
    .p('d', 6, 6);
  for (const cx of [5, 15]) {
    P.e('k', cx, 12, 2, 2).e('g', cx, 12, 1, 1);
    if (wh === 0) P.p('l', cx, 12);
    else if (wh === 1) P.p('l', cx - 1, 12).p('l', cx + 1, 12);
    else P.p('l', cx, 11).p('l', cx, 13);
  }
  return P.ol().rows();
};

/** Tanque y pesado: casco con orugas a los dos lados, torreta redonda; el cañón es una pieza aparte (retroceso). */
const orugas = (c, ph) => {
  const P = pg(c.W, c.H);
  const { x0, x1 } = c;
  const wd = x1 - x0 + 1;
  const ny = c.hy + c.hh + c.sh;
  P.r('k', x0 - 1, c.fy, wd + 2, c.fh);
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    if ((x + ph) % 3 === 0) P.p('l', x, c.fy);
    else if ((x + ph) % 3 === 1) P.p('g', x, c.fy + c.fh - 1);
  }
  P.r('t', x0, c.hy, wd, c.hh)
    .r('h', x0, c.hy, wd, 1)
    .r('h', x1 - 3, c.hy + 1, 4, c.hh - 1);
  P.r('g', x0 + 1, c.hy + 2, 4, c.hh - 3);
  for (let j = c.hy + 2; j < c.hy + c.hh - 1; j += 2) P.r('k', x0 + 1, j, 4, 1);
  P.r('d', x0, c.hy + c.hh, wd, c.sh);
  for (let x = x0 + 3; x < x1; x += 5) P.p('g', x, c.hy + c.hh);
  P.r('k', x0 - 1, ny, wd + 2, c.nh);
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    if ((x + ph) % 3 === 0) {
      P.p('l', x, ny);
      P.p('l', x, ny + c.nh - 1);
    } else {
      P.p('g', x, ny);
    }
  }
  const wy = ny + (c.nh >> 1);
  const wr = (c.nh - 3) >> 1;
  for (let wx = x0 + c.ws; wx <= x1 - 1; wx += c.wp) {
    P.e('g', wx, wy, wr, wr);
    P.p('l', wx, wy);
  }
  P.e('d', c.tx, c.ty + 1, c.rx, c.ry)
    .e('t', c.tx, c.ty, c.rx, c.ry)
    .e('h', c.tx - 1, c.ty - 1, c.rx - 3, c.ry - 2);
  P.e('k', c.tx - 2, c.ty, 1, 1).p('l', c.tx - 2, c.ty);
  P.r('g', c.tx + c.rx - 1, c.ty - 1, 2, 3);
  if (c.two) P.e('k', c.tx + 2, c.ty + 2, 1, 0);
  return P.ol().rows();
};
const barra = (L) => [rep('o', L), 'og' + rep('m', L - 4) + 'ko', rep('o', L)];
const TKP = {
  W: 28,
  H: 20,
  x0: 2,
  x1: 23,
  fy: 3,
  fh: 3,
  hy: 6,
  hh: 6,
  sh: 2,
  nh: 5,
  ws: 2,
  wp: 4,
  tx: 11,
  ty: 8,
  rx: 5,
  ry: 3,
};
const HVP = {
  W: 40,
  H: 28,
  x0: 2,
  x1: 33,
  fy: 4,
  fh: 4,
  hy: 8,
  hh: 9,
  sh: 3,
  nh: 7,
  ws: 3,
  wp: 6,
  tx: 15,
  ty: 12,
  rx: 8,
  ry: 5,
  two: 1,
};

// ---------------------------------------------------------------------------------------------------------------
// Bombardero bimotor 44x34 visto desde arriba (vuela hacia +x): alas rectas con dos góndolas, nariz vidriada, cabina,
// torreta dorsal y estabilizador. El color del equipo va SOLO en las bandas listadas en `REGIONES.bandas`: puntas de
// ala, estabilizador, aros de motor y una banda del fuselaje. Sin insignias. Las bombas son piezas sueltas (soportes).
// bk: 0 nivelado, 1 alabeo hacia y-, 2 alabeo hacia y+ (el ala que baja se ve más corta y oscura). pr: cuadro de hélice.

const AW = 44;
const AH = 34;

/** Regiones del bombardero (coordenadas del sprite): las pruebas de CB-9 las leen. */
const REGIONES = {
  gondolas: [
    { x: 14, y: 6, w: 16, h: 5 },
    { x: 14, y: 22, w: 16, h: 5 },
  ],
  cabina: { x: 31, y: 14, w: 2, h: 5 },
  helices: [
    { x: 30, y: 3, w: 1, h: 10 },
    { x: 30, y: 19, w: 1, h: 12 },
  ],
  // las bandas incluyen el desplazamiento de las puntas de ala en los cuadros de alabeo (tT 1 o 3, tB 29 o 31)
  bandas: [
    { x: 20, y: 2, w: 7, h: 5 },
    { x: 20, y: 27, w: 7, h: 5 },
    { x: 1, y: 9, w: 6, h: 2 },
    { x: 1, y: 22, w: 6, h: 2 },
    { x: 27, y: 6, w: 2, h: 5 },
    { x: 27, y: 22, w: 2, h: 5 },
    { x: 11, y: 14, w: 2, h: 5 },
  ],
};

/** Posiciones de las 5 bombas: 2 bajo cada ala y 1 bajo el fuselaje (coordenadas del sprite, esquina superior izquierda). */
const SOPORTES = [
  { x: 12, y: 11 },
  { x: 12, y: 20 },
  { x: 19, y: 3 },
  { x: 19, y: 28 },
  { x: 4, y: 15 },
];
const bombaPlana = () => pg(6, 4).r('k', 1, 1, 4, 2).p('g', 4, 1).r('b', 0, 1, 1, 2).ol().rows();

const bombardero = (bk, pr) => {
  const P = pg(AW, AH);
  const tT = bk === 1 ? 3 : 1;
  const tB = bk === 2 ? 29 : 31;
  for (let y = tT; y <= tB; y++) {
    const d = Math.min(y - tT, tB - y);
    const x0 = d < 1 ? 21 : d < 2 ? 20 : 19;
    const x1 = d < 1 ? 25 : d < 2 ? 26 : 27;
    const dn = (bk === 1 && y < 16) || (bk === 2 && y > 16);
    P.r(dn ? 'g' : 'm', x0, y, x1 - x0 + 1, 1)
      .p(dn ? 'm' : 'l', x1, y)
      .p(dn ? 'k' : 'g', x0, y);
  }
  for (const y of [tT + 1, tT + 2, tB - 2, tB - 1]) P.r('t', 20, y, 6, 1).p('h', 26, y);
  for (let y = 8; y <= 24; y++) {
    const d = Math.min(y - 8, 24 - y);
    const x0 = d < 1 ? 2 : 1;
    const x1 = d < 1 ? 5 : 6;
    P.r('m', x0, y, x1 - x0 + 1, 1).p('l', x1, y);
  }
  P.r('t', 1, 9, 6, 2).r('t', 1, 22, 6, 2).p('h', 6, 9).p('h', 6, 22);
  P.r('m', 1, 15, 8, 3).r('m', 9, 14, 6, 5).r('m', 15, 13, 21, 7).r('m', 36, 14, 3, 5).r('m', 39, 15, 2, 3);
  P.r('l', 1, 15, 8, 1)
    .r('g', 1, 17, 8, 1)
    .r('l', 9, 14, 6, 1)
    .r('g', 9, 18, 6, 1)
    .r('c', 15, 13, 21, 1)
    .r('l', 15, 14, 21, 1)
    .r('g', 15, 19, 21, 1)
    .r('k', 1, 16, 6, 1);
  P.r('t', 11, 14, 2, 5).p('h', 11, 14).p('h', 12, 14);
  for (const cy of [8, 24]) {
    P.r('m', 16, cy - 2, 13, 5)
      .r('l', 16, cy - 2, 13, 1)
      .r('g', 16, cy + 2, 13, 1)
      .r('m', 14, cy - 1, 2, 3)
      .p('g', 14, cy + 1);
    P.r('t', 27, cy - 2, 2, 5)
      .p('h', 27, cy - 2)
      .p('h', 28, cy - 2)
      .r('c', 29, cy - 1, 1, 3)
      .p('w', 29, cy - 1);
  }
  P.r('a', 31, 14, 2, 5).r('k', 33, 14, 1, 5).p('w', 31, 14).p('w', 32, 14).p('w', 31, 15);
  P.r('a', 36, 14, 3, 5).r('a', 39, 15, 2, 3).r('k', 37, 14, 1, 5).p('w', 38, 15).p('w', 40, 15);
  P.e('k', 23, 16, 1, 1).p('a', 23, 16).p('w', 22, 15);
  P.ol();
  for (const cy of [8, 24]) {
    if (pr) P.r('c', 30, cy - 5, 1, 4).r('c', 30, cy + 2, 1, 4);
    else
      P.r('l', 30, cy - 4, 1, 3)
        .r('l', 30, cy + 2, 1, 3)
        .p('c', 30, cy - 5)
        .p('c', 30, cy + 5);
  }
  return P.rows();
};

/** Todos los sprites, con la forma del archivo generado `public/js/data/sprites.js`. */
export function buildSprites() {
  const volar = [];
  for (let bk = 0; bk < 3; bk++) for (let pr = 0; pr < 2; pr++) volar.push(bombardero(bk, pr));
  const tk = (ph) => orugas(TKP, ph);
  const hv = (ph) => orugas(HVP, ph);
  return {
    version: 1,
    paleta: 'o d t h s k g l m b w y r f a c',
    soldado: {
      w: 9,
      h: 13,
      ax: 3,
      ay: 11,
      mz: [8, 6],
      anims: {
        idle: [soldado(3, 3)],
        walk: [soldado(3, 2), soldado(3, 3), soldado(2, 3), soldado(3, 3)],
        shoot: [soldado(3, 3), soldado(3, 3, 1)],
        death: muerte,
      },
    },
    jeep: {
      w: 22,
      h: 16,
      ax: 10,
      ay: 14,
      mz: [16, 3],
      anims: {
        idle: [jeep(0)],
        walk: [jeep(0), jeep(1), jeep(2)],
        shoot: [jeep(0), jeep(0, 1)],
        wreck: [quemar(jeep(0))],
      },
    },
    tanque: {
      w: 28,
      h: 20,
      ax: 13,
      ay: 18,
      mz: [27, 8],
      barra: { rows: barra(13), dx: 15, dy: 7 },
      anims: { idle: [tk(0)], walk: [tk(0), tk(1), tk(2)], shoot: [tk(0)], wreck: [quemar(tk(0))] },
    },
    pesado: {
      w: 40,
      h: 28,
      ax: 17,
      ay: 26,
      mz: [39, 10],
      mz2: [39, 14],
      barra: { rows: barra(18), dx: 22, dy: 9, dy2: 13 },
      anims: { idle: [hv(0)], walk: [hv(0), hv(1), hv(2)], shoot: [hv(0)], wreck: [quemar(hv(0))] },
    },
    avion: {
      w: AW,
      h: AH,
      ax: 21,
      ay: 16,
      regiones: REGIONES,
      soportes: SOPORTES.map((s) => ({ ...s, rows: bombaPlana() })),
      // índice de cuadro = alabeo * 2 + hélice
      anims: { fly: volar },
    },
    bomba: { w: 3, h: 6, ax: 1, ay: 4, anims: { fall: [['oto', 'otd', 'okg', 'okg', 'oko', '.o.']] } },
  };
}

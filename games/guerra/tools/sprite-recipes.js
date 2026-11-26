// Recetas de los sprites (diseño D21 punto 9; Q5 (a): arte en código). Es el pintor `pg` del prototipo v3 aprobado por el
// dueño, portado sin cambiar la forma de nada salvo el bombardero (que sigue el diseño: 44x34, bombas en soportes
// sueltos, bandas de equipo delimitadas). Solo desarrollo: `tools/sprites.mjs` corre estas recetas y escribe
// `public/js/data/sprites.js`, que es lo único que carga el navegador. Un artista puede redibujar editando filas de ese
// archivo o reemplazarlo con el mismo contrato.
//
// Paleta (una letra por color, ver `paleta` en el archivo generado): o contorno, d equipo oscuro, t equipo, h equipo
// claro, s piel, k negro, g gris oscuro, l gris claro, m metal, b casi negro, w blanco, y amarillo, r rojo, f naranja,
// a vidrio, c cromo. '.' es transparente. Los sprites miran al este (+x); el espejo se hornea al cargar.

/** Pintor de filas de texto indexadas por paleta. Con `init` (filas ya pintadas) sigue pintando sobre ellas. */
function pg(w, h, init) {
  const g = init ? init.map((r) => r.split('')) : Array.from({ length: h }, () => Array(w).fill('.'));
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
  if (c.rack) {
    bastidor(P, c, c.fl ?? 0);
    return P.ol().rows();
  }
  P.e('d', c.tx, c.ty + 1, c.rx, c.ry)
    .e('t', c.tx, c.ty, c.rx, c.ry)
    .e('h', c.tx - 1, c.ty - 1, c.rx - 3, c.ry - 2);
  P.e('k', c.tx - 2, c.ty, 1, 1).p('l', c.tx - 2, c.ty);
  P.r('g', c.tx + c.rx - 1, c.ty - 1, 2, 3);
  if (c.two) P.e('k', c.tx + 2, c.ty + 2, 1, 0);
  return P.ol().rows();
};

/**
 * Lanzacohetes (v2.8): en lugar de la torreta, un bastidor con tres tubos paralelos sobre el casco. Cada tubo lleva una
 * banda del color del equipo y un cohete (punta roja) asomando por la boca; con `fl` sale la llamarada y el humo.
 */
function bastidor(P, c, fl) {
  const x0 = c.tx - 7;
  const x1 = c.tx + 8;
  P.r('g', x0 - 1, c.hy - 1, x1 - x0 + 3, 2).r('k', x0 - 1, c.hy, x1 - x0 + 3, 1);
  for (const y of [c.hy - 7, c.hy - 5, c.hy - 3]) {
    P.r('l', x0, y, x1 - x0 + 1, 1).r('m', x0, y + 1, x1 - x0 + 1, 1);
    P.r('t', c.tx - 3, y, 2, 2).p('h', c.tx - 3, y);
    P.r('k', x1, y, 1, 2)
      .p('r', x1 + 1, y)
      .p('y', x1 + 1, y + 1);
    if (fl)
      P.p('w', x1 + 2, y)
        .p('y', x1 + 3, y)
        .p('f', x1 + 2, y + 1)
        .p('f', x1 + 4, y + 1);
  }
  P.r('g', x0, c.hy - 7, 1, 7).r('g', x1 - 1, c.hy - 7, 1, 7);
}
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

/** Casco del lanzacohetes (v2.8): el del tanque, más largo, con el bastidor de tubos (`rack`) en vez de torreta. */
const LCP = {
  W: 32,
  H: 22,
  x0: 2,
  x1: 27,
  fy: 5,
  fh: 3,
  hy: 8,
  hh: 6,
  sh: 2,
  nh: 5,
  ws: 2,
  wp: 4,
  tx: 14,
  ty: 8,
  rx: 0,
  ry: 0,
  rack: 1,
};

// ---------------------------------------------------------------------------------------------------------------
// Tipos nuevos de la v2.8 (francotirador, blindado y lobo). Mismas reglas que el resto: miran al este, el color del equipo
// va en t/h/d y el espejo se hornea al cargar.

/**
 * Francotirador 15x13: el soldado con casco de camuflaje, rifle largo con mira telescópica y bípode. `l`/`r`: largo de cada
 * pierna; `fl`: fogonazo en la boca del cañón (14, 6).
 */
const francotirador = (l, r, fl) => {
  const P = pg(15, 13);
  P.r('t', 2, 1, 3, 2).p('g', 3, 1).p('g', 2, 2).p('d', 2, 3).r('s', 3, 3, 2, 1);
  P.r('t', 1, 4, 5, 3).r('h', 2, 4, 2, 1).r('d', 1, 7, 5, 2).r('k', 1, 7, 5, 1);
  P.p('s', 5, 6).p('k', 6, 6).p('g', 7, 6).r('m', 8, 6, 6, 1);
  P.r('k', 7, 5, 4, 1).p('a', 10, 5).p('l', 8, 5);
  P.p('g', 11, 7).p('g', 12, 8);
  const lg = (x, n) => {
    P.r('d', x, 9, 2, n - 1).r('k', x, 8 + n, 2, 1);
  };
  lg(1, l);
  lg(4, r);
  P.ol();
  if (fl) P.p('w', 14, 6).p('y', 14, 5).p('y', 14, 7);
  return P.rows();
};

/** Caídas del francotirador: las del soldado ensanchadas a 15 columnas y, la última, con el rifle en el suelo. */
const caidaLarga = (rows, rifle) => {
  const P = pg(
    15,
    13,
    rows.map((r) => r + '......'),
  );
  if (rifle) P.r('m', 7, 10, 6, 1).p('k', 13, 10).p('a', 9, 9).ol();
  return P.rows();
};

/**
 * Blindado 26x18: autoblindado de cuatro ruedas, casco de equipo con planchas, parabrisas, escotilla con ametralladora
 * pesada en la torreta. `ph` gira los tornillos de las ruedas; `fl` es el fogonazo en la boca (25, 4).
 */
const blindado = (ph, fl) => {
  const P = pg(26, 18);
  P.r('k', 1, 11, 24, 2);
  P.r('d', 2, 10, 22, 2).r('t', 2, 6, 22, 4).r('h', 2, 6, 22, 1).r('h', 17, 7, 6, 2);
  P.r('t', 24, 7, 1, 3).p('d', 24, 10);
  for (const x of [7, 13]) P.r('g', x, 7, 1, 3);
  P.r('k', 3, 8, 3, 1).r('a', 19, 7, 3, 1).r('k', 19, 8, 3, 1);
  P.r('g', 0, 8, 2, 1).p('k', 0, 7);
  P.e('d', 11, 5, 3, 2).e('t', 11, 4, 3, 2).e('h', 10, 3, 1, 1);
  P.e('k', 9, 4, 1, 1).p('l', 9, 4);
  P.r('g', 13, 3, 2, 3).r('m', 15, 4, 9, 1).r('l', 15, 3, 3, 1).p('k', 24, 4);
  for (const cx of [5, 10, 16, 21]) {
    P.e('k', cx, 14, 2, 2).e('g', cx, 14, 1, 1);
    if (ph === 0) P.p('l', cx, 14);
    else if (ph === 1) P.p('l', cx - 1, 14).p('l', cx + 1, 14);
    else P.p('l', cx, 13).p('l', cx, 15);
  }
  P.ol();
  if (fl) P.p('w', 25, 4).p('y', 25, 3).p('y', 25, 5);
  return P.rows();
};

/**
 * Lobo 24x28: el héroe. Hombre lobo bípedo y encorvado visto de lado: lomo con cresta, cabeza de hocico largo con
 * colmillos, arnés y hombrera del equipo, brazos largos con garras. `l`/`r`: paso de cada pierna (0 a 2 px) y `sw`
 * (0 nada, 1 brazo alzado, 2 zarpazo: tres arcos blancos delante).
 */
const lobo = (l, r, sw) => {
  const P = pg(24, 28);
  const alto = sw >= 1;
  // cola y lomo encorvado: la joroba queda más alta que la cabeza
  P.r('g', 2, 16, 4, 2).p('g', 1, 17).p('b', 0, 18).p('b', 1, 18);
  P.e('b', 8, 8, 4, 3).e('g', 10, 14, 5, 5).e('b', 7, 13, 3, 4);
  P.p('k', 5, 5).p('k', 7, 4).p('k', 9, 4).p('k', 11, 5);
  // pecho claro y arnés cruzado con hombrera del equipo
  P.r('l', 14, 12, 2, 5);
  for (let y = 9; y <= 19; y++) P.r('t', 12 - ((y - 9) >> 2), y, 2, 1).p('d', 14 - ((y - 9) >> 2), y);
  P.r('h', 11, 7, 4, 1).r('t', 10, 8, 5, 2).r('d', 10, 10, 5, 1);
  // taparrabos
  P.r('k', 7, 19, 8, 1).r('d', 7, 20, 8, 2).r('t', 9, 21, 4, 1);
  // cabeza: cuello, cráneo, orejas, hocico largo, ojo y colmillos
  P.r('g', 14, 7, 3, 4).e('g', 18, 7, 3, 3);
  P.p('k', 16, 2).r('g', 16, 3, 2, 2).p('k', 19, 2).r('g', 19, 3, 2, 2);
  P.r('g', 20, 6, 3, 2).r('l', 20, 8, 4, 2).p('k', 23, 6).p('k', 23, 7);
  P.p('y', 19, 6).p('r', 20, 6);
  P.p('w', 21, 10).p('w', 23, 10).r('b', 20, 10, 3, 1);
  // piernas digitigradas: muslo, tobillo hacia atrás y pie con garras
  const pierna = (x, paso) => {
    P.r('g', x, 22, 4, 2)
      .r('b', x - 1, 24, 2, 2)
      .r('g', x + 1 + paso, 24, 2, 2);
    P.r('k', x - 1 + paso, 26, 5, 1).p('w', x + 4 + paso, 26);
  };
  pierna(6, l);
  pierna(11, r);
  // brazos largos: el cercano baja hacia delante con garras; con `sw` se alza
  const dy = alto ? -7 : 0;
  P.r('g', 13, 11 + dy, 2, 3)
    .r('g', 15, 13 + dy, 2, 3)
    .r('g', 17, 14 + dy, 2, 2)
    .r('b', 18, 16 + dy, 2, 2);
  P.p('w', 20, 16 + dy)
    .p('w', 21, 17 + dy)
    .p('w', 20, 18 + dy);
  P.ol();
  if (sw === 2) {
    // zarpazo: tres arcos delante del brazo alzado
    for (const [x, y] of [
      [20, 7],
      [21, 8],
      [21, 9],
      [22, 10],
      [21, 11],
      [22, 12],
      [20, 13],
      [21, 14],
    ])
      P.p(y % 2 ? 'w' : 'y', x, y);
  }
  return P.rows();
};

/** Caídas del lobo: derribado hacia delante, de lado y tendido (24x28, el cuerpo en la mitad de abajo). */
const caidaLobo = [
  pg(24, 28)
    .e('g', 10, 18, 7, 5)
    .r('t', 9, 14, 3, 8)
    .e('g', 18, 14, 3, 3)
    .r('l', 20, 14, 3, 2)
    .r('g', 8, 23, 3, 3)
    .r('k', 7, 26, 4, 1)
    .p('y', 18, 13)
    .ol()
    .rows(),
  pg(24, 28)
    .e('g', 10, 21, 8, 4)
    .r('t', 9, 18, 3, 6)
    .e('g', 19, 20, 3, 2)
    .r('l', 21, 20, 2, 2)
    .r('g', 2, 21, 4, 2)
    .r('k', 0, 24, 5, 1)
    .p('w', 22, 23)
    .ol()
    .rows(),
  pg(24, 28)
    .e('g', 10, 24, 9, 3)
    .r('t', 9, 22, 3, 5)
    .r('g', 19, 24, 3, 2)
    .r('l', 21, 24, 2, 2)
    .r('g', 1, 24, 4, 2)
    .r('b', 3, 22, 1, 1)
    .p('w', 22, 26)
    .ol()
    .rows(),
];

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
    francotirador: {
      w: 15,
      h: 13,
      ax: 3,
      ay: 11,
      mz: [14, 6],
      anims: {
        idle: [francotirador(3, 3)],
        walk: [francotirador(3, 2), francotirador(3, 3), francotirador(2, 3), francotirador(3, 3)],
        shoot: [francotirador(3, 3), francotirador(3, 3, 1)],
        death: [caidaLarga(muerte[0]), caidaLarga(muerte[1]), caidaLarga(muerte[2], true)],
      },
    },
    blindado: {
      w: 26,
      h: 18,
      ax: 12,
      ay: 16,
      mz: [25, 4],
      anims: {
        idle: [blindado(0)],
        walk: [blindado(0), blindado(1), blindado(2)],
        shoot: [blindado(0), blindado(0, 1)],
        wreck: [quemar(blindado(0))],
      },
    },
    lanzacohetes: {
      w: 32,
      h: 22,
      ax: 14,
      ay: 20,
      mz: [26, 4],
      anims: {
        idle: [orugas(LCP, 0)],
        walk: [orugas(LCP, 0), orugas(LCP, 1), orugas(LCP, 2)],
        shoot: [orugas(LCP, 0), orugas({ ...LCP, fl: 1 }, 0)],
        wreck: [quemar(orugas(LCP, 0))],
      },
    },
    lobo: {
      w: 24,
      h: 28,
      ax: 10,
      ay: 26,
      mz: [22, 14],
      anims: {
        idle: [lobo(0, 0, 0)],
        walk: [lobo(0, 2, 0), lobo(1, 1, 0), lobo(2, 0, 0), lobo(1, 1, 0)],
        shoot: [lobo(0, 0, 1), lobo(0, 0, 2)],
        death: caidaLobo,
      },
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

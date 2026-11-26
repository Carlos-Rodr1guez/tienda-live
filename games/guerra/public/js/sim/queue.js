// Colas de refuerzos (diseño D19, §7.2 pasos 1 y 2; CB-7, CB-8, CB-10, CB-14). TODO entra por la cola de su lado: los
// regalos, la unión, los likes, el follow, el share y los refuerzos base. Cola de tierra FIFO por orden de llegada, con
// 8 apariciones por segundo por lado y un tope de unidades vivas; la cabeza sale por la PUERTA del lado en cuanto hay
// ficha y cupo, sin esperar a nadie (D30). Cola de aire aparte (≤ 5, ≤ 1 avión vivo por lado, ≥ 8 s entre lanzamientos).
// Nada se pierde: un avión sin lugar se vuelve tanques del mismo valor; lo que no entra en la cola llena va al cubo de
// desborde y el valor se conserva. Sin azar: la ranura
// de la puerta (la primera libre desde n mod 5, con el paso del tipo) y la altura de destino son funciones del
// contador de salidas del lado. La espera por una ranura libre está acotada (`movement.door.maxWait`).

import { freeOrder, likeOrders, socialOrder } from '@tienda/kit/sim/router.js';
import { SIM_HZ } from './defaults.js';
import { addPaid } from './credit.js';
import { requestStrike } from './energy.js';
import { canLaunchPlane, launchPlane } from './plane.js';
import { CRUCE_X, CRUCE_Y, doorOffsets } from './field.js';
import { addUnit, targetLane } from './units.js';

/** Segundos de reloj de juego entre dos avisos de cola llena. */
const WARN_EVERY_STEPS = 10 * SIM_HZ;

/** Holgura (px) del radio de consulta de la puerta: las celdas de la grilla son del inicio del paso anterior. */
const SLOT_MARGIN = 3;

/** Colas de los dos lados: fichas de aparición llenas al empezar (la primera unidad sale sin esperar). */
export const createQueues = () =>
  [0, 1].map(() => ({ ground: [], air: [], groundUnits: 0, airUnits: 0, tokens: SIM_HZ, warnStep: -1e9, wait: 0 }));

/**
 * Acepta una orden del router (`{kind, team, owner, count, unitValue, source}`; `team` 1..2). En `matchup` no hace
 * nada (no crea ni encola unidades). Devuelve cuántas unidades quedaron encoladas.
 * @param {any} world
 * @param {{kind:string, team:number, owner:string|null, count:number, unitValue:number, source:string}} order
 */
export function submitOrder(world, order) {
  if (world.phase === 'matchup') return 0;
  const side = order.team - 1;
  if (side !== 0 && side !== 1) return 0;
  const count = Math.floor(order.count);
  if (!(count >= 1)) return 0;
  const q = world.queues[side];
  const lim = world.cfg.limits;
  const air = order.kind === 'avion';
  let room = air ? lim.maxQueuedPlanes - q.airUnits : lim.maxQueuedUnits - q.groundUnits;
  // v2.8: el héroe lobo, como mucho `maxWolvesPerTeam` vivos o en cola por lado; el resto se vuelve pesados del mismo valor
  const heroe = order.kind === 'lobo';
  if (heroe) room = Math.min(room, Math.max(0, lim.maxWolvesPerTeam - lobosDelLado(world, side)));
  const fits = Math.max(0, Math.min(count, room));
  addPaid(world, side, count * order.unitValue);
  let convertidas = 0;
  if (fits < count) {
    const exceso = count - fits;
    // v2.8: un avión que llega con la cola de aire llena NO se pierde: su valor sale como tanques (tramo tanque)
    if (air && order.unitValue > 0) convertidas = convertirAviones(world, side, order, exceso);
    else if (heroe && order.unitValue > 0) convertidas = convertirLobos(world, side, order, exceso);
    else world.credit.overflow[side] += exceso * order.unitValue;
    world.queueStats.overflow++;
    if (world.step - q.warnStep >= WARN_EVERY_STEPS) {
      q.warnStep = world.step;
      world.emit({ type: 'warn', code: 'queueFull', side });
    }
  }
  if (fits > 0) {
    const o = {
      kind: order.kind,
      owner: order.owner ?? null,
      remaining: fits,
      unitValue: order.unitValue,
      source: order.source,
    };
    if (air) {
      q.air.push(o);
      q.airUnits += fits;
    } else {
      q.ground.push(o);
      q.groundUnits += fits;
    }
  }
  return fits + convertidas;
}

/**
 * Aviones que no caben en la cola de aire: cada uno se convierte en `floor(valor / c del tanque)` tanques (mínimo 1) que
 * conservan el valor (`valor / n` cada uno; 500 monedas → 5 tanques) y van a la cola de tierra con el mismo dueño. Lo que
 * tampoco cabe en la de tierra va al desborde, así el libro sigue cuadrando. Avisa con `planeConverted`.
 * @returns {number} tanques encolados
 */
function convertirAviones(world, side, order, aviones) {
  const caben = convertirA(world, side, order, aviones, 'tanque');
  world.emit({ type: 'planeConverted', side, planes: aviones, tanks: caben, value: aviones * order.unitValue });
  return caben;
}

/**
 * v2.8: lobos que no caben (ya hay uno vivo o en cola en el lado): cada uno se vuelve `floor(valor / c del pesado)` pesados
 * (mínimo 1; 3 000 monedas → 3) del mismo dueño y valor. Avisa a la vista con `loboConverted` (F2: «el lobo ya está en
 * campo»).
 * @returns {number} pesados encolados
 */
function convertirLobos(world, side, order, lobos) {
  const caben = convertirA(world, side, order, lobos, 'pesado');
  world.emit({
    type: 'loboConverted',
    side,
    owner: order.owner ?? null,
    lobos,
    pesados: caben,
    value: lobos * order.unitValue,
  });
  return caben;
}

/** Cuenta los lobos de un lado, vivos y en cola de tierra. */
function lobosDelLado(world, side) {
  let n = 0;
  for (const u of world.units) if (u.side === side && u.alive && u.kind === 'lobo') n++;
  for (const o of world.queues[side].ground) if (o.kind === 'lobo') n += o.remaining;
  return n;
}

/**
 * Convierte `cuantas` unidades de la orden en unidades de tierra del tipo `destino` que conservan el valor: cada una da
 * `floor(valor / c del destino)` (mínimo 1) unidades de `valor / n`. Van a la cola de tierra con el mismo dueño; lo que no
 * cabe en ella va al desborde, así el libro sigue cuadrando.
 * @returns {number} unidades encoladas
 */
function convertirA(world, side, order, cuantas, destino) {
  const lim = world.cfg.limits;
  const q = world.queues[side];
  const n = Math.max(1, Math.floor(order.unitValue / world.cfg.units[destino].c));
  const valor = order.unitValue / n;
  const total = cuantas * n;
  const caben = Math.max(0, Math.min(total, lim.maxQueuedUnits - q.groundUnits));
  if (caben > 0) {
    q.ground.push({
      kind: destino,
      owner: order.owner ?? null,
      remaining: caben,
      unitValue: valor,
      source: order.source,
    });
    q.groundUnits += caben;
  }
  world.credit.overflow[side] += (total - caben) * valor;
  return caben;
}

/**
 * Un regalo ya enrutado: acredita monedas y XP de LIVE de inmediato (también en pausa y en `matchup`) y encola sus
 * órdenes. En `matchup` solo muestra el agradecimiento.
 * @param {any} world
 * @param {{owner:string|null, coins:number, orders:any[]}} g
 */
export function submitGift(world, g) {
  if (g.owner && g.coins > 0) world.registry?.addCoins(g.owner, g.coins, world.time);
  if (world.phase === 'matchup') {
    world.emit({ type: 'thanks', owner: g.owner, coins: g.coins });
    return 0;
  }
  let n = 0;
  for (const o of g.orders) n += submitOrder(world, o);
  return n;
}

/** Likes de un usuario con equipo: cada `perReinforcement` da un refuerzo de valor 0 (dueño "Likes"). */
export function submitLikes(world, team, count) {
  const refs = world.counters.addLikes(team, count);
  const orders = likeOrders({ likes: world.cfg.social.likes }, team, refs);
  for (const o of orders) submitOrder(world, o);
  return orders.length;
}

/** Follow o share de un usuario con equipo. */
export function submitSocial(world, type, team, owner) {
  const o = socialOrder({ follow: world.cfg.social.follow, share: world.cfg.social.share }, type, team, owner);
  return o ? submitOrder(world, o) : 0;
}

const keyOf = (evt) => String(evt?.userId || evt?.uniqueId || evt?.nickname || 'anon');

/**
 * Un comentario: pide equipo (la unión da 1 soldado gratis por usuario y ronda; el registro decide) y carga la barra
 * de energía de quien ya tiene equipo (una carga cada `userCooldown`, solo en batalla).
 * @returns {{join: any, strike: boolean}}
 */
export function submitChat(world, evt) {
  const reg = world.registry;
  if (!reg) return { join: null, strike: false };
  const join = reg.joinFromChat(evt, world.time, world.round);
  if (join !== null && join.freeUnit) submitOrder(world, freeOrder('soldado', join.team, join.key, 1, 'join'));
  const u = reg.get(keyOf(evt));
  let strike = false;
  if (u && u.team && world.counters.chargeEnergy(u.team, u.key, world.time, world.phase === 'battle')) {
    requestStrike(world, u.team - 1);
    strike = true;
  }
  return { join, strike };
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 1: refuerzos base

/** Refuerzos base: desde t = `start` y cada `interval` s del reloj de la ronda, la misma orden para los dos lados. */
export function stepBaseline(world) {
  if (world.phase !== 'battle') return;
  const b = world.cfg.baseline;
  const t = world.step - world.roundStart;
  const start = Math.round(b.start * SIM_HZ);
  const every = Math.round(b.interval * SIM_HZ);
  if (t < start || (t - start) % every !== 0) return;
  for (const team of [1, 2]) submitOrder(world, freeOrder(b.unit, team, null, b.count, 'baseline'));
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 2: despliegue desde las colas

function aliveGround(world, side) {
  let n = 0;
  for (const u of world.units) if (u.side === side) n++;
  return n;
}

// Búsqueda de ranura libre (estado del módulo: sin asignaciones por paso)
let libreX = 0;
let libreY = 0;
let libreSp = 0;
let libreUmbral = 0;
let libreOcupada = false;

let libreYg = 0;

function chequear(p) {
  if (!p.alive) return;
  const dx = p.x - libreX;
  const dy = p.y - libreY;
  const par = (libreSp + p.stats.spacing) / 2;
  const lim = libreUmbral * par;
  if (dx * dx + dy * dy < lim * lim) libreOcupada = true;
  // sin cruce: cerca de la puerta, quien sale no puede quedar del lado contrario de su yg respecto de un amigo que
  // sigue cerca (los dos se cruzarían en el tramo leg y la separación los dejaría trabados lado a lado)
  else if (
    dx < CRUCE_X * par &&
    dx > -CRUCE_X * par &&
    dy < CRUCE_Y * par &&
    dy > -CRUCE_Y * par &&
    dy * (libreYg - p.yg) > 0
  )
    libreOcupada = true;
}

const ORDEN = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Ranura de salida del tipo. Candidatas: las cinco en orden rotativo desde `n mod |ranuras|`, reordenadas (orden
 * estable, así el empate lo resuelve la rotación) por cercanía al desplazamiento que le corresponde a su altura de
 * destino `yg`: quien va hacia arriba sale por las ranuras de arriba y quien va hacia abajo por las de abajo, así
 * dos salidas seguidas no se cruzan en el tramo `leg` (cruzarse las dejaba trabadas, la separación contra el rumbo).
 * Devuelve la `y` de la primera donde ningún amigo vivo está a menos de `freeFactor` × el espaciado del par (el
 * criterio de par mixto de spacing.js), o `null` si ninguna lo está. Usa la grilla propia (reconstruida al final del
 * paso anterior; las celdas quedan a lo sumo un paso atrasadas, de ahí el margen en el radio): determinista, sin azar.
 */
function ranuraLibre(world, side, door, stats, n, yg) {
  const offs = doorOffsets(door, stats.spacing);
  const k = offs.length;
  const grid = world.grids[side];
  const [g0, g1] = world.field.ground;
  const half = Math.max(g1 - door.y, door.y - g0);
  const meta = ((yg - door.y) / half) * Math.max(...offs.map(Math.abs));
  // orden de prueba: inserción estable por |desplazamiento − meta| sobre la lista rotativa
  for (let i = 0; i < k; i++) {
    const idx = (n + i) % k;
    const dist = Math.abs(offs[idx] - meta);
    let j = i;
    while (j > 0 && Math.abs(offs[ORDEN[j - 1]] - meta) > dist) {
      ORDEN[j] = ORDEN[j - 1];
      j--;
    }
    ORDEN[j] = idx;
  }
  libreSp = stats.spacing;
  libreUmbral = door.freeFactor;
  libreYg = yg;
  const radio = Math.max(door.freeFactor, CRUCE_X, CRUCE_Y) * ((stats.spacing + world.maxSpacing) / 2) + SLOT_MARGIN;
  for (let i = 0; i < k; i++) {
    const y = door.y + offs[ORDEN[i]];
    libreX = door.x;
    libreY = y;
    libreOcupada = false;
    grid.forEachInRadius(door.x, y, radio, chequear);
    if (!libreOcupada) return y;
  }
  return null;
}

let holguraMin = 0;

function medirHolgura(p) {
  if (!p.alive) return;
  const dx = p.x - libreX;
  const dy = p.y - libreY;
  const r = Math.sqrt(dx * dx + dy * dy) / (libreUmbral * ((libreSp + p.stats.spacing) / 2));
  if (r < holguraMin) holguraMin = r;
}

/**
 * Seguro de la espera acotada: la ranura con MÁS holgura, o sea la de mayor distancia mínima a un amigo vivo dividida
 * por `freeFactor` × el espaciado del par. Recorre las ranuras en el mismo orden de prueba que `ranuraLibre` (queda en
 * ORDEN) y solo reemplaza con una estrictamente mejor: el empate lo gana la primera. Una ranura sin amigos en el radio
 * vale Infinity. Debe llamarse justo después de `ranuraLibre` (reutiliza su orden y sus parámetros). Sin azar.
 */
function ranuraMasHolgada(world, side, door, stats) {
  const offs = doorOffsets(door, stats.spacing);
  const grid = world.grids[side];
  const radio = Math.max(door.freeFactor, CRUCE_X, CRUCE_Y) * ((stats.spacing + world.maxSpacing) / 2) + SLOT_MARGIN;
  let mejor = -1;
  let ymejor = door.y;
  for (let i = 0; i < offs.length; i++) {
    const y = door.y + offs[ORDEN[i]];
    libreX = door.x;
    libreY = y;
    holguraMin = Infinity;
    grid.forEachInRadius(door.x, y, radio, medirHolgura);
    if (holguraMin > mejor) {
      mejor = holguraMin;
      ymejor = y;
    }
  }
  return ymejor;
}

/**
 * Una salida por ficha: la unidad nace en la puerta del lado, en la primera ranura libre de su tipo a partir de
 * `n mod |ranuras|` (n = salidas del lado en la ronda), con la altura de destino `yg` que le toca a ese n. Si
 * ninguna ranura está libre la cabeza ESPERA: no se consume la ficha ni el contador y el FIFO se conserva. La espera
 * (`q.wait`, en pasos, entra al hash) está acotada: al llegar a `maxWait × SIM_HZ` la cabeza sale por la ranura con más
 * holgura y se cuenta en `queueStats.forced`. `queueStats.waitMax` guarda la mayor espera vista al salir (pasos).
 */
function deployGround(world, side, q) {
  const o = q.ground[0];
  if (o === undefined) {
    q.wait = 0;
    return;
  }
  if (q.tokens < SIM_HZ) return;
  if (aliveGround(world, side) >= world.cfg.limits.maxAlivePerSide) return;
  const door = world.field.sides[side].door;
  const n = world.doorN[side];
  const { yg, off } = targetLane(world, n);
  let y = ranuraLibre(world, side, door, world.stats[o.kind], n, yg);
  if (y === null) {
    q.wait++;
    if (q.wait < Math.round(world.cfg.movement.door.maxWait * SIM_HZ)) return;
    y = ranuraMasHolgada(world, side, door, world.stats[o.kind]);
    world.queueStats.forced++;
  }
  if (q.wait > world.queueStats.waitMax) world.queueStats.waitMax = q.wait;
  q.wait = 0;
  world.doorN[side]++;
  const x = door.x;
  const u = addUnit(world, side, o.kind, x, y, { owner: o.owner, value: o.unitValue, yg, yoff: off });
  q.tokens -= SIM_HZ;
  o.remaining--;
  q.groundUnits--;
  if (o.remaining === 0) q.ground.shift();
  world.emit({ type: 'spawn', id: u.id, side, kind: o.kind, x, y });
}

function deployAir(world, side, q) {
  const o = q.air[0];
  if (o === undefined || !canLaunchPlane(world, side).ok) return;
  launchPlane(world, side, o.owner, o.unitValue);
  o.remaining--;
  q.airUnits--;
  if (o.remaining === 0) q.air.shift();
}

/** Paso 2: una unidad por ficha y por lado (8 por segundo), en orden estricto de llegada; y la cola de aire. */
export function deployStep(world) {
  const rate = world.cfg.limits.spawnsPerSecond;
  for (let side = 0; side < 2; side++) {
    const q = world.queues[side];
    q.tokens += rate;
    deployGround(world, side, q);
    deployAir(world, side, q);
    // capacidad 1 ficha: lo que sobra de una ficha entera se pierde, pero el resto fraccionario se conserva
    q.tokens = Math.min(SIM_HZ, q.tokens);
  }
}

// Regenera `public/js/data/golden.js`: el log fijo del hash dorado (CB-13) y el hash que le da el sim en Node.
// Solo se corre a propósito: `npm run golden -w batalla-paises`. Si cambiaron las reglas o el log sin regenerar,
// `test/determinism.test.js` falla, y eso es lo que se busca.
//
// El log es un PARTIDO completo (lote 4d, tarea 4d.7): elegir el par, ~60 uniones, regalos de todos los tipos (también
// avión), likes, follow, share, comentarios que cargan la energía, golpes de energía, una pausa en medio, dos rondas
// y el principio de la siguiente espera. El azar de esta herramienta (semilla fija) solo arma el log; el log queda
// escrito como datos y el sim no recibe azar. Los números del log no se editan a mano: se regenera con este archivo.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mulberry32, seedFrom } from '@tienda/kit/sim/rng.js';
import { PAISES } from '../public/js/data/paises.js';
import { hashMatch } from '../public/js/sim/hash.js';
import { replayMatch } from '../public/js/sim/replay.js';

const VERSION = 5; // v2.8b: cuatro tipos nuevos (francotirador, blindado, lanzacohetes y lobo) y tabla de precios por monedas
const STEPS = 10400;
/**
 * Rondas de 150 s con intro y resultados de 2 s. Las bases y las torretas son más frágiles que las de producción para
 * que las rondas lleguen a destruir y el hash toque el cubo de la base, las torretas y el desempate; el sim es el mismo.
 */
const GAME = { round: { seconds: 150, introSeconds: 2, resultsSeconds: 2 }, hq: { hp: 8000 }, turret: { hp: 600 } };

const rnd = mulberry32(seedFrom('golden-batalla-4d-v2'));
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];

const log = [];
const add = (step, kind, payload) => log.push({ step, kind, payload });
const cmd = (step, type, extra = {}) => add(step, 'cmd', { type, ...extra });

// Valor por unidad (el mismo que el router da con la config por defecto): lo pagado es count × unitValue.
// [tipo, valor, peso en %, tope por orden]; los pesos suman 100. El lobo (héroe) sale en el 4 %: con uno vivo, el siguiente se
// vuelve pesados y así el log ejercita también esa conversión.
const KINDS = [
  ['soldado', 1, 38, 20],
  ['francotirador', 5, 12, 4],
  ['jeep', 10, 14, 6],
  ['blindado', 30, 8, 3],
  ['tanque', 100, 10, 3],
  ['lanzacohetes', 300, 5, 2],
  ['pesado', 1000, 4, 1],
  ['avion', 500, 5, 2],
  ['lobo', 3000, 4, 1],
];
const pickKind = () => {
  let r = int(1, 100);
  for (const k of KINDS) {
    if ((r -= k[2]) <= 0) return k;
  }
  return KINDS[0];
};

// 60 usuarios: los pares van a la izquierda (PE) y los impares a la derecha (MX)
const USERS = Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, nick: `Hincha ${i}`, side: i % 2 }));
const WORD = ['peru', 'mexico'];
const chatEvt = (u, text) => ({ type: 'chat', evt: { type: 'chat', userId: u.id, nickname: u.nick, text } });

function audienceEvent(step) {
  const u = pick(USERS);
  const r = int(1, 100);
  if (r <= 45) {
    const [kind, unitValue, , maxCount] = pickKind();
    const count = int(1, maxCount);
    add(step, 'evt', {
      type: 'gift',
      owner: u.id,
      coins: count * unitValue,
      orders: [{ kind, team: u.side + 1, owner: u.id, count, unitValue, source: 'gift' }],
    });
  } else if (r <= 57) {
    add(step, 'evt', { type: 'likes', team: u.side + 1, count: int(20, 400) });
  } else if (r <= 63) {
    add(step, 'evt', { type: 'follow', team: u.side + 1, owner: u.id });
  } else if (r <= 66) {
    add(step, 'evt', { type: 'share', team: u.side + 1, owner: u.id });
  } else if (r <= 68) {
    add(step, 'evt', { type: 'strike', side: u.side });
  } else if (r <= 70) {
    // alguien pide el otro país: cambio de bando si ya pasó el enfriamiento
    add(step, 'evt', chatEvt(u, WORD[1 - u.side]));
  } else {
    add(step, 'evt', chatEvt(u, 'vamos'));
  }
}

// Sala: el par y las uniones, una por tick
cmd(0, 'pickPair', { a: 'PE', b: 'MX' });
USERS.forEach((u, i) => add(1 + i, 'evt', chatEvt(u, WORD[u.side])));
cmd(70, 'startMatch');

// Ronda 1: la batalla empieza en el tick 130 (la intro dura 2 s). Pausa del 1600 al 1700, con eventos en medio.
for (let t = 140; t < 4600; t += int(15, 28)) {
  if (t >= 1600 && t < 1700) continue;
  audienceEvent(t);
}
cmd(1600, 'pause', { by: 'manual' });
for (let t = 1610; t < 1700; t += int(8, 14)) audienceEvent(t);
cmd(1700, 'resume');

// Pantalla de resultados y espera: llegan regalos para la ronda siguiente
for (let t = 4900; t < 5100; t += int(10, 20)) audienceEvent(t);
cmd(5200, 'startRound');

// Ronda 2: la intro termina en el tick 5260
for (let t = 5270; t < 9900; t += int(15, 28)) audienceEvent(t);

log.sort((a, b) => a.step - b.step); // estable: los comandos del mismo tick conservan su orden

const m = replayMatch(log, { steps: STEPS, paises: PAISES, game: GAME });
if (m.results.length < 2) throw new Error(`el log debe jugar dos rondas y jugó ${m.results.length}`);
const hash = hashMatch(m);

const salida = [
  '// GENERADO por `npm run golden -w batalla-paises` (tools/golden.mjs). No se edita a mano.',
  '// Log fijo del hash dorado (CB-13): el test `determinism` lo repite en Node y compara el hash. Solo datos.',
  '// Es un partido completo: par, uniones, regalos de todos los tipos, avión, energía, likes, una pausa y dos rondas.',
  '',
  'export const GOLDEN = {',
  `  version: ${VERSION},`,
  `  steps: ${STEPS},`,
  `  game: ${JSON.stringify(GAME)},`,
  `  hash: '${hash}',`,
  '  log: [',
  ...log.map((e) => `    ${JSON.stringify(e)},`),
  '  ],',
  '};',
  '',
].join('\n');

const destino = fileURLToPath(new URL('../public/js/data/golden.js', import.meta.url));
fs.writeFileSync(destino, salida);
const rondas = m.results.map((r) => `${r.winner === 0 ? 'izq' : 'der'}:${r.reason}@${r.step}`).join(', ');
console.log(
  `golden.js escrito: ${log.length} eventos, ${STEPS} pasos, hash ${hash}; estado ${m.state}, rondas [${rondas}]`,
);

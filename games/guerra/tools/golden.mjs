// Regenera `public/js/data/golden.js`: el log fijo del hash dorado (CB-13) y el hash que le da el sim en Node.
// Solo se corre a propósito: `npm run golden -w batalla-paises`. Si cambiaron las reglas o el log sin regenerar,
// `test/determinism.test.js` falla, y eso es lo que se busca.
//
// PROVISORIO (lote 4b, Duda 3): este log es chico. El definitivo, de ~500 eventos con todos los regalos, avión,
// energía, likes, uniones, una pausa y dos rondas, se escribe en el lote 4d (tarea 4d.7).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashWorld } from '../public/js/sim/hash.js';
import { replayLog } from '../public/js/sim/replay.js';

const STEPS = 1500; // 50 s de reloj de juego

const squad = (step, side, kind, corridor, lane) => ({
  step,
  kind: 'cmd',
  payload: { type: 'seedSquad', side, kind, corridor, lane },
});
const plane = (step, side) => ({ step, kind: 'cmd', payload: { type: 'launchPlane', side } });

// Grupos de los cuatro tipos por lado en los tres corredores, aviones de los dos lados y refuerzos a mitad de
// combate. Sin azar: los números están escritos a mano.
const LOG = [
  squad(0, 0, 'soldado', 1, 0),
  squad(0, 1, 'soldado', 1, 0),
  squad(0, 0, 'soldado', 0, 0),
  squad(0, 1, 'soldado', 2, 0),
  squad(20, 0, 'jeep', 0, 1),
  squad(20, 1, 'jeep', 2, 1),
  squad(40, 0, 'jeep', 2, 1),
  squad(40, 1, 'jeep', 0, 1),
  squad(60, 0, 'tanque', 2, 2),
  squad(60, 1, 'tanque', 0, 2),
  plane(120, 0),
  plane(200, 1),
  squad(300, 0, 'pesado', 1, 2),
  squad(300, 1, 'pesado', 1, 2),
  plane(330, 0),
  squad(400, 0, 'soldado', 2, 0),
  squad(400, 1, 'soldado', 0, 0),
  plane(520, 1),
  squad(600, 0, 'tanque', 1, 2),
  squad(600, 1, 'tanque', 1, 2),
];

const w = replayLog(LOG, { steps: STEPS });
const golden = { version: 1, steps: STEPS, hash: hashWorld(w), log: LOG };

const salida = [
  '// GENERADO por `npm run golden -w batalla-paises` (tools/golden.mjs). No se edita a mano.',
  '// Log fijo del hash dorado (CB-13): el test `determinism` lo repite en Node y compara el hash. Solo datos.',
  '// PROVISORIO (lote 4b, hash regenerado en 4c): el log definitivo de ~500 eventos se regenera en 4d.7.',
  '',
  'export const GOLDEN = {',
  `  version: ${golden.version},`,
  `  steps: ${golden.steps},`,
  `  hash: '${golden.hash}',`,
  '  log: [',
  ...golden.log.map((e) => `    ${JSON.stringify(e)},`),
  '  ],',
  '};',
  '',
].join('\n');

const destino = fileURLToPath(new URL('../public/js/data/golden.js', import.meta.url));
fs.writeFileSync(destino, salida);
console.log(`golden.js escrito: ${golden.log.length} eventos, ${STEPS} pasos, hash ${golden.hash}`);

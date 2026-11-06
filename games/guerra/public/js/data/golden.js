// GENERADO por `npm run golden -w batalla-paises` (tools/golden.mjs). No se edita a mano.
// Log fijo del hash dorado (CB-13): el test `determinism` lo repite en Node y compara el hash. Solo datos.
// PROVISORIO (lote 4b): el log definitivo de ~500 eventos se regenera en 4d.7.

export const GOLDEN = {
  version: 1,
  steps: 1500,
  hash: '92dad388',
  log: [
    { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'soldado', corridor: 1, lane: 0 } },
    { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'soldado', corridor: 1, lane: 0 } },
    { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'soldado', corridor: 0, lane: 0 } },
    { step: 0, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'soldado', corridor: 2, lane: 0 } },
    { step: 20, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'jeep', corridor: 0, lane: 1 } },
    { step: 20, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'jeep', corridor: 2, lane: 1 } },
    { step: 40, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'jeep', corridor: 2, lane: 1 } },
    { step: 40, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'jeep', corridor: 0, lane: 1 } },
    { step: 60, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'tanque', corridor: 2, lane: 2 } },
    { step: 60, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'tanque', corridor: 0, lane: 2 } },
    { step: 120, kind: 'cmd', payload: { type: 'launchPlane', side: 0 } },
    { step: 200, kind: 'cmd', payload: { type: 'launchPlane', side: 1 } },
    { step: 300, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'pesado', corridor: 1, lane: 2 } },
    { step: 300, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'pesado', corridor: 1, lane: 2 } },
    { step: 330, kind: 'cmd', payload: { type: 'launchPlane', side: 0 } },
    { step: 400, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'soldado', corridor: 2, lane: 0 } },
    { step: 400, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'soldado', corridor: 0, lane: 0 } },
    { step: 520, kind: 'cmd', payload: { type: 'launchPlane', side: 1 } },
    { step: 600, kind: 'cmd', payload: { type: 'seedSquad', side: 0, kind: 'tanque', corridor: 1, lane: 2 } },
    { step: 600, kind: 'cmd', payload: { type: 'seedSquad', side: 1, kind: 'tanque', corridor: 1, lane: 2 } },
  ],
};

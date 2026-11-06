// Hash de estado de reglas (diseño D14): FNV-1a de 32 bits sobre el estado ordenado por id, con los números
// flotantes por sus bits (IEEE-754, big-endian). Lo usan el hash dorado, la repetición y F2. No depende del
// motor: solo enteros de 32 bits y `Math.imul`.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const view = new DataView(new ArrayBuffer(8));

function byte(h, b) {
  return Math.imul(h ^ b, FNV_PRIME) >>> 0;
}
function int(h, n) {
  const v = n | 0;
  h = byte(h, v & 255);
  h = byte(h, (v >>> 8) & 255);
  h = byte(h, (v >>> 16) & 255);
  return byte(h, (v >>> 24) & 255);
}
function num(h, x) {
  view.setFloat64(0, x, false);
  for (let i = 0; i < 8; i++) h = byte(h, view.getUint8(i));
  return h;
}
function str(h, s) {
  h = int(h, s.length);
  for (let i = 0; i < s.length; i++) h = int(h, s.charCodeAt(i));
  return h;
}
const flag = (h, b) => byte(h, b ? 1 : 0);

/**
 * Hash del estado de reglas del mundo, en 8 dígitos hexadecimales.
 * @param {any} w mundo (`createWorld`)
 */
export function hashWorld(w) {
  let h = FNV_OFFSET;
  h = int(h, w.step);
  h = int(h, w.nextId);
  h = int(h, w.nextSquadId);
  h = int(h, w.nextHitId);
  h = flag(h, w.over !== null);
  if (w.over !== null) {
    h = int(h, w.over.step);
    h = int(h, w.over.winner === null ? -1 : w.over.winner);
  }
  h = int(h, w.lastLaunch[0]);
  h = int(h, w.lastLaunch[1]);
  for (const t of w.teams) {
    h = num(h, t.structDamage);
    h = num(h, t.energyAsked);
  }
  h = int(h, w.roundStart);
  h = int(h, w.round);
  h = str(h, w.phase);
  h = flag(h, w.paused);
  const c = w.credit;
  for (const v of [c.paid, c.destroyedUser, c.destroyedUnattr, c.retired, c.overflow[0], c.overflow[1]]) h = num(h, v);
  for (const v of [c.teamValue[0], c.teamValue[1], c.teamCoins[0], c.teamCoins[1]]) h = num(h, v);
  for (const q of w.queues) {
    h = num(h, q.tokens);
    h = int(h, q.warnStep);
    for (const list of [q.ground, q.air]) {
      h = int(h, list.length);
      for (const o of list) {
        h = str(h, o.kind);
        h = str(h, o.owner ?? '');
        h = int(h, o.remaining);
        h = num(h, o.unitValue);
      }
    }
  }
  for (const m of w.cmd) {
    h = int(h, m.rebal);
    h = int(h, m.lastConvert);
    h = int(h, m.q);
  }

  h = int(h, w.units.length);
  for (const u of w.units) {
    h = int(h, u.id);
    h = int(h, u.side);
    h = str(h, u.kind);
    h = int(h, u.squad.id);
    h = flag(h, u.alive);
    h = num(h, u.hp);
    h = num(h, u.valueAlive);
    h = flag(h, u.arrived);
    h = str(h, u.owner ?? '');
    h = num(h, u.x);
    h = num(h, u.y);
    h = num(h, u.vx);
    h = num(h, u.vy);
    h = int(h, u.dir);
    h = int(h, u.faceSteps);
    h = int(h, u.cd);
    h = str(h, u.tgtKind);
    h = int(h, u.tgt === null ? 0 : (u.tgt.id ?? u.tgt.k + 1));
  }

  h = int(h, w.squads.length);
  for (const s of w.squads) {
    h = int(h, s.id);
    h = int(h, s.side);
    h = str(h, s.kind);
    h = str(h, s.role);
    h = str(h, s.state);
    h = int(h, s.corridor);
    h = int(h, s.lane);
    h = int(h, s.sector);
    h = int(h, s.post);
    h = int(h, s.firstArrivalStep);
    h = flag(h, s.open);
    h = num(h, s.anchor.x);
    h = num(h, s.anchor.y);
    h = num(h, s.anchor.vx);
    h = num(h, s.anchor.vy);
    h = flag(h, s.locked);
    h = int(h, s.engagedSteps);
    h = int(h, s.idleSteps);
    h = int(h, s.blockedBy);
    h = int(h, s.blockedSteps);
    h = int(h, s.sideStep);
    h = int(h, s.members.length);
    for (const m of s.members) h = int(h, m.id);
  }

  h = int(h, w.hits.length);
  for (const x of w.hits) {
    h = int(h, x.id);
    h = int(h, x.due);
    h = str(h, x.kind);
    h = int(h, x.side);
    h = num(h, x.dmg);
    h = num(h, x.tx);
    h = num(h, x.ty);
  }

  h = int(h, w.bombs.length);
  for (const b of w.bombs) {
    h = int(h, b.id);
    h = int(h, b.side);
    h = int(h, b.dropStep);
    h = int(h, b.impactStep);
    h = num(h, b.tx);
    h = num(h, b.ty);
  }

  h = int(h, w.planes.length);
  for (const p of w.planes) {
    h = int(h, p.id);
    h = int(h, p.side);
    h = num(h, p.x);
    h = num(h, p.y);
    h = num(h, p.vy);
    h = int(h, p.bombsLeft);
    h = num(h, p.value);
    h = flag(h, p.decided);
  }

  for (const b of w.bases) {
    h = num(h, b.hp);
    h = num(h, b.bucket);
    h = flag(h, b.fell);
    for (const t of b.turrets) {
      h = num(h, t.hp);
      h = int(h, t.cd);
      h = flag(h, t.on);
    }
  }
  return h.toString(16).padStart(8, '0');
}

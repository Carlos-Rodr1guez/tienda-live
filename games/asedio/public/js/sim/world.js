// Simulación pura del juego (sin Three.js ni DOM): unidades, combate, base y rondas.
// El render lee el estado y los eventos visuales que se acumulan en `world.fx`.

import { UNITS, TURRET, TEAM, isBig, resolveKind } from './units.js';

export const FIELD = {
  halfW: 12, // ancho jugable: x ∈ [-12, 12]
  zTop: -34, // borde superior, donde entran los invasores
  baseZ: 22, // centro de la base defensora
  baseR: 4.5, // radio de la base
  guardZ: 8, // línea donde esperan los defensores
};

const CELL = 4;
const OFF = 96;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class World {
  constructor(config, rng = Math.random) {
    this.cfg = config;
    this.rng = rng;
    this.nextId = 1;
    this.time = 0;
    this.score = [0, 0];
    this.roundNumber = 0;
    this.queue = [];
    this.fx = [];
    this.spawnBudget = 0;
    this.grid = new Map();
    this.startRound();
  }

  // ---------------------------------------------------------------- rondas

  startRound() {
    this.roundNumber++;
    this.units = [];
    this.projectiles = [];
    this.strikes = [];
    this.byId = new Map();
    this.aliveCount = [0, 0];
    this.state = 'intro';
    this.stateTime = this.cfg.round.introSeconds;
    this.timeLeft = this.cfg.round.seconds;
    this.winner = null;
    this.bossSent = false;
    const hp = this.cfg.round.baseHp;
    this.base = { x: 0, z: FIELD.baseZ, hp, maxHp: hp, lastHit: -99 };
    this.turrets = [-3.3, 3.3].map((x) => ({
      x,
      z: FIELD.baseZ - 1.4,
      cd: 0,
      retarget: 0,
      target: null,
      aimX: 0,
      aimZ: -1,
    }));
    this.nextWave = this.cfg.cpu.firstWaveAt;
    this.stats = { spawned: [0, 0], kills: [0, 0] };
    this.cmd = { strikeReady: 0, dashReady: 0, dashTime: 0, kills: 0 };
    this.commanderRespawnAt = 0;
    this.commander = this.spawnUnit({ kind: 'comandante', team: TEAM.DEF, x: 0, z: FIELD.baseZ - 7.5 });
    this.commander.controlled = true;
    this.fx.push({ t: 'round', state: 'intro', round: this.roundNumber });
  }

  endRound(winner) {
    if (this.state === 'end') return;
    this.state = 'end';
    this.stateTime = this.cfg.round.intermission;
    this.winner = winner;
    this.score[winner]++;
    this.projectiles.length = 0;
    this.strikes.length = 0;
    this.fx.push({ t: 'round', state: 'end', winner, round: this.roundNumber });
    if (winner === TEAM.INV) this.fx.push({ t: 'baseDestroyed', x: this.base.x, z: this.base.z });
  }

  // ---------------------------------------------------------------- spawns

  // req: { kind, team, owner?, cpu?, gift? }. gift marca las unidades que llegaron por un regalo.
  // Devuelve false si la cola está llena.
  queueSpawn(req, count = 1) {
    const kind = resolveKind(req.kind);
    if (!UNITS[kind]) return false;
    const max = this.cfg.limits.maxQueue;
    for (let i = 0; i < count; i++) {
      if (this.queue.length >= max && !isBig(kind)) return false;
      this.queue.push({ kind, team: req.team, owner: req.owner || null, cpu: !!req.cpu, gift: !!req.gift });
    }
    return true;
  }

  processQueue(dt) {
    const lim = this.cfg.limits;
    this.spawnBudget = Math.min(this.spawnBudget + lim.spawnsPerSecond * dt, Math.max(1, lim.spawnsPerSecond));
    while (this.spawnBudget >= 1 && this.queue.length) {
      const idx = this.queue.findIndex((r) => isBig(r.kind) || this.aliveCount[r.team] < lim.maxUnitsPerTeam);
      if (idx < 0) break;
      const req = this.queue.splice(idx, 1)[0];
      this.spawnUnit(req);
      this.spawnBudget -= 1;
    }
  }

  spawnUnit(req) {
    const kind = resolveKind(req.kind);
    const def = UNITS[kind];
    if (!def) return null;
    req = { ...req, kind };
    const r = this.rng;
    const team = req.team;
    let { x, z } = req;
    if (x === undefined || z === undefined) {
      const capital = kind === 'acorazado';
      if (team === TEAM.DEF) {
        x = (r() * 2 - 1) * (capital ? 6 : FIELD.halfW - 2);
        z = capital ? FIELD.baseZ + 2 : FIELD.baseZ - 6.5 - r() * 4;
      } else {
        // los grandes aparecen a la vista; el resto sale del portal
        x = (r() * 2 - 1) * (capital ? 6 : FIELD.halfW - 1);
        z = capital ? FIELD.zTop + 18 : isBig(kind) ? FIELD.zTop + 8 : FIELD.zTop + 1 + r() * 3;
      }
    }
    const u = {
      id: this.nextId++,
      kind: req.kind,
      team,
      def,
      x,
      z,
      y: def.flying ? def.altitude : 0,
      vx: 0,
      vz: 0,
      heading: team === TEAM.DEF ? 0 : Math.PI,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      cd: r() * def.rate,
      retarget: r() * 0.3,
      target: null,
      owner: req.owner || null,
      cpu: !!req.cpu,
      gift: !!req.gift,
      born: this.time,
      lastHit: -99,
      guardX: clamp(x + (r() - 0.5) * 4, -FIELD.halfW + 1, FIELD.halfW - 1),
      guardZ: FIELD.guardZ - r() * 6 - (def.flying ? 6 : 0),
      aimX: 0,
      aimZ: team === TEAM.DEF ? -1 : 1,
      moving: false,
      controlled: false,
    };
    this.units.push(u);
    this.byId.set(u.id, u);
    this.aliveCount[team]++;
    this.stats.spawned[team]++;
    this.fx.push({
      t: 'spawn',
      id: u.id,
      kind: u.kind,
      team,
      x,
      y: u.y,
      z,
      big: isBig(u.kind),
      owner: u.owner,
      cpu: u.cpu,
    });
    return u;
  }

  // ---------------------------------------------------------------- bucle

  update(dt, input = {}) {
    this.time += dt;
    this.stateTime -= dt;

    if (this.state === 'intro' && this.stateTime <= 0) {
      this.state = 'battle';
      this.fx.push({ t: 'round', state: 'battle', round: this.roundNumber });
    } else if (this.state === 'end' && this.stateTime <= 0) {
      this.startRound();
      return;
    }

    if (this.state === 'battle') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.updateCpu();
      if (this.timeLeft <= 0) this.endRound(TEAM.DEF);
    }

    if (this.state === 'end') return; // todo queda congelado en la pantalla de resultados

    this.processQueue(dt);
    this.buildGrid();
    this.updateCommander(dt, input);
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.alive && !u.controlled) this.updateUnit(u, dt);
    }
    this.updateTurrets(dt);
    this.updateProjectiles(dt);
    this.updateStrikes(dt);
    this.cleanup();
  }

  updateCpu() {
    const c = this.cfg.cpu;
    if (!c.enabled) return;
    const elapsed = this.cfg.round.seconds - this.timeLeft;
    if (c.bossAt > 0 && !this.bossSent && elapsed >= c.bossAt) {
      this.bossSent = true;
      this.queueSpawn({ kind: 'coloso', team: TEAM.INV, cpu: true });
    }
    if (elapsed < this.nextWave) return;
    const count = c.baseCount + Math.floor((elapsed / 60) * c.growthPerMinute);
    this.queueSpawn({ kind: 'caza', team: TEAM.INV, cpu: true }, count);
    if (elapsed >= c.tankAfter && this.rng() < 0.4) this.queueSpawn({ kind: 'bombardero', team: TEAM.INV, cpu: true });
    this.nextWave = elapsed + Math.max(c.minInterval, c.interval - elapsed / 60);
  }

  // ------------------------------------------------------------ grilla

  cellKey(x, z) {
    return Math.floor((x + OFF) / CELL) * 1024 + Math.floor((z + OFF) / CELL);
  }

  buildGrid() {
    for (const arr of this.grid.values()) arr.length = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.alive) continue;
      const k = this.cellKey(u.x, u.z);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(u);
    }
  }

  forNear(x, z, r, fn) {
    const x0 = Math.floor((x - r + OFF) / CELL),
      x1 = Math.floor((x + r + OFF) / CELL);
    const z0 = Math.floor((z - r + OFF) / CELL),
      z1 = Math.floor((z + r + OFF) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(cx * 1024 + cz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) fn(arr[i]);
      }
    }
  }

  nearestEnemyAt(x, z, team, radius, hitsAir) {
    let best = null;
    let bestD = radius * radius;
    this.forNear(x, z, radius, (e) => {
      if (e.team === team || !e.alive) return;
      if (e.def.flying && !hitsAir) return;
      const dx = e.x - x,
        dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    });
    return best;
  }

  // ------------------------------------------------------------ unidades

  updateUnit(u, dt) {
    const d = u.def;

    u.retarget -= dt;
    if (u.target && !u.target.alive) u.target = null;
    if (u.retarget <= 0) {
      u.retarget = 0.35 + this.rng() * 0.25;
      u.target = this.nearestEnemyAt(u.x, u.z, u.team, d.aggro, d.hitsAir);
    }

    let tx, tz, stop;
    let goingForBase = false;
    if (u.target) {
      tx = u.target.x;
      tz = u.target.z;
      stop = d.range * 0.85 + u.target.def.radius * 0.5;
    } else if (u.team === TEAM.INV) {
      tx = this.base.x + clamp(u.x, -4, 4) * 0.5;
      tz = this.base.z;
      stop = FIELD.baseR + d.range * 0.8;
      goingForBase = true;
    } else {
      tx = u.guardX;
      tz = u.guardZ;
      stop = 0.6;
    }

    const dx = tx - u.x,
      dz = tz - u.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    let mx = 0,
      mz = 0;
    if (dist > stop) {
      mx = dx / dist;
      mz = dz / dist;
    }

    // separación para que no se amontonen
    let sx = 0,
      sz = 0;
    this.forNear(u.x, u.z, d.radius + 2, (o) => {
      if (o === u || !o.alive || !!o.def.flying !== !!d.flying) return;
      const ox = u.x - o.x,
        oz = u.z - o.z;
      const dd = ox * ox + oz * oz;
      const min = d.radius + o.def.radius;
      if (dd < min * min && dd > 1e-6) {
        const l = Math.sqrt(dd);
        const k = (min - l) / min;
        sx += (ox / l) * k;
        sz += (oz / l) * k;
      }
    });
    mx += sx * 1.5;
    mz += sz * 1.5;

    const ml = Math.hypot(mx, mz);
    if (ml > 0.05) {
      const k = Math.min(1, ml) / ml;
      u.vx = mx * k * d.speed;
      u.vz = mz * k * d.speed;
      u.x += u.vx * dt;
      u.z += u.vz * dt;
      u.moving = dist > stop;
    } else {
      u.vx = u.vz = 0;
      u.moving = false;
    }
    this.confine(u);

    // orientación: mira al objetivo si está peleando, si no hacia donde camina
    let fx = u.vx,
      fz = u.vz;
    if (u.target || (goingForBase && dist <= stop + 0.5)) {
      fx = tx - u.x;
      fz = tz - u.z;
    }
    if (fx * fx + fz * fz > 1e-4) u.heading = lerpAngle(u.heading, Math.atan2(-fx, -fz), Math.min(1, dt * 7));
    if (u.target) {
      u.aimX = u.target.x - u.x;
      u.aimZ = u.target.z - u.z;
    } else if (goingForBase) {
      u.aimX = tx - u.x;
      u.aimZ = tz - u.z;
    }

    u.cd -= dt;
    if (u.cd > 0) return;
    if (u.target) {
      const td = Math.hypot(u.target.x - u.x, u.target.z - u.z);
      if (td <= d.range + u.target.def.radius) {
        this.fire(u, u.target);
        u.cd = d.rate * (0.85 + this.rng() * 0.3);
      }
    } else if (goingForBase && dist <= stop + 0.6) {
      this.fireAtBase(u);
      u.cd = d.rate * (0.85 + this.rng() * 0.3);
    }
  }

  confine(u) {
    const d = u.def;
    u.x = clamp(u.x, -FIELD.halfW, FIELD.halfW);
    u.z = clamp(u.z, FIELD.zTop - 8, FIELD.baseZ + 4);
    if (d.flying) return;
    const bx = u.x - this.base.x,
      bz = u.z - this.base.z;
    const bd = Math.hypot(bx, bz) || 1e-6;
    const min = FIELD.baseR + d.radius;
    if (bd < min) {
      u.x = this.base.x + (bx / bd) * min;
      u.z = this.base.z + (bz / bd) * min;
    }
  }

  muzzleY(u) {
    return u.y + u.def.height * (u.def.muzzle ?? 0.62);
  }

  fire(u, t) {
    const d = u.def;
    u.lastFire = this.time;
    const ty = t.y + t.def.height * 0.5;
    if (d.weapon === 'cannon' || d.weapon === 'rockets') {
      this.launch(u, t.x, ty, t.z, !!t.def.flying);
      return;
    }
    this.damage(t, d.dmg, u);
    if (d.splash > 0) this.splash(t.x, t.z, !!t.def.flying, d.splash, d.dmg * 0.5, u.team, u, t);
    this.shotFx(u, t.x, ty, t.z);
    if (d.multi > 1) {
      let extra = d.multi - 1;
      this.forNear(u.x, u.z, d.range, (e) => {
        if (extra <= 0 || e === t || e.team === u.team || !e.alive) return;
        if (e.def.flying && !d.hitsAir) return;
        if (Math.hypot(e.x - u.x, e.z - u.z) > d.range) return;
        extra--;
        this.damage(e, d.dmg, u);
        this.shotFx(u, e.x, e.y + e.def.height * 0.5, e.z);
      });
    }
  }

  shotFx(u, x2, y2, z2) {
    this.fx.push({
      t: 'shot',
      w: u.def.weapon,
      team: u.team,
      kind: u.kind,
      cmd: u.controlled,
      x1: u.x,
      y1: this.muzzleY(u),
      z1: u.z,
      x2,
      y2,
      z2,
    });
  }

  fireAtBase(u) {
    const d = u.def;
    u.lastFire = this.time;
    const r = this.rng;
    const bx = this.base.x + (r() - 0.5) * 3.5;
    const bz = this.base.z - FIELD.baseR * 0.4 + (r() - 0.5) * 2;
    const by = 1.2 + r() * 2.5;
    if (d.weapon === 'cannon' || d.weapon === 'rockets') {
      this.launch(u, bx, by, bz, false, true);
      return;
    }
    this.damageBase(d.dmg * (d.multi || 1));
    this.shotFx(u, bx, by, bz);
  }

  launch(u, tx, ty, tz, air, atBase = false) {
    const d = u.def;
    const sx = u.x,
      sy = this.muzzleY(u),
      sz = u.z;
    const spread = d.weapon === 'rockets' ? 0.9 : 0.35;
    tx += (this.rng() - 0.5) * spread;
    tz += (this.rng() - 0.5) * spread;
    const dist = Math.hypot(tx - sx, ty - sy, tz - sz);
    this.projectiles.push({
      id: this.nextId++,
      team: u.team,
      w: d.weapon,
      sx,
      sy,
      sz,
      tx,
      ty,
      tz,
      t: 0,
      flight: Math.max(0.08, dist / d.projSpeed),
      dmg: d.dmg,
      splash: d.splash,
      air,
      atBase,
      arc: d.weapon === 'rockets' ? 2.2 : 0.5,
      owner: u,
    });
    this.fx.push({ t: 'launch', w: d.weapon, team: u.team, x: sx, y: sy, z: sz });
  }

  updateProjectiles(dt) {
    let w = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.t >= p.flight) {
        this.splash(p.tx, p.tz, p.air, p.splash, p.dmg, p.team, p.owner, null);
        if (p.atBase) this.damageBase(p.dmg);
        this.fx.push({ t: 'boom', x: p.tx, y: p.ty, z: p.tz, r: p.splash, team: p.team, w: p.w });
        continue;
      }
      this.projectiles[w++] = p;
    }
    this.projectiles.length = w;
  }

  splash(x, z, air, r, dmg, team, attacker, exclude) {
    this.forNear(x, z, r + 2, (e) => {
      if (e === exclude || e.team === team || !e.alive) return;
      if (!!e.def.flying !== !!air) return;
      const dd = Math.hypot(e.x - x, e.z - z);
      const reach = r + e.def.radius;
      if (dd > reach) return;
      this.damage(e, dmg * (1 - (dd / reach) * 0.5), attacker);
    });
  }

  damage(e, amount, attacker) {
    if (!e.alive) return;
    e.hp -= amount;
    e.lastHit = this.time;
    if (e.hp > 0) return;
    e.hp = 0;
    e.alive = false;
    this.aliveCount[e.team]--;
    this.stats.kills[1 - e.team]++;
    if (attacker && attacker.controlled) this.cmd.kills++;
    this.fx.push({
      t: 'death',
      id: e.id,
      kind: e.kind,
      team: e.team,
      x: e.x,
      y: e.y,
      z: e.z,
      big: isBig(e.kind) || e.controlled,
    });
    if (e.controlled) {
      this.commanderRespawnAt = this.time + this.cfg.commander.respawnSeconds;
      this.fx.push({ t: 'cmdDown' });
    }
  }

  damageBase(amount) {
    if (this.state !== 'battle' || amount <= 0) return;
    this.base.hp = Math.max(0, this.base.hp - amount);
    this.base.lastHit = this.time;
    if (this.time - (this.lastBaseFx || -1) > 0.12) {
      this.lastBaseFx = this.time;
      this.fx.push({ t: 'baseHit' });
    }
    if (this.base.hp <= 0) this.endRound(TEAM.INV);
  }

  updateTurrets(dt) {
    if (this.state === 'end') return;
    for (const tr of this.turrets) {
      tr.cd -= dt;
      tr.retarget -= dt;
      if (tr.target && !tr.target.alive) tr.target = null;
      if (tr.retarget <= 0) {
        tr.retarget = 0.25;
        tr.target = this.nearestEnemyAt(tr.x, tr.z, TEAM.DEF, TURRET.range, true);
      }
      if (!tr.target) continue;
      tr.aimX = tr.target.x - tr.x;
      tr.aimZ = tr.target.z - tr.z;
      if (tr.cd > 0) continue;
      tr.cd = TURRET.rate;
      const t = tr.target;
      this.damage(t, TURRET.dmg, null);
      this.fx.push({
        t: 'shot',
        w: 'turret',
        team: TEAM.DEF,
        kind: 'torreta',
        x1: tr.x,
        y1: 2.9,
        z1: tr.z,
        x2: t.x,
        y2: t.y + t.def.height * 0.5,
        z2: t.z,
      });
    }
  }

  // ------------------------------------------------------------ comandante

  updateCommander(dt, inp) {
    const c = this.commander;
    if (!c || !c.alive) {
      if (this.commanderRespawnAt > 0 && this.time >= this.commanderRespawnAt) {
        this.commander = this.spawnUnit({ kind: 'comandante', team: TEAM.DEF, x: 0, z: FIELD.baseZ - 7.5 });
        this.commander.controlled = true;
        this.commanderRespawnAt = 0;
        this.fx.push({ t: 'cmdUp' });
      }
      return;
    }
    const d = c.def;

    let mx = inp.moveX || 0,
      mz = inp.moveZ || 0;
    if (!mx && !mz && inp.moveTo) {
      const dx = inp.moveTo.x - c.x,
        dz = inp.moveTo.z - c.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.6) {
        mx = dx / dl;
        mz = dz / dl;
      }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }

    if (inp.dash && this.time >= this.cmd.dashReady && ml > 0.1) {
      this.cmd.dashTime = 0.22;
      this.cmd.dashReady = this.time + this.cfg.commander.dashCooldown;
      this.fx.push({ t: 'dash', x: c.x, z: c.z });
    }
    let speed = d.speed;
    if (this.cmd.dashTime > 0) {
      this.cmd.dashTime -= dt;
      speed *= 3.2;
    }
    c.vx = mx * speed;
    c.vz = mz * speed;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    c.moving = ml > 0.1;
    this.confine(c);
    c.z = Math.max(c.z, FIELD.zTop + 2);

    c.retarget -= dt;
    if (c.target && !c.target.alive) c.target = null;
    if (c.retarget <= 0) {
      c.retarget = 0.15;
      c.target = this.nearestEnemyAt(c.x, c.z, c.team, d.range + 2, true);
    }
    let fx = c.vx,
      fz = c.vz;
    if (c.target) {
      c.aimX = c.target.x - c.x;
      c.aimZ = c.target.z - c.z;
      fx = c.aimX;
      fz = c.aimZ;
    }
    if (fx * fx + fz * fz > 1e-4) c.heading = lerpAngle(c.heading, Math.atan2(-fx, -fz), Math.min(1, dt * 12));

    c.cd -= dt;
    if (c.cd <= 0 && c.target) {
      const td = Math.hypot(c.target.x - c.x, c.target.z - c.z);
      if (td <= d.range + c.target.def.radius) {
        this.fire(c, c.target);
        c.cd = d.rate;
      }
    }

    if (inp.strike && this.time >= this.cmd.strikeReady) {
      const aim = inp.aim || { x: c.x, z: c.z - 10 };
      const ax = clamp(aim.x, -FIELD.halfW, FIELD.halfW);
      const az = clamp(aim.z, FIELD.zTop, FIELD.baseZ - 2);
      this.cmd.strikeReady = this.time + this.cfg.commander.strikeCooldown;
      this.strikes.push({ x: ax, z: az, t: 0.75, r: 5.5, dmg: 1100 });
      this.fx.push({ t: 'strikeMark', x: ax, z: az, r: 5.5, delay: 0.75 });
    }
  }

  // Bombardeo de equipo (energía por comentarios): varios impactos sobre los grupos enemigos
  // más densos. Si los Invasores no tienen a quién apuntar, el bombardeo va a la base.
  teamStrike(team, opts = {}) {
    if (this.state !== 'battle') return false;
    const { strikes = 3, radius = 5, dmg = 900, baseDmg = 1200 } = opts;
    const enemies = this.units.filter((u) => u.alive && u.team !== team && !u.controlled);
    const cand = [];
    for (let i = 0, n = Math.min(enemies.length, 24); i < n; i++) {
      const u = enemies[Math.floor(this.rng() * enemies.length)];
      let near = 0;
      this.forNear(u.x, u.z, radius, (e) => {
        if (e.alive && e.team !== team) near++;
      });
      cand.push({ x: u.x, z: u.z, near });
    }
    cand.sort((a, b) => b.near - a.near);
    const targets = [];
    for (const c of cand) {
      if (targets.length >= strikes) break;
      if (targets.every((t) => Math.hypot(t.x - c.x, t.z - c.z) > radius * 1.2)) targets.push(c);
    }
    if (!targets.length) {
      targets.push(
        team === TEAM.INV ? { x: this.base.x, z: this.base.z - 3 } : { x: 0, z: (FIELD.zTop + FIELD.baseZ) / 2 },
      );
    }
    // Con pocos grupos enemigos igual caen todos los impactos: los que sobran rodean a los objetivos.
    // Esos extra no dañan la base, así el daño a la base sigue siendo baseDmg por objetivo real.
    const real = targets.length;
    for (let i = 0; targets.length < strikes; i++) {
      const c = targets[i % real];
      const a = this.rng() * Math.PI * 2;
      targets.push({ x: c.x + Math.cos(a) * radius * 1.1, z: c.z + Math.sin(a) * radius * 1.1, extra: true });
    }
    targets.forEach((t, i) => {
      const x = clamp(t.x, -FIELD.halfW, FIELD.halfW);
      const z = clamp(t.z, FIELD.zTop, FIELD.baseZ);
      const delay = 0.9 + i * 0.35;
      this.strikes.push({ x, z, t: delay, r: radius, dmg, team, baseDmg: team === TEAM.INV && !t.extra ? baseDmg : 0 });
      this.fx.push({ t: 'strikeMark', x, z, r: radius, delay });
    });
    return true;
  }

  updateStrikes(dt) {
    let w = 0;
    for (const s of this.strikes) {
      s.t -= dt;
      if (s.t > 0) {
        this.strikes[w++] = s;
        continue;
      }
      // sin team es el bombardeo del comandante
      const team = s.team ?? TEAM.DEF;
      const attacker = s.team === undefined ? this.commander : null;
      this.splash(s.x, s.z, false, s.r, s.dmg, team, attacker, null);
      this.splash(s.x, s.z, true, s.r, s.dmg * 0.6, team, attacker, null);
      if (s.baseDmg > 0 && Math.hypot(s.x - this.base.x, s.z - this.base.z) <= s.r + 4) this.damageBase(s.baseDmg);
      this.fx.push({ t: 'strike', x: s.x, z: s.z, r: s.r, team: s.team });
    }
    this.strikes.length = w;
  }

  // ------------------------------------------------------------ limpieza y lectura

  cleanup() {
    let w = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.alive) this.units[w++] = u;
      else this.byId.delete(u.id);
    }
    this.units.length = w;
  }

  drainFx() {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  // Fuerza total de cada ejército (para la barra de poder del HUD).
  power() {
    const p = [0, 0];
    for (const u of this.units) if (u.alive && !u.controlled) p[u.team] += u.hp;
    return p;
  }

  strikeCooldown() {
    return Math.max(0, this.cmd.strikeReady - this.time);
  }

  dashCooldown() {
    return Math.max(0, this.cmd.dashReady - this.time);
  }
}

// Efectos visuales: trazadoras, proyectiles, explosiones, partículas, rayos de aparición.
// Todo está agrupado en pocos draw calls (InstancedMesh / Points) para aguantar cientos de unidades.

import * as THREE from 'three';
import { TEAM_COLORS } from './models.js';
import { Blasts } from './blasts.js';

const MAX_TRACERS = 900;
const MAX_PROJ = 500;
const MAX_PARTICLES = 2600;

const TRACER_COLORS = {
  rifle: [new THREE.Color(0x7fd0ff), new THREE.Color(0xff8a7a)],
  laser: [new THREE.Color(0x66e6ff), new THREE.Color(0xff5577)],
  turret: [new THREE.Color(0x9fe8ff), new THREE.Color(0x9fe8ff)],
  cmd: [new THREE.Color(0xffd36b), new THREE.Color(0xffd36b)],
};

function radialTexture(stops = [[0, 1], [0.35, 0.55], [1, 0]]) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, a] of stops) grd.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.dummy = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
    this.soft = radialTexture();

    // trazadoras (cajas delgadas estiradas entre dos puntos)
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5);
    this.tracerMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }), MAX_TRACERS);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    scene.add(this.tracerMesh);
    this.tracers = [];

    // proyectiles (obuses y cohetes)
    this.projMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }), MAX_PROJ);
    this.projMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projMesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.projMesh.frustumCulled = false;
    this.projMesh.count = 0;
    scene.add(this.projMesh);

    // partículas
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pBase = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -999;
    this.pNext = 0;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.55, map: this.soft, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // explosiones: fuego, humo, onda y escombros con shaders (blasts.js)
    this.blastFx = new Blasts(scene);
    this.timers = [];
    // anillo de impacto en el suelo, con pool
    this.blasts = [];
    const ring = new THREE.RingGeometry(0.75, 1, 40);
    ring.rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const r = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
        color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      r.visible = false;
      scene.add(r);
      this.blasts.push({ r, life: 0, max: 1, size: 1, active: false });
    }

    // rayos verticales (aparición de unidades grandes y bombardeo)
    this.beams = [];
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      scene.add(m);
      this.beams.push({ m, life: 0, max: 1, r: 1, active: false });
    }

    // marcadores de bombardeo
    this.markers = [];
    const markGeo = new THREE.RingGeometry(0.86, 1, 48);
    markGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffd040).multiplyScalar(4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false;
      scene.add(m);
      this.markers.push({ m, life: 0, max: 1, r: 1, active: false });
    }
  }

  // ---------------------------------------------------------------- emisores

  tracer(e) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    const set = e.cmd ? TRACER_COLORS.cmd : (TRACER_COLORS[e.w] || TRACER_COLORS.rifle);
    const color = set[e.team] || set[0];
    const width = e.w === 'laser' ? 0.22 : e.w === 'turret' ? 0.12 : e.cmd ? 0.1 : 0.06;
    const life = e.w === 'laser' ? 0.16 : 0.07;
    this.tracers.push({ x1: e.x1, y1: e.y1, z1: e.z1, x2: e.x2, y2: e.y2, z2: e.z2, color, width, life, max: life });
    if (e.w === 'laser' || e.w === 'turret' || e.cmd) this.sparks(e.x2, e.y2, e.z2, e.w === 'laser' ? 5 : 2, color, 4, 0.25);
  }

  sparks(x, y, z, n, color, speed = 6, life = 0.5, gravity = 9) {
    const c = color instanceof THREE.Color ? color : this.tmpColor.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = Math.cos(a) * sp; this.pVel[i * 3 + 1] = up * sp; this.pVel[i * 3 + 2] = Math.sin(a) * sp;
      this.pBase[i * 3] = c.r * 2.2; this.pBase[i * 3 + 1] = c.g * 2.2; this.pBase[i * 3 + 2] = c.b * 2.2;
      const l = life * (0.6 + Math.random() * 0.8);
      this.pLife[i] = l; this.pMax[i] = l; this.pGrav[i] = gravity;
    }
  }

  smoke(x, y, z) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = (Math.random() - 0.5) * 0.6; this.pVel[i * 3 + 1] = 0.8; this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    this.pBase[i * 3] = 0.35; this.pBase[i * 3 + 1] = 0.33; this.pBase[i * 3 + 2] = 0.3;
    this.pLife[i] = this.pMax[i] = 0.5; this.pGrav[i] = 0;
  }

  explode(x, y, z, size, color = 0xffa040) {
    this.blastFx.explode(x, y, z, size, color);
    if (y < 2.5) {
      const b = this.blasts.find((q) => !q.active) || this.blasts.reduce((a, q) => (q.life < a.life ? q : a));
      b.active = true;
      b.size = size;
      b.max = b.life = 0.32 + size * 0.07;
      b.r.position.set(x, 0.06, z);
      b.r.material.color.set(color).multiplyScalar(1.6);
      b.r.visible = true;
    }
    const fire = new THREE.Color(color);
    this.sparks(x, y + 0.2, z, Math.min(24, 3 + Math.round(size * 3)), fire, 3 + size * 2.4, 0.3 + size * 0.05);
  }

  // ejecuta algo dentro de unos segundos (tiempo del juego, no del reloj)
  later(sec, fn) {
    this.timers.push({ at: sec, fn });
  }

  // explosiones encadenadas (naves grandes)
  chain(x, y, z, size, count, spread, interval, color) {
    this.blastFx.chain(x, y, z, size, count, spread, interval, color);
  }

  beam(x, z, color, radius = 2, life = 0.9, height = 40) {
    const b = this.beams.find((q) => !q.active) || this.beams[0];
    b.active = true;
    b.life = b.max = life;
    b.r = radius;
    b.m.position.set(x, 0, z);
    b.m.scale.set(radius, height, radius);
    b.m.material.color.set(color).multiplyScalar(2.6);
    b.m.visible = true;
  }

  marker(x, z, r, life) {
    const m = this.markers.find((q) => !q.active) || this.markers[0];
    m.active = true;
    m.life = m.max = life;
    m.r = r;
    m.m.position.set(x, 0.08, z);
    m.m.visible = true;
  }

  // ---------------------------------------------------------------- actualización

  update(dt, world, time) {
    const d = this.dummy;

    // trazadoras
    let n = 0;
    let w = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) continue;
      this.tracers[w++] = t;
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1, t.z2 - t.z1);
      if (len < 0.01) continue;
      d.position.set(t.x1, t.y1, t.z1);
      d.lookAt(t.x2, t.y2, t.z2);
      d.scale.set(t.width, t.width, len);
      d.updateMatrix();
      this.tracerMesh.setMatrixAt(n, d.matrix);
      this.tmpColor.copy(t.color).multiplyScalar(4 * (0.4 + 0.9 * (t.life / t.max)));
      this.tracerMesh.setColorAt(n, this.tmpColor);
      n++;
    }
    this.tracers.length = w;
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;

    // proyectiles (posición leída del mundo)
    n = 0;
    for (const p of world.projectiles) {
      if (n >= MAX_PROJ) break;
      const f = Math.min(1, p.t / p.flight);
      const x = p.sx + (p.tx - p.sx) * f;
      const z = p.sz + (p.tz - p.sz) * f;
      const y = p.sy + (p.ty - p.sy) * f + p.arc * 4 * f * (1 - f);
      d.position.set(x, y, z);
      d.rotation.set(0, 0, 0);
      const s = p.w === 'rockets' ? 0.22 : 0.18;
      d.scale.set(s, s, s);
      d.updateMatrix();
      this.projMesh.setMatrixAt(n, d.matrix);
      this.tmpColor.set(p.w === 'rockets' ? 0xffb347 : 0xfff2a8).multiplyScalar(5);
      this.projMesh.setColorAt(n, this.tmpColor);
      if (p.w === 'rockets' && Math.random() < 0.6) this.smoke(x, y, z);
      n++;
    }
    this.projMesh.count = n;
    this.projMesh.instanceMatrix.needsUpdate = true;
    if (this.projMesh.instanceColor) this.projMesh.instanceColor.needsUpdate = true;

    // partículas
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) {
        this.pPos[i3 + 1] = -999;
        this.pCol[i3] = this.pCol[i3 + 1] = this.pCol[i3 + 2] = 0;
        continue;
      }
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.05) { this.pPos[i3 + 1] = 0.05; this.pVel[i3 + 1] *= -0.3; this.pVel[i3] *= 0.7; this.pVel[i3 + 2] *= 0.7; }
      const k = this.pLife[i] / this.pMax[i];
      this.pCol[i3] = this.pBase[i3] * k;
      this.pCol[i3 + 1] = this.pBase[i3 + 1] * k;
      this.pCol[i3 + 2] = this.pBase[i3 + 2] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    if (this.timers.length) {
      const due = [];
      this.timers = this.timers.filter((tm) => ((tm.at -= dt) > 0 ? true : (due.push(tm), false)));
      for (const tm of due) tm.fn();
    }
    // explosiones
    this.blastFx.update(dt);
    for (const b of this.blasts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.r.visible = false; continue; }
      const k = 1 - b.life / b.max;
      const ease = 1 - (1 - k) * (1 - k);
      b.r.scale.setScalar(b.size * (0.4 + 1.5 * ease));
      b.r.material.opacity = (1 - k) * 0.38;
    }

    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.m.visible = false; continue; }
      const k = b.life / b.max;
      b.m.material.opacity = k * 0.4;
      const r = b.r * (0.4 + 0.6 * k);
      b.m.scale.x = b.m.scale.z = r;
    }

    for (const m of this.markers) {
      if (!m.active) continue;
      m.life -= dt;
      if (m.life <= 0) { m.active = false; m.m.visible = false; continue; }
      const pulse = 0.5 + 0.5 * Math.sin(time * 30);
      m.m.scale.setScalar(m.r * (0.55 + 0.45 * (m.life / m.max)));
      m.m.material.opacity = 0.45 + 0.5 * pulse;
    }
  }

  clear() {
    this.tracers.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -999; }
    this.blastFx.clear();
    this.timers.length = 0;
    for (const b of this.blasts) { b.active = false; b.r.visible = false; }
    for (const b of this.beams) { b.active = false; b.m.visible = false; }
    for (const m of this.markers) { m.active = false; m.m.visible = false; }
  }
}

export function teamColor(team) {
  return new THREE.Color(TEAM_COLORS[team] ?? 0xffffff);
}

// Plataforma de batalla flotando en el espacio: cubierta de planchas metálicas,
// bordes con luces, brazos laterales con balizas, una plataforma lateral para la colonia
// (escenario.glb) y escombros flotando alrededor.
// tools/compose_escenario.py usa las mismas medidas (PAD) para apoyar el decorado.

import * as THREE from 'three';
import { FIELD } from '../sim/world.js';

export const DECK = { half: 14, z0: -52, z1: 38 };
// plataforma lateral izquierda junto a la base, donde va la colonia
export const PAD = { x0: -24.5, x1: -14, z0: 6, z1: 32 };

// contorno de la cubierta (x, z), en orden
export function deckOutline() {
  const { half: h, z0, z1 } = DECK;
  const p = PAD;
  return [
    [-h + 2, z0], [h - 2, z0], [h, z0 + 2], [h, z1 - 2], [h - 2, z1], [-h + 2, z1], [-h, z1 - 2],
    [-h, p.z1], [p.x0 + 2, p.z1], [p.x0, p.z1 - 2], [p.x0, p.z0 + 2], [p.x0 + 2, p.z0], [-h, p.z0],
    [-h, z0 + 2],
  ];
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rnd = mulberry(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const h = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// área que cubre la textura (unidades del juego)
const TEX = { x0: PAD.x0, x1: DECK.half, z0: DECK.z0, z1: DECK.z1, ppu: 18 };

function paintDeck() {
  const W = Math.round((TEX.x1 - TEX.x0) * TEX.ppu);
  const H = Math.round((TEX.z1 - TEX.z0) * TEX.ppu);
  const P = TEX.ppu;
  const toPx = (x, z) => [(x - TEX.x0) * P, (z - TEX.z0) * P];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const e = document.createElement('canvas');
  e.width = W; e.height = H;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);

  // base metálica con variación suave
  const n1 = makeNoise(5), n2 = makeNoise(17);
  const img = g.createImageData(W, H);
  const data = img.data;
  for (let py = 0; py < H; py++) {
    const z = TEX.z0 + py / P;
    // de rojizo (lado del portal) a azulado (lado de la base)
    const k = Math.min(1, Math.max(0, (z - FIELD.zTop) / (FIELD.baseZ - FIELD.zTop)));
    for (let px = 0; px < W; px++) {
      const x = TEX.x0 + px / P;
      const m = 0.82 + 0.12 * n1(x * 0.12, z * 0.12) + 0.07 * n2(x * 0.9, z * 0.9);
      const i = (py * W + px) * 4;
      data[i] = (40 - 14 * k) * m;
      data[i + 1] = (36 - 2 * k) * m;
      data[i + 2] = (48 + 10 * k) * m;
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const rnd = mulberry(7);
  // planchas
  const plate = 3 * P;
  for (let y = 0; y < H; y += plate) {
    for (let x = 0; x < W; x += plate) {
      g.fillStyle = `rgba(255,255,255,${(rnd() * 0.05).toFixed(3)})`;
      g.fillRect(x + 2, y + 2, plate - 4, plate - 4);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, plate - 2, plate - 2);
      g.strokeStyle = 'rgba(170,200,255,0.08)';
      g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + plate - 3, y + 3); g.stroke();
      if (rnd() < 0.16) {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        for (let b = 0; b < 4; b++) g.fillRect(x + 6 + b * (plate - 16) / 3, y + plate / 2 - 2, 4, 4);
      }
      if (rnd() < 0.05) {
        // rejilla de ventilación
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let b = 0; b < 6; b++) g.fillRect(x + 8, y + 8 + b * 6, plate - 16, 3);
      }
    }
  }
  // desgaste y marcas de quemado
  for (let i = 0; i < 70; i++) {
    const [cx, cy] = toPx(-12 + rnd() * 24, DECK.z0 + 4 + rnd() * (DECK.z1 - DECK.z0 - 8));
    const r = (0.6 + rnd() * 2.2) * P;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, 'rgba(5,4,8,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }

  // franjas de peligro a lo largo de los bordes de la pista
  const band = 0.5 * P;
  const [, ly0] = toPx(0, DECK.z0 + 2);
  const [, ly1] = toPx(0, DECK.z1 - 2);
  for (const side of [-1, 1]) {
    const [bx] = toPx(side * (DECK.half - 0.95), 0);
    const xs = side < 0 ? bx : bx - band;
    g.fillStyle = '#17171c';
    g.fillRect(xs, ly0, band, ly1 - ly0);
    g.save();
    g.beginPath(); g.rect(xs, ly0, band, ly1 - ly0); g.clip();
    g.fillStyle = 'rgba(240,180,40,0.6)';
    for (let y = ly0 - band; y < ly1; y += band * 2) {
      g.beginPath();
      g.moveTo(xs, y); g.lineTo(xs + band, y + band); g.lineTo(xs + band, y + band * 2); g.lineTo(xs, y + band);
      g.closePath(); g.fill();
    }
    g.restore();
  }
  // luces en el piso junto a las franjas
  for (const side of [-1, 1]) {
    for (let z = DECK.z0 + 3; z < DECK.z1 - 2; z += 3) {
      if (side < 0 && z > PAD.z0 && z < PAD.z1) continue;
      const [px, py] = toPx(side * (DECK.half - 1.75), z);
      ge.fillStyle = '#9fe4ff';
      ge.beginPath(); ge.arc(px, py, 0.15 * P, 0, Math.PI * 2); ge.fill();
      g.fillStyle = '#d4f3ff';
      g.beginPath(); g.arc(px, py, 0.15 * P, 0, Math.PI * 2); g.fill();
    }
  }
  // flechas de avance tenues en el centro
  g.strokeStyle = 'rgba(140,190,255,0.11)';
  g.lineWidth = 0.2 * P;
  for (let z = FIELD.zTop + 4; z < FIELD.baseZ - 10; z += 9) {
    const [cx, cy] = toPx(0, z);
    const s = 1.2 * P;
    g.beginPath(); g.moveTo(cx - s, cy - s * 0.6); g.lineTo(cx, cy + s * 0.2); g.lineTo(cx + s, cy - s * 0.6); g.stroke();
  }
  // zona del portal en rojo
  const [, pz0] = toPx(0, DECK.z0);
  const [, pz1] = toPx(0, FIELD.zTop + 1);
  const rg = g.createLinearGradient(0, pz0, 0, pz1);
  rg.addColorStop(0, 'rgba(255,40,60,0.26)');
  rg.addColorStop(1, 'rgba(255,40,60,0)');
  g.fillStyle = rg;
  g.fillRect(0, pz0, W, pz1 - pz0);

  // plataforma circular de la base
  const [bx, by] = toPx(0, FIELD.baseZ);
  g.fillStyle = 'rgba(24,46,72,0.9)';
  g.beginPath(); g.arc(bx, by, 8.8 * P, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(120,200,255,0.28)';
  g.lineWidth = 3;
  for (const rr of [8.8, 7.6]) { g.beginPath(); g.arc(bx, by, rr * P, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const [lx, ly] = [bx + Math.cos(a) * 8.2 * P, by + Math.sin(a) * 8.2 * P];
    ge.fillStyle = '#5fd0ff';
    ge.beginPath(); ge.arc(lx, ly, 0.12 * P, 0, Math.PI * 2); ge.fill();
  }

  // plataforma lateral (colonia): planchas más oscuras y círculo de aterrizaje
  const [qx0, qy0] = toPx(PAD.x0, PAD.z0);
  const [qx1, qy1] = toPx(-DECK.half + 0.3, PAD.z1);
  g.fillStyle = 'rgba(10,12,18,0.35)';
  g.fillRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 0.12 * P;
  g.setLineDash([0.6 * P, 0.5 * P]);
  g.strokeRect(qx0 + 0.6 * P, qy0 + 0.6 * P, qx1 - qx0 - 1.2 * P, qy1 - qy0 - 1.2 * P);
  g.setLineDash([]);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

// roca irregular con sombreado plano (escombros)
function rockGeometry(seed, detail = 1) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const n = makeNoise(seed);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(0.7 + 0.55 * n(v.x * 1.7 + 5, v.y * 1.7 + v.z * 1.3 + 9));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

export class Platform {
  constructor(scene) {
    this.scene = scene;
    const group = new THREE.Group();
    this.group = group;
    this.time = 0;

    // cubierta con algo de espesor (los costados se ven al acercar la cámara)
    const shape = new THREE.Shape();
    deckOutline().forEach(([x, z], i) => { if (i) shape.lineTo(x, -z); else shape.moveTo(x, -z); });
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -1.6, 0);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - TEX.x0) / (TEX.x1 - TEX.x0), 1 - (pos.getZ(i) - TEX.z0) / (TEX.z1 - TEX.z0));
    }
    const { map, emissiveMap } = paintDeck();
    const top = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 0.78, metalness: 0.25,
    });
    const side = new THREE.MeshStandardMaterial({ color: 0x1b1d26, roughness: 0.7, metalness: 0.4 });
    const deck = new THREE.Mesh(geo, [top, side]);
    group.add(deck);
    this.deck = deck;

    // bordillo con franja de luz cian a lo largo del contorno
    const outline = deckOutline();
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x2a2e3a, roughness: 0.6, metalness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x58c8ff).multiplyScalar(2.6) });
    const glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a5a).multiplyScalar(2.6) });
    for (let i = 0; i < outline.length; i++) {
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ang = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, len + 0.4), curbMat);
      curb.position.set(mx, 0.2, mz);
      curb.rotation.y = ang;
      group.add(curb);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, len), mz < FIELD.zTop + 4 ? glowRed : glowMat);
      strip.position.set(mx, 0.42, mz);
      strip.rotation.y = ang;
      group.add(strip);
    }

    // brazos laterales con balizas que parpadean
    this.beacons = [];
    const armMat = new THREE.MeshStandardMaterial({ color: 0x30343f, roughness: 0.6, metalness: 0.5 });
    const armGeo = new THREE.BoxGeometry(1, 0.35, 0.35);
    const tipGeo = new THREE.SphereGeometry(0.28, 12, 8);
    const rnd = mulberry(3);
    for (const s of [-1, 1]) {
      for (let z = DECK.z0 + 6; z < DECK.z1 - 3; z += 11) {
        if (s < 0 && z > PAD.z0 - 2 && z < PAD.z1 + 2) continue;
        const L = 3 + rnd() * 2.5;
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.scale.x = L;
        arm.position.set(s * (DECK.half + L / 2), -0.5, z);
        group.add(arm);
        const strut = new THREE.Mesh(armGeo, armMat);
        strut.scale.x = L * 0.75;
        strut.position.set(s * (DECK.half + L * 0.32), -1.2, z);
        strut.rotation.z = s * 0.5;
        group.add(strut);
        const red = z < (FIELD.zTop + FIELD.baseZ) / 2 - 6;
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(red ? 0xff3344 : 0x44bbff).multiplyScalar(4) });
        const tip = new THREE.Mesh(tipGeo, mat);
        tip.position.set(s * (DECK.half + L), -0.5, z);
        group.add(tip);
        this.beacons.push({ mesh: tip, phase: rnd() * 6.28, base: mat.color.clone() });
      }
    }

    // escombros flotando en el espacio (dan profundidad)
    this.debris = [];
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x3f3a45, roughness: 1, flatShading: true });
    const debrisMesh = new THREE.InstancedMesh(rockGeometry(41, 1), debrisMat, 60);
    debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    while (this.debris.length < 60) {
      const x = (rnd() - 0.5) * 200;
      const z = -150 + rnd() * 200;
      const y = -14 - rnd() * 80;
      if (Math.abs(x) < 34 && z > DECK.z0 - 12 && z < DECK.z1 + 12) continue;
      this.debris.push({
        x, y, z, s: 0.8 + rnd() ** 2 * 6,
        rx: rnd() * 6, ry: rnd() * 6, vx: (rnd() - 0.5) * 0.25, vy: (rnd() - 0.5) * 0.25, bob: rnd() * 6,
      });
    }
    this.debrisMesh = debrisMesh;
    group.add(debrisMesh);
    this.tmp = new THREE.Object3D();
    this.update(0);
    scene.add(group);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const d = this.tmp;
    this.debris.forEach((r, i) => {
      r.rx += r.vx * dt;
      r.ry += r.vy * dt;
      d.position.set(r.x, r.y + Math.sin(t * 0.25 + r.bob) * 0.8, r.z);
      d.rotation.set(r.rx, r.ry, 0);
      d.scale.setScalar(r.s);
      d.updateMatrix();
      this.debrisMesh.setMatrixAt(i, d.matrix);
    });
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    for (const b of this.beacons) {
      const k = Math.max(0.15, Math.sin(t * 2.2 + b.phase) > 0.6 ? 1 : 0.15);
      b.mesh.material.color.copy(b.base).multiplyScalar(k);
    }
  }
}

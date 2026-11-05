// Explosiones con shaders: bolas de fuego animadas con ruido, humo, onda expansiva y escombros.
// Cada tipo es un solo draw call (billboards instanciados), así aguanta muchas a la vez.

import * as THREE from 'three';

const NOISE2D = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}
`;

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iData;   // x: edad 0..1, y: semilla, z: tamaño, w: giro
attribute vec3 iTint;
varying vec2 vUv;
varying vec4 vData;
varying vec3 vTint;
void main() {
  vUv = uv;
  vData = iData;
  vTint = iTint;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.w), s = sin(iData.w);
  vec2 p = position.xy * iData.z;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = projectionMatrix * mv;
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vData;
varying vec3 vTint;
${NOISE2D}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float age = vData.x, seed = vData.y;
  if (age < 0.0) discard;
  float r = length(p);
  float n = fbm2(p * 2.3 + seed * 31.0 + vec2(0.0, -age * 1.6));
  float n2v = fbm2(p * 5.1 - seed * 7.0 + vec2(age * 0.9, 0.0));
  n = mix(n, n2v, 0.35);
  float edge = 0.6 + 0.35 * age;
  float shape = 1.0 - smoothstep(edge - 0.45, edge, r + (n - 0.5) * 0.85);
  // núcleo caliente solo al centro y al principio; luego se enfría hacia rojo oscuro
  float core = 1.0 - smoothstep(0.0, 0.75, r);
  float heat = clamp(shape * core * (1.25 - age * 1.6) + (n - 0.55) * 0.5, 0.0, 1.0);
  vec3 dark = vTint * vec3(0.28, 0.1, 0.06);
  vec3 hot = vec3(1.0, 0.9, 0.66);
  vec3 col = mix(dark, vTint, smoothstep(0.05, 0.45, heat));
  col = mix(col, hot, smoothstep(0.62, 0.98, heat));
  float alpha = shape * (1.0 - smoothstep(0.5, 1.0, age)) * vData.z / max(vData.z, 0.001);
  gl_FragColor = vec4(col * alpha * (0.45 + 1.4 * heat), 1.0);
  #include <colorspace_fragment>
}
`;

const SMOKE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vData;
varying vec3 vTint;
${NOISE2D}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float age = vData.x, seed = vData.y;
  if (age < 0.0) discard;
  float r = length(p);
  float n = fbm2(p * 1.9 + seed * 17.0 + vec2(age * 0.5, -age * 0.9));
  float shape = 1.0 - smoothstep(0.3, 1.0, r + (n - 0.5) * 0.65);
  float alpha = shape * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.4, 1.0, age)) * 0.62;
  vec3 col = mix(vec3(0.045, 0.04, 0.05), vec3(0.2, 0.19, 0.2), n);
  col += vTint * (1.0 - smoothstep(0.0, 0.32, age)) * 0.9 * shape;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

const WAVE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vData;
varying vec3 vTint;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float age = vData.x;
  if (age < 0.0) discard;
  float r = length(p);
  float rad = 0.15 + 0.8 * (1.0 - (1.0 - age) * (1.0 - age));
  float w = 0.05 + 0.08 * (1.0 - age);
  float ring = smoothstep(w, 0.0, abs(r - rad));
  float glow = smoothstep(rad, 0.0, r) * 0.25 * (1.0 - age);
  gl_FragColor = vec4(vTint * (ring + glow) * (1.0 - age) * 1.3, 1.0);
  #include <colorspace_fragment>
}
`;

class BillboardPool {
  constructor(scene, max, fragmentShader, blending, renderOrder) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iData', this.aData);
    geo.setAttribute('iTint', this.aTint);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    this.geo = geo;
    this.items = [];
    this.max = max;
  }

  add(it) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(it);
  }

  update(dt) {
    let n = 0;
    let w = 0;
    const P = this.aPos.array, D = this.aData.array, T = this.aTint.array;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.age += dt;
      if (it.age >= it.life) continue;
      this.items[w++] = it;
      const k = it.age / it.life;
      if (it.age > 0) {
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        const drag = Math.exp(-(it.drag ?? 2) * dt);
        it.vx *= drag; it.vz *= drag; it.vy = it.vy * drag + (it.lift ?? 0) * dt;
      }
      const ease = 1 - (1 - Math.max(0, k)) ** 2;
      P[n * 3] = it.x; P[n * 3 + 1] = it.y; P[n * 3 + 2] = it.z;
      D[n * 4] = it.age < 0 ? -1 : k;
      D[n * 4 + 1] = it.seed;
      D[n * 4 + 2] = it.s0 + (it.s1 - it.s0) * ease;
      D[n * 4 + 3] = it.rot + (it.spin || 0) * Math.max(0, it.age);
      T[n * 3] = it.r; T[n * 3 + 1] = it.g; T[n * 3 + 2] = it.b;
      n++;
    }
    this.items.length = w;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aData.needsUpdate = this.aTint.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
    this.geo.instanceCount = 0;
  }
}

function chunkGeometry() {
  const g = new THREE.TetrahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 1.3, p.getY(i) * 0.6, p.getZ(i));
  g.computeVertexNormals();
  return g;
}

export class Blasts {
  constructor(scene) {
    this.smoke = new BillboardPool(scene, 180, SMOKE_FRAG, THREE.NormalBlending, 1);
    this.fire = new BillboardPool(scene, 260, FIRE_FRAG, THREE.AdditiveBlending, 2);
    this.waves = new BillboardPool(scene, 40, WAVE_FRAG, THREE.AdditiveBlending, 3);
    this.tint = new THREE.Color();
    this.pending = [];

    // escombros
    this.MAXD = 260;
    this.debris = [];
    this.debrisMesh = new THREE.InstancedMesh(chunkGeometry(), new THREE.MeshStandardMaterial({
      color: 0x34323a, roughness: 0.8, metalness: 0.3, flatShading: true,
    }), this.MAXD);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    scene.add(this.debrisMesh);
    this.d = new THREE.Object3D();
  }

  // x, y, z: centro; size: radio aproximado en unidades del juego; color: tono del fuego
  explode(x, y, z, size, color = 0xffa040) {
    const c = this.tint.set(color);
    const R = Math.random;
    y = Math.max(y, size * 0.35);
    // destello
    this.fire.add({ x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.11, s0: size * 1.3, s1: size * 1.7, seed: R(), rot: R() * 6, r: 1, g: 0.8, b: 0.55 });
    // bolas de fuego
    const nf = Math.min(6, 1 + Math.round(size * 0.7));
    for (let i = 0; i < nf; i++) {
      const a = R() * Math.PI * 2, d = i === 0 ? 0 : size * (0.25 + R() * 0.45);
      const life = (0.42 + size * 0.07) * (0.8 + R() * 0.45);
      this.fire.add({
        x: x + Math.cos(a) * d, y: y + (R() - 0.3) * size * 0.4, z: z + Math.sin(a) * d,
        vx: Math.cos(a) * size * 0.6, vy: size * 0.35, vz: Math.sin(a) * size * 0.6, drag: 3,
        age: -i * 0.04, life, s0: size * (0.9 + R() * 0.3), s1: size * (1.9 + R() * 0.5),
        seed: R(), rot: R() * 6, spin: (R() - 0.5) * 1.5, r: c.r, g: c.g, b: c.b,
      });
    }
    // humo
    const ns = Math.min(6, 1 + Math.round(size * 0.8));
    for (let i = 0; i < ns; i++) {
      const a = R() * Math.PI * 2, d = size * R() * 0.5;
      this.smoke.add({
        x: x + Math.cos(a) * d, y: y + size * 0.2, z: z + Math.sin(a) * d,
        vx: Math.cos(a) * size * 0.25, vy: 0.6 + size * 0.25, vz: Math.sin(a) * size * 0.25, drag: 1.2, lift: 0.4,
        age: -0.08 - i * 0.05, life: 1.1 + size * 0.22 + R() * 0.4, s0: size * 1.1, s1: size * (2.6 + R() * 0.8),
        seed: R(), rot: R() * 6, spin: (R() - 0.5) * 0.6, r: c.r, g: c.g * 0.6, b: c.b * 0.3,
      });
    }
    // onda expansiva
    if (size >= 3) {
      this.waves.add({ x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.3 + size * 0.03, s0: size * 1.2, s1: size * 3.2, seed: 0, rot: 0, r: c.r * 0.6, g: c.g * 0.5, b: c.b * 0.4 });
    }
    // escombros
    if (size >= 1.8) {
      const nd = Math.min(18, Math.round(size * 3));
      for (let i = 0; i < nd; i++) {
        if (this.debris.length >= this.MAXD) this.debris.shift();
        const a = R() * Math.PI * 2, sp = size * (1.5 + R() * 2.5);
        this.debris.push({
          x, y, z, vx: Math.cos(a) * sp, vy: size * (1.2 + R() * 2.2), vz: Math.sin(a) * sp,
          rx: R() * 6, ry: R() * 6, sx: (R() - 0.5) * 12, sy: (R() - 0.5) * 12,
          s: (0.12 + R() * 0.22) * Math.min(3, size * 0.6), age: 0, life: 1.1 + R() * 0.9,
        });
      }
    }
  }

  // varias explosiones encadenadas a lo largo de una nave grande
  chain(x, y, z, size, count, spread, interval = 0.12, color) {
    for (let i = 0; i < count; i++) {
      this.pending.push({
        at: i * interval * (0.7 + Math.random() * 0.6),
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * size * 0.5, z: z + (Math.random() - 0.5) * spread * 1.4,
        size: size * (0.6 + Math.random() * 0.5), color,
      });
    }
  }

  update(dt) {
    if (this.pending.length) {
      let w = 0;
      for (const p of this.pending) {
        p.at -= dt;
        if (p.at <= 0) this.explode(p.x, p.y, p.z, p.size, p.color);
        else this.pending[w++] = p;
      }
      this.pending.length = w;
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    this.waves.update(dt);

    const d = this.d;
    let n = 0, w = 0;
    for (const b of this.debris) {
      b.age += dt;
      if (b.age >= b.life) continue;
      this.debris[w++] = b;
      b.vy -= 22 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.y < 0.1) { b.y = 0.1; b.vy *= -0.3; b.vx *= 0.6; b.vz *= 0.6; b.sx *= 0.6; b.sy *= 0.6; }
      b.rx += b.sx * dt; b.ry += b.sy * dt;
      const k = b.age / b.life;
      d.position.set(b.x, b.y, b.z);
      d.rotation.set(b.rx, b.ry, 0);
      d.scale.setScalar(b.s * (k > 0.75 ? (1 - k) / 0.25 : 1));
      d.updateMatrix();
      this.debrisMesh.setMatrixAt(n++, d.matrix);
    }
    this.debris.length = w;
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.pending.length = 0;
    this.smoke.clear();
    this.fire.clear();
    this.waves.clear();
    this.debris.length = 0;
    this.debrisMesh.count = 0;
  }
}

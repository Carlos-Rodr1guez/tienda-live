// Modelos 3D. El proyecto trae modelos CC0 en /models (naves de Quaternius, robot de
// Quaternius y base/escenario de KayKit). Si falta alguno, se usa uno hecho por código.
//
// Nombres de archivo en /models:
//   <unidad>.glb        modelo de la unidad (equipo Defensores, y de respaldo para Invasores)
//   <unidad>_inv.glb    versión del equipo Invasores (opcional; si no está, se tiñe de rojo)
//   base.glb            la base del streamer
//   escenario.glb       decoración alrededor del campo

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const TEAM_COLORS = [0x2f9bff, 0xff4040];
export const GOLD = 0xffc23d;
const DARK = 0x262b36;
const STEEL = 0x606a7c;
const VISOR = 0x9ff6ff;

// Tamaño objetivo (lado más largo, en unidades del juego) al normalizar cada .glb
const TARGET_SIZE = { dron: 1.9, caza: 2.6, bombardero: 4.4, coloso: 5.4, acorazado: 14, comandante: 3.4 };
export const KINDS = Object.keys(TARGET_SIZE);
export const SCENE_MODELS = ['base', 'escenario'];

// Brillo de motores por equipo (valores > 1 para que el bloom los haga brillar)
const EXHAUST_COLORS = [new THREE.Color(0x4fb8ff).multiplyScalar(2.6), new THREE.Color(0xff5a3a).multiplyScalar(2.6)];
const EXHAUST_GOLD = new THREE.Color(0xffb850).multiplyScalar(2.6);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

// Una pieza: geometría + color + transformación, lista para fusionar.
function P(geo, color, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0);
  tmpQ.setFromEuler(tmpE);
  tmpP.set(o.x || 0, o.y || 0, o.z || 0);
  tmpS.set(o.sx || 1, o.sy || 1, o.sz || 1);
  tmpM.compose(tmpP, tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g;
}

function M(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);

// ---------------------------------------------------------------- respaldos por código

function buildShip(T, scale) {
  const engines = [[-1.05, 0, 1], [1.05, 0, 1], [0, 0.32, 1.15]];
  const parts = [
    P(box(2.8, 1.25, 7.0), T, { z: 0.4 }),
    P(cone(1.55, 3.4, 4), shade(T, 0.85), { z: -4.6, rx: -Math.PI / 2, ry: Math.PI / 4 }),
    P(box(3.8, 0.5, 4.2), shade(T, 0.68), { y: -0.45, z: 1.0 }),
    P(box(6.8, 0.22, 2.0), DARK, { y: -0.2, z: 1.9 }),
    P(box(1.7, 1.05, 2.3), STEEL, { y: 1.05, z: 2.0 }),
    P(box(1.0, 0.45, 0.9), VISOR, { y: 1.45, z: 1.2 }),
    ...engines.map(([x, y, s]) => P(cyl(0.6 * s, 0.7 * s, 1.5, 10), DARK, { x, y, z: 4.25, rx: Math.PI / 2 })),
  ];
  const body = M(parts);
  body.scale(scale, scale, scale);
  const glow = M(engines.map(([x, y, s]) => P(cyl(0.5 * s, 0.5 * s, 0.12, 12), 0xffffff, { x, y, z: 5.05, rx: Math.PI / 2 })));
  glow.scale(scale, scale, scale);
  return { body, glow };
}

function buildColossus(T) {
  const tubes = [];
  for (const sx of [-1, 1]) {
    for (const [dx, dy] of [[-0.2, 0.18], [0.2, 0.18], [-0.2, -0.18], [0.2, -0.18]]) {
      tubes.push(P(cyl(0.13, 0.13, 0.22, 8), DARK, { x: sx * 1.65 + dx, y: 3.92 + dy, z: -0.74, rx: Math.PI / 2 }));
    }
  }
  const leg = M([
    P(box(0.55, 1.1, 0.62), shade(T, 0.62), { y: -0.55 }),
    P(box(0.44, 1.15, 0.52), DARK, { y: -1.6, z: 0.12 }),
    P(box(0.78, 0.26, 1.05), DARK, { y: -2.2, z: -0.1 }),
  ]);
  return {
    body: M([
      P(box(1.4, 0.62, 1.05), DARK, { y: 2.42 }),
      P(box(2.3, 1.5, 1.7), T, { y: 3.45 }),
      P(box(1.25, 0.48, 0.16), VISOR, { y: 3.62, z: -0.88 }),
      P(box(0.92, 0.92, 1.4), shade(T, 0.7), { x: -1.65, y: 3.92 }),
      P(box(0.92, 0.92, 1.4), shade(T, 0.7), { x: 1.65, y: 3.92 }),
      ...tubes,
      P(box(0.36, 0.36, 1.7), STEEL, { x: -1.38, y: 2.9, z: -0.55 }),
      P(box(0.36, 0.36, 1.7), STEEL, { x: 1.38, y: 2.9, z: -0.55 }),
    ]),
    leg,
    hipY: 2.35,
    legX: 0.78,
  };
}

// ---------------------------------------------------------------- librería

export class ModelLibrary {
  constructor(cfg) {
    this.cfg = cfg;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.exhaustMats = [0, 1, 2].map((i) => new THREE.MeshBasicMaterial({
      color: i === 2 ? EXHAUST_GOLD : EXHAUST_COLORS[i],
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.proc = {};
    for (let team = 0; team < 2; team++) {
      const T = TEAM_COLORS[team];
      this.proc[`dron:${team}`] = buildShip(new THREE.Color(T).lerp(new THREE.Color(0xffffff), 0.3), 0.2);
      this.proc[`caza:${team}`] = buildShip(T, 0.27);
      this.proc[`bombardero:${team}`] = buildShip(shade(T, 0.85), 0.45);
      this.proc[`coloso:${team}`] = buildColossus(T);
      this.proc[`acorazado:${team}`] = buildShip(T, 1.2);
    }
    this.proc['comandante:0'] = buildShip(GOLD, 0.34);
    this.glb = {};     // kind -> { variants: [obj, obj], animations }
    this.scenes = {};  // base / escenario -> Object3D
  }

  // Carga los .glb disponibles. `available` es la lista que da el servidor,
  // `embedded` un mapa nombre -> ArrayBuffer (demo de un solo archivo).
  async loadOverrides(baseUrl = 'models/', available = null, embedded = null) {
    const loader = new GLTFLoader();
    if (embedded) {
      // En la demo de un solo archivo las texturas se decodifican con <img> (blob:),
      // que funciona en páginas con CSP estricta donde fetch(blob:) puede estar bloqueado.
      loader.register((parser) => {
        const tl = new THREE.TextureLoader(parser.options.manager);
        tl.setCrossOrigin(parser.options.crossOrigin);
        parser.textureLoader = tl;
        return { name: 'asedio_img_textures' };
      });
    }
    const names = [...KINDS.flatMap((k) => [k, `${k}_inv`]), ...SCENE_MODELS];
    const want = names.filter((n) => (embedded ? n in embedded : !available || available.includes(n)));
    const gltfs = {};
    await Promise.all(want.map(async (name) => {
      try {
        if (embedded) {
          gltfs[name] = await loader.parseAsync(embedded[name], baseUrl);
        } else {
          if (!available) {
            const head = await fetch(`${baseUrl}${name}.glb`, { method: 'HEAD' });
            if (!head.ok) return;
          }
          gltfs[name] = await loader.loadAsync(`${baseUrl}${name}.glb`);
        }
      } catch (err) {
        console.warn(`[modelos] no se pudo cargar ${name}.glb:`, err?.message || err);
      }
    }));
    for (const kind of KINDS) {
      if (!gltfs[kind] && !gltfs[`${kind}_inv`]) continue;
      const def = gltfs[kind] || gltfs[`${kind}_inv`];
      const inv = gltfs[`${kind}_inv`];
      this.glb[kind] = {
        variants: [this.prepareUnit(kind, def, 0, false), this.prepareUnit(kind, inv || def, 1, !inv)],
        animations: def.animations || [],
      };
    }
    for (const name of SCENE_MODELS) if (gltfs[name]) this.scenes[name] = this.prepareScene(name, gltfs[name]);
    return Object.keys(gltfs);
  }

  prepareUnit(kind, gltf, team, tintIt) {
    const opts = this.cfg.models?.[kind] || {};
    const src = SkeletonUtils.clone(gltf.scene);
    src.rotation.y = THREE.MathUtils.degToRad(opts.rotateY ?? 180);
    src.updateMatrixWorld(true);
    const bbox = new THREE.Box3();
    src.traverse((o) => {
      if (o.isMesh && !String(o.material?.name || '').startsWith('Exhaust')) bbox.expandByObject(o);
    });
    if (bbox.isEmpty()) bbox.setFromObject(src);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const scale = ((TARGET_SIZE[kind] || 2) / (Math.max(size.x, size.y, size.z) || 1)) * (opts.scale ?? 1);
    // en las unidades que vuelan el centro va a la altura de vuelo; en las de suelo, los pies en y = 0
    const flying = kind !== 'coloso';
    src.position.set(-center.x, flying ? -center.y : -bbox.min.y, -center.z);
    const pivot = new THREE.Group();
    pivot.add(src);
    pivot.scale.setScalar(scale);
    const holder = new THREE.Group();
    holder.add(pivot);

    const teamColor = new THREE.Color(TEAM_COLORS[team]);
    const tint = opts.tint ?? 0.35;
    const only = opts.tintMaterial;
    const cache = new Map();
    holder.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.frustumCulled = false;
      const swap = (m) => {
        if (!m) return m;
        if (String(m.name || '').startsWith('Exhaust')) {
          o.userData.exhaust = true;
          return this.exhaustMats[kind === 'comandante' ? 2 : team];
        }
        if (cache.has(m)) return cache.get(m);
        const c = m.clone();
        if (c.color && (tintIt || only)) {
          if (only) { if (m.name === only) c.color.lerp(teamColor, opts.tint ?? 1); }
          else if (tint > 0) c.color.lerp(teamColor, tint);
        } else if (c.color && kind !== 'comandante') {
          // un toque del color del equipo también en modelos que ya traen su versión
          c.color.lerp(teamColor, opts.teamTint ?? 0.18);
        }
        if (c.isMeshStandardMaterial) c.envMapIntensity = 0.9;
        cache.set(m, c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    return holder;
  }

  prepareScene(name, gltf) {
    const opts = this.cfg.models?.[name] || {};
    const root = new THREE.Group();
    const inner = gltf.scene;
    inner.rotation.y = THREE.MathUtils.degToRad(opts.rotateY ?? 0);
    root.add(inner);
    root.scale.setScalar(opts.scale ?? 2);
    root.traverse((o) => {
      if (o.isMesh && o.material?.isMeshStandardMaterial) {
        o.material.envMapIntensity = 0.8;
        if (opts.darken) o.material.color.multiplyScalar(opts.darken);
      }
    });
    return root;
  }

  // Crea la vista de una unidad: { root, glb, legs?, exhausts, anim? }
  instantiate(kind, team) {
    const glb = this.glb[kind];
    if (glb) {
      const root = new THREE.Group();
      const inner = SkeletonUtils.clone(glb.variants[team] || glb.variants[0]);
      root.add(inner);
      const view = { root, glb: true, exhausts: [] };
      inner.traverse((o) => { if (o.userData.exhaust) view.exhausts.push(o); });
      // modelos sin animación pero con piernas separadas (nodos LegL / LegR con pivote en la cadera)
      const legL = inner.getObjectByName('LegL'), legR = inner.getObjectByName('LegR');
      if (legL && legR && !glb.animations.length) {
        view.legs = [legL, legR];
        view.legRest = [legL.rotation.x, legR.rotation.x];
        view.torso = inner.getObjectByName('Torso') || null;
      }
      if (glb.animations.length) {
        const mixer = new THREE.AnimationMixer(inner);
        const find = (re) => glb.animations.find((a) => re.test(a.name));
        const clips = {
          walk: find(/walk/i) || find(/run/i),
          idle: find(/idle/i) || find(/stand/i),
          attack: find(/punch|attack|shoot/i),
          win: find(/dance|wave|yes/i),
        };
        const actions = {};
        for (const [k, c] of Object.entries(clips)) if (c) actions[k] = mixer.clipAction(c);
        const firstKey = actions.idle ? 'idle' : Object.keys(actions)[0];
        if (firstKey) actions[firstKey].play();
        view.anim = { mixer, actions, current: firstKey || null };
      }
      return view;
    }
    const key = kind === 'comandante' ? 'comandante:0' : `${kind}:${team}`;
    const p = this.proc[key] || this.proc[`caza:${team}`];
    const root = new THREE.Group();
    const view = { root, glb: false, exhausts: [] };
    root.add(new THREE.Mesh(p.body, this.mat));
    if (p.leg) {
      view.legs = [-1, 1].map((s) => {
        const leg = new THREE.Mesh(p.leg, this.mat);
        leg.position.set(s * p.legX, p.hipY, 0);
        root.add(leg);
        return leg;
      });
    }
    if (p.glow) {
      const glow = new THREE.Mesh(p.glow, this.exhaustMats[kind === 'comandante' ? 2 : team]);
      root.add(glow);
      view.exhausts.push(glow);
    }
    return view;
  }
}

// Escena 3D: cámara vertical 9:16, campo de batalla, base, portal, unidades y post-proceso (bloom).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ModelLibrary, TEAM_COLORS, GOLD, KINDS } from './models.js';
import { Effects } from './effects.js';
import { Platform } from './terrain.js';
import { SpaceBackdrop } from './space.js';
import { FIELD } from '../sim/world.js';
import { TEAM } from '../sim/units.js';

const BG = 0x0b1020;
const FOG = 0x0b0d1c;
const MAX_SHADOWS = 1200;

// Escala visual (solo dibujo) para que se lean bien en un celular.
const VIEW_SCALE = { dron: 1.3, caza: 1.35, bombardero: 1.2, coloso: 1.05, acorazado: 1, comandante: 1.25 };
// Tamaño de la sombra en el suelo por unidad
const SHADOW_SIZE = { dron: 1.6, caza: 2.2, bombardero: 3.6, coloso: 4.2, acorazado: 11, comandante: 2.8 };

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export class GameRenderer {
  constructor(canvas, world, cfg, opts = {}) {
    this.world = world;
    this.cfg = cfg;
    this.time = 0;
    this.shakeAmt = 0;
    // El temblor mueve toda la imagen y en el directo se comprime mal (cuadraditos).
    this.shakeScale = Math.max(0, Number(cfg.graphics?.shake ?? 1) || 0);
    this.views = new Map();
    this.frame = 0;

    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // graphics.pixelRatio > 0 fuerza la resolución interna (2 = el doble de nítido, más pesado).
    const forcedPr = Number(opts.pixelRatio) || Number(cfg.graphics?.pixelRatio) || 0;
    r.setPixelRatio(forcedPr > 0 ? Math.min(forcedPr, 3) : Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(FOG, 125, 320);
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(40, 9 / 16, 0.5, 2000);
    this.camPos = new THREE.Vector3(0, 72, 60);
    this.camLook = new THREE.Vector3(0, 0, 2);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // cámara cinematográfica para los regalos grandes
    this.cineEnabled = opts.cinematics !== false && cfg.graphics?.cinematics !== false;
    this.cine = null;
    this.cineQ = [];
    this.cineCool = 0;
    this.onCine = null;
    this.viewPos = new THREE.Vector3();
    this.viewLook = new THREE.Vector3();
    this.cineTarget = new THREE.Vector3();

    scene.add(new THREE.HemisphereLight(0xc6d8ff, 0x2a2733, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
    sun.position.set(18, 40, 12);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7aa2ff, 0.9);
    rim.position.set(-20, 18, -30);
    scene.add(rim);

    this.models = new ModelLibrary(cfg);
    this.effects = new Effects(scene);
    // plataforma flotando en el espacio, con nebulosa y planeta de fondo
    this.platform = new Platform(scene);
    this.space = new SpaceBackdrop(r, scene);
    this.buildBase();
    this.buildPortal();
    this.buildShadows();

    // anillo del comandante
    const ringGeo = new THREE.RingGeometry(1.1, 1.35, 40).rotateX(-Math.PI / 2);
    this.cmdRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: hdr(GOLD, 3.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.cmdRing.visible = false;
    scene.add(this.cmdRing);

    // post-proceso: brillo en motores, láseres y explosiones
    this.useBloom = opts.bloom !== false && cfg.graphics?.bloom !== false;
    if (this.useBloom) {
      // El antialias del renderer no llega a la imagen intermedia del post-proceso:
      // sin `samples`, con bloom los bordes salen dentados. 4 muestras de MSAA lo arreglan.
      const rt = new THREE.WebGLRenderTarget(540, 960, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(540, 960), cfg.graphics?.bloomStrength ?? 0.85, 0.4, 2.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmpV = new THREE.Vector3();
    this.tmpObj = new THREE.Object3D();
  }

  // ---------------------------------------------------------------- escenario

  buildBase() {
    const base = new THREE.Group();
    base.position.set(0, 0, FIELD.baseZ);
    const steel = new THREE.MeshLambertMaterial({ color: 0x4a5468, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x252b38, flatShading: true });
    const blue = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[0], flatShading: true });
    // estructura por código (se oculta si existe base.glb)
    const shell = new THREE.Group();
    shell.add(new THREE.Mesh(new THREE.CylinderGeometry(5.6, 6.3, 1.0, 8), steel).translateY(0.5));
    shell.add(new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.35, 8), dark).translateY(1.15));
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.9, 3.4, 8), steel);
    tower.position.y = 2.9;
    shell.add(tower);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.35, 8), blue);
    collar.position.y = 4.4;
    shell.add(collar);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.4, 0.7), blue);
      pylon.position.set(Math.cos(a) * 4.6, 2.0, Math.sin(a) * 4.6);
      shell.add(pylon);
    }
    this.turretStands = [];
    for (const tr of this.world.turrets) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1.6, 8), dark);
      stand.position.set(tr.x, 1.6, tr.z - FIELD.baseZ);
      shell.add(stand);
    }
    base.add(shell);
    this.baseShell = shell;

    this.coreMat = new THREE.MeshLambertMaterial({ color: 0x2c6f8f, emissive: 0x2bc8ff, emissiveIntensity: 1.7, flatShading: true });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), this.coreMat);
    this.core.position.y = 5.8;
    base.add(this.core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.7, 7.1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: hdr(TEAM_COLORS[0], 3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ring.position.y = 0.05;
    base.add(ring);
    this.baseRing = ring;

    // torretas (la cabeza gira hacia su objetivo)
    const white = new THREE.MeshLambertMaterial({ color: 0xdfe6ef, flatShading: true });
    this.turretHeads = this.world.turrets.map((tr) => {
      const head = new THREE.Group();
      head.position.set(tr.x, 2.7, tr.z - FIELD.baseZ);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.1), white);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.16, 1.12), blue);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.4), steel);
      barrel.position.set(0, 0.05, -0.9);
      head.add(hb, stripe, barrel);
      base.add(head);
      return head;
    });
    this.base = base;
    this.scene.add(base);
  }

  buildPortal() {
    const portal = new THREE.Group();
    portal.position.set(0, 6.5, FIELD.zTop - 7);
    const red = TEAM_COLORS[1];
    const torus = new THREE.Mesh(new THREE.TorusGeometry(7, 0.6, 10, 48), new THREE.MeshLambertMaterial({
      color: 0x3a1418, emissive: red, emissiveIntensity: 3, flatShading: true,
    }));
    portal.add(torus);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,220,220,0.95)');
    grd.addColorStop(0.3, 'rgba(255,70,80,0.75)');
    grd.addColorStop(0.75, 'rgba(120,10,40,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,190,190,0.35)';
    g.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(128, 128, 30 + i * 16, i, i + 2.2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.portalDisc = new THREE.Mesh(new THREE.CircleGeometry(6.6, 48), new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(2.6, 2.6, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    portal.add(this.portalDisc);
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), new THREE.MeshLambertMaterial({ color: 0x2b2230, flatShading: true }));
      pillar.position.set(s * 8.2, -2, 0);
      portal.add(pillar);
    }
    this.portalTorus = torus;
    this.portal = portal;
    this.scene.add(portal);
  }

  buildShadows() {
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const g = sc.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(geo, mat, MAX_SHADOWS);
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = -1;
    this.scene.add(this.shadows);

    // aro del color del equipo bajo cada unidad: se lee de qué bando es incluso en un celular
    const ring = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
    this.halos = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
    }), MAX_SHADOWS);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.setColorAt(0, new THREE.Color(1, 1, 1));
    this.halos.frustumCulled = false;
    this.halos.count = 0;
    this.scene.add(this.halos);
    this.haloColors = TEAM_COLORS.map((c) => new THREE.Color(c).multiplyScalar(1.15));
  }

  // Se llama después de cargar los .glb: reemplaza base y decoración por los modelos.
  applySceneModels() {
    const sc = this.models.scenes;
    if (sc.base) {
      this.baseShell.visible = false;
      this.base.add(sc.base);
      for (const head of this.turretHeads) head.position.y = 2.35;
    }
    if (sc.escenario) this.scene.add(sc.escenario);
  }

  // ---------------------------------------------------------------- tamaño y utilidades

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  project(x, y, z, out) {
    const v = this.tmpV.set(x, y, z).project(this.camera);
    out.x = (v.x + 1) / 2;
    out.y = (1 - v.y) / 2;
    out.visible = v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2;
    return out;
  }

  // Punto del suelo bajo una posición normalizada de pantalla (0..1)
  groundAt(nx, ny) {
    this.raycaster.setFromCamera({ x: nx * 2 - 1, y: -(ny * 2 - 1) }, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return null;
    return { x: p.x, z: p.z };
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.6, this.shakeAmt + amount);
  }

  // ---------------------------------------------------------------- eventos

  handleFx(list) {
    const fx = this.effects;
    for (const e of list) {
      switch (e.t) {
        case 'shot':
          fx.tracer(e);
          break;
        case 'boom': {
          const size = e.w === 'rockets' ? 1.0 : 1.35;
          fx.explode(e.x, e.y, e.z, size, e.w === 'rockets' ? 0xff9a3c : 0xffc35a);
          break;
        }
        case 'death': {
          const col = new THREE.Color(TEAM_COLORS[e.team]).lerp(new THREE.Color(0xffa040), 0.6);
          if (e.kind === 'acorazado') {
            // la nave grande revienta por partes y al final estalla entera
            fx.chain(e.x, e.y, e.z, 3.2, 7, 9, 0.16, 0xff9a40);
            fx.explode(e.x, e.y, e.z, 4, 0xffb060);
            fx.later(1.05, () => { fx.explode(e.x, e.y, e.z, 7.5, 0xff8a30); this.shake(1.4); });
            this.shake(0.6);
          } else if (e.kind === 'coloso') { fx.explode(e.x, 3.2, e.z, 3.6, 0xffa040); fx.chain(e.x, 2.5, e.z, 2.2, 3, 2.5, 0.14, 0xff8a30); this.shake(0.7); }
          else if (e.kind === 'bombardero') { fx.explode(e.x, e.y, e.z, 2.3, 0xffa040); this.shake(0.12); }
          else if (e.kind === 'comandante') { fx.explode(e.x, e.y, e.z, 2.4, GOLD); this.shake(0.4); }
          else { fx.explode(e.x, e.y, e.z, 1.0, 0xffa850); fx.sparks(e.x, e.y, e.z, 5, col, 4, 0.5); }
          break;
        }
        case 'spawn': {
          const col = new THREE.Color(e.kind === 'comandante' ? GOLD : TEAM_COLORS[e.team]);
          if (e.big && e.owner && !e.cpu && e.owner.id !== 'likes') this.queueCine(e);
          if (e.big) {
            fx.beam(e.x, e.z, col, e.kind === 'acorazado' ? 2.6 : 1.6, 0.75, 40);
            fx.sparks(e.x, 1, e.z, 40, col, 9, 0.8);
            this.shake(e.kind === 'acorazado' ? 0.8 : 0.35);
          } else if (e.kind === 'bombardero' || e.kind === 'comandante') {
            fx.beam(e.x, e.z, col, 0.9, 0.4, 12);
          } else if (!e.cpu) {
            fx.sparks(e.x, e.y, e.z, 3, col, 2.5, 0.35);
          }
          break;
        }
        case 'baseHit':
          fx.sparks((Math.random() - 0.5) * 6, 2 + Math.random() * 3, FIELD.baseZ - 3, 6, 0xff7050, 5, 0.4);
          this.coreFlash = 0.15;
          break;
        case 'strikeMark':
          fx.marker(e.x, e.z, e.r, e.delay);
          break;
        case 'strike': {
          // dorado = comandante; azul o rojo = bombardeo de equipo por energía
          const tc = e.team === undefined ? null : TEAM_COLORS[e.team];
          fx.beam(e.x, e.z, tc ?? 0xffd36b, 1.6, 0.45, 70);
          fx.explode(e.x, 0.5, e.z, e.r * 0.9, 0xffb040);
          fx.chain(e.x, 1.2, e.z, e.r * 0.45, 5, e.r * 1.2, 0.07, tc ?? 0xffc860);
          this.shake(0.9);
          break;
        }
        case 'baseDestroyed':
          fx.chain(0, 3, FIELD.baseZ, 4, 10, 8, 0.18, 0xff8040);
          fx.explode(0, 3, FIELD.baseZ, 6, 0xffa040);
          this.shake(1.6);
          break;
        case 'dash':
          fx.sparks(e.x, 3, e.z, 10, GOLD, 4, 0.3);
          break;
        case 'round':
          if (e.state === 'intro') this.clearViews();
          break;
        default:
          break;
      }
    }
  }

  clearViews() {
    for (const v of this.views.values()) this.removeView(v);
    this.views.clear();
    this.effects.clear();
  }

  // ---------------------------------------------------------------- toma cinematográfica

  queueCine(e) {
    if (!this.cineEnabled) return;
    const item = { id: e.id, kind: e.kind, team: e.team, owner: e.owner };
    if (e.kind === 'acorazado') {
      // el acorazado tiene prioridad sobre los colosos en espera
      this.cineQ = this.cineQ.filter((q) => q.kind === 'acorazado');
      if (this.cineQ.length < 2) this.cineQ.push(item);
    } else if (!this.cineQ.length && !(this.cine && this.cine.kind === 'acorazado')) {
      this.cineQ.push(item);
    }
  }

  updateCine(dt) {
    const w = this.world;
    this.cineCool = Math.max(0, this.cineCool - dt);
    if (!this.cine && this.cineQ.length && this.cineCool <= 0 && w.state !== 'end') {
      const q = this.cineQ.shift();
      if (w.units.some((u) => u.id === q.id && u.alive)) {
        this.cine = { ...q, t: 0, dur: q.kind === 'acorazado' ? 4.6 : 2.8, ended: false };
        this.onCine?.('start', this.cine);
      }
    }
    let k = 0;
    const c = this.cine;
    if (c) {
      c.t += dt;
      const u = w.units.find((x) => x.id === c.id);
      const v = this.views.get(c.id);
      if (u && u.alive && v) this.cineTarget.set(v.root.position.x, v.root.position.y, v.root.position.z);
      else if (c.t < c.dur - 0.9) c.t = c.dur - 0.9; // si muere, se vuelve antes
      const fadeIn = 0.85, fadeOut = 0.9;
      k = Math.min(1, c.t / fadeIn, (c.dur - c.t) / fadeOut);
      k = Math.max(0, k);
      k = k * k * (3 - 2 * k);
      if (c.t >= c.dur) {
        this.onCine?.('end', c);
        this.cine = null;
        this.cineCool = 1.5;
        k = 0;
      }
    }
    this.viewPos.copy(this.camPos);
    this.viewLook.copy(this.camLook);
    if (k > 0) {
      const big = c.kind === 'acorazado';
      // la cámara gira despacio alrededor de la unidad mientras dura la toma
      const a = (c.t - c.dur / 2) * (big ? 0.16 : 0.22);
      const dist = big ? 27 : 17;
      const hgt = big ? 15 : 9.5;
      const tx = this.cineTarget.x, ty = this.cineTarget.y, tz = this.cineTarget.z;
      const cx = tx + Math.sin(a) * dist, cz = tz + Math.cos(a) * dist;
      this.viewPos.lerp(this.tmpV.set(cx, ty + hgt, cz), k);
      this.viewLook.lerp(this.tmpV.set(tx, ty + (big ? 0.5 : 2.4), tz), k);
    }
  }

  // ---------------------------------------------------------------- vistas

  createView(u) {
    const v = this.models.instantiate(u.kind, u.team);
    v.root.position.set(u.x, u.y, u.z);
    v.root.rotation.y = u.heading;
    v.born = this.time;
    v.flying = !!u.def.flying;
    v.kind = u.kind;
    v.prevHeading = u.heading;
    v.roll = 0;
    this.scene.add(v.root);
    return v;
  }

  removeView(v) {
    this.scene.remove(v.root);
    if (v.anim) v.anim.mixer.stopAllAction();
  }

  playAnim(v, name) {
    const a = v.anim;
    if (!a || a.current === name || !a.actions[name]) return;
    const next = a.actions[name];
    const prev = a.current ? a.actions[a.current] : null;
    next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    if (prev) prev.fadeOut(0.2);
    a.current = name;
  }

  update(dt) {
    this.time += dt;
    this.frame++;
    const w = this.world;
    const t = this.time;
    const d = this.tmpObj;
    let shadowN = 0;
    let haloN = 0;

    for (const u of w.units) {
      let v = this.views.get(u.id);
      if (!v) { v = this.createView(u); this.views.set(u.id, v); }
      v.seen = this.frame;
      const age = t - v.born;
      let y = u.y;
      if (v.flying) {
        y += Math.sin(t * 1.6 + u.id * 1.7) * (u.kind === 'acorazado' ? 0.35 : 0.22);
        if (u.kind === 'acorazado' && age < 1.4) y += (1 - age / 1.4) ** 2 * 26; // desciende desde el cielo
        // alabeo al girar
        let dh = u.heading - v.prevHeading;
        dh = ((dh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const turn = dt > 0 ? dh / dt : 0;
        const targetRoll = Math.max(-0.6, Math.min(0.6, -turn * 0.18));
        v.roll += (targetRoll - v.roll) * Math.min(1, dt * 6);
        v.root.rotation.set(u.moving ? -0.06 : 0, u.heading, v.roll, 'YXZ');
      } else {
        v.root.rotation.set(0, u.heading, 0);
      }
      v.prevHeading = u.heading;
      v.root.position.set(u.x, y, u.z);
      const grow = Math.min(1, age / 0.25);
      v.root.scale.setScalar((VIEW_SCALE[u.kind] || 1) * (0.3 + 0.7 * grow));

      if (v.legs) {
        // paso pesado: piernas que se balancean y el cuerpo sube y baja con cada pisada
        const heavy = !!v.legRest;
        const f = heavy ? 2.6 : 4;
        const amp = heavy ? 0.32 : 0.45;
        const sw = u.moving ? Math.sin(t * f + u.id) * amp : 0;
        const r0 = v.legRest ? v.legRest[0] : 0, r1 = v.legRest ? v.legRest[1] : 0;
        v.legs[0].rotation.x = r0 + sw;
        v.legs[1].rotation.x = r1 - sw;
        if (u.moving) v.root.position.y += Math.abs(Math.cos(t * f + u.id)) * (heavy ? 0.35 : 0.18);
        if (v.torso) v.torso.rotation.z = u.moving ? Math.sin(t * f + u.id) * 0.05 : 0;
      }
      if (v.exhausts.length) {
        const f = (u.moving ? 1 : 0.7) * (0.85 + Math.sin(t * 40 + u.id * 3) * 0.15);
        for (const e of v.exhausts) e.scale.setScalar(f);
      }
      if (v.anim) {
        if (w.state === 'end' && w.winner === u.team) this.playAnim(v, 'win');
        else if (u.moving) this.playAnim(v, 'walk');
        else if (w.time - (u.lastFire ?? -9) < 0.8) this.playAnim(v, 'attack');
        else this.playAnim(v, 'idle');
        v.anim.mixer.update(dt);
      }

      if (shadowN < MAX_SHADOWS) {
        const s = (SHADOW_SIZE[u.kind] || 2) * (v.flying ? 1 : 1.1) * (0.3 + 0.7 * grow);
        d.position.set(u.x, 0.04, u.z);
        d.rotation.set(0, u.heading, 0);
        d.scale.set(s, 1, u.kind === 'acorazado' ? s * 1.6 : s * 1.2);
        d.updateMatrix();
        this.shadows.setMatrixAt(shadowN++, d.matrix);
        if (!u.controlled) {
          const hs = (SHADOW_SIZE[u.kind] || 2) * 0.62 * (0.3 + 0.7 * grow);
          d.position.y = 0.06;
          d.scale.set(hs, 1, hs);
          d.updateMatrix();
          this.halos.setMatrixAt(haloN, d.matrix);
          this.halos.setColorAt(haloN, this.haloColors[u.team]);
          haloN++;
        }
      }
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.halos.count = haloN;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;

    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) { this.removeView(v); this.views.delete(id); }
    }

    // comandante
    const c = w.commander;
    if (c && c.alive) {
      this.cmdRing.visible = true;
      this.cmdRing.position.set(c.x, 0.06, c.z);
      this.cmdRing.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    } else this.cmdRing.visible = false;

    // base: núcleo gira y pasa de cian a rojo según su vida
    const hpK = w.base.hp / w.base.maxHp;
    this.core.rotation.y += dt * 1.2;
    this.core.rotation.x += dt * 0.6;
    this.core.position.y = 5.8 + Math.sin(t * 2) * 0.25;
    this.coreFlash = Math.max(0, (this.coreFlash || 0) - dt);
    this.coreMat.emissive.set(0x2bc8ff).lerp(new THREE.Color(0xff2a2a), 1 - hpK);
    this.coreMat.emissiveIntensity = 1.7 + (this.coreFlash > 0 ? 2.5 : 0);
    this.base.visible = !(w.state === 'end' && w.winner === TEAM.INV);
    this.baseRing.material.opacity = 0.35 + 0.25 * Math.sin(t * 3);
    w.turrets.forEach((tr, i) => {
      const head = this.turretHeads[i];
      if (head) head.rotation.y = Math.atan2(-tr.aimX, -tr.aimZ);
    });

    // portal
    this.portalDisc.rotation.z -= dt * 0.8;
    this.portalTorus.rotation.z += dt * 0.2;

    this.effects.update(dt, w, t);

    // cámara (con toma cinematográfica si llegó un regalo grande) y temblor
    this.updateCine(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const s = this.shakeAmt * this.shakeAmt * 0.9 * this.shakeScale;
    this.camera.position.set(
      this.viewPos.x + (Math.random() - 0.5) * s,
      this.viewPos.y + (Math.random() - 0.5) * s,
      this.viewPos.z + (Math.random() - 0.5) * s,
    );
    this.camera.lookAt(this.viewLook);

    this.platform.update(dt);
    this.space.update(dt, t, this.camera);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- miniaturas para el HUD

  thumbnails(size = 160) {
    const out = {};
    const scene = new THREE.Scene();
    scene.environment = this.scene.environment;
    scene.environmentIntensity = 0.7;
    scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x30303a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(5, 10, 6);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearAlpha();
    const prevTone = this.renderer.toneMapping;
    const buf = new Uint8Array(size * size * 4);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    for (const kind of KINDS) {
      if (kind === 'comandante' || kind === 'dron') continue;
      const view = this.models.instantiate(kind, 0);
      const obj = view.root;
      obj.rotation.set(0.45, -0.75, 0, 'YXZ');
      scene.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(16))) * 0.95;
      cam.position.set(sphere.center.x, sphere.center.y + dist * 0.42, sphere.center.z + dist * 0.9);
      cam.lookAt(sphere.center);
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(scene, cam);
      this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        img.data.set(buf.subarray(src, src + size * 4), y * size * 4);
      }
      ctx.clearRect(0, 0, size, size);
      ctx.putImageData(img, 0, 0);
      out[kind] = canvas.toDataURL('image/png');
      scene.remove(obj);
    }
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(BG, prevClear);
    this.renderer.toneMapping = prevTone;
    rt.dispose();
    return out;
  }
}

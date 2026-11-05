// Fondo espacial: nebulosa (se pinta una sola vez en un cubemap), estrellas que titilan
// y un planeta gigante con atmósfera y anillos debajo del asteroide.

import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; }
  return s;
}
`;

function nebulaMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float n1 = fbm(d * 2.1 + vec3(3.1, 1.7, 0.4));
        float n2 = fbm(d * 3.3 + vec3(-2.0, 5.3, 1.1) + n1 * 1.6);
        float neb = smoothstep(0.42, 0.86, n2);
        float neb2 = smoothstep(0.48, 0.9, fbm(d * 4.6 - n1 * 1.2 + vec3(7.0)));
        vec3 col = vec3(0.010, 0.012, 0.030);
        col += vec3(0.32, 0.09, 0.46) * neb * 0.55;
        col += vec3(0.04, 0.30, 0.48) * neb2 * 0.42;
        col += vec3(0.85, 0.30, 0.42) * pow(neb * neb2, 2.0) * 0.55;
        col *= 0.7 + 0.6 * fbm(d * 9.0 + vec3(4.0));
        // estrellas fijas (las brillantes que titilan van aparte)
        vec3 sd = d * 340.0;
        vec3 cell = floor(sd);
        float h = hash3(cell);
        if (h > 0.972) {
          vec3 sp = cell + vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1));
          float dist = length(sd - sp);
          float b = (h - 0.972) / 0.028;
          vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash3(cell + 8.0));
          col += tint * smoothstep(0.42, 0.0, dist) * (0.35 + 1.6 * b * b);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function planetMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vObj;
      void main() {
        vObj = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform float time;
      varying vec3 vN;
      varying vec3 vObj;
      ${NOISE_GLSL}
      void main() {
        float lat = vObj.y;
        float turb = fbm(vObj * 3.0 + vec3(0.0, 0.0, time * 0.01));
        float bands = sin(lat * 15.0 + turb * 3.2) * 0.5 + 0.5;
        float fine = sin(lat * 47.0 + turb * 6.0) * 0.5 + 0.5;
        vec3 c1 = vec3(0.86, 0.62, 0.40);
        vec3 c2 = vec3(0.55, 0.30, 0.20);
        vec3 c3 = vec3(0.95, 0.86, 0.70);
        vec3 col = mix(c2, c1, bands);
        col = mix(col, c3, smoothstep(0.65, 1.0, fine) * 0.45);
        // tormenta
        vec3 sp = normalize(vec3(0.55, -0.32, 0.77));
        float storm = smoothstep(0.17, 0.05, distance(vObj, sp) + (turb - 0.5) * 0.08);
        col = mix(col, vec3(0.80, 0.33, 0.22), storm * 0.8);
        float diff = dot(normalize(vN), normalize(sunDir));
        float light = smoothstep(-0.08, 0.65, diff);
        vec3 night = vec3(0.012, 0.016, 0.035);
        col = pow(col, vec3(1.25)) * 0.62;
        vec3 outc = mix(night, col * (0.3 + 0.9 * light), light);
        gl_FragColor = vec4(outc, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function atmosphereMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec3 n = -normalize(vN);
        float rim = 1.0 - abs(dot(n, normalize(vView)));
        float glow = pow(rim, 2.2) * smoothstep(0.98, 0.55, rim);
        float lit = smoothstep(-0.35, 0.6, dot(normalize(vN), normalize(sunDir)));
        vec3 col = vec3(1.0, 0.62, 0.38) * 2.2 * glow * (0.12 + lit);
        gl_FragColor = vec4(col, glow);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 8;
  const g = c.getContext('2d');
  for (let x = 0; x < 512; x++) {
    const t = x / 511;
    const a = (0.25 + 0.55 * Math.abs(Math.sin(t * 38) * Math.sin(t * 11 + 1))) * Math.sin(t * Math.PI) ** 0.6 * (t > 0.62 && t < 0.66 ? 0.15 : 1);
    const r = 220 - t * 50, gg = 190 - t * 60, b = 160 - t * 50;
    g.fillStyle = `rgba(${r | 0},${gg | 0},${b | 0},${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SpaceBackdrop {
  constructor(renderer, scene, sunPos) {
    this.scene = scene;
    const sunDir = sunPos.clone().normalize();
    // el planeta se ilumina de costado para que tenga lado de noche (más volumen)
    const planetSun = new THREE.Vector3(0.85, 0.25, -0.45).normalize();

    // 1) nebulosa pintada una sola vez en un cubemap (barato de dibujar cada cuadro)
    // 8 bits en sRGB: buena precisión en los tonos oscuros con poca memoria de video (~24 MB)
    const rt = new THREE.WebGLCubeRenderTarget(1024, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: false, minFilter: THREE.LinearFilter });
    const cubeCam = new THREE.CubeCamera(1, 100, rt);
    const tmp = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), nebulaMaterial());
    tmp.add(sky);
    const prevTone = renderer.toneMapping;
    cubeCam.update(renderer, tmp);
    renderer.toneMapping = prevTone;
    sky.geometry.dispose();
    sky.material.dispose();
    scene.background = rt.texture;
    scene.backgroundIntensity = 1.0;
    this.cube = rt;

    // 2) estrellas brillantes que titilan (con bloom)
    const N = 320;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      // casi todas por debajo del horizonte, que es lo que ve esta cámara
      let x, y, z;
      do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1 || y > 0.15);
      const l = Math.hypot(x, y, z) || 1;
      pos[i * 3] = (x / l) * 900; pos[i * 3 + 1] = (y / l) * 900; pos[i * 3 + 2] = (z / l) * 900;
      seed[i] = rnd();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, pr: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float time;
        uniform float pr;
        varying float vB;
        varying vec3 vC;
        void main() {
          float tw = 0.55 + 0.45 * sin(time * (1.2 + seed * 3.0) + seed * 40.0);
          vB = tw * (0.6 + 2.4 * seed * seed);
          vC = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.8, 0.65), fract(seed * 7.0));
          gl_PointSize = (1.6 + 3.2 * seed * seed) * pr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vB;
        varying vec3 vC;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = dot(p, p);
          float a = exp(-d * 5.0) + 0.6 * exp(-abs(p.x) * 18.0) * exp(-abs(p.y) * 2.5) * step(0.85, vB / 3.0 + 0.2) ;
          gl_FragColor = vec4(vC * vB * a * 1.6, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -2;
    scene.add(this.stars);

    // 3) planeta con atmósfera y anillos
    const planet = new THREE.Group();
    const R = 165;
    this.planetMat = planetMaterial(planetSun);
    const body = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), this.planetMat);
    planet.add(body);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 96, 64), atmosphereMaterial(planetSun));
    planet.add(atmo);
    const ringGeo = new THREE.RingGeometry(R * 1.35, R * 2.15, 160, 1);
    // UV radial para la textura del anillo
    const rp = ringGeo.attributes.position;
    const ruv = ringGeo.attributes.uv;
    for (let i = 0; i < rp.count; i++) {
      const r = Math.hypot(rp.getX(i), rp.getY(i));
      ruv.setXY(i, (r - R * 1.35) / (R * 0.8), 0.5);
    }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      map: ringTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
      color: new THREE.Color(0.85, 0.78, 0.72), fog: false,
    }));
    ring.rotation.x = -Math.PI / 2 + 0.38;
    ring.rotation.y = 0.22;
    planet.add(ring);
    planet.rotation.z = 0.32;
    planet.position.set(40, -300, -420);
    for (const m of [body, atmo]) m.material.fog = false;
    this.planet = planet;
    this.planetBody = body;
    scene.add(planet);
  }

  update(dt, t, camera) {
    this.starMat.uniforms.time.value = t;
    this.stars.position.copy(camera.position);
    this.planetMat.uniforms.time.value = t;
    this.planetBody.rotation.y += dt * 0.006;
  }
}

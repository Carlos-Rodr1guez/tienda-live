import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { SPRITES } from '../public/js/data/sprites.js';
import { buildSprites } from '../tools/sprite-recipes.js';
import { KIND_WEIGHT } from '../public/js/camera/auto.js';
import { createBanners } from '../public/js/ui/banners.js';
import { ALTURA, MARCAS, SOMBRA, ZANCADA } from '../public/js/render/units.js';
import { A_PIE, createFx } from '../public/js/render/fx.js';
import { createScene } from '../public/js/render/scene.js';
import { SIM_GIFTS, buildRouter, createAudience, createFlow } from '../public/js/audience.js';
import { DEFAULTS, GROUND_KINDS } from '../public/js/sim/defaults.js';
import { ANIMATION_STATES } from '../public/js/sim/units.js';
import { S } from '../public/js/ui/strings.js';

// v2.8 (lote 6): arte y efectos de los cuatro tipos nuevos (francotirador, blindado, lanzacohetes y lobo).

const NUEVOS = ['francotirador', 'blindado', 'lanzacohetes', 'lobo'];
const CLAVES = new Set('odthskglmbwyrfac'.split(''));
const marcos = (sp) => Object.entries(sp.anims).flatMap(([an, fs]) => fs.map((f, i) => ({ an, i, rows: f })));
const letras = (rows) => new Set(rows.join('').split(''));

test('el archivo de sprites generado es el que sale de las recetas (npm run sprites)', () => {
  const r = buildSprites();
  for (const k of [...NUEVOS, 'soldado', 'jeep', 'tanque', 'pesado'])
    assert.deepEqual(JSON.parse(JSON.stringify(r[k])), JSON.parse(JSON.stringify(SPRITES[k])), k);
});

test('sprites nuevos: filas de igual largo, claves de la paleta, ancla y boca dentro del sprite', () => {
  for (const kind of NUEVOS) {
    const sp = SPRITES[kind];
    assert.ok(sp, kind);
    assert.ok(sp.ax >= 0 && sp.ax < sp.w && sp.ay >= 0 && sp.ay < sp.h, `${kind}: ancla dentro`);
    assert.ok(sp.mz[0] < sp.w && sp.mz[1] < sp.h, `${kind}: boca dentro`);
    for (const { an, i, rows } of marcos(sp)) {
      assert.equal(rows.length, sp.h, `${kind}.${an}[${i}] alto`);
      for (const fila of rows) {
        assert.equal(fila.length, sp.w, `${kind}.${an}[${i}] ancho`);
        for (const c of fila) assert.ok(c === '.' || CLAVES.has(c), `${kind}.${an}[${i}]: clave "${c}"`);
      }
    }
  }
});

test('sprites nuevos: tienen los estados de la config y color de equipo con al menos 2 tonos', () => {
  for (const kind of NUEVOS) {
    for (const an of ANIMATION_STATES[kind]) assert.ok(SPRITES[kind].anims[an]?.length >= 1, `${kind}.${an}`);
    const l = letras(SPRITES[kind].anims.idle[0]);
    const tonos = ['t', 'h', 'd'].filter((c) => l.has(c));
    assert.ok(tonos.length >= 2, `${kind}: tonos de equipo ${tonos}`);
  }
  assert.equal(SPRITES.francotirador.anims.death.length, 3);
  assert.equal(SPRITES.lobo.anims.death.length, 3);
  assert.equal(SPRITES.lobo.anims.walk.length, 4);
});

test('restos de vehículos nuevos: la carcasa quemada no conserva el color del equipo', () => {
  for (const kind of ['blindado', 'lanzacohetes']) {
    const l = letras(SPRITES[kind].anims.wreck[0]);
    for (const c of ['t', 'h', 'd']) assert.ok(!l.has(c), `${kind} wreck con "${c}"`);
  }
});

test('el lobo se distingue a la escala del mapa: más alto que el tanque y más grande que un jeep', () => {
  assert.ok(SPRITES.lobo.h >= SPRITES.tanque.h + 6);
  assert.ok(SPRITES.lobo.w * SPRITES.lobo.h > SPRITES.jeep.w * SPRITES.jeep.h);
  assert.ok(SPRITES.francotirador.w > SPRITES.soldado.w, 'el rifle largo ensancha al francotirador');
});

test('units.js: sombra, altura, zancada y marcas del LOD para todos los tipos de tierra', () => {
  for (const k of GROUND_KINDS) {
    assert.ok(SOMBRA[k]?.[0] > 0, `SOMBRA.${k}`);
    assert.ok(ALTURA[k] > 0, `ALTURA.${k}`);
    assert.ok(ZANCADA[k] > 0, `ZANCADA.${k}`);
    assert.ok(MARCAS[k]?.[0] > 0 && MARCAS[k][1] > 0, `MARCAS.${k}`);
    assert.ok(KIND_WEIGHT[k] >= 1, `KIND_WEIGHT.${k}`);
  }
  assert.ok(MARCAS.lobo[0] >= MARCAS.pesado[0] + 1, 'la marca del lobo se ve más grande que la del pesado');
});

test('auto.js repite el roster de tierra (la vista no importa del sim)', () => {
  assert.deepEqual(Object.keys(KIND_WEIGHT), [...GROUND_KINDS]);
});

// ------------------------------------------------------------------------------------------------------------- efectos

const mundoFalso = (step = 10) => ({
  step,
  cfg: DEFAULTS,
  units: [],
  planes: [],
  bombs: [],
  bases: [
    { frontX: 90, turrets: [{ x: 100, y: 242 }] },
    { frontX: 1350, turrets: [{ x: 1340, y: 242 }] },
  ],
});
const escena = () => createScene({ teamHex: ['#E5484D', '#5BC8F5'], sprites: SPRITES });
const TIPO = { spark: 0, smoke: 1, fire: 2, dust: 3, debris: 4, muzzle: 6 };
const deTipo = (fx, ty) => fx.particles.filter((p) => p.a && p.ty === ty);
const tam = (fx) =>
  fx.booms
    .filter((b) => b.a)
    .map((b) => b.R)
    .sort((a, b) => a - b);

test('A_PIE: soldado, francotirador y lobo dejan un cuerpo que se desvanece; los vehículos, una carcasa que arde', () => {
  assert.deepEqual([...A_PIE].sort(), ['francotirador', 'lobo', 'soldado']);
});

test('muerte: el francotirador cae como un soldado (polvo, sin explosión) y el blindado explota mediano', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'death', id: 1, kind: 'francotirador', side: 0, x: 300, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), []);
  assert.ok(deTipo(sc.fx, TIPO.dust).length >= 1);
  sc.consume([{ type: 'death', id: 2, kind: 'blindado', side: 0, x: 400, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), [11]);
});

test('muerte: el lanzacohetes explota grande y sus cohetes revientan después (secundarias); no cae en el «huge» del pesado', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'death', id: 1, kind: 'lanzacohetes', side: 0, x: 300, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), [18]);
  for (let i = 0; i < 5; i++) sc.fx.update(0.25, w);
  assert.ok(sc.fx.stats.secondary >= 2, `secundarias: ${sc.fx.stats.secondary}`);
});

test('muerte del lobo: gran nube de polvo y chispas blancas, sin explosión y sin nada rojo', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'death', id: 1, kind: 'lobo', side: 1, x: 900, y: 300 }], w);
  assert.deepEqual(tam(sc.fx), []);
  assert.ok(deTipo(sc.fx, TIPO.dust).length >= 6, 'nube de polvo grande');
  for (const p of sc.fx.particles.filter((q) => q.a)) assert.doesNotMatch(String(p.c ?? ''), /^#(E5|FF0|D9)/i);
  assert.equal(sc.fx.wrecks.length, 1);
});

test('el cuerpo del lobo y del francotirador se desvanece como el del soldado (3,1 s), el vehículo dura 7,5 s', () => {
  const sc = escena();
  const w = mundoFalso(0);
  sc.consume(
    [
      { type: 'death', id: 1, kind: 'lobo', side: 0, x: 100, y: 300 },
      { type: 'death', id: 2, kind: 'francotirador', side: 0, x: 200, y: 300 },
      { type: 'death', id: 3, kind: 'blindado', side: 0, x: 300, y: 300 },
    ],
    w,
  );
  sc.fx.prune(4 * 30);
  assert.deepEqual(
    sc.fx.wrecks.map((r) => r.kind),
    ['blindado'],
  );
});

test('disparo del francotirador: trazador largo y fino (proyectil kind 2), fogonazo chico, vuela rápido', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'shot', id: 1, kind: 'francotirador', x: 300, y: 300, tx: 450, ty: 300 }], w);
  assert.equal(sc.projectiles.length, 1);
  const p = sc.projectiles[0];
  assert.equal(p.kind, 2);
  const dist = Math.hypot(450 - 300 - 6, 0);
  assert.ok(p.dur <= Math.ceil((dist / DEFAULTS.projectiles.sniper) * 30) / 30 + 0.05, `dur ${p.dur}`);
  assert.equal(deTipo(sc.fx, TIPO.muzzle).length, 1);
});

test('disparo del lanzacohetes: cohete con arco (kind 3), fogonazo y humo de boca grandes; estalla al llegar con cráter', () => {
  const sc = escena();
  const w = mundoFalso(100);
  sc.consume([{ type: 'shot', id: 1, kind: 'lanzacohetes', x: 800, y: 300, tx: 980, ty: 300 }], w);
  const p = sc.projectiles[0];
  assert.equal(p.kind, 3);
  assert.ok(p.arc > 0);
  assert.ok(deTipo(sc.fx, TIPO.smoke).length >= 1, 'humo de boca');
  w.step = 100 + Math.round(p.dur * 30);
  sc.consume([], w);
  assert.ok(tam(sc.fx).length >= 1, 'estalla');
  assert.equal(sc.craters.length, 1, 'cava un cráter (iba a un punto del campo)');
});

test('disparo del blindado: bala normal (kind 0)', () => {
  const sc = escena();
  sc.consume([{ type: 'shot', id: 1, kind: 'blindado', x: 300, y: 300, tx: 380, ty: 300 }], mundoFalso());
  assert.equal(sc.projectiles[0].kind, 0);
});

test('zarpazo del lobo: no hay proyectil, hay un tajo de chispas blancas y amarillas delante de él', () => {
  const sc = escena();
  const w = mundoFalso();
  sc.consume([{ type: 'shot', id: 1, kind: 'lobo', x: 300, y: 300, tx: 320, ty: 300 }], w);
  assert.equal(sc.projectiles.length, 0);
  const ch = deTipo(sc.fx, TIPO.spark);
  assert.ok(ch.length >= 5, `chispas del tajo: ${ch.length}`);
  assert.ok(
    ch.every((p) => p.x > 300),
    'delante del lobo',
  );
  assert.ok(
    ch.every((p) => /^#(FFFFFF|FFE680|FFD84A)$/i.test(p.c)),
    'blanco y amarillo',
  );
  const sc2 = escena();
  sc2.consume([{ type: 'shot', id: 1, kind: 'lobo', x: 900, y: 300, tx: 880, ty: 300 }], w);
  assert.ok(
    deTipo(sc2.fx, TIPO.spark).every((p) => p.x < 900),
    'espejado hacia el oeste',
  );
});

test('createFx expone el tajo y los temblores del lobo (muerte: shake 2)', () => {
  const fx = createFx({ seed: 'efectos:lobo' });
  assert.equal(typeof fx.claw, 'function');
});

// ---------------------------------------------------------------------------------- cartel del donante, feed y F2

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };

test('regalo de lobo: el cartel del donante sale por el momento de regalo grande, con su propio texto', () => {
  const registry = createRegistry({ teams: [PE, MX] });
  const router = buildRouter({}).router;
  const audience = createAudience({ registry, router });
  const bigs = [];
  const flow = createFlow({
    audience,
    match: { command: () => ({}), world: null, pair: { teams: [{ name: 'Perú' }, { name: 'México' }] } },
    rig: { bigGift: (g) => bigs.push(g) },
    banners: { note() {} },
  });
  flow.ready();
  flow.push({
    type: 'gift',
    userId: 'u1',
    uniqueId: 'u1',
    nickname: 'Ana',
    giftName: 'Universe',
    coins: 3000,
    count: 1,
  });
  flow.push({ type: 'gift', userId: 'u1', uniqueId: 'u1', nickname: 'Ana', giftName: 'Rose', coins: 1, count: 1 });
  assert.equal(bigs.length, 1);
  assert.equal(bigs[0].hero, 'lobo');
  assert.equal(bigs[0].giftName, 'Universe');

  const reg2 = createRegistry({ teams: [PE, MX] });
  reg2.touch({ userId: 'u1', uniqueId: 'u1', nickname: 'Ana', avatar: '' });
  const b = createBanners({ registry: reg2 });
  b.gift([
    {
      kind: 'wolf',
      owner: reg2.touch({ userId: 'u1', uniqueId: 'u1', nickname: 'Ana', avatar: '' }).key,
      giftName: 'Universe',
    },
  ]);
  b.update(0, false);
  b.update(0.5, false);
  assert.match(b.current().text, /Hombre lobo/);
  assert.match(b.current().text, /Ana/);
});

test('el momento de regalo grande conserva el aviso de lobo (`hero`)', async () => {
  const { createMoments, createHeat } = await import('../public/js/camera/auto.js');
  const m = createMoments({ heat: createHeat() });
  m.gift({ coins: 3000, big: true, hero: 'lobo', giftName: 'U', owner: 'k', x: 1, y: 2 }, { step: 0, reduced: false });
  const [b] = m.drainBanners();
  assert.equal(b.kind, 'wolf');
});

test('el feed avisa cuando un lobo se convierte en pesados (evento loboConverted del sim)', () => {
  const reg = createRegistry({ teams: [PE, MX] });
  const k = reg.touch({ userId: 'u1', uniqueId: 'u1', nickname: 'Ana', avatar: '' }).key;
  const b = createBanners({ registry: reg });
  b.consume([{ type: 'loboConverted', side: 0, owner: k, lobos: 1, pesados: 3, value: 3000 }], () => 'Perú');
  const [linea] = b.feed();
  assert.match(linea.text, /Ana/);
  assert.match(linea.text, /3 pesados/);
  assert.equal(S.feed.wolfConverted('Ana', 3), linea.text);
});

test('simulador F1: un regalo por tramo de la tabla (de 1 a 3000 monedas), con nombres neutros', () => {
  const monedas = SIM_GIFTS.map((g) => g.coins);
  for (const c of [1, 5, 10, 30, 100, 300, 500, 1000, 3000]) assert.ok(monedas.includes(c), `falta el botón de ${c}`);
  const router = buildRouter({}).router;
  const unidades = new Set();
  for (const g of SIM_GIFTS) {
    let t = router.tiers[0];
    for (const x of router.tiers) if (g.coins >= x.minCoins) t = x;
    unidades.add(t.unit);
  }
  assert.equal(unidades.size, router.tiers.length, 'cada botón cae en un tramo distinto');
  // los tramos sin regalo conocido no inventan nombres de TikTok: botón por monedas
  for (const g of SIM_GIFTS.filter((x) => [10, 300, 3000].includes(x.coins)))
    assert.match(g.name, /monedas$/, `${g.name} debe ser un nombre neutro «N monedas»`);
  const lobo = SIM_GIFTS.find((g) => g.coins === 3000);
  assert.ok(lobo.autoWeight > 0 && lobo.autoWeight < 1, 'el lobo sale poco en el tráfico automático');
});

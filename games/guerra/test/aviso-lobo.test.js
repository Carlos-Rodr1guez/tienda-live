import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '@tienda/kit/sim/registry.js';
import { createBanners } from '../public/js/ui/banners.js';

// v2.9: el aviso grande «X invocó al Hombre lobo» tiene prioridad sobre los avisos de ascenso: ni queda detrás de una cola
// de ascensos ni lo tapa o reemplaza uno que justo estaba en pantalla (el regalo del lobo suele ascender a su dueño en el
// mismo paso: el ascenso entra a la cola ANTES que el aviso del lobo, que llega después con los momentos de la cámara).

const PE = { id: 'pe', name: 'Perú', iso: 'PE', aliases: ['peru'] };
const MX = { id: 'mx', name: 'México', iso: 'MX', aliases: ['mexico'] };

function armar() {
  const registry = createRegistry({ teams: [PE, MX] });
  const ana = registry.touch({ userId: 'u1', uniqueId: 'u1', nickname: 'Ana', avatar: '' }).key;
  const beto = registry.touch({ userId: 'u2', uniqueId: 'u2', nickname: 'Beto', avatar: '' }).key;
  const banners = createBanners({ registry });
  return { banners, ana, beto };
}
const ascenso = (key, to = 7) => ({ type: 'rankUp', key, to, team: 1 });
const lobo = (owner) => ({ kind: 'wolf', owner, giftName: '3000 monedas' });

test('el ascenso de Coronel del mismo paso no pasa por delante del aviso del lobo', () => {
  const { banners, ana } = armar();
  banners.consume([ascenso(ana)]); // primero entra el ascenso (onStep) ...
  banners.gift([lobo(ana)]); // ... y después el momento del lobo (cuadro)
  banners.update(10, false);
  assert.match(banners.current().text, /Hombre lobo/, 'lo primero en pantalla es el lobo');
  assert.equal(banners.current().kind, 'wolf');
  // el ascenso no se pierde: sale después del lobo
  banners.update(10 + 2.4 + 0.01, false);
  assert.match(banners.current().text, /Coronel/);
});

test('un ascenso que ya estaba en pantalla se cede al lobo en cuanto llega (el lobo no espera ni queda tapado)', () => {
  const { banners, ana, beto } = armar();
  banners.consume([ascenso(beto)]);
  banners.update(5, false);
  assert.match(banners.current().text, /Coronel/, 'el ascenso está en pantalla');
  banners.gift([lobo(ana)]);
  banners.update(5.2, false);
  assert.equal(banners.current().kind, 'wolf', 'el lobo toma la pantalla de inmediato');
  // mientras dura el aviso del lobo, ningún ascenso nuevo lo reemplaza
  banners.consume([ascenso(beto, 8)]);
  for (const t of [5.5, 6, 6.5, 7, 7.5]) {
    banners.update(t, false);
    assert.equal(banners.current().kind, 'wolf', `a los ${t} s sigue el lobo`);
  }
  banners.update(5.2 + 2.4 + 0.01, false);
  assert.match(banners.current().text, /General/, 'después sale el ascenso');
});

test('con una cola larga de ascensos, el lobo salta al frente (y varios lobos siguen en orden de llegada)', () => {
  const { banners, ana, beto } = armar();
  for (let i = 0; i < 8; i++) banners.consume([ascenso(beto, 6 + (i % 3))]);
  banners.gift([lobo(ana)]);
  banners.gift([lobo(beto)]);
  banners.update(0, false);
  assert.equal(banners.current().kind, 'wolf');
  assert.match(banners.current().text, /Ana/);
  banners.update(2.5, false);
  assert.equal(banners.current().kind, 'wolf');
  assert.match(banners.current().text, /Beto/);
  banners.update(5, false);
  assert.equal(banners.current().kind, 'rank', 'recién entonces siguen los ascensos');
});

test('un aviso de avión o de regalo grande que ya está en pantalla no lo corta el lobo (solo cede un ascenso)', () => {
  const { banners, ana } = armar();
  banners.gift([{ kind: 'plane', owner: ana, giftName: 'Airplane' }]);
  banners.update(0, false);
  assert.equal(banners.current().kind, 'plane');
  banners.gift([lobo(ana)]);
  banners.update(0.5, false);
  assert.equal(banners.current().kind, 'plane', 'el avión termina su tiempo');
  banners.update(2.5, false);
  assert.equal(banners.current().kind, 'wolf');
});

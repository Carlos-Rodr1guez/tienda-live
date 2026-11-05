// Definición de equipos y unidades. Todo lo de balance vive aquí.
// Coordenadas del juego: x = izquierda/derecha, z = arriba(-)/abajo(+), y = altura.

export const TEAM = { DEF: 0, INV: 1 };
export const TEAM_LABEL = ['Defensores', 'Invasores'];

// hp: vida · speed: unidades/seg · radius: tamaño físico · range: alcance de disparo
// dmg: daño por disparo · rate: segundos entre disparos · splash: radio de daño en área
// aggro: distancia a la que detecta enemigos · hitsAir: puede atacar unidades que vuelan
// flying + altitude: vuela a esa altura · weapon: rifle | cannon | rockets | laser
export const UNITS = {
  dron: {
    name: 'Dron', plural: 'Drones',
    hp: 30, speed: 4.4, radius: 0.6, range: 6, dmg: 4, rate: 0.7, splash: 0,
    aggro: 12, hitsAir: true, flying: true, altitude: 3.2, height: 0.6, weapon: 'rifle',
  },
  caza: {
    name: 'Caza', plural: 'Cazas',
    hp: 55, speed: 4.2, radius: 0.8, range: 7, dmg: 7, rate: 0.6, splash: 0,
    aggro: 13, hitsAir: true, flying: true, altitude: 3.8, height: 0.7, weapon: 'rifle',
  },
  bombardero: {
    name: 'Bombardero', plural: 'Bombarderos',
    hp: 700, speed: 2.6, radius: 1.5, range: 9.5, dmg: 70, rate: 1.5, splash: 2.4,
    aggro: 16, hitsAir: true, flying: true, altitude: 5.2, height: 1.2, weapon: 'cannon', projSpeed: 24,
  },
  coloso: {
    name: 'Coloso', plural: 'Colosos',
    hp: 9000, speed: 1.9, radius: 1.8, range: 9, dmg: 120, rate: 0.55, splash: 2.6,
    aggro: 18, hitsAir: true, flying: false, height: 5.2, muzzle: 0.82, weapon: 'laser',
  },
  acorazado: {
    name: 'Acorazado', plural: 'Acorazados',
    hp: 90000, speed: 1.0, radius: 4.2, range: 15, dmg: 150, rate: 0.3, splash: 2.6,
    aggro: 24, hitsAir: true, flying: true, altitude: 9, height: 2.4, weapon: 'laser', multi: 3,
  },
  comandante: {
    name: 'Comandante', plural: 'Comandantes',
    hp: 900, speed: 8.5, radius: 1, range: 12, dmg: 26, rate: 0.16, splash: 0,
    aggro: 12, hitsAir: true, flying: true, altitude: 3, height: 0.8, weapon: 'rifle',
  },
};

// Nombres de la versión anterior (soldado, tanque, recluta) siguen funcionando en config.json.
export const ALIASES = { soldado: 'caza', tanque: 'bombardero', recluta: 'dron' };
export const resolveKind = (kind) => (UNITS[kind] ? kind : ALIASES[kind] || kind);

// Torretas fijas de la base (siempre del lado defensor).
export const TURRET = { range: 14, dmg: 30, rate: 0.45 };

export const BIG_UNITS = new Set(['coloso', 'acorazado']);
export const isBig = (kind) => BIG_UNITS.has(kind);

export function unitLabel(kind, count) {
  const u = UNITS[resolveKind(kind)];
  if (!u) return kind;
  return count === 1 ? u.name : u.plural;
}

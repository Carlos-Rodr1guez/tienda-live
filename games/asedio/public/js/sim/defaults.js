// Configuración por defecto del juego. config.json (raíz del proyecto) puede
// sobrescribir cualquier valor dentro de "game"; lo que no pongas se toma de aquí.

export const DEFAULT_CONFIG = {
  title: 'ASEDIO',

  round: {
    seconds: 240, // duración de cada ronda
    introSeconds: 4, // cuenta regresiva antes de empezar
    intermission: 12, // pantalla de resultados entre rondas
    baseHp: 30000, // vida de la base del streamer
  },

  teams: {
    // A qué equipo va alguien que manda un regalo sin haber elegido:
    // "balance" (al equipo con menos gente), "defensores" o "invasores".
    defaultTeam: 'balance',
    allowSwitch: true,
    // La primera palabra del comentario puede ser cualquiera de estas (incluidos 1 y 2).
    // Más adelante en el comentario solo cuentan las palabras, no los números.
    joinWords: {
      defensores: ['1', 'def', 'defensa', 'defender', 'defensor', 'defensores', 'defiendo', 'azul'],
      invasores: ['2', 'inv', 'invadir', 'invasor', 'invasores', 'invado', 'atacar', 'ataco', 'rojo'],
    },
  },

  // Regalos por valor en monedas. Se usa el nivel más alto cuyo minCoins
  // alcance el regalo. Cantidad = monedas / coinsPerUnit (hasta maxPerGift).
  tiers: [
    { minCoins: 1, unit: 'caza', coinsPerUnit: 1, maxPerGift: 10, example: 'Rosa' },
    { minCoins: 10, unit: 'bombardero', coinsPerUnit: 10, maxPerGift: 5, example: 'Rosquilla' },
    { minCoins: 100, unit: 'coloso', coinsPerUnit: 100, maxPerGift: 4, example: 'Corazón con las manos' },
    { minCoins: 1000, unit: 'acorazado', coinsPerUnit: 1000, maxPerGift: 3, example: 'Galaxia' },
  ],

  // Opcional: un regalo concreto (por nombre, como llega de TikTok) a una unidad fija.
  // Ejemplo: { "Galaxy": { "unit": "acorazado", "count": 1 } }
  giftOverrides: {},

  likes: { perReinforcement: 300, unit: 'caza', count: 3 },
  follow: { unit: 'caza', count: 2 },
  share: { unit: 'caza', count: 3 },
  joinSpawn: { enabled: true, unit: 'dron', count: 1 },

  // Energía por comentarios: cada comentario de alguien con bando carga la barra de su equipo
  // (como mucho uno cada userCooldown segundos por persona). Con perCharge comentarios cae
  // un bombardeo de equipo: strikes impactos de radio radius y daño dmg. baseDmg es lo que
  // le quita a la base el bombardeo de los Invasores cuando cae encima.
  energy: {
    enabled: true,
    perCharge: 15,
    userCooldown: 3,
    strike: { strikes: 3, radius: 5, dmg: 900, baseDmg: 1200 },
  },

  // Oleadas automáticas de invasores para que siempre haya acción.
  cpu: {
    enabled: true,
    firstWaveAt: 6,
    interval: 9,
    minInterval: 5,
    baseCount: 2,
    growthPerMinute: 2,
    tankAfter: 90,
    bossAt: 160,
  },

  limits: { maxUnitsPerTeam: 220, spawnsPerSecond: 40, maxQueue: 1500 },

  commander: { respawnSeconds: 6, strikeCooldown: 9, dashCooldown: 3 },

  // Modelos .glb en /models. rotateY en grados, scale multiplica el tamaño automático,
  // tint mezcla el color del equipo (0 a 1) cuando no hay versión _inv del modelo,
  // tintMaterial tiñe solo ese material (por ejemplo la carcasa del robot).
  models: {
    dron: { rotateY: 180, scale: 1, tint: 0.35 },
    caza: { rotateY: 180, scale: 1, tint: 0.35 },
    bombardero: { rotateY: 180, scale: 1, tint: 0.35 },
    coloso: { rotateY: 180, scale: 1, tintMaterial: 'Main', tint: 0.85 },
    acorazado: { rotateY: 180, scale: 1, tint: 0.35 },
    comandante: { rotateY: 180, scale: 1, tint: 0 },
    base: { scale: 2 },
    escenario: { scale: 2 },
  },

  // Marco para tu cámara (abajo a la derecha). La cámara la pones en LIVE Studio encima del marco;
  // con F3 el marco muestra la posición exacta. size agranda o achica el marco (1 = normal).
  camera: { enabled: false, size: 1 },

  // Gráficos: apaga el brillo (bloom) si tu PC se pone lenta.
  // cinematics: la cámara se acerca a cada Coloso o Acorazado que llega por un regalo.
  // pixelRatio: 0 = automático (según tu pantalla); 1.5 o 2 = más nítido para el directo, pero más pesado.
  // shake: temblor de cámara (1 = normal, 0 = sin temblor; menos temblor = menos cuadraditos en el directo).
  graphics: { bloom: true, bloomStrength: 0.85, cinematics: true, pixelRatio: 0, shake: 1 },

  // music: música de fondo (CC0). Ponla en false si pones tu propia música en el directo.
  audio: { volume: 0.5, music: true, musicVolume: 0.35 },
};

export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  if (base === null || typeof base !== 'object' || over === null || typeof over !== 'object') return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

// Textos visibles de Batalla de países (diseño D24, CB-4): el ÚNICO lugar del juego con texto que ve el público o el
// narrador. Español neutro, de "tú". Ninguna de las palabras de la lista prohibida del proyecto (se dice "en vivo" o
// "transmisión"; la lista vive solo en `test/support/forbidden-words.js`); el escáner de `test/strings.test.js` recorre todo lo que sale de aquí, llamando cada plantilla con
// nombres del peor caso, y `test/deviations.test.js` (CB-2) vigila además que este directorio no diga la palabra del
// símbolo nacional. Por eso la leyenda de los íconos dice "Defensa" y "Ataque" y no nombra las formas dibujadas.
//
// Las plantillas aceptan cualquier tipo de argumento y siempre devuelven un texto: lo que llega del público nunca debe
// romper una pantalla. El recorte por ancho es del dibujo (`ui/text.js`), no de la plantilla.
//
// Módulo puro: sin DOM, sin reloj, sin azar.

/** Texto de un valor cualquiera. */
const t = (v) => {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try {
    return String(v);
  } catch {
    return ''; // un objeto sin `toString` (por ejemplo `Object.create(null)`) no rompe la pantalla
  }
};
/** Entero mostrable: finito, entre 0 y 999 999 999 (nada de "NaN" ni de notación científica en pantalla). */
const n = (v) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(999_999_999, Math.max(0, x)) : 0;
};

/** A dónde vuelve el juego al restaurar la sesión (F2). */
const SESSION_STATES = {
  waitingNextRound: 'esperando la ronda siguiente',
  lobby: 'sala',
  selector: 'selector de pares',
};

const deepFreeze = (o) => {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const S = deepFreeze({
  /** Título del juego (también el `<title>` de index.html). */
  title: 'Batalla de países',
  /** Texto exacto de la pausa (NM-9). */
  pause: 'Pausa: el narrador vuelve enseguida',
  /** Lo que se muestra en lugar del nombre de un espectador oculto o vetado (KIT-13). */
  anon: 'anónimo',
  /** Rótulos de las teclas (la ayuda H y el botón de avance los toman de aquí) y los avisos de las que piden confirmar. */
  keys: {
    enter: 'Enter',
    escTwice: 'Esc ×2',
    shiftNTwice: 'Shift+N ×2',
    altZ: 'Alt+Z',
    shiftS: 'Shift+S',
    space: 'Espacio',
    arrows: 'Flechas',
    zoomIn: '+',
    zoomOut: '-',
    click: 'Clic',
    altClick: 'Alt+clic',
    /** Primer Esc: se confirma con otro en 2 s. */
    endConfirm: 'Pulsa Esc otra vez en 2 segundos para terminar el partido',
    ended: 'Partido terminado',
  },
  /** Ayuda de atajos (H): lo que hace cada acción del mapa de `ui/keys.js`; las teclas salen del mapa. Cada línea cabe sin recortarse. */
  help: {
    title: 'Atajos del narrador',
    advance: 'Continuar / elegir par',
    pause: 'Pausa y reanudar',
    endMatch: 'Terminar el partido',
    scoreboard: 'Marcador grande (6 s)',
    top3: 'Top 3 del partido (6 s)',
    followNext: 'Seguir al siguiente',
    followStop: 'Dejar de seguir',
    autoCam: 'Cámara automática',
    viewAll: 'Ver todo el mapa',
    base1: 'Base izquierda',
    base2: 'Base derecha',
    hottest: 'Pelea más caliente',
    pan: 'Mover la cámara',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    frame: 'Marco del narrador',
    reduced: 'Movimiento reducido',
    help: 'Esta ayuda',
    undo: 'Deshacer ocultamiento',
    newLive: 'Nuevo en vivo (selector)',
    names: 'Ocultar los nombres',
    mute: 'Sonido',
    sim: 'Simulador',
    perf: 'Rendimiento',
    safe: 'Zonas seguras',
    click: 'Seguir a ese donante',
    altClick: 'Ocultar a ese donante',
  },
  /** Moderación (NM-11): los avisos nunca llevan el nombre. */
  moderation: {
    hidden: 'Donante oculto',
    undone: 'Se deshizo el último ocultamiento',
    nothingToUndo: 'No hay nada que deshacer',
    namesHidden: 'Nombres ocultos',
    namesShown: 'Nombres visibles',
  },
  spotlight: {
    none: 'No hay donantes en el campo',
    stopped: 'Seguimiento terminado',
  },
  /** Superposiciones del narrador (G y T). */
  overlays: {
    scoreboard: 'Marcador',
    top3: 'Mejores del partido',
    leader: 'Va primero',
  },
  safeZones: {
    label: 'Zona segura',
  },
  audio: {
    on: 'Sonido: activado',
    off: 'Sonido: desactivado',
  },
  /** Marco del narrador (NM-10). */
  frame: 'EN VIVO · NARRADOR',
  /** Textos fijos de index.html (el HTML los repite tal cual y una prueba compara). */
  noscript: 'Esta página necesita JavaScript para mostrar el juego.',
  canvasLabel: 'Campo de batalla',

  camera: {
    barLabel: 'Cámara',
    /** Estado que se lee aparte (NM-4): lo que hace la cámara ahora. */
    auto: 'CÁMARA AUTO',
    manual: 'CÁMARA MANUAL',
    /** Botones: dicen lo que hacen al pulsarlos (S3 de la revisión de 5c). */
    viewAll: 'Ver todo',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    /** Botón de ALTERNAR (aria-pressed): su rótulo es fijo y no copia el estado, que se lee aparte en el panel central. */
    autoButton: 'CÁMARA AUTO',
    /** Avisos de la tecla A (y de R, que también apaga la automática). */
    autoOn: 'Cámara automática: activada',
    autoOff: 'Cámara automática: desactivada',
  },

  motion: {
    on: 'Movimiento reducido: activado',
    off: 'Movimiento reducido: desactivado',
  },

  /** Leyenda de los íconos de rol: junto a los íconos dibujados, sin nombrar sus formas (nota 40). */
  legend: {
    defensa: 'Defensa',
    ataque: 'Ataque',
  },

  hud: {
    percent: (v) => `${Math.min(100, n(v))} %`,
    round: (r, total) => `Ronda ${Math.max(1, n(r))}/${Math.max(1, n(total))}`,
    /** Tiempo que queda de la ronda, "m:ss". */
    clock: (seconds) => {
      const s = n(seconds);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },
    members: (count) => `${n(count)} unidos`,
    /** Primera línea del riel de unión; la segunda es el nombre del país (se recorta aparte). */
    joinPrefix: (num) => `Comenta ${n(num)} o`,
    likes: 'Likes',
    energy: 'Energía',
    noTroops: 'Sin tropas en el campo',
    /** Para el feed del adaptador del público (lote 6b): lo que no entra en la cola y el tope por regalo. */
    queued: (count) => `+${n(count)} en cola`,
  },

  feed: {
    empty: 'Sin novedades',
    join: (nombre, pais) => `${t(nombre)} se unió a ${t(pais)}`,
    /** Un regalo que pasó el tope de unidades por regalo (el valor se conserva en las que salen). */
    maxPerGift: (nombre) => `${t(nombre)}: máx. por regalo`,
    /** Los likes de un equipo juntaron refuerzos (el dueño es "Likes", no un usuario). */
    reinforcements: (pais, count) => `Refuerzos para ${t(pais)}: +${n(count)}`,
  },

  banners: {
    rankUp: (nombre, rango) => `${t(nombre)} ascendió a ${t(rango)}`,
    gift: (nombre, regalo) => `${t(nombre)} envió ${t(regalo)}`,
    /** Regalo grande cuando todavía no se conoce el nombre del regalo (el adaptador de 6b lo trae). */
    giftNoName: (nombre) => `${t(nombre)} envió un regalo grande`,
    plane: (nombre, regalo) => `${t(nombre)} envió ${t(regalo)}: bombardeo`,
    /** Cuando todavía no se conoce el nombre del regalo (el adaptador del público lo trae en el lote 6b). */
    planeNoGift: (nombre) => `${t(nombre)} lanzó un bombardeo`,
  },

  connection: {
    demo: 'DEMO',
    connecting: 'Conectando con la transmisión…',
    connected: 'Conectado',
    reconnecting: 'Reconectando…',
    noUser: 'Sin usuario de TikTok',
    noConnection: 'Sin conexión con TikTok',
  },

  errors: {
    /** Puente perdido: nombra el problema y la salida (CB-17). */
    bridgeLost:
      'Se perdió la conexión con TikTok. Revisa que la transmisión en vivo siga activa; el juego reintenta solo.',
    /** Errores de la conexión que no se arreglan solos: qué falló y cómo arreglarlo. */
    noUser:
      'No hay usuario de TikTok. Escribe tu usuario en config.json o pásalo al arrancar; mientras tanto puedes probar con F1.',
    noDeps:
      'Falta instalar las dependencias de la conexión con TikTok. Cierra el juego, ejecuta npm install y vuelve a abrirlo.',
    config: (detalle) => `La configuración tiene un error: ${t(detalle)}`,
    configExit: 'Corrígelo en config.json y recarga la página.',
    data: (detalle) => `No se pudo leer la lista de países: ${t(detalle)}`,
    dataExit: 'Revisa los datos del juego y recarga la página.',
    title: 'El juego no puede empezar',
  },

  matchup: {
    title: 'Elige los dos países',
    left: 'Equipo izquierdo',
    right: 'Equipo derecho',
    start: 'Elegir el par',
    needTwo: 'Elige dos países distintos para empezar',
    preview: (a, b) => `${t(a)} vs ${t(b)}`,
    fort: 'Fortín',
    citadel: 'Ciudadela',
    loading: 'Cargando países…',
    empty: 'No hay países para elegir',
  },

  lobby: {
    versus: (a, b) => `${t(a)} vs ${t(b)}`,
    join: (a, b) => `Comenta 1 o ${t(a)} · 2 o ${t(b)} para unirte`,
    empty: 'Nadie se unió todavía',
    members: (count) => `${n(count)} unidos`,
    more: (count) => `+${n(count)} más`,
    /** Acción de avance de la sala: la tecla se dibuja aparte, como rótulo. */
    start: 'Empezar el partido',
  },

  roundEnd: {
    win: (pais) => `¡${t(pais)} gana la ronda!`,
    mvp: (pais) => `MVP de ${t(pais)}`,
    next: 'El narrador inicia la siguiente ronda',
    xp: (v) => `${n(v)} XP`,
  },

  matchEnd: {
    win: (pais) => `¡${t(pais)} gana la batalla!`,
    mvp: 'MVP del partido',
    best: (pais) => `Mejores de ${t(pais)}`,
    empty: 'Sin regalos',
    back: 'Volver al selector',
    xp: (v) => `${n(v)} XP`,
  },

  newLive: {
    confirm:
      'Pulsa Shift+N otra vez en 2 segundos para empezar un nuevo en vivo. Se reinician los rangos, la XP y los nombres ocultos.',
    done: 'Nuevo en vivo: se reiniciaron los rangos',
    blocked: 'Termina el partido para empezar un nuevo en vivo',
  },

  /** Panel de rendimiento F2: etiquetas y palabras de los valores. */
  f2: {
    fps: 'cuadros por segundo',
    configWarning: 'aviso de la config de regalos',
    msSim: 'ms sim',
    msWorld: 'ms mundo',
    msUi: 'ms interfaz',
    msFx: 'ms efectos (dentro de mundo)',
    msWork: 'ms trabajo por cuadro',
    units: 'unidades',
    squads: 'grupos',
    planes: 'aviones',
    hits: 'golpes en vuelo',
    particles: 'partículas',
    drawCalls: 'llamadas de dibujo',
    culled: 'recortadas',
    scale: 'escala s',
    mode: 'modo de escala',
    lod: 'LOD',
    devicePass: 'pasada de dispositivo',
    bakeCount: 'sprites horneados (equipos)',
    canvases: 'lienzos reservados',
    hash: 'hash del paso',
    fxParticles: 'efectos: partículas',
    fxBooms: 'efectos: explosiones',
    fxCraters: 'efectos: cráteres',
    fxWrecks: 'efectos: restos',
    fxLarge: 'destellos grandes (último segundo)',
    labelsDrawn: 'etiquetas dibujadas',
    labelsSelected: 'etiquetas elegidas',
    labelsDropped: 'etiquetas descartadas por el layout',
    iconsDrawn: 'íconos de rol dibujados',
    camK: 'cámara k (objetivo / mostrado)',
    camMode: 'cámara',
    camIdle: 'segundos sin entrada del narrador',
    camAuto: 'cámara automática',
    camFocus: 'foco de la cámara (px de mundo)',
    goldenHash: 'hash dorado',
    goldenMatch: 'coincide con el dorado',
    yes: 'sí',
    no: 'no',
    marks: 'marcas',
    sprites: 'sprites',
    on: 'encendida',
    off: 'apagada',
    wholeMap: 'mapa entero',
    matches: 'sí coincide',
    noMatch: 'NO coincide',
    running: (step, steps) => `corriendo ${n(step)}/${n(steps)}`,
    withinBudget: 'dentro del presupuesto',
    workOver: (ms, max) => `trabajo ${t(ms)} ms > ${t(max)} ms`,
    fpsUnder: (fps, min) => `${t(fps)} fps < ${t(min)} fps`,
  },

  /** Sesión de la transmisión en memoria (F2, KIT-28). */
  session: {
    statusLabel: 'sesión de la transmisión',
    leftOutLabel: 'usuarios fuera de la copia',
    states: SESSION_STATES,
    none: 'sin cargar',
    restored: (users, state, dropped) =>
      `restaurada con ${n(users)} usuarios · ${Object.hasOwn(SESSION_STATES, t(state)) ? SESSION_STATES[t(state)] : t(state)}${n(dropped) > 0 ? ` · ${n(dropped)} descartados` : ''}`,
    empty: 'vacía: sesión nueva',
    off: 'sin servidor de sesión: no se guarda',
    failed: 'no se pudo cargar: el juego arranca vacío',
    retrying: 'reintentando',
    blocked: 'hay una copia guardada sin cargar: recarga la página para recuperarla',
    every: (secs) => `cada ${n(secs)} s`,
    invalid: 'copia inválida: el juego arranca vacío',
    saving: {
      idle: '',
      pending: 'guardando',
      ok: 'guardada',
      error: 'error al guardar (se reintenta)',
    },
    hiddenLeftOut: (count) => ` (+${n(count)} ocultos)`,
  },
});

// @ts-check
// El diccionario en español: todo texto visible del producto sale de acá (páginas, mensajes de la API y correo).
// Español neutral con "tú", sin voseo. La marca va como {marca} y se rellena con `fmt` y BRAND.name.
// Cada sección es una exportación con nombre, para que la web importe solo las que usa.
// Los textos de `respuestas` son los de la tabla de resultados de la especificación de la lista de espera.

/**
 * Congela un árbol de objetos y arreglos.
 * @template T
 * @param {T} nodo
 * @returns {T}
 */
function congelar(nodo) {
  if (typeof nodo === 'object' && nodo !== null) {
    for (const hijo of Object.values(nodo)) congelar(hijo);
    Object.freeze(nodo);
  }
  return nodo;
}

const SOLICITUD_ILEGIBLE = 'No pudimos leer tu solicitud. Recarga la página e inténtalo de nuevo.';

/** Mensajes de la API (campo `mensaje`) y textos por campo. */
export const respuestas = congelar({
  exito:
    'Casi listo. Si el correo es válido, te enviamos un mensaje para confirmar tu lugar. Si no llega en 10 minutos, revisa spam o inténtalo de nuevo más tarde.',
  campos_invalidos: 'Revisa los campos marcados e inténtalo de nuevo.',
  solicitud_invalida: SOLICITUD_ILEGIBLE,
  demasiado_grande: SOLICITUD_ILEGIBLE,
  origen_no_permitido: SOLICITUD_ILEGIBLE,
  verificacion_fallida: 'No pudimos verificar que eres una persona. Recarga la verificación e inténtalo de nuevo.',
  no_disponible: 'El registro no está disponible por ahora. Inténtalo de nuevo más tarde.',
  confirmado: 'Listo, tu correo quedó confirmado. Te avisaremos cuando haya novedades.',
  enlace_invalido:
    'Este enlace no es válido o ya venció. Si ya confirmaste, no tienes que hacer nada más. Si no, vuelve a anotarte para recibir uno nuevo.',
  no_encontrado: 'No encontramos lo que buscas.',
  error_interno: 'Algo salió mal de nuestro lado. Inténtalo de nuevo más tarde.',
  campos: {
    email: 'Escribe un correo válido, por ejemplo nombre@dominio.com.',
    tiktok_user: 'Usa de 2 a 24 letras, números, puntos o guiones bajos.',
    live_frequency: 'Elige una opción.',
    stream_type: 'Elige una opción.',
    interests: 'Elige entre 1 y 4 categorías.',
    followers_range: 'Elige una opción de la lista.',
    country: 'Elige una opción de la lista.',
    consent: 'Necesitamos tu consentimiento y que confirmes que tienes 18 años o más.',
  },
});

/** Correo de confirmación. Marcadores: {marca} y {enlace}. Solo lleva el enlace: sin imágenes ni seguimiento. */
export const correo = congelar({
  asunto: 'Confirma tu lugar en {marca}',
  texto: [
    'Hola:',
    '',
    'Recibimos una solicitud para anotar este correo en la lista de espera de {marca}. Si fuiste tú, confirma tu lugar abriendo este enlace:',
    '',
    '{enlace}',
    '',
    'El enlace sirve una sola vez y vence en 48 horas.',
    '',
    'Si no fuiste tú, ignora este mensaje: tu solicitud se borra sola pasados 7 días y no recibirás nada más.',
    '',
    '{marca}',
  ].join('\n'),
});

/**
 * Texto de consentimiento por versión. Una versión publicada no se edita: un cambio es una versión nueva
 * (y CONSENT_VERSION apunta a ella).
 */
export const consentimiento = congelar({
  v1: {
    texto:
      'Tengo 18 años o más y acepto que {marca} use mi correo y los datos que indiqué solo para avisarme de novedades de la lista de espera. Puedo pedir que borren mis datos cuando quiera.',
    enlacePrivacidad: 'Política de privacidad',
  },
});

/** Datos generales del sitio y de la portada. */
export const sitio = congelar({
  idioma: 'es',
  saltar: 'Ir al contenido',
  tituloInicio: '{marca}: juegos interactivos para tu LIVE',
  tituloPagina: '{titulo} | {marca}',
  descripcion:
    'Juegos que tu público controla con comentarios, likes y regalos mientras haces LIVE en TikTok. Anótate en la lista de espera.',
  borrador: 'Borrador: este texto aún no es definitivo.',
});

/** Portada: el primer pantallazo. El titular puede ajustarse cuando se elija la dirección visual. */
export const inicio = congelar({
  titulo: 'Tu público juega contigo en tu LIVE',
  bajada:
    'Juegos para TikTok LIVE que tu chat controla con comentarios, likes y regalos. Tú conduces el directo y el público decide qué pasa en el juego.',
  videoPosterAlt: 'Captura de ASEDIO LIVE: naves de dos bandos peleando sobre una base',
  videoProximamente: 'Video próximamente',
});

/** Cómo funciona, en tres verbos. */
export const pasos = congelar({
  titulo: 'Cómo funciona',
  lista: [
    { verbo: 'Instala', detalle: 'Ponlo en tu computadora y ábrelo en Chrome.' },
    { verbo: 'Captura', detalle: 'Agrega la ventana del juego a TikTok LIVE Studio u OBS, en formato vertical.' },
    {
      verbo: 'Juega con tu chat',
      detalle:
        'Tu público elige bando con comentarios y manda naves con likes y regalos, mientras tú juegas en cámara.',
    },
  ],
});

/** ASEDIO LIVE en la portada y la escalera de regalos. */
export const juego = congelar({
  titulo: 'ASEDIO LIVE',
  resumen:
    'Tu público elige bando y con sus regalos invoca naves y robots. Tú juegas como el Comandante y defiendes tu base en vivo.',
  escaleraTitulo: 'Más valor, unidad más grande',
  escaleraIntro: 'Cada regalo trae una unidad según su valor en monedas. Para el mismo valor, siempre llega la misma.',
  escalera: [
    { monedas: '1 a 9', unidad: 'Caza', detalle: 'Una nave ligera por moneda.' },
    { monedas: '10 a 99', unidad: 'Bombardero', detalle: 'Uno cada 10 monedas.' },
    { monedas: '100 a 999', unidad: 'Coloso', detalle: 'Un robot gigante.' },
    { monedas: '1000 o más', unidad: 'Acorazado', detalle: 'Una nave capital que baja del cielo.' },
  ],
  unirseGratis: 'Unirse al juego con un comentario es gratis.',
  verFicha: 'Ver la ficha de ASEDIO LIVE',
});

/** Introducción del bloque de categorías (los datos de cada una están en `opciones.categorias`). */
export const categorias = congelar({
  titulo: 'Cuatro tipos de juego',
  intro: 'Cada categoría cambia quién mueve la acción y qué haces tú durante el LIVE.',
  rolEtiqueta: 'Tu rol',
  idealParaEtiqueta: 'Ideal para',
  notaEtiqueta: 'Ten en cuenta',
});

/** Juegos que todavía son ideas. */
export const proximos = congelar({
  titulo: 'Próximos juegos',
  intro: 'Estos juegos aún son ideas. Lo que elijas al anotarte nos ayuda a decidir cuál sigue.',
  chip: 'Próximamente',
  provisional: 'Nombre provisional',
});

/** Preguntas frecuentes. */
export const faq = congelar({
  titulo: 'Preguntas frecuentes',
  preguntas: [
    {
      pregunta: '¿Tengo que estar en cámara durante el LIVE?',
      respuesta:
        'Sí. En todos los juegos estás presente en el directo: juegas, conduces o acompañas. Nada está pensado para dejarlo corriendo solo.',
    },
    {
      pregunta: '¿Mi público necesita regalar para participar?',
      respuesta:
        'No. En ASEDIO LIVE unirse con un comentario es gratis y el juego tiene acción aunque nadie regale. Los regalos son una forma más de participar.',
    },
    {
      pregunta: '¿Qué necesito para usarlo?',
      respuesta:
        'Una computadora, Google Chrome y una cuenta de TikTok con LIVE habilitado. TikTok pone sus propios requisitos para hacer LIVE y recibir regalos, como una edad mínima.',
    },
    {
      pregunta: '¿Qué hacen con mi correo?',
      respuesta:
        'Lo usamos solo para avisarte de novedades de la lista de espera. Si no confirmas tu correo, tu solicitud se borra sola a los 7 días. Puedes pedir que borren tus datos cuando quieras.',
    },
  ],
});

/** Las dos reglas que van visibles en la portada. */
export const reglas = congelar({
  titulo: 'Dos reglas que no cambian',
  presencia: {
    titulo: 'Tú estás en el LIVE',
    texto:
      'Cada juego necesita que estés en cámara. Puedes jugar, conducir o acompañar, pero nada corre sin ti en el directo.',
  },
  sinAzar: {
    titulo: 'Nada se decide por casualidad',
    texto:
      'El efecto de un regalo depende solo de su valor y siempre es el mismo. No hay rifas ni giros con resultado incierto.',
  },
});

/** Formulario de la lista de espera. Los errores por campo y los mensajes de la API están en `respuestas`. */
export const formulario = congelar({
  titulo: 'Anótate en la lista de espera',
  abrir: 'Quiero anotarme',
  opcional: '(opcional)',
  elegirOpcion: 'Elige una opción',
  enviar: 'Anotarme',
  enviando: 'Enviando…',
  reintentar: 'Intentar de nuevo',
  resumenErrores: 'Revisa estos campos:',
  exitoTitulo: 'Revisa tu correo',
  errorRed: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
  verificacionError: 'No pudimos cargar la verificación. Revisa tu conexión e inténtalo de nuevo.',
  noscript:
    'Para anotarte necesitas activar JavaScript en tu navegador: lo usamos para verificar que eres una persona.',
  grupos: {
    tu: 'Tú',
    live: 'Tu LIVE',
    interes: 'Qué te interesa',
    consentimiento: 'Consentimiento',
  },
  campos: {
    email: { etiqueta: 'Correo electrónico', ejemplo: 'nombre@dominio.com' },
    tiktok_user: { etiqueta: 'Usuario de TikTok', ejemplo: 'tu_usuario' },
    live_frequency: { etiqueta: '¿Cada cuánto haces LIVE?' },
    stream_type: { etiqueta: '¿Qué tipo de LIVE haces?' },
    followers_range: { etiqueta: 'Seguidores' },
    country: { etiqueta: 'País' },
    interests: { etiqueta: '¿Qué tipo de juegos te interesan?', ayuda: 'Elige entre 1 y 4.' },
  },
});

/**
 * Etiquetas de cada valor de cada enumeración de contracts. Las pruebas exigen una por valor.
 * `categorias` además lleva los datos de cada categoría (rolStreamer es un valor de STREAMER_ROLES).
 */
export const opciones = congelar({
  roles: {
    juega: 'Juegas',
    conduce: 'Conduces',
    acompana: 'Acompañas en cámara',
  },
  tiposDeLive: {
    gaming: 'Gaming',
    charla: 'Charla',
    musica: 'Música',
    estudio: 'Estudio',
  },
  frecuencia: {
    'todavia-no': 'Todavía no hago LIVE',
    ocasional: 'De vez en cuando',
    semanal: 'Una vez por semana',
    'varias-por-semana': 'Varias veces por semana',
    diario: 'Todos los días',
  },
  seguidores: {
    '0-99': 'Menos de 100',
    '100-999': '100 a 999',
    '1k-9k': '1000 a 9999',
    '10k-49k': '10 000 a 49 999',
    '50k+': '50 000 o más',
  },
  paises: {
    ES: 'España',
    AR: 'Argentina',
    MX: 'México',
    CO: 'Colombia',
    CL: 'Chile',
    PE: 'Perú',
    UY: 'Uruguay',
    PY: 'Paraguay',
    BO: 'Bolivia',
    EC: 'Ecuador',
    VE: 'Venezuela',
    CR: 'Costa Rica',
    PA: 'Panamá',
    DO: 'República Dominicana',
    GT: 'Guatemala',
    HN: 'Honduras',
    SV: 'El Salvador',
    NI: 'Nicaragua',
    CU: 'Cuba',
    PR: 'Puerto Rico',
    US: 'Estados Unidos',
    BR: 'Brasil',
    ZZ: 'Otro',
  },
  estados: {
    concepto: 'Concepto',
    prototipo: 'Prototipo',
    beta: 'Beta',
    venta: 'A la venta',
  },
  categorias: {
    accion: {
      nombre: 'Acción',
      descripcion: 'Tú juegas y tu público ayuda o estorba con sus comentarios y regalos.',
      rolStreamer: 'juega',
      idealPara: 'LIVE de gaming que quieren jugar junto al chat.',
      nota: 'Tienes que estar jugando en cámara: el juego no corre solo.',
      arteAlt: 'Ilustración: la nave del Comandante esquivando disparos de invasores en diagonal',
    },
    publico: {
      nombre: 'Público',
      descripcion: 'El chat juega en equipos o respondiendo, y tú conduces el ritmo del directo.',
      rolStreamer: 'conduce',
      idealPara: 'LIVE de charla y comunidad donde el chat participa mucho.',
      nota: 'Tú presentas y animas: el juego necesita que estés en el directo.',
      arteAlt: 'Ilustración: dos carriles de equipo alimentados por burbujas de chat con los números 1 y 2',
    },
    relax: {
      nombre: 'Relax',
      descripcion: 'Nadie gana: la escena cambia y crece con los regalos.',
      rolStreamer: 'acompana',
      idealPara: 'LIVE de charla, música o estudio.',
      nota: 'Estás en cámara todo el tiempo: la escena te acompaña, no te reemplaza.',
      arteAlt: 'Ilustración: peces y linternas que suben en capas tranquilas',
    },
    metas: {
      nombre: 'Metas',
      descripcion: 'Todo el chat junto hacia una meta con un gran final.',
      rolStreamer: 'conduce',
      idealPara: 'LIVE con una comunidad que disfruta ir por objetivos.',
      nota: 'Tú conduces el directo hacia la meta y celebras el final en cámara.',
      arteAlt: 'Ilustración: un medidor en forma de torre que se llena hasta el cien por ciento',
    },
  },
});

/** Página /confirmar. El resultado de confirmar usa `respuestas.confirmado` y `respuestas.enlace_invalido`. */
export const confirmar = congelar({
  titulo: 'Confirma tu lugar',
  descripcion: 'Confirma tu correo para quedar en la lista de espera.',
  noscript: 'Para confirmar tu correo necesitas activar JavaScript en tu navegador.',
  sinEnlace: 'No encontramos un enlace de confirmación. Abre el enlace que te llegó por correo.',
  listo: 'Pulsa el botón para confirmar tu correo y quedar en la lista de espera.',
  boton: 'Confirmar',
  enviando: 'Confirmando…',
  errorRed: 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.',
  reintentar: 'Intentar de nuevo',
  volver: 'Volver al inicio',
});

/** Pie de página: va en todas las páginas, incluidas la 404 y /confirmar. */
export const pie = congelar({
  noAfiliacion:
    '{marca} es un proyecto independiente: no está afiliado a TikTok ni a ByteDance, ni cuenta con su respaldo.',
  navegacion: 'Información legal y contacto',
  aviso: 'Aviso legal',
  privacidad: 'Política de privacidad',
  contacto: 'Contacto',
  pendiente: 'pendiente',
  licencias: 'Licencias',
});

/** Página 404. */
export const pagina404 = congelar({
  titulo: 'No encontramos esta página',
  descripcion: 'La página que buscas no existe o cambió de lugar.',
  texto: 'Puede que el enlace esté mal escrito o que la página ya no exista.',
  volver: 'Volver al inicio',
});

/** Páginas legales (aviso y privacidad). El texto de cada una vive en su archivo de src/content/legal. */
export const legal = congelar({
  borradorTitulo: 'Borrador',
  versionActualizado: 'Versión {version}, actualizada el {fecha}',
  descripcion: '{titulo} de {marca}.',
});

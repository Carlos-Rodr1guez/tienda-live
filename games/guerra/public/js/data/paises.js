// Lista curada de países jugables (CB-1): 18 de la lista A y CU, PR, US y GQ de la lista B. Solo datos.
// - `aliases`: palabras que unen a un equipo en cualquier posición del comentario, ya normalizadas.
// - `firstOnly`: palabras que unen solo como primer token ("salvador!" une; "mi tío salvador" no).
// - `colors`: colores candidatos de la paleta, en orden de preferencia.
// Cada país tiene solo su identificación, su nombre y sus colores: nada con qué dibujar símbolos nacionales (CB-2).

/** @typedef {{id:string, iso:string, name:string, aliases:string[], firstOnly:string[], colors:string[]}} Pais */

/** @type {readonly Pais[]} */
export const PAISES = Object.freeze(
  [
    ['AR', 'Argentina', 'argentina argentino argentinos argentinas arg albiceleste', '', 'celeste azul oro'],
    ['BO', 'Bolivia', 'bolivia boliviano bolivianos boliviana bol', '', 'verde rojo oro'],
    ['CL', 'Chile', 'chileno chilenos chilena', 'chile', 'rojo azul blanco'],
    ['CO', 'Colombia', 'colombia colombiano colombianos colombiana', 'col', 'oro azul rojo'],
    ['CR', 'Costa Rica', 'costarica costarricense costarricenses tico ticos', '', 'azul rojo blanco'],
    [
      'DO',
      'República Dominicana',
      'republicadominicana dominicana dominicano dominicanos quisqueya',
      'rd',
      'azul rojo blanco',
    ],
    ['EC', 'Ecuador', 'ecuador ecuatoriano ecuatorianos ecuatoriana ecu', '', 'oro azul rojo'],
    ['ES', 'España', 'espana espanoles espanola esp', 'espanol', 'rojo oro morado'],
    ['GT', 'Guatemala', 'guatemala guatemalteco guatemaltecos chapin chapines guate', '', 'celeste azul blanco'],
    ['HN', 'Honduras', 'honduras hondureno hondurenos catracho catrachos', '', 'azul celeste blanco'],
    ['MX', 'México', 'mexico mexicano mexicanos mexicana mex mx', '', 'verde rojo blanco'],
    ['NI', 'Nicaragua', 'nicaragua nicaraguense nicas nica pinolero', '', 'azul celeste blanco'],
    ['PA', 'Panamá', 'panama panameno panamenos panamena', '', 'rojo azul blanco'],
    ['PE', 'Perú', 'peru peruano peruanos peruana', '', 'rojo blanco naranja'],
    ['PY', 'Paraguay', 'paraguay paraguayo paraguayos py', '', 'rojo azul blanco'],
    ['SV', 'El Salvador', 'elsalvador salvadoreno salvadorenos', 'salvador guanaco', 'azul celeste blanco'],
    ['UY', 'Uruguay', 'uruguay uruguayo uruguayos charrua uru', '', 'celeste azul blanco'],
    ['VE', 'Venezuela', 'venezuela venezolano venezolanos vinotinto vzla', '', 'oro morado azul'],
    // lista B, aprobada por el dueño
    ['CU', 'Cuba', 'cuba cubano cubanos cubana', '', 'azul rojo blanco'],
    ['PR', 'Puerto Rico', 'puertorico boricua boricuas puertorriqueno pr', '', 'rojo azul blanco'],
    ['US', 'Estados Unidos', 'estadosunidos estadounidense estadounidenses usa eeuu', '', 'azul rojo blanco'],
    [
      'GQ',
      'Guinea Ecuatorial',
      'guineaecuatorial ecuatoguineano ecuatoguineanos ecuatoguineana',
      'guinea',
      'verde rojo azul',
    ],
  ].map(([id, name, aliases, firstOnly, colors]) =>
    Object.freeze({
      id,
      iso: id,
      name,
      aliases: Object.freeze(aliases.split(' ')),
      firstOnly: Object.freeze(firstOnly ? firstOnly.split(' ') : []),
      colors: Object.freeze(colors.split(' ')),
    }),
  ),
);

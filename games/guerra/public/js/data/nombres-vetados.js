// Términos vetados para nombres de espectadores (KIT-12). Solo datos. La semilla es del dueño: la escribe y la revisa en cada
// versión con `node tools/check-seed.mjs`, que cuenta de 40 a 80 términos (`contains` y `token`; `allow` no cuenta).
//
// Dos modos (el formato de `createBlocklist` del kit; todo se compara plegado: sin tildes ni mayúsculas, con las
// sustituciones de cifras y símbolos, sin separadores y con las repeticiones reducidas a una):
//   - `contains`: el término vetado aparece dentro del nombre. Un término que se pliega a menos de 4 caracteres veta nombres
//     inocentes ("kkk" se pliega a "k"): esos van en `token`, y `check-seed.mjs` falla si no.
//   - `token`: el nombre, o una de sus palabras separadas por espacios, es exactamente el término.
//   - `allow`: palabras permitidas que cubren un tramo vetado. Cada una tiene que contener el término que cubre:
//     con `contains: ['mala']` y `allow: ['malabares']`, "malabares" no se veta pero "malaonda" sí.
//
// Qué no se veta, a propósito: apodos e identidades que suelen ser inocentes o autodescriptivos, los insultos suaves y las
// abreviaturas casuales. Al plegar se quitan los separadores, así que dos palabras seguidas pueden formar un término:
// los cruces inocentes frecuentes tienen su `allow`, largo para no abrir huecos. Un nombre inocente que igual cae se
// muestra como "anónimo" y su dueño juega igual.
export const NOMBRES_VETADOS = Object.freeze({
  contains: [
    // vulgaridades sexuales
    'puta',
    'puto',
    'verga',
    'pinga',
    'pichula',
    'chucha',
    'chinga',
    'culero',
    'culiao',
    'mamaguevo',
    'mamahuevo',
    'vagina',
    'porno',
    'pornhub',
    'pornstar',
    'prostitut',
    // insultos fuertes
    'mierda',
    'cojud',
    'pendej',
    'cabron',
    'malparid',
    'gonorrea',
    'malnacid',
    'gilipollas',
    'pelotud',
    'conchud',
    'conchatum',
    'conchetum',
    'conchasum',
    'conchadetum',
    'conchesum',
    'chuchetum',
    'imbecil',
    'violador',
    'pedofil',
    // odio, homofobia y capacitismo
    'maricon',
    'rosquete',
    'faggot',
    'retard',
    'retrasad',
    'mongolic',
    'subnormal',
    // xenofobia y racismo (incluye las dirigidas a nacionalidades latinoamericanas)
    'sudaca',
    'veneco',
    'gachupin',
    'frijolero',
    'niger',
    'beaner',
    'wetback',
    // nazis
    'hitler',
    'nazi',
    'siegheil',
    // inglés
    'fuck',
    'shit',
    'bitch',
    'cunt',
    'pussy',
    'whore',
  ],
  token: [
    // vulgaridades sexuales
    'culo',
    'coño',
    'pene',
    'porn',
    // insultos fuertes (abreviaturas de uso agresivo)
    'ctm',
    'csm',
    'hdp',
    'ptm',
    'ptmr',
    // odio y homofobia
    'marica',
    'joto',
    'trolo',
    // xenofobia y racismo
    'niga',
    'nigas',
    'spic',
    // inglés
    'slut',
  ],
  allow: [
    // puta, puto
    'diputad',
    'computad',
    'computac',
    'disputa',
    'reputacion',
    'reputad',
    'imputad',
    'amputad',
    'caputo',
    'computo',
    'disputo',
    'reputo',
    'imputo',
    'amputo',
    // verga, chucha, chinga
    'vergara',
    'evergarden',
    // alias de juego en inglés: "Silver Gamer", "River Gaming", "Driver Games", "Overgame"
    'vergamer',
    'vergaming',
    'vergames',
    'overgame',
    'cachucha',
    'pachucha',
    'chingana',
    'chingaza',
    // maricon: "Mari Contreras", "Mari Condori", "Mari Concha", "Mari Consuelo", "Mari Constanza", "Mari Concepción",
    // "Mari Conchita"
    'maricontr',
    'maricond',
    'mariconcha',
    'mariconsuel',
    'mariconstanz',
    'mariconcep',
    'mariconchit',
    // violador: "Viola Dorado", "Viola Dorantes"
    'violadorad',
    'violadorant',
    // niger, nazi
    'nigeria',
    'nazir',
    'nazim',
    'lunazion',
    'bonazzi',
    // inglés y otros ("Yoshi", "Toshi", "Hoshi", "Mishi Tierna")
    'oshit',
    'mishit',
    'shitake',
    'cuntur',
    'scunthorpe',
    'retardo',
  ],
});

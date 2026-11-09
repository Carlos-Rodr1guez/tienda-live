// Términos vetados para nombres de espectadores (KIT-12). Solo datos. Se entrega VACÍO: la semilla de 40 a 80 términos la
// escribe el dueño antes del primer LIVE y la revisa en cada versión (`node tools/check-seed.mjs` la cuenta).
//
// Dos modos (el formato de `createBlocklist` del kit; todo se compara plegado: sin tildes ni mayúsculas, con las
// sustituciones de cifras y símbolos, sin separadores y con las repeticiones reducidas a una):
//   - `contains`: el término vetado aparece dentro del nombre. Un término que se pliega a menos de 4 caracteres veta nombres
//     inocentes ("kkk" se pliega a "k"): esos van en `token`, y `check-seed.mjs` falla si no.
//   - `token`: el nombre, o una de sus palabras separadas por espacios, es exactamente el término.
//   - `allow`: palabras permitidas que cubren un tramo vetado. Cada una tiene que contener el término que cubre:
//     con `contains: ['mala']` y `allow: ['malabares']`, "malabares" no se veta pero "malaonda" sí.
export const NOMBRES_VETADOS = Object.freeze({ contains: [], token: [], allow: [] });

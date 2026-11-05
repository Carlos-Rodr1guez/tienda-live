// @ts-check
// Rellena los marcadores {nombre} de una plantilla. Un parámetro que falta es un error de programación y se avisa
// con una excepción, para que nunca llegue "undefined" a una página o a un correo.

/**
 * @param {string} plantilla
 * @param {Record<string, string | number | undefined>} parametros
 * @returns {string}
 */
export function fmt(plantilla, parametros) {
  return plantilla.replace(/\{([A-Za-z_]\w*)\}/g, (_, nombre) => {
    const valor = parametros[nombre];
    if (valor === undefined)
      throw new Error(`fmt: falta el parámetro "${nombre}" en la plantilla "${plantilla.slice(0, 60)}"`);
    return String(valor);
  });
}

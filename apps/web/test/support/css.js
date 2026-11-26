// Ayudas para las pruebas de estilos: leer las propiedades personalizadas de un CSS y calcular contraste (WCAG 2.x).

/** Quita los comentarios de un CSS. */
export function sinComentarios(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Lee las declaraciones `--nombre: valor;` de todos los bloques `:root { ... }`.
 * @param {string} css
 * @returns {Map<string, string>}
 */
export function leerPropiedades(css) {
  const props = new Map();
  for (const bloque of sinComentarios(css).matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of bloque[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) props.set(decl[1], decl[2].trim());
  }
  return props;
}

/**
 * Luminancia relativa de un color #rrggbb.
 * @param {string} hex
 */
export function luminancia(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`no es un color #rrggbb: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Relación de contraste entre dos colores #rrggbb (de 1 a 21).
 * @param {string} a
 * @param {string} b
 */
export function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

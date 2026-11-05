// Lector mínimo del frontmatter de los .md de contenido, para las pruebas (no hay un parser de YAML en el proyecto).
// Entiende solo lo que usan las fichas: líneas `clave: valor`, listas en bloque (`- valor`), listas de objetos planos
// (`- clave: valor` seguido de `  clave: valor`), listas en línea (`[a, b]`), números, booleanos y comentarios con #.
// Cualquier otra cosa lanza un error: es mejor fallar que leer mal.

/** @param {string} crudo */
function escalar(crudo) {
  const t = crudo.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    if (t.length < 2) throw new Error(`comilla sin cerrar: ${crudo}`);
    return t.slice(1, -1);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const dentro = t.slice(1, -1).trim();
    return dentro === '' ? [] : dentro.split(',').map(escalar);
  }
  if (/^[[{|>&*!]/.test(t)) throw new Error(`valor YAML no soportado: ${crudo}`);
  return t;
}

/**
 * @param {string} texto  contenido completo del archivo
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(texto) {
  const normal = texto.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normal);
  if (!m) throw new Error('el archivo no empieza con frontmatter entre ---');
  /** @type {Record<string, unknown>} */
  const data = {};
  /** @type {string | null} */
  let clave = null;
  /** @type {any[] | null} */
  let lista = null;
  for (const linea of m[1].split('\n')) {
    if (linea.trim() === '' || linea.trim().startsWith('#')) continue;
    const item = /^\s+- (.*)$/.exec(linea);
    const continuacion = /^\s{4}([A-Za-z0-9_]+):\s*(.*)$/.exec(linea);
    if (item && clave) {
      if (!lista) throw new Error(`"${clave}" mezcla valor y lista`);
      const objeto = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(item[1]);
      lista.push(objeto ? { [objeto[1]]: escalar(objeto[2]) } : escalar(item[1]));
    } else if (continuacion && clave && lista && typeof lista[lista.length - 1] === 'object') {
      lista[lista.length - 1][continuacion[1]] = escalar(continuacion[2]);
    } else {
      const par = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(linea);
      if (!par) throw new Error(`línea de frontmatter no soportada: ${linea}`);
      clave = par[1];
      if (par[2] === '') {
        lista = [];
        data[clave] = lista;
      } else {
        lista = null;
        data[clave] = escalar(par[2]);
      }
    }
  }
  return { data, body: m[2] };
}

// @ts-check
// Textos de metadatos de las páginas legales. Código puro: el diseño recibe cadenas ya armadas.

import { fmt, legal, sitio } from '@tienda/contracts/i18n';

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * "2026-11-05" pasa a "5 de noviembre de 2026". No usa la zona horaria: la fecha es la que se escribió.
 * @param {unknown} iso  AAAA-MM-DD de un día que existe
 * @returns {string}
 */
export function formatFecha(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  const [anio, mes, dia] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (!m || fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new Error(`la fecha tiene que ser AAAA-MM-DD y un día que exista: ${String(iso)}`);
  }
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/**
 * @param {{ titulo: string, version: string, actualizado: string }} datos  los datos de la entrada de src/content/legal
 * @param {string} marca  BRAND.name
 * @returns {{ titulo: string, descripcion: string, versionActualizado: string }}
 */
export function legalMeta({ titulo, version, actualizado }, marca) {
  return {
    titulo: fmt(sitio.tituloPagina, { titulo, marca }),
    descripcion: fmt(legal.descripcion, { titulo, marca }),
    versionActualizado: fmt(legal.versionActualizado, { version, fecha: formatFecha(actualizado) }),
  };
}

// Revisa las licencias de todas las dependencias de producción del monorepo.
// Falla si alguna es copyleft fuerte (AGPL, GPL, SSPL), no comercial o no declara licencia:
// el código que se vende no puede arrastrar esas condiciones.
// Las dependencias de desarrollo no se revisan, porque no viajan con el producto.
//
// Uso: npm run licenses

import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Prohibidas en producción.
const DENIED = [/\bAGPL/i, /\bGPL/i, /\bSSPL/i, /\bBUSL/i, /-NC\b/i];

// Copyleft débil: se permite, pero se avisa para revisar cómo se usa.
const REVIEW = [/\bLGPL/i, /\bMPL/i, /\bEPL/i, /\bEUPL/i];

// Excepciones conocidas y temporales. Cada una dice por qué está y hasta cuándo.
const EXCEPTIONS = {
  'tiktok-live-connector': 'Se reemplaza en el H2 (ADR-001).',
  'tiktok-live-proto': 'Llega con tiktok-live-connector y se va con él en el H2 (ADR-001).',
};

export const OK = 0;
export const WARN = 1;
export const DENY = 2;

/** Sin licencia, UNLICENSED o "SEE LICENSE IN ...": hay que leerla a mano. */
export function isUnknown(license) {
  return !license || /^UNLICENSED$/i.test(license) || /^SEE LICEN[CS]E/i.test(license);
}

function leaf(id) {
  if (DENIED.some((re) => re.test(id))) return DENY;
  if (REVIEW.some((re) => re.test(id))) return WARN;
  return OK;
}

/**
 * Evalúa una expresión SPDX. Con OR se puede elegir, así que vale la mejor opción;
 * con AND se cumplen todas, así que vale la peor. "GPL-2.0 AND (MIT OR BSD-3-Clause)" queda prohibida.
 */
export function evaluate(expr) {
  if (isUnknown(expr)) return DENY;
  const tokens = expr.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i]?.toUpperCase();
  function factor() {
    if (tokens[i] === '(') {
      i++;
      const value = anyOf();
      i++; // cierra el paréntesis
      return value;
    }
    const id = tokens[i++] ?? '';
    if (peek() === 'WITH') i += 2; // la excepción no cambia la familia de la licencia
    return leaf(id);
  }
  function allOf() {
    let value = factor();
    while (peek() === 'AND') {
      i++;
      value = Math.max(value, factor());
    }
    return value;
  }
  function anyOf() {
    let value = allOf();
    while (peek() === 'OR') {
      i++;
      value = Math.min(value, allOf());
    }
    return value;
  }
  return anyOf();
}

function npmQuery(selector) {
  const opts = { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
  // Dentro de "npm run", npm_execpath apunta al CLI de npm: así no hace falta una shell.
  const npmCli = process.env.npm_execpath;
  const out =
    npmCli && /\.c?js$/.test(npmCli)
      ? execFileSync(process.execPath, [npmCli, 'query', selector], opts)
      : execSync(`npm query "${selector}"`, opts);
  return JSON.parse(out);
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license.trim();
  if (pkg.license?.type) return String(pkg.license.type);
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l?.type ?? l).join(' OR ');
  return '';
}

function main() {
  // Solo paquetes de terceros: la raíz y los workspaces son nuestros y son privados.
  const packages = new Map();
  for (const pkg of npmQuery('.prod')) {
    if (pkg.private || !/(^|\/)node_modules\//.test(pkg.location ?? '')) continue;
    packages.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, license: licenseOf(pkg) });
  }

  const count = {};
  const warnings = [];
  const errors = [];
  const usedExceptions = new Set();

  for (const [id, { name, license }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const label = license || 'sin licencia';
    count[label] = (count[label] ?? 0) + 1;
    const level = evaluate(license);
    if (level === OK) continue;
    if (EXCEPTIONS[name]) {
      usedExceptions.add(name);
      warnings.push(`${id} (${label}): excepción temporal. ${EXCEPTIONS[name]}`);
    } else if (level === WARN) {
      warnings.push(`${id} (${label}): copyleft débil, revisá cómo se usa.`);
    } else if (isUnknown(license)) {
      errors.push(`${id} (${label}): no declara una licencia que se pueda verificar. Revisala a mano.`);
    } else {
      errors.push(`${id} (${label}): licencia prohibida en producción.`);
    }
  }

  for (const name of Object.keys(EXCEPTIONS)) {
    if (!usedExceptions.has(name)) warnings.push(`la excepción de ${name} ya no hace falta: borrala de este script.`);
  }

  const summary = Object.entries(count)
    .sort(([, a], [, b]) => b - a)
    .map(([license, n]) => `${license} ${n}`)
    .join(' · ');
  console.log(`Licencias de ${packages.size} paquetes de producción: ${summary}`);
  for (const w of warnings) console.log(`  aviso: ${w}`);
  for (const e of errors) console.error(`  error: ${e}`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} dependencia(s) con una licencia que no se puede vender.`);
    process.exit(1);
  }
  console.log('Licencias OK.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

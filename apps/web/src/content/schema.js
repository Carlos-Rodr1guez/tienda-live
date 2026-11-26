// @ts-check
// Esquemas de las colecciones de contenido. Es código puro: solo importa `astro/zod` y contracts, así que las pruebas
// de node:test lo cargan sin Vite. `src/content.config.js` los conecta con las colecciones de Astro.
//
// El esquema de los juegos es estricto: un campo desconocido, o una categoría o un rol fuera de contracts, rompe la
// construcción nombrando el archivo y el campo.

import { z } from 'astro/zod';
import { CATEGORIES, GAME_STATES, STREAMER_ROLES, STREAM_TYPES } from '@tienda/contracts/enums';

/** `/videos/<nombre>.mp4|webm`, desde la carpeta public. */
const RUTA_VIDEO = /^\/videos\/[a-z0-9-]+\.(mp4|webm)$/;
/** Relativa a `src/assets`: `juegos/<juego>/<archivo>`. */
const RUTA_POSTER = /^juegos\/[a-z0-9-]+\/[a-z0-9-]+\.(png|jpe?g|webp)$/;
/** Un valor (`5`), un rango (`10-99`) o un mínimo (`1000+`). */
const MONEDAS = /^[0-9]+(-[0-9]+|\+)?$/;

const regalo = z
  .object({
    monedas: z.string().max(12).regex(MONEDAS, 'usa un número, un rango (10-99) o un mínimo (1000+)'),
    efecto: z.string().min(1).max(120),
  })
  .strict();

/**
 * Esquema de una ficha de juego (un archivo de `src/content/juegos`).
 * El estado "concepto" solo pide lo básico; cualquier otro estado exige mecánicas y póster.
 */
export function createJuegoSchema() {
  return z
    .object({
      nombre: z.string().min(1).max(60),
      resumen: z.string().min(1).max(160),
      categoria: z.enum(CATEGORIES),
      rolStreamer: z.enum(STREAMER_ROLES),
      idealPara: z
        .array(z.enum(STREAM_TYPES))
        .min(1)
        .max(4)
        .refine((tipos) => new Set(tipos).size === tipos.length, 'no repitas tipos de LIVE'),
      estado: z.enum(GAME_STATES),
      video: z.string().max(200).regex(RUTA_VIDEO, 'usa /videos/<nombre>.mp4 o .webm').optional(),
      poster: z.string().max(200).regex(RUTA_POSTER, 'usa juegos/<juego>/<archivo>.png|jpg|webp').optional(),
      mecanicas: z.array(z.string().min(1).max(140)).max(8).default([]),
      regalos: z.array(regalo).max(8).default([]),
      requisitos: z.array(z.string().min(1).max(120)).max(8).default([]),
      orden: z.number().int().min(0).max(999).default(999),
    })
    .strict()
    .superRefine((juego, ctx) => {
      if (juego.estado === 'concepto') return;
      if (juego.mecanicas.length < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['mecanicas'],
          message: 'un juego que no es concepto necesita mecánicas',
        });
      }
      if (!juego.poster) {
        ctx.addIssue({ code: 'custom', path: ['poster'], message: 'un juego que no es concepto necesita póster' });
      }
    });
}

/** Esquema de una página legal (un archivo de `src/content/legal`). */
export function createLegalSchema() {
  return z
    .object({
      titulo: z.string().min(1).max(80),
      version: z.string().min(1).max(20),
      actualizado: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'usa AAAA-MM-DD')
        .refine(
          (f) => !Number.isNaN(Date.parse(`${f}T00:00:00Z`)) && new Date(`${f}T00:00:00Z`).toISOString().startsWith(f),
          'fecha inexistente',
        ),
      borrador: z.boolean().default(false),
    })
    .strict();
}

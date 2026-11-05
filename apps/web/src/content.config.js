// Colecciones de contenido. Sumar un juego es sumar un archivo en src/content/juegos: no hay que tocar nada más.
// Los esquemas están en src/content/schema.js (código puro, con pruebas).
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { createJuegoSchema, createLegalSchema } from './content/schema.js';

const juegos = defineCollection({
  // JUEGOS_DIR solo lo usa `npm run check:schema`: apunta a fichas inválidas para comprobar que la construcción falla.
  loader: glob({ pattern: '*.md', base: process.env.JUEGOS_DIR ?? './src/content/juegos' }),
  schema: createJuegoSchema(),
});

const legal = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/legal' }),
  schema: createLegalSchema(),
});

export const collections = { juegos, legal };

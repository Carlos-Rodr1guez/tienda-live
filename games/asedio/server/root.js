// Carpeta del juego: el kit la pide explícita para no adivinarla desde su propia ubicación.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

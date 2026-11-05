// Ubica la carpeta de un paquete instalado. Con npm workspaces, npm sube las dependencias
// al node_modules de la raíz del monorepo, así que se busca subiendo de carpeta en carpeta,
// igual que hace Node al resolver un import.

import { existsSync } from 'node:fs';
import path from 'node:path';

export function packageDir(name, from) {
  const start = path.resolve(from);
  for (let dir = start; ;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return path.join(start, 'node_modules', name);
    dir = parent;
  }
}

#!/usr/bin/env node
// Uso:
//   npm run start:batalla                      (usa el usuario de config.json)
//   npm run start:batalla -- tu_usuario        (o pásalo aquí)
//   PORT=4000 npm run start:batalla            (otro puerto)

import { startServer, loadConfigFile } from '@tienda/kit/server';
import { ROOT } from './root.js';

const args = process.argv.slice(2);
const config = await loadConfigFile(ROOT);

const cliUser = args.find((a) => !a.startsWith('-'));
const userFlag = args.find((a) => a.startsWith('--user='));
if (userFlag) config.tiktokUsername = userFlag.slice(7);
else if (cliUser) config.tiktokUsername = cliUser;
if (process.env.TIKTOK_USERNAME) config.tiktokUsername = process.env.TIKTOK_USERNAME;

const port = Number(process.env.PORT || config.port || 3100);

try {
  const app = await startServer({ root: ROOT, config, port });
  const url = `http://localhost:${app.port}`;
  console.log('');
  console.log('  Batalla de países lista');
  console.log(`  Abre en Chrome:  ${url}`);
  console.log('');
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (err) {
  if (err.code === 'EADDRINUSE')
    console.error(`El puerto ${port} está ocupado. Cambia "port" en config.json o usa PORT=4000 npm run start:batalla`);
  else console.error(err);
  process.exit(1);
}

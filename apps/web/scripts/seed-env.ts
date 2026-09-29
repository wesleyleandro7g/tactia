import { loadEnvConfig } from '@next/env';
import { fileURLToPath } from 'node:url';

loadEnvConfig(fileURLToPath(new URL('..', import.meta.url)));

import('./seed').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

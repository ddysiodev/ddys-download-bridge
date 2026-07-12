import { optionsFromEnv } from './core/config.mjs';
import { startNodeServer } from './core/http.mjs';

const { url } = await startNodeServer(optionsFromEnv());
console.log(JSON.stringify({ ok: true, url }, null, 2));

import path from 'node:path';
import { ProcessingService } from '../processing-service.mjs';
import { main } from '../server.mjs';

const dataDir = process.env.SCRIPTA_DATA_DIR || path.resolve(import.meta.dirname,'../data');
const supervisor = new ProcessingService(dataDir);
try {
  await supervisor.listen();
  // One informational line; the site and /health never depend on the processing runtime.
  supervisor.runtimeStatus().then(line => console.log(line), () => {});
  await main({onShutdown:()=>supervisor.drain()});
}
catch (error) { await supervisor.drain(); throw error; }

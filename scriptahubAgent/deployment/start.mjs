// Refuse a missing/mismatched processing runtime before opening the service.
await import('./check-runtime.mjs');
if (process.exitCode) process.exit(process.exitCode);
const { main } = await import('../server.mjs');
await main();

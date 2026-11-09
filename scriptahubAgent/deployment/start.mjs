// The application image has no skills runtime: skills run only in the robot, which checks their sources.
const { main } = await import('../server.mjs');
await main();

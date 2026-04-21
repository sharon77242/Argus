'use strict';
/**
 * simulate.js — starts the quotes server inline then runs the traffic sequence.
 *
 * All monitoring triggers run as server-side routes so the agent (same process)
 * captures every event and prints it to the terminal.
 */

const http = require('http');

// ── 1. Boot ArgusAgent (must be first) ───────────────────────────────────────
const agent = require('./diagnostic');

// ── 2. Boot Express app ───────────────────────────────────────────────────────
const app    = require('./app');
const server = http.createServer(app);
const PORT   = 3000;

server.listen(PORT, async () => {
  console.log(`\n[SIM] Server on :${PORT} — starting simulation in 800ms...\n`);
  await new Promise(r => setTimeout(r, 800));

  // Set target before require so traffic.js reads the correct HOST/PORT constants
  process.env.TARGET_HOST = 'localhost';
  process.env.TARGET_PORT = String(PORT);
  const { run } = require('./traffic');
  await run();

  await new Promise(r => setTimeout(r, 500)); // allow aggregator to flush
  agent.stop().then(() => server.close(() => process.exit(0)));
});

'use strict';

const path = require('path');
const { DiagnosticAgent } = require(path.resolve(__dirname, '../packages/agent/dist/cjs/index.cjs'));

// ── colour helpers (no deps) ──────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',  bold: '\x1b[1m',
  red: '\x1b[31m',   yellow: '\x1b[33m', green: '\x1b[32m',
  cyan: '\x1b[36m',  magenta: '\x1b[35m', dim: '\x1b[2m',
};
const stamp = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
const tag = (colour, label) => `${colour}${c.bold}[${label}]${c.reset}`;

const agent = DiagnosticAgent.createProfile({
  environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
  appType: ['web', 'db'],
  workspaceDir: path.resolve(__dirname, '..'),
});

// Enable runtime monitor explicitly so the busy-spin demo fires ANOM events.
// (Normally reserved for the 'worker' profile — included here to showcase all free-mode features.)
agent.withRuntimeMonitor();

// ── live event listeners ──────────────────────────────────────────────────────

agent.on('query', (q) => {
  const slow = q.durationMs > 100 ? ` ${c.yellow}⚠ SLOW${c.reset}` : '';
  const hints = q.suggestions?.length
    ? `\n    ${c.yellow}↳ hints: ${q.suggestions.map(s => s.rule).join(', ')}${c.reset}`
    : '';
  console.log(
    `${c.dim}${stamp()}${c.reset} ${tag(c.cyan,'QUERY')} ` +
    `${c.dim}[${q.driver ?? 'pg'}]${c.reset} ` +
    `${c.bold}${q.sanitizedQuery?.slice(0, 80)}${q.sanitizedQuery?.length > 80 ? '…' : ''}${c.reset} ` +
    `${c.dim}(${q.durationMs.toFixed(1)}ms)${c.reset}${slow}${hints}`
  );
});

agent.on('http', (r) => {
  const status = r.statusCode ?? '---';
  const colour = !r.statusCode ? c.dim : r.statusCode >= 500 ? c.red : r.statusCode >= 400 ? c.yellow : c.green;
  const hints = r.suggestions?.length
    ? `\n    ${c.yellow}↳ hints: ${r.suggestions.map(s => s.rule).join(', ')}${c.reset}`
    : '';
  console.log(
    `${c.dim}${stamp()}${c.reset} ${tag(c.magenta,'HTTP ')} ` +
    `${r.method} ${r.url} ${colour}→ ${status}${c.reset} ` +
    `${c.dim}(${r.durationMs.toFixed(1)}ms)${c.reset}${hints}`
  );
});

agent.on('log', (l) => {
  if (l.scrubbed) {
    console.warn(
      `${c.dim}${stamp()}${c.reset} ${tag(c.yellow,'SCRUB')} ` +
      `console.${l.level} contained a high-entropy secret — redacted`
    );
  }
  if (l.suggestions?.length) {
    const hints = l.suggestions.map(s => {
      const sev = s.severity === 'critical' ? c.red : s.severity === 'warning' ? c.yellow : c.dim;
      return `${sev}[${s.severity}] ${s.rule}${c.reset}`;
    }).join(', ');
    process.stderr.write(
      `${c.dim}${stamp()}${c.reset} ${tag(c.yellow,'LOG  ')} ` +
      `console.${l.level} → ${hints}\n`
    );
  }
});

agent.on('fs', (f) => {
  if (!f.suggestions?.length) return; // skip unannotated reads to avoid noise
  const hints = f.suggestions.map(s => {
    const sev = s.severity === 'critical' ? c.red : s.severity === 'warning' ? c.yellow : c.dim;
    return `${sev}[${s.severity}] ${s.rule}${c.reset}`;
  }).join(', ');
  process.stdout.write(
    `${c.dim}${stamp()}${c.reset} ${tag(c.cyan,'FS   ')} ` +
    `${c.dim}${f.method}${c.reset} ${f.path.split(/[\\/]/).pop()} ` +
    `${c.dim}(${f.durationMs.toFixed(1)}ms)${c.reset}` +
    `\n    ↳ hints: ${hints}\n`
  );
});

agent.on('anomaly', (a) => {
  console.error(
    `${c.dim}${stamp()}${c.reset} ${tag(c.red,'ANOM ')} ` +
    `type=${c.bold}${a.type}${c.reset} ` +
    `${a.lagMs != null ? `lagMs=${a.lagMs}` : ''} ` +
    `${a.growthBytes != null ? `growthBytes=${a.growthBytes}` : ''}`
  );
});

agent.on('leak', (l) => {
  console.error(
    `${c.dim}${stamp()}${c.reset} ${tag(c.red,'LEAK ')} ` +
    `${l.handlesCount} active handles — ${l.suggestions[0]?.message ?? ''}`
  );
});

agent.on('crash', (crash) => {
  console.error(
    `${c.dim}${stamp()}${c.reset} ${tag(c.red,'CRASH')} ` +
    `${crash.error?.message ?? String(crash)}`
  );
});

agent.on('audit', (result) => {
  const total = result.suggestions?.length ?? 0;
  const colour = total > 0 ? c.red : c.dim;
  console.log(
    `${c.dim}${stamp()}${c.reset} ${tag(colour,'AUDIT')} ` +
    `npm audit — ${total} high/critical vulnerability(ies)`
  );
  for (const s of (result.suggestions ?? []).slice(0, 5)) {
    console.log(`    ${c.red}[${s.severity}]${c.reset} ${s.rule} — ${s.message.slice(0, 80)}`);
  }
});

agent.on('scan', (results) => {
  const total = results.reduce((n, r) => n + r.totalIssues, 0);
  console.log(
    `${c.dim}${stamp()}${c.reset} ${tag(c.cyan,'SCAN ')} ` +
    `static analysis complete — ${total} issue(s) across ${results.length} tool(s)`
  );
  for (const r of results) {
    if (r.totalIssues === 0) continue;
    console.log(`  ${c.dim}${r.tool}:${c.reset}`);
    for (const s of r.suggestions.slice(0, 5)) {
      const sev = s.severity === 'critical' ? c.red : s.severity === 'warning' ? c.yellow : c.dim;
      console.log(`    ${sev}[${s.severity}]${c.reset} ${s.rule} — ${s.message.slice(0, 80)}`);
    }
    if (r.suggestions.length > 5) console.log(`    ${c.dim}… and ${r.suggestions.length - 5} more${c.reset}`);
  }
});

agent.on('info',  (m) => console.log(`${c.dim}${stamp()} [INFO ] ${m}${c.reset}`));
agent.on('error', (e) => console.error(`${c.dim}${stamp()}${c.reset} ${tag(c.red,'ERROR')} ${e?.message ?? e}`));

// ── start ─────────────────────────────────────────────────────────────────────
agent.start()
  .then(() => {
    console.log(
      `\n${c.green}${c.bold}╔══════════════════════════════════════════╗${c.reset}`,
    );
    console.log(
      `${c.green}${c.bold}║  Argus — ACTIVE                          ║${c.reset}`,
    );
    console.log(
      `${c.green}${c.bold}╚══════════════════════════════════════════╝${c.reset}\n`,
    );
  })
  .catch((err) => console.error('[DiagAgent] failed to start:', err));

process.on('SIGTERM', () => agent.stop());
process.on('SIGINT',  () => agent.stop());

module.exports = agent;

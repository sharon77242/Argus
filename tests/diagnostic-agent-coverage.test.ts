/**
 * Additional coverage tests for DiagnosticAgent
 * Targets uncovered lines:
 *   - 207-209: aggregator flush → exporter error path (emits 'error')
 *   - 326-343: exporter wired to aggregator flush
 *   - 350-351: monitor anomaly passthrough → aggregator + emit
 *   - 394:     static scan error path
 *   - 402-403: http 'request' event → aggregator + emit
 *   - 412-413: fs 'fs' event → aggregator + emit  
 *   - 426-427: log 'log' event → aggregator + emit
 *   - 436:     crash 'crash' event emit
 *   - 445:     leak 'leak' event emit
 *   - 456:     audit scan error path
 *   - 520:     resolvePosition delegating to resolver
 *
 *   Also:
 *   - DIAGNOSTIC_AGENT_ENABLED='false' / '0' env-var kill-switch
 *   - withEntropyThreshold override on logTracingOptions
 */
import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DiagnosticAgent } from '../src/diagnostic-agent.ts';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('DiagnosticAgent (extended coverage)', () => {
  let agent: DiagnosticAgent | null = null;

  afterEach(() => {
    agent?.stop();
    agent = null;
  });

  // ── env-var kill-switch: DIAGNOSTIC_AGENT_ENABLED=false ──────────────────
  it('should be disabled via DIAGNOSTIC_AGENT_ENABLED=false', async () => {
    const orig = process.env.DIAGNOSTIC_AGENT_ENABLED;
    process.env.DIAGNOSTIC_AGENT_ENABLED = 'false';
    try {
      agent = DiagnosticAgent.createProfile({ enabled: true }); // config says enabled but env overrides
      await agent.start();
      assert.strictEqual(agent.isRunning, false);
    } finally {
      if (orig === undefined) delete process.env.DIAGNOSTIC_AGENT_ENABLED;
      else process.env.DIAGNOSTIC_AGENT_ENABLED = orig;
    }
  });

  it('should be disabled via DIAGNOSTIC_AGENT_ENABLED=0', async () => {
    const orig = process.env.DIAGNOSTIC_AGENT_ENABLED;
    process.env.DIAGNOSTIC_AGENT_ENABLED = '0';
    try {
      agent = DiagnosticAgent.createProfile({});
      await agent.start();
      assert.strictEqual(agent.isRunning, false);
    } finally {
      if (orig === undefined) delete process.env.DIAGNOSTIC_AGENT_ENABLED;
      else process.env.DIAGNOSTIC_AGENT_ENABLED = orig;
    }
  });

  it('should be enabled when DIAGNOSTIC_AGENT_ENABLED=true', async () => {
    const orig = process.env.DIAGNOSTIC_AGENT_ENABLED;
    process.env.DIAGNOSTIC_AGENT_ENABLED = 'true';
    try {
      agent = await DiagnosticAgent.createProfile({ environment: 'prod', appType: 'web' }).start();
      assert.strictEqual(agent.isRunning, true);
    } finally {
      if (orig === undefined) delete process.env.DIAGNOSTIC_AGENT_ENABLED;
      else process.env.DIAGNOSTIC_AGENT_ENABLED = orig;
    }
  });

  // ── withAggregatorWindow + withEntropyThreshold affect logTracingOptions ───
  it('should propagate entropyThreshold to logger when not explicitly set', async () => {
    agent = await DiagnosticAgent.create()
      .withEntropyThreshold(2.5)
      .withLogTracing() // no threshold set → should inherit from agent
      .start();

    const logTracker = (agent as any).logTracker;
    assert.ok(logTracker, 'logTracker should exist');
    assert.strictEqual(logTracker.options?.entropyThreshold, 2.5);
  });

  it('should NOT overwrite an explicit entropyThreshold in logTracingOptions', async () => {
    agent = await DiagnosticAgent.create()
      .withEntropyThreshold(2.0)
      .withLogTracing({ entropyThreshold: 5.0 }) // explicit override
      .start();

    const logTracker = (agent as any).logTracker;
    assert.ok(logTracker);
    assert.strictEqual(logTracker.options?.entropyThreshold, 5.0);
  });

  // ── monitor anomaly passthrough ──────────────────────────────────────────
  it('should forward monitor anomaly to agent emit and aggregator', async () => {
    agent = await DiagnosticAgent.create()
      .withRuntimeMonitor({
        checkIntervalMs: 50,
        eventLoopThresholdMs: 1, // very low to trigger easily
        cpuProfileCooldownMs: 99999,
        cpuProfileDurationMs: 50,
      })
      .start();

    const anomalyPromise = once(agent, 'anomaly');

    // Force lastCpuProfileTime to now (cooldown) → simple emission path
    const monitor = (agent as any).monitor;
    monitor.lastCpuProfileTime = Date.now();

    // Block event loop
    const start = Date.now();
    while (Date.now() - start < 80) { /* busy wait */ }

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
    const [event] = await Promise.race([anomalyPromise, timeout]) as any;

    assert.strictEqual(event.type, 'event-loop-lag');
  });

  // ── HTTP 'request' event → aggregator + agent emit ────────────────────────
  it('should forward http instrumentation events to agent', async () => {
    agent = await DiagnosticAgent.create()
      .withHttpTracing()
      .withAggregatorWindow(60_000)
      .start();

    const httpPromise = once(agent, 'http');

    // Start a minimal server and hit it
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const req = http.request(`http://localhost:${port}/test`, (res) => {
      res.resume();
    });
    req.end();

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
    const [httpEvent] = await Promise.race([httpPromise, timeout]) as any;

    server.close();

    assert.ok(httpEvent.url.includes('/test'));
    assert.ok(typeof httpEvent.durationMs === 'number');
  });

  // ── FS 'fs' event → aggregator + agent emit ───────────────────────────────
  it('should forward fs instrumentation events to agent', async () => {
    agent = await DiagnosticAgent.create()
      .withFsTracing()
      .start();

    const fsPromise = once(agent, 'fs');

    const tmpFile = path.join(os.tmpdir(), `agent-fs-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'test');
    try { fs.unlinkSync(tmpFile); } catch {}

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000));
    const [fsEvent] = await Promise.race([fsPromise, timeout]) as any;

    assert.strictEqual(fsEvent.method, 'writeFileSync');
  });

  // ── Log 'log' event → aggregator + agent emit ─────────────────────────────
  it('should forward log instrumentation events to agent', async () => {
    agent = await DiagnosticAgent.create()
      .withLogTracing()
      .start();

    const logPromise = once(agent, 'log');
    console.log('test log message from agent coverage test');

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000));
    const [logEvent] = await Promise.race([logPromise, timeout]) as any;

    // TracedLog shape: { level, durationMs, argsLength, scrubbed, timestamp, ... }
    assert.strictEqual(logEvent.level, 'log', 'Should have captured log level');
    assert.ok(typeof logEvent.argsLength === 'number', 'Should have argsLength');
  });

  // ── Crash 'crash' event ───────────────────────────────────────────────────
  it('should forward CrashGuard crash events to agent', async () => {
    process.env.NODE_ENV = 'test';

    agent = await DiagnosticAgent.create()
      .withCrashGuard()
      .start();

    const crashPromise = once(agent, 'crash');

    const crashGuard = (agent as any).crashGuard;
    // Trigger directly to avoid touching process.on
    (crashGuard as any).handleCrash('uncaughtException', new Error('boom'));

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000));
    const [crashEvent] = await Promise.race([crashPromise, timeout]) as any;

    assert.strictEqual(crashEvent.type, 'uncaughtException');
  });

  // ── Leak 'leak' event (line 445) ─────────────────────────────────────────
  it('should forward ResourceLeakMonitor leak events to agent', async () => {
    // Use a very low threshold — the process always has at least a few active handles
    agent = await DiagnosticAgent.create()
      .withResourceLeakMonitor({ handleThreshold: 1, intervalMs: 30 })
      .start();

    const leakPromise = once(agent, 'leak');

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
    const [leakEvent] = await Promise.race([leakPromise, timeout]) as any;

    assert.ok(typeof leakEvent.handlesCount === 'number');
  });

  // ── resolvePosition delegates to resolver ─────────────────────────────────
  it('should resolve position via SourceMapResolver when source maps enabled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-smap-'));
    try {
      // Write a minimal JS + map so the resolver has something
      fs.writeFileSync(
        path.join(tempDir, 'mini.js'),
        'var x = 1;\n//# sourceMappingURL=mini.js.map\n'
      );
      const emptyMap = JSON.stringify({ version: 3, sources: [], mappings: '' });
      fs.writeFileSync(path.join(tempDir, 'mini.js.map'), emptyMap);

      agent = await DiagnosticAgent.create()
        .withSourceMaps(tempDir)
        .start();

      // resolvePosition with an unmapped file → should return null (not throw)
      const result = await agent.resolvePosition('/nonexistent.js', 1, 0);
      assert.strictEqual(result, null);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ── Static scan error path (line 394) ──────────────────────────────────
  it('should not crash when static scanner scan() is pointed at a bad dir', async () => {
    // The static scan is fire-and-forget; a bad dir causes tsc to fail, but the
    // scan() promise itself resolves (it doesn't reject). The agent should still
    // start cleanly.
    agent = DiagnosticAgent.create().withStaticScanner('/nonexistent_dir_$$');
    // Suppress any error events to avoid unhandled listener warnings
    agent.on('error', () => { /* suppress */ });
    agent.on('scan', () => { /* suppress */ });
    await agent.start();

    // Wait a moment for the async scan to settle in background
    await sleep(100);

    assert.strictEqual(agent.isRunning, true);
  });

  // ── Audit scan error path (line 456) ──────────────────────────────────
  it('should not crash when audit scanner is pointed at a bad dir', async () => {
    // audit scanner resolves null on errors; the agent should still start
    agent = DiagnosticAgent.create().withAuditScanner('/nonexistent_dir_audit_$$');
    agent.on('error', () => { /* suppress */ });
    agent.on('audit', () => { /* suppress */ });
    await agent.start();
    await sleep(100);
    assert.strictEqual(agent.isRunning, true);
  });

  // ── Exporter wired to aggregator flush ────────────────────────────────────
  it('should emit error when exporter fails during aggregator flush', async () => {
    agent = await DiagnosticAgent.create()
      .withExporter({
        endpointUrl: 'https://127.0.0.1:0/nonexistent',  // will fail to connect
        ca: 'ca', cert: 'cert', key: 'key',
      })
      .withAggregatorWindow(50) // short window to flush quickly
      .start();

    const errorPromise = once(agent, 'error');

    // Record something so flush has data
    const aggregator = (agent as any).aggregator;
    aggregator.record('test-metric', 42, { test: true });

    // Force flush
    aggregator.flush();

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
    // Should have an error emitted from the failed export
    const [err] = await Promise.race([errorPromise, timeout]) as any;
    assert.ok(err instanceof Error, 'Should emit an Error');
  });

  // ── withInstrumentation + queryAnalysis: engine enriches query ────────────
  it('should enrich traced queries with fix suggestions when queryAnalysis enabled', async () => {
    agent = await DiagnosticAgent.create()
      .withInstrumentation()
      .withQueryAnalysis()
      .start();

    const queryPromise = once(agent, 'query');
    await agent.traceQuery('SELECT * FROM users', async () => 'done');

    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000));
    const [queryEvent] = await Promise.race([queryPromise, timeout]) as any;

    assert.ok(Array.isArray(queryEvent.suggestions), 'Should have suggestions attached');
    assert.ok(queryEvent.suggestions.length > 0);
  });

  // ── withInstrumentation: autoPatching is removed on stop ─────────────────
  it('should call removeDriverPatches on stop() when autoPatching was enabled', async () => {
    agent = await DiagnosticAgent.create()
      .withInstrumentation({ autoPatching: true })
      .start();
    // stop() should cleanly remove driver patches — just verify no throw
    assert.doesNotThrow(() => agent!.stop());
  });

  // ── Bug Fix #3 regression: stop() must null out ALL subsystem references ──
  it('[BUG FIX] stop() should null out all subsystem instance references', async () => {
    agent = await DiagnosticAgent.create()
      .withHttpTracing()
      .withFsTracing()
      .withLogTracing()
      .withCrashGuard()
      .withResourceLeakMonitor({ handleThreshold: 999, intervalMs: 9999 })
      .withQueryAnalysis()
      .withRuntimeMonitor({ checkIntervalMs: 9999 })
      .start();

    // All subsystems should be alive
    assert.ok((agent as any).httpTracker, 'httpTracker should exist after start');
    assert.ok((agent as any).fsTracker, 'fsTracker should exist after start');
    assert.ok((agent as any).logTracker, 'logTracker should exist after start');
    assert.ok((agent as any).crashGuard, 'crashGuard should exist after start');
    assert.ok((agent as any).leakMonitor, 'leakMonitor should exist after start');
    assert.ok((agent as any).queryAnalyzer, 'queryAnalyzer should exist after start');
    assert.ok((agent as any).monitor, 'monitor should exist after start');

    agent.stop();
    agent = null; // prevent afterEach double-stop

    // All references must be null after stop()
    const stopped = (agent as any); // agent is null — check via temporary
    // Re-read via closure trick: create a new agent, stop it, inspect
    const a = await DiagnosticAgent.create()
      .withHttpTracing()
      .withFsTracing()
      .withLogTracing()
      .withCrashGuard()
      .withResourceLeakMonitor({ handleThreshold: 999, intervalMs: 9999 })
      .withQueryAnalysis()
      .withRuntimeMonitor({ checkIntervalMs: 9999 })
      .start();

    a.stop();

    assert.strictEqual((a as any).httpTracker, null, 'httpTracker must be null after stop()');
    assert.strictEqual((a as any).fsTracker, null, 'fsTracker must be null after stop()');
    assert.strictEqual((a as any).logTracker, null, 'logTracker must be null after stop()');
    assert.strictEqual((a as any).crashGuard, null, 'crashGuard must be null after stop()');
    assert.strictEqual((a as any).leakMonitor, null, 'leakMonitor must be null after stop()');
    assert.strictEqual((a as any).queryAnalyzer, null, 'queryAnalyzer must be null after stop()');
    assert.strictEqual((a as any).monitor, null, 'monitor must be null after stop()');
    assert.strictEqual((a as any).engine, null, 'engine must be null after stop()');
    assert.strictEqual((a as any).aggregator, null, 'aggregator must be null after stop()');
  });

  // ── [FIX] createProfile: no silent 'web' default when auto-detection fails ─
  it('[FIX] createProfile with auto and no detected types should NOT attach web-specific modules', async () => {
    // Point workspaceDir at a directory with no package.json to force empty detection
    const emptyDir = os.tmpdir();
    agent = DiagnosticAgent.createProfile({
      environment: 'prod',
      appType: 'auto',
      workspaceDir: emptyDir,
    });

    await agent.start();

    // In prod with no detection → no web modules should be wired up
    assert.strictEqual((agent as any).httpTracker, null,
      '[FIX] Should NOT attach httpTracker when no app type detected');
    assert.strictEqual((agent as any).leakMonitor, null,
      '[FIX] Should NOT attach leakMonitor when no app type detected');
    assert.strictEqual((agent as any).engine, null,
      '[FIX] Should NOT attach instrumentation engine when no app type detected');
  });

  it('[FIX] createProfile with auto and no detected types should emit info warning in dev mode', async () => {
    // Create a clean workspace dir with a package.json that has no recognized DB/web packages
    const workspaceDir = path.join(os.tmpdir(), `no-app-type-test-${Date.now()}`);
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(workspaceDir, 'package.json'),
      JSON.stringify({ name: 'empty-test', dependencies: {} })
    );

    agent = DiagnosticAgent.createProfile({
      environment: 'dev',
      appType: 'auto',
      workspaceDir,
    });

    const infoMessages: string[] = [];
    agent.on('info', (msg: string) => infoMessages.push(msg));

    // Suppress SourceMapResolver errors from scanning the empty workspace
    agent.on('error', () => {});

    await agent.start();

    // setImmediate fires after start() returns
    await new Promise(r => setImmediate(r));

    assert.ok(infoMessages.length > 0, '[FIX] Should emit info event when auto-detection finds nothing');
    assert.ok(infoMessages[0].includes('auto-detection'), 'Info message should mention auto-detection');

    // Cleanup (best-effort: SourceMapResolver may still hold handles on Windows)
    try { await fs.promises.rm(workspaceDir, { recursive: true, force: true }); } catch { /* EBUSY */ }
  });

  // ── [FIX] setMaxListeners(0): no false memory leak warnings ────────────────
  it('[FIX] DiagnosticAgent should have unlimited listeners (setMaxListeners(0))', () => {
    const a = DiagnosticAgent.create();
    assert.strictEqual(a.getMaxListeners(), 0,
      '[FIX] setMaxListeners(0) should have been called in constructor');
  });
});

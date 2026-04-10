import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticAgent } from '../src/diagnostic-agent.ts';

describe('DiagnosticAgent (builder pattern)', () => {
  let agent: DiagnosticAgent | null = null;

  afterEach(() => {
    agent?.stop();
    agent = null;
  });

  it('should start and stop with minimal configuration', async () => {
    agent = await DiagnosticAgent.create().start();

    assert.strictEqual(agent.isRunning, true);
    agent.stop();
    assert.strictEqual(agent.isRunning, false);
  });

  it('should accept chained configuration without errors', async () => {
    agent = await DiagnosticAgent.create()
      .withRuntimeMonitor({ checkIntervalMs: 200, eventLoopThresholdMs: 100 })
      .withInstrumentation()
      .withAggregatorWindow(5000)
      .withEntropyThreshold(3.5);

    // Not started yet — just configured
    assert.strictEqual(agent.isRunning, false);

    await agent.start();
    assert.strictEqual(agent.isRunning, true);
  });

  it('should throw when calling traceQuery without instrumentation', async () => {
    agent = await DiagnosticAgent.create().start();

    await assert.rejects(
      () => agent!.traceQuery('SELECT 1', async () => 'ok'),
      { message: /Instrumentation is not enabled/ },
    );
  });

  it('should throw when calling resolvePosition without source maps', async () => {
    agent = await DiagnosticAgent.create().start();

    await assert.rejects(
      () => agent!.resolvePosition('foo.js', 1, 0),
      { message: /Source maps are not enabled/ },
    );
  });

  it('should allow traceQuery when instrumentation is enabled', async () => {
    agent = await DiagnosticAgent.create()
      .withInstrumentation()
      .withAggregatorWindow(100);

    await agent.start();

    const result = await agent.traceQuery(
      "SELECT * FROM users WHERE id = 5",
      async () => ({ rows: [] }),
    );

    assert.deepStrictEqual(result, { rows: [] });
  });

  it('should be idempotent on double start / double stop', async () => {
    agent = await DiagnosticAgent.create()
      .withRuntimeMonitor({ checkIntervalMs: 500 });

    await agent.start();
    await agent.start(); // second start is a no-op

    assert.strictEqual(agent.isRunning, true);

    agent.stop();
    agent.stop(); // second stop is a no-op

    assert.strictEqual(agent.isRunning, false);
  });
});

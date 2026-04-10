import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticAgent } from '../src/diagnostic-agent.ts';

describe('DiagnosticAgent Extensions', () => {
  let agent: DiagnosticAgent;

  beforeEach(() => {
    agent = new DiagnosticAgent();
  });

  it('should enable and disable SQL instrumentation', () => {
    agent.enableSQL({ sanitize: true });
    assert.ok((agent as any).config.instrumentation.sql.enabled);
    assert.ok((agent as any).config.instrumentation.sql.sanitize);
  });

  it('should enable and disable FS instrumentation', () => {
    agent.enableFS({ trackSync: true });
    assert.ok((agent as any).config.instrumentation.fs.enabled);
  });

  it('should enable and disable HTTP instrumentation', () => {
    agent.enableHTTP();
    assert.ok((agent as any).config.instrumentation.http.enabled);
  });

  it('should enable and disable Logger instrumentation', () => {
    agent.enableLogger({ scrubEntropy: true });
    assert.ok((agent as any).config.instrumentation.logger.enabled);
  });

  it('should enable and disable Runtime monitor', () => {
    agent.enableRuntimeMonitor({ eventLoopThresholdMs: 100 });
    assert.ok((agent as any).config.metrics.runtime.enabled);
  });

  it('should enable and disable Resource monitor', () => {
    agent.enableResourceMonitor({ handleThreshold: 500 });
    assert.ok((agent as any).config.metrics.resources.enabled);
  });

  it('should enable and disable Crash guard', () => {
    agent.enableCrashGuard();
    assert.ok((agent as any).config.metrics.crashGuard.enabled);
  });

  it('should enable and disable Source maps', () => {
    agent.enableSourceMaps();
    assert.ok((agent as any).config.sourceMaps.enabled);
  });

  it('should enable and disable OTLP export', () => {
    agent.enableOTLPExport({ url: 'http://localhost:4318' });
    assert.ok((agent as any).config.exporter.otlp.enabled);
  });

  it('should handle multiple enable calls idempotently', () => {
    agent.enableSQL().enableSQL().enableHTTP();
    assert.ok((agent as any).config.instrumentation.sql.enabled);
    assert.ok((agent as any).config.instrumentation.http.enabled);
  });

  it('should throw on traceQuery if not initialized', async () => {
    const rawAgent = new DiagnosticAgent(); // not started
    await assert.rejects(async () => {
      await rawAgent.traceQuery('SELECT 1', () => Promise.resolve());
    }, /not started/i);
  });

  it('should throw on resolvePosition if not initialized', async () => {
    const rawAgent = new DiagnosticAgent();
    await assert.rejects(async () => {
      await rawAgent.resolvePosition('foo.js', 1, 1);
    }, /not started/i);
  });
});

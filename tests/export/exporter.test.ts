import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { OTLPExporter } from '../../src/export/exporter.ts';
import https from 'node:https';
import type { AggregatorEvent } from '../../src/export/aggregator.ts';
import { EventEmitter } from 'node:events';

describe('OTLPExporter', () => {
  it('should correctly format events to OTLP JSON payload', () => {
    const exporter = new OTLPExporter({
      endpointUrl: 'https://localhost',
      key: 'test',
      cert: 'test',
      ca: 'test'
    });

    const mockEvents: AggregatorEvent[] = [
      { id: '1', metricName: 'query', value: 100, payload: { query: 'SELECT * FROM users' } }
    ];

    const payload = exporter.formatToOTLP(mockEvents);

    assert.ok(payload.resourceSpans[0].scopeSpans[0].spans.length === 1);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    
    assert.strictEqual(span.name, 'query');
    assert.ok(span.traceId.length === 32);
    assert.ok(span.spanId.length === 16);
    assert.strictEqual(
      span.attributes.find((a: any) => a.key === 'diagnostic.value')?.value.doubleValue,
      100
    );
  });

  it('should construct mTLS options using node:https request correctly', async () => {
    const mockRequest = mock.method(https, 'request', (options: any, callback?: any) => {
      // Assert mTLS options are populated exactly
      assert.strictEqual(options.key, 'mock-key');
      assert.strictEqual(options.cert, 'mock-cert');
      assert.strictEqual(options.ca, 'mock-ca');
      assert.strictEqual(options.rejectUnauthorized, true);
      assert.strictEqual(options.hostname, 'datadog.example.com');
      assert.strictEqual(options.method, 'POST');

      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = () => {};
      
      // Simulate HTTP 200 response
      const resMock = new EventEmitter() as any;
      resMock.statusCode = 200;
      
      // Fire callback async to mimic network
      process.nextTick(() => {
        if (callback) callback(resMock);
        resMock.emit('end');
      });

      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: 'https://datadog.example.com/v1/traces',
      key: 'mock-key',
      cert: 'mock-cert',
      ca: 'mock-ca'
    });

    await exporter.export([{
      id: 'uuid',
      metricName: 'event-loop-lag',
      value: 60,
      payload: { lagMs: 60, timestamp: Date.now() }
    }]);

    assert.strictEqual(mockRequest.mock.calls.length, 1);
  });
});

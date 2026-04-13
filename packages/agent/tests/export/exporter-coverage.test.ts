/**
 * Additional coverage tests for OTLPExporter
 * Targets: invalid URL (lines 31-32), non-200 status (58-59), timeout (65-66),
 *          empty events early-return (line 21), missing timestamp payload (line 80)
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { OTLPExporter } from '../../src/export/exporter.ts';
import { EventEmitter } from 'node:events';

describe('OTLPExporter (coverage)', () => {

  it('should resolve immediately when events array is empty', async () => {
    const exporter = new OTLPExporter({
      endpointUrl: 'https://example.com',
      ca: 'ca', cert: 'cert', key: 'key'
    });
    // Should not throw or call https.request
    await exporter.export([]);
  });

  it('should reject with an error when the endpoint URL is invalid', async () => {
    const exporter = new OTLPExporter({
      endpointUrl: 'NOT_A_VALID_URL',
      ca: 'ca', cert: 'cert', key: 'key'
    });

    await assert.rejects(
      () => exporter.export([{ id: '1', metricName: 'test', value: 0, payload: {} }]),
      undefined, // any error
    );
  });

  it('should reject when the server returns a non-200 status code', async () => {
    const mockRequest = mock.method(https, 'request', (_opts: any, callback?: any) => {
      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = () => {};

      const resMock = new EventEmitter() as any;
      resMock.statusCode = 500;

      process.nextTick(() => {
        if (callback) callback(resMock);
        resMock.emit('data', 'Internal Server Error');
        resMock.emit('end');
      });

      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: 'https://example.com/traces',
      ca: 'ca', cert: 'cert', key: 'key'
    });

    try {
      await assert.rejects(
        () => exporter.export([{ id: '1', metricName: 'test', value: 42, payload: {} }]),
        /OTLP Export failed with status 500/,
      );
    } finally {
      mockRequest.mock.restore();
    }
  });

  it('should reject when the request times out', async () => {
    const mockRequest = mock.method(https, 'request', (_opts: any, _callback?: any) => {
      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = function() {
        // Emit error after destroy to simulate timeout rejection chain
        // The real code calls req.destroy() then reject(new Error('timed out'))
      };

      // Emit 'timeout' event on next tick
      process.nextTick(() => {
        reqMock.emit('timeout');
      });

      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: 'https://example.com/traces',
      ca: 'ca', cert: 'cert', key: 'key',
      timeoutMs: 1
    });

    try {
      await assert.rejects(
        () => exporter.export([{ id: '1', metricName: 'test', value: 0, payload: {} }]),
        /Export request timed out/,
      );
    } finally {
      mockRequest.mock.restore();
    }
  });

  it('should reject when the https request itself errors', async () => {
    const mockRequest = mock.method(https, 'request', (_opts: any, _callback?: any) => {
      const reqMock = new EventEmitter() as any;
      reqMock.write = () => {};
      reqMock.end = () => {};
      reqMock.destroy = () => {};

      process.nextTick(() => {
        reqMock.emit('error', new Error('Network failure'));
      });

      return reqMock;
    });

    const exporter = new OTLPExporter({
      endpointUrl: 'https://example.com/traces',
      ca: 'ca', cert: 'cert', key: 'key'
    });

    try {
      await assert.rejects(
        () => exporter.export([{ id: '1', metricName: 'test', value: 0, payload: {} }]),
        /Network failure/,
      );
    } finally {
      mockRequest.mock.restore();
    }
  });

  it('formatToOTLP should use Date.now() when payload has no timestamp', () => {
    const exporter = new OTLPExporter({
      endpointUrl: 'https://example.com',
      ca: 'ca', cert: 'cert', key: 'key'
    });

    const beforeMs = Date.now();
    const payload = exporter.formatToOTLP([{
      id: '1',
      metricName: 'memory-leak',
      value: 0,
      payload: null  // no .timestamp property → falls back to Date.now()
    }]);
    const afterMs = Date.now();

    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    // startTimeUnixNano = timestamp * 1_000_000 — verify it's a valid large number
    assert.ok(typeof span.startTimeUnixNano === 'number',
      'startTimeUnixNano should be a number');
    assert.ok(span.startTimeUnixNano > 0, 'startTimeUnixNano should be positive');
    // memory-leak events have durationMs=0, so end should equal start
    assert.strictEqual(span.endTimeUnixNano, span.startTimeUnixNano,
      'memory-leak events should have zero duration (start === end)');
    // The recovered timestamp should be in a sane range
    const recoveredMs = span.startTimeUnixNano / 1_000_000;
    // Allow a generous 1 second window for test timing jitter
    assert.ok(
      recoveredMs >= beforeMs - 1000 && recoveredMs <= afterMs + 1000,
      `Timestamp ${recoveredMs}ms should be near [${beforeMs}, ${afterMs}]`
    );
  });
});

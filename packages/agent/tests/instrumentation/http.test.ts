import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import { HttpInstrumentation, type TracedHttpRequest } from '../../src/instrumentation/http.ts';
import { runWithContext, createRequestContext } from '../../src/instrumentation/correlation.ts';

describe('HttpInstrumentation', () => {
  it('should trace an outgoing HTTP request using diagnostics channel', async () => {
    const instrumentation = new HttpInstrumentation(() => 'test.ts:1');
    let capturedRequest: TracedHttpRequest | null = null;

    instrumentation.on('request', (req) => {
      capturedRequest = req;
    });

    instrumentation.enable();

    // Make an outgoing request to a dummy server
    const server = http.createServer((res, req) => {
      req.writeHead(200);
      req.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const req = http.request(`http://localhost:${port}/test-path`, (res) => {
      res.on('data', () => {});
    });
    req.end();

    // Wait for the request to complete
    await new Promise<void>((resolve) => {
      req.on('close', resolve);
    });

    // Wait a tiny bit for the diagnostics channel to fire
    await new Promise(r => setTimeout(r, 10));

    instrumentation.disable();
    server.close();

    assert.ok(capturedRequest, 'Should have traced request');
    assert.strictEqual(capturedRequest.method, 'GET');
    assert.ok(capturedRequest.url.includes('/test-path'));
    assert.ok(typeof capturedRequest.durationMs === 'number');
    assert.strictEqual(capturedRequest.statusCode, 200);
  });

  it('should include correlationId when request is wrapped in runWithContext', async () => {
    const instrumentation = new HttpInstrumentation(() => 'test.ts:1');
    let capturedRequest: Record<string, unknown> | null = null;

    instrumentation.on('request', (req) => {
      capturedRequest = req as Record<string, unknown>;
    });

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const ctx = createRequestContext('GET', `/corr-test`);

    await runWithContext(ctx, async () => {
      instrumentation.enable();

      const req = http.request(`http://localhost:${port}/corr-test`, (res) => {
        res.on('data', () => {});
      });
      req.end();

      await new Promise<void>((resolve) => req.on('close', resolve));
      await new Promise((r) => setTimeout(r, 10));

      instrumentation.disable();
    });

    server.close();

    assert.ok(capturedRequest, 'Should have traced request');
    assert.equal(capturedRequest['correlationId'], ctx.requestId,
      'correlationId should match the request context requestId');
  });

  it('should not include correlationId when request is outside runWithContext', async () => {
    const instrumentation = new HttpInstrumentation(() => 'test.ts:1');
    let capturedRequest: Record<string, unknown> | null = null;

    instrumentation.on('request', (req) => {
      capturedRequest = req as Record<string, unknown>;
    });

    instrumentation.enable();

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const req = http.request(`http://localhost:${port}/no-context`, (res) => {
      res.on('data', () => {});
    });
    req.end();
    await new Promise<void>((resolve) => req.on('close', resolve));
    await new Promise((r) => setTimeout(r, 10));

    instrumentation.disable();
    server.close();

    assert.ok(capturedRequest, 'Should have traced request');
    assert.equal(capturedRequest['correlationId'], undefined,
      'correlationId should be undefined outside runWithContext');
  });
});

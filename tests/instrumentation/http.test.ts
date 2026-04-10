import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpInstrumentation } from '../../src/instrumentation/http.ts';

describe('HttpInstrumentation', () => {
  it('should trace an outgoing HTTP request using diagnostics channel', async () => {
    const instrumentation = new HttpInstrumentation(() => 'test.ts:1');
    let capturedRequest: any = null;

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
    const port = (server.address() as any).port;

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
});

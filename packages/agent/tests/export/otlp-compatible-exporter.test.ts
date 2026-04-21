import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OTLPCompatibleExporter } from "../../src/export/otlp-compatible-exporter.ts";
import type { AggregatorEvent } from "../../src/export/aggregator.ts";

function makeEvent(overrides: Partial<AggregatorEvent> = {}): AggregatorEvent {
  return {
    id: "test-id",
    metricName: "query",
    value: 42,
    payload: { sanitizedQuery: "SELECT ?" },
    ...overrides,
  };
}

describe("OTLPCompatibleExporter", () => {
  // ── constructor validation ─────────────────────────────────────────────────

  it("throws on invalid URL", () => {
    assert.throws(
      () => new OTLPCompatibleExporter({ endpointUrl: "not-a-url" }),
      /invalid endpointUrl/,
    );
  });

  it("throws on unsupported protocol", () => {
    assert.throws(
      () => new OTLPCompatibleExporter({ endpointUrl: "ftp://example.com/v1" }),
      /http or https/,
    );
  });

  it("accepts http:// URLs", () => {
    assert.doesNotThrow(
      () => new OTLPCompatibleExporter({ endpointUrl: "http://localhost:4318/v1/metrics" }),
    );
  });

  it("accepts https:// URLs", () => {
    assert.doesNotThrow(
      () => new OTLPCompatibleExporter({ endpointUrl: "https://api.example.com/v1/metrics" }),
    );
  });

  // ── export() returns immediately for empty array ───────────────────────────

  it("export([]) resolves without making a network call", async () => {
    const exporter = new OTLPCompatibleExporter({ endpointUrl: "http://localhost:9999/v1" });
    // No server running on 9999 — should resolve because events is empty
    await assert.doesNotReject(exporter.export([]));
  });

  // ── HTTP round-trip via local server ──────────────────────────────────────

  it("POSTs valid OTLP JSON to the endpoint and resolves on 200", async () => {
    let receivedBody = "";
    let receivedPath = "";
    let receivedMethod = "";

    const server = http.createServer((req, res) => {
      receivedMethod = req.method ?? "";
      receivedPath = req.url ?? "";
      let data = "";
      req.on("data", (chunk) => {
        data += String(chunk);
      });
      req.on("end", () => {
        receivedBody = data;
        res.writeHead(200).end();
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
        serviceName: "my-service",
      });

      await exporter.export([makeEvent()]);

      assert.strictEqual(receivedMethod, "POST");
      assert.strictEqual(receivedPath, "/v1/metrics");
      assert.ok(receivedBody.length > 0);

      const parsed = JSON.parse(receivedBody) as { resourceMetrics: unknown[] };
      assert.ok(Array.isArray(parsed.resourceMetrics));
      assert.strictEqual((parsed.resourceMetrics as []).length, 1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("includes Authorization header when apiKey provided", async () => {
    let receivedAuth = "";

    const server = http.createServer((req, res) => {
      receivedAuth = req.headers.authorization ?? "";
      res.writeHead(200).end();
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
        apiKey: "my-secret-key",
      });

      await exporter.export([makeEvent()]);
      assert.strictEqual(receivedAuth, "Bearer my-secret-key");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects on HTTP 4xx response", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
      });
      await assert.rejects(exporter.export([makeEvent()]), /401/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects on HTTP 5xx response", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(500).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
      });
      await assert.rejects(exporter.export([makeEvent()]), /500/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("data points include argus.payload attribute with full event payload as JSON", async () => {
    let receivedBody = "";
    const server = http.createServer((req, res) => {
      let d = "";
      req.on("data", (c) => {
        d += String(c);
      });
      req.on("end", () => {
        receivedBody = d;
        res.writeHead(200).end();
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
      });
      const payload = { sanitizedQuery: "SELECT ?", suggestions: [{ message: "add index" }] };
      await exporter.export([makeEvent({ payload })]);

      const parsed = JSON.parse(receivedBody) as {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    gauge: {
                      dataPoints: {
                        attributes: { key: string; value: { stringValue: string } }[];
                      }[];
                    };
                  },
                ];
              },
            ];
          },
        ];
      };
      const dp = parsed.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[0];
      const payloadAttr = dp.attributes.find((a) => a.key === "argus.payload");
      assert.ok(payloadAttr, "argus.payload attribute must be present");
      assert.deepStrictEqual(JSON.parse(payloadAttr.value.stringValue), payload);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("OTLP body contains service.name attribute", async () => {
    let receivedBody = "";
    const server = http.createServer((req, res) => {
      let d = "";
      req.on("data", (c) => {
        d += String(c);
      });
      req.on("end", () => {
        receivedBody = d;
        res.writeHead(200).end();
      });
    });

    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };

    try {
      const exporter = new OTLPCompatibleExporter({
        endpointUrl: `http://127.0.0.1:${port}/v1/metrics`,
        serviceName: "argus-test",
      });
      await exporter.export([makeEvent()]);

      const parsed = JSON.parse(receivedBody) as {
        resourceMetrics: [
          { resource: { attributes: { key: string; value: { stringValue: string } }[] } },
        ];
      };
      const attrs = parsed.resourceMetrics[0].resource.attributes;
      const svcAttr = attrs.find((a) => a.key === "service.name");
      assert.ok(svcAttr);
      assert.strictEqual(svcAttr.value.stringValue, "argus-test");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

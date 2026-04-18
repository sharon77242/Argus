import https from "node:https";
import crypto from "node:crypto";
import type { AggregatorEvent } from "./aggregator.ts";

export interface ExporterConfig {
  endpointUrl: string; // e.g. https://otel.example.com/v1/traces
  ca: string | Buffer;
  cert: string | Buffer;
  key: string | Buffer;
  timeoutMs?: number;
  /** Max retry attempts on transient 5xx or network errors. Default: 1. */
  maxRetries?: number;
  /** Base delay between retries in ms (doubles each attempt). Default: 1000. */
  retryDelayMs?: number;
  /** OTLP resource service.name attribute. Default: 'argus'. */
  serviceName?: string;
  /** OTLP scope version attribute. Default: '1.0.0'. */
  serviceVersion?: string;
}

/** Retryable: network errors and 5xx responses. Not retryable: 4xx and bad URLs. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message.startsWith("OTLP Export failed with status 4")) return false;
  return true;
}

export class OTLPExporter {
  private config: ExporterConfig;

  constructor(config: ExporterConfig) {
    let parsed: URL;
    try {
      parsed = new URL(config.endpointUrl);
    } catch {
      throw new TypeError(`OTLPExporter: invalid endpointUrl "${config.endpointUrl}"`);
    }
    if (parsed.protocol !== "https:") {
      throw new TypeError(`OTLPExporter: endpointUrl must use https, got "${parsed.protocol}"`);
    }
    this.config = config;
  }

  public async export(events: AggregatorEvent[]): Promise<void> {
    if (events.length === 0) return;
    const maxRetries = this.config.maxRetries ?? 1;
    const retryDelayMs = this.config.retryDelayMs ?? 1000;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
      }
      try {
        await this.attempt(events);
        return; // success
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) break; // don't retry 4xx or malformed URL
      }
    }

    throw lastErr;
  }

  private async attempt(events: AggregatorEvent[]): Promise<void> {
    const payload = this.formatToOTLP(events);
    const payloadStr = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(this.config.endpointUrl);
      } catch (err) {
        return reject(err instanceof Error ? err : new Error(String(err)));
      }

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payloadStr),
        },
        ca: this.config.ca,
        cert: this.config.cert,
        key: this.config.key,
        timeout: this.config.timeoutMs ?? 5000,
        // Guarantee strict TLS boundary
        rejectUnauthorized: true,
      };

      const req = https.request(options, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`OTLP Export failed with status ${res.statusCode}: ${responseBody}`));
          }
        });
      });

      req.on("error", (e) => reject(e));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Export request timed out"));
      });

      req.write(payloadStr);
      req.end();
    });
  }

  /**
   * Translates internal events to OTLP JSON trace format.
   * Conforms strictly to OpenTelemetry HTTP/JSON standard.
   */
  public formatToOTLP(events: AggregatorEvent[]) {
    const spans = events.map((event) => {
      const timestamp =
        typeof event.payload.timestamp === "number" ? event.payload.timestamp : Date.now();
      const durationMs = event.metricName === "memory-leak" ? 0 : event.value;

      return {
        traceId: crypto.randomBytes(16).toString("hex"),
        spanId: crypto.randomBytes(8).toString("hex"),
        name: event.metricName,
        kind: 1, // SPAN_KIND_INTERNAL
        startTimeUnixNano: timestamp * 1000000,
        endTimeUnixNano: (timestamp + durationMs) * 1000000,
        attributes: [
          {
            key: "diagnostic.value",
            value: { doubleValue: event.value },
          },
          {
            key: "diagnostic.payload",
            value: { stringValue: JSON.stringify(event.payload) },
          },
        ],
      };
    });

    const serviceName = this.config.serviceName ?? "argus";
    const serviceVersion = this.config.serviceVersion ?? "1.0.0";
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
          },
          scopeSpans: [
            {
              scope: { name: serviceName, version: serviceVersion },
              spans: spans,
            },
          ],
        },
      ],
    };
  }
}

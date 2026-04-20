import https from "node:https";
import http from "node:http";
import type { AggregatorEvent } from "./aggregator.ts";

export interface OTLPCompatibleExporterConfig {
  /** OTLP HTTP endpoint URL (http or https). e.g. https://api.honeycomb.io/v1/metrics */
  endpointUrl: string;
  /** Optional bearer token sent as 'Authorization: Bearer <apiKey>'. */
  apiKey?: string;
  /** Request timeout in ms. Default: 5 000. */
  timeoutMs?: number;
  /** OTLP resource service.name attribute. Default: 'argus'. */
  serviceName?: string;
}

/**
 * OTLP-JSON exporter that sends metrics in OpenTelemetry wire format without
 * requiring the full OTel SDK.  Supports both http and https endpoints.
 */
export class OTLPCompatibleExporter {
  private readonly config: OTLPCompatibleExporterConfig;
  private readonly url: URL;

  constructor(config: OTLPCompatibleExporterConfig) {
    let parsed: URL;
    try {
      parsed = new URL(config.endpointUrl);
    } catch {
      throw new TypeError(`OTLPCompatibleExporter: invalid endpointUrl "${config.endpointUrl}"`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError(
        `OTLPCompatibleExporter: endpointUrl must use http or https, got "${parsed.protocol}"`,
      );
    }
    this.url = parsed;
    this.config = config;
  }

  /** Converts AggregatorEvents to OTLP metrics JSON and POSTs to the endpoint. */
  async export(events: AggregatorEvent[]): Promise<void> {
    if (events.length === 0) return;
    const body = JSON.stringify(this._toOtlpMetrics(events));
    await this._post(body);
  }

  private _toOtlpMetrics(events: AggregatorEvent[]): unknown {
    const serviceName = this.config.serviceName ?? "argus";
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    const nowNsStr = nowNs.toString();

    const dataPoints = events.map((e) => ({
      attributes: [{ key: "metric.name", value: { stringValue: e.metricName } }],
      startTimeUnixNano: nowNsStr,
      timeUnixNano: nowNsStr,
      asDouble: e.value,
      exemplars: [],
    }));

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
          },
          scopeMetrics: [
            {
              scope: { name: "argus", version: "0.1.0" },
              metrics: [
                {
                  name: "argus.events",
                  gauge: { dataPoints },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  private _post(body: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutMs = this.config.timeoutMs ?? 5_000;
      const transport = this.url.protocol === "https:" ? https : http;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body).toString(),
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      const req = transport.request(
        {
          hostname: this.url.hostname,
          port: this.url.port || (this.url.protocol === "https:" ? 443 : 80),
          path: this.url.pathname + this.url.search,
          method: "POST",
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          res.resume(); // drain response
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(`OTLPCompatibleExporter: export failed with status ${res.statusCode}`),
            );
          } else {
            resolve();
          }
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error(`OTLPCompatibleExporter: request timed out after ${timeoutMs}ms`));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

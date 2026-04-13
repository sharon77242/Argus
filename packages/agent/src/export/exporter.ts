import https from 'node:https';
import crypto from 'node:crypto';
import type { AggregatorEvent } from './aggregator.ts';

export interface ExporterConfig {
  endpointUrl: string; // e.g. https://otel.example.com/v1/traces
  ca: string | Buffer;
  cert: string | Buffer;
  key: string | Buffer;
  timeoutMs?: number;
}

export class OTLPExporter {
  private config: ExporterConfig;

  constructor(config: ExporterConfig) {
    this.config = config;
  }

  public async export(events: AggregatorEvent[]): Promise<void> {
    if (events.length === 0) return;

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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr),
        },
        ca: this.config.ca,
        cert: this.config.cert,
        key: this.config.key,
        timeout: this.config.timeoutMs ?? 5000,
        // Guarantee strict TLS boundary
        rejectUnauthorized: true,
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`OTLP Export failed with status ${res.statusCode}: ${responseBody}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Export request timed out'));
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
    const spans = events.map(event => {
      const timestamp = typeof event.payload?.timestamp === 'number' ? event.payload.timestamp : Date.now();
      const durationMs = event.metricName === 'memory-leak' ? 0 : event.value;

      return {
        traceId: crypto.randomBytes(16).toString('hex'),
        spanId: crypto.randomBytes(8).toString('hex'),
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
          }
        ]
      };
    });

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "deep-diagnostic-agent" } }
            ]
          },
          scopeSpans: [
            {
              scope: { name: "deep-diagnostic-agent", version: "1.0.0" },
              spans: spans
            }
          ]
        }
      ]
    };
  }
}

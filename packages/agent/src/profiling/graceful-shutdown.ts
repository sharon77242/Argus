import type { ArgusAgent } from "../argus-agent.ts";

export interface GracefulShutdownOptions {
  timeoutMs?: number;
}

/**
 * Registers SIGTERM/SIGINT handlers that flush telemetry before process exit.
 * Uses agent.stop() which returns a Promise — awaited before process.exit(0).
 * On timeout, exits with code 1 so process supervisors (systemd, Kubernetes)
 * know the shutdown was degraded and can decide whether to restart.
 */
export class GracefulShutdown {
  private registered = false;

  register(agent: ArgusAgent, opts: GracefulShutdownOptions = {}): void {
    if (this.registered) return;
    this.registered = true;
    const timeout = opts.timeoutMs ?? 5000;

    const shutdown = (signal: string) => {
      let exited = false;
      const doExit = (code: number) => {
        if (exited) return;
        exited = true;
        process.exit(code);
      };

      try {
        agent.emit("info", `ArgusAgent: ${signal} received — flushing telemetry`);
      } catch {
        // listener threw — proceed to flush anyway
      }

      const timer = setTimeout(() => {
        try {
          agent.emit("info", "ArgusAgent: flush timeout — exiting");
        } catch {
          // ignore
        }
        doExit(1); // exit 1: degraded shutdown, supervisor should decide whether to restart
      }, timeout);
      timer.unref(); // don't hold the process open if flush completes first

      // stop() is async — await it so the exporter can flush before exit
      void (async () => {
        try {
          await agent.stop();
        } catch {
          // stop() threw — still exit cleanly
        }
        clearTimeout(timer);
        doExit(0);
      })();
    };

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  }
}

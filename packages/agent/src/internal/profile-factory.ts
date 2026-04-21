/**
 * Profile factory — pure configuration logic for ArgusAgent.createProfile().
 *
 * Kept separate from ArgusAgent to keep the main class focused on lifecycle
 * and public API, not preset decision-making.
 */

import type { ArgusAgent, AgentProfileConfig, AppType } from "../argus-agent.ts";
import { detectAppTypes } from "../profiling/app-type-detector.ts";

/**
 * Applies profile-based configuration to an already-constructed (but not yet started)
 * `ArgusAgent` instance. Calls only the agent's public builder methods.
 *
 * Separated from the static `createProfile()` factory so the decision logic can be
 * tested and reasoned about independently of the class lifecycle.
 *
 * @param agent  Fresh `ArgusAgent` instance (pre-disabled check done by caller).
 * @param config Profile configuration from the caller.
 */
export function buildAgentProfile(agent: ArgusAgent, config: AgentProfileConfig): void {
  const env = config.environment ?? "prod";
  agent.isDevMode = env === "dev";

  // Resolve app types — 'auto' triggers package.json scanning
  let appTypes: AppType[];
  const selectedType = config.appType ?? "auto";

  if (selectedType === "auto") {
    const detected = detectAppTypes(config.workspaceDir);
    if (detected.types.length > 0) {
      appTypes = detected.types;
    } else {
      // No recognized packages found — don't silently assume 'web'.
      // Emit a dev-time notice and apply no app-type-specific modules.
      appTypes = [];
      if (env !== "prod") {
        // Delay to after construction so listeners can attach
        setImmediate(() => {
          agent.emit(
            "info",
            "ArgusAgent: auto-detection found no recognized app type in package.json. " +
              'Pass appType explicitly ("web" | "db" | "worker") to enable app-specific monitoring.',
          );
        });
      }
    }
  } else {
    appTypes = Array.isArray(selectedType) ? selectedType : [selectedType];
  }

  // 1. Universal Production Safe Bindings
  agent.withCrashGuard();
  agent.withLogTracing();

  // 2. Dev/Test Scanners (Non-Prod)
  if (env === "dev" || env === "test") {
    agent.withFsTracing();
    if (config.workspaceDir) {
      agent.withStaticScanner(config.workspaceDir);
      agent.withAuditScanner(config.workspaceDir);
      agent.withSourceMaps(config.workspaceDir);
    }
  }

  // 3. Application Type Optimization — union modules from all specified types.
  //    Each `with*()` call is idempotent, so duplicates across types are harmless.
  for (const app of appTypes) {
    switch (app) {
      case "web":
        agent.withHttpTracing();
        agent.withResourceLeakMonitor(); // Catch Sockets
        agent.withInstrumentation({ autoPatching: true }); // Catch remote db calls
        break;
      case "db":
        agent.withQueryAnalysis(config.queryAnalysis ?? {});
        agent.withSlowQueryMonitor(config.slowQueries ?? {});
        agent.withInstrumentation({ autoPatching: true });
        agent.withResourceLeakMonitor(); // Catch Db connection leaks
        break;
      case "worker":
        agent.withRuntimeMonitor(); // Catch memory leaks/CPU hangs heavily
        agent.withGcMonitor();
        agent.withResourceLeakMonitor();
        agent.withInstrumentation({ autoPatching: true });
        break;
    }
  }

  // Always register graceful shutdown so buffered telemetry is flushed on SIGTERM/SIGINT.
  agent.withGracefulShutdown();
}

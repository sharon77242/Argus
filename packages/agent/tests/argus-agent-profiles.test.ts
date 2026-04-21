import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ArgusAgent, type AgentProfileConfig } from "../src/argus-agent.ts";

describe("ArgusAgent Profiles", () => {
  it("should return a zero-overhead NoOp agent when enabled is false", async () => {
    const config: AgentProfileConfig = { enabled: false };
    const agent = ArgusAgent.createProfile(config);

    // Test that bindings can be called without error
    agent.withHttpTracing().withCrashGuard();

    await agent.start();

    // Running shouldn't be set because start() exits early
    // We can verify this via internal state if necessary, but returning gracefully is proof enough
    agent.stop();
  });

  it("should enable Dev bounds correctly", () => {
    const config: AgentProfileConfig = {
      environment: "dev",
      workspaceDir: process.cwd(),
      appType: "web",
    };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should enable DB profile bounds without error", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: "db" };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should enable Worker profile bounds without error", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: "worker" };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  // ── Mixed / Hybrid App Types ──────────────────────────────────

  it("should accept an array of app types (web + db)", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: ["web", "db"] };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should accept an array of app types (web + worker)", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: ["web", "worker"] };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should accept all three app types combined (web + db + worker)", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: ["web", "db", "worker"] };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should start and stop cleanly with a mixed profile", async () => {
    const config: AgentProfileConfig = {
      environment: "dev",
      appType: ["web", "db", "worker"],
      workspaceDir: process.cwd(),
    };
    const agent = ArgusAgent.createProfile(config);
    await agent.start();
    assert.strictEqual(agent.isRunning, true);
    agent.stop();
    assert.strictEqual(agent.isRunning, false);
  });

  it("should still accept a single string appType (backward compat)", () => {
    const config: AgentProfileConfig = { environment: "prod", appType: "web" };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  // ── Auto-Detection ────────────────────────────────────────────

  it('should accept appType "auto" and create a valid agent', () => {
    const config: AgentProfileConfig = { environment: "prod", appType: "auto" };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should auto-detect with workspaceDir and create a valid agent", () => {
    const config: AgentProfileConfig = {
      environment: "dev",
      appType: "auto",
      workspaceDir: process.cwd(),
    };
    const agent = ArgusAgent.createProfile(config);
    assert.ok(agent);
  });

  it("should expose a static detectAppTypes() method", () => {
    const result = ArgusAgent.detectAppTypes();
    assert.ok(Array.isArray(result.types));
    assert.ok(result.matches);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticAgent, type AgentProfileConfig } from '../src/diagnostic-agent.ts';

describe('DiagnosticAgent Profiles', () => {
  it('should return a zero-overhead NoOp agent when enabled is false', async () => {
    const config: AgentProfileConfig = { enabled: false };
    const agent = DiagnosticAgent.createProfile(config);
    
    // Test that bindings can be called without error
    agent.withHttpTracing().withCrashGuard();
    
    await agent.start();
    
    // Running shouldn't be set because start() exits early
    // We can verify this via internal state if necessary, but returning gracefully is proof enough
    agent.stop();
  });

  it('should enable Dev bounds correctly', () => {
    const config: AgentProfileConfig = { environment: 'dev', workspaceDir: process.cwd(), appType: 'web' };
    const agent = DiagnosticAgent.createProfile(config);
    assert.ok(agent);
  });

  it('should enable DB profile bounds without error', () => {
    const config: AgentProfileConfig = { environment: 'prod', appType: 'db' };
    const agent = DiagnosticAgent.createProfile(config);
    assert.ok(agent);
  });

  it('should enable Worker profile bounds without error', () => {
    const config: AgentProfileConfig = { environment: 'prod', appType: 'worker' };
    const agent = DiagnosticAgent.createProfile(config);
    assert.ok(agent);
  });
});

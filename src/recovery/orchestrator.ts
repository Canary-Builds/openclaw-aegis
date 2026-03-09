import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import type { DiagnosisContext, HealthScore, RecoveryAction } from "../types/index.js";
import type { AegisConfig } from "../config/schema.js";
import { preflightValidation } from "../config-guardian/guardian.js";
import { DiagnosisEngine } from "../diagnosis/engine.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { BackupManager } from "../backup/manager.js";
import { createL3Patterns } from "./l3-patterns.js";

const execFileAsync = promisify(execFile);

export type RecoveryEvent =
  | { type: "L1_ATTEMPT"; attempt: number }
  | { type: "L1_SUCCESS" }
  | { type: "L1_PREFLIGHT_FAILED"; errors: string[] }
  | { type: "L2_ATTEMPT"; pattern: string }
  | { type: "L2_SUCCESS"; pattern: string }
  | { type: "L2_FAILURE"; pattern: string }
  | { type: "L2_NO_MATCH" }
  | { type: "L3_ATTEMPT"; pattern: string }
  | { type: "L3_SUCCESS"; pattern: string }
  | { type: "L3_FAILURE"; pattern: string }
  | { type: "L3_NO_MATCH" }
  | { type: "L3_DISABLED" }
  | { type: "L4_ALERT"; reason: string; actions: RecoveryAction[] }
  | { type: "CIRCUIT_BREAKER_TRIPPED" }
  | { type: "FAST_PATH_L4"; reason: string };

export class RecoveryOrchestrator extends EventEmitter {
  private readonly config: AegisConfig;
  private readonly diagnosisEngine: DiagnosisEngine;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly backupManager: BackupManager;
  private recovering = false;

  constructor(config: AegisConfig, diagnosisEngine: DiagnosisEngine, backupManager: BackupManager) {
    super();
    this.config = config;
    this.diagnosisEngine = diagnosisEngine;
    this.backupManager = backupManager;
    this.circuitBreaker = new CircuitBreaker(
      config.recovery.circuitBreakerMaxCycles,
      config.recovery.circuitBreakerWindowMs,
    );
  }

  isRecovering(): boolean {
    return this.recovering;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Public entry point for on-demand L3 deep repair (e.g. from /repair bot command).
   * Runs L3 patterns regardless of l3Enabled config — caller is responsible for confirmation.
   */
  async triggerL3(): Promise<{ success: boolean; actions: RecoveryAction[] }> {
    return this.attemptL3();
  }

  async recover(_healthScore: HealthScore): Promise<RecoveryAction[]> {
    if (this.recovering) return [];
    this.recovering = true;

    try {
      if (this.circuitBreaker.isTripped()) {
        this.emitEvent({ type: "CIRCUIT_BREAKER_TRIPPED" });
        return [];
      }

      const actions: RecoveryAction[] = [];

      const l1Result = await this.attemptL1();
      actions.push(...l1Result.actions);
      if (l1Result.success) return actions;

      const l2Result = await this.attemptL2();
      actions.push(...l2Result.actions);

      if (l2Result.success) {
        const retryL1 = await this.attemptL1();
        actions.push(...retryL1.actions);
        if (retryL1.success) return actions;
      }

      // L3: Deep repair — network, dependencies, safe mode, disk cleanup
      let l3Success = false;
      if (this.config.recovery.l3Enabled) {
        const l3Result = await this.attemptL3();
        actions.push(...l3Result.actions);
        l3Success = l3Result.success;

        if (l3Success) {
          const retryL1 = await this.attemptL1();
          actions.push(...retryL1.actions);
          if (retryL1.success) return actions;
        }
      } else {
        this.emitEvent({ type: "L3_DISABLED" });
      }

      if (!l2Result.success && l2Result.noMatch && !l3Success) {
        const l3Note = this.config.recovery.l3Enabled
          ? ""
          : " L3 deep repair is DISABLED — enable it with l3Enabled = true in [recovery] config if you want Aegis to attempt network repair, dependency rebuild, safe mode, and disk cleanup.";
        this.emitEvent({
          type: "FAST_PATH_L4",
          reason: `L1+L2 exhausted — no auto-repair available.${l3Note}`,
        });
      }

      this.circuitBreaker.recordFailedCycle();
      if (this.circuitBreaker.isTripped()) {
        this.emitEvent({ type: "CIRCUIT_BREAKER_TRIPPED" });
      }

      let reason: string;
      if (!this.config.recovery.l3Enabled) {
        reason = !l2Result.success && l2Result.noMatch
          ? "No matching failure pattern — cannot auto-repair. L3 deep repair is DISABLED (enable with l3Enabled = true to allow network repair, dependency rebuild, safe mode boot, and disk cleanup)"
          : "Recovery exhausted — L1+L2 failed. L3 deep repair is DISABLED (enable with l3Enabled = true)";
      } else {
        reason = !l2Result.success && l2Result.noMatch && !l3Success
          ? "No matching failure pattern — cannot auto-repair"
          : "Recovery exhausted — L1+L2+L3 failed";
      }
      this.emitEvent({ type: "L4_ALERT", reason, actions });

      return actions;
    } finally {
      this.recovering = false;
    }
  }

  private async attemptL1(): Promise<{ success: boolean; actions: RecoveryAction[] }> {
    const actions: RecoveryAction[] = [];
    const maxAttempts = this.config.recovery.l1MaxAttempts;
    const baseMs = this.config.recovery.l1BackoffBaseMs;
    const multiplier = this.config.recovery.l1BackoffMultiplier;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.emitEvent({ type: "L1_ATTEMPT", attempt });

      const preflight = preflightValidation(this.config.gateway.configPath);
      if (!preflight.valid) {
        this.emitEvent({ type: "L1_PREFLIGHT_FAILED", errors: preflight.errors });
        actions.push({
          level: "L1",
          action: "preflight-failed",
          result: "skipped",
          durationMs: 0,
        });
        return { success: false, actions };
      }

      const start = Date.now();
      try {
        await execFileAsync("openclaw", ["gateway", "restart"], { timeout: 30000 });
        actions.push({
          level: "L1",
          action: "restart",
          result: "success",
          durationMs: Date.now() - start,
        });
        this.emitEvent({ type: "L1_SUCCESS" });
        return { success: true, actions };
      } catch {
        actions.push({
          level: "L1",
          action: "restart",
          result: "failure",
          durationMs: Date.now() - start,
        });
      }

      if (attempt < maxAttempts) {
        const delay = baseMs * Math.pow(multiplier, attempt - 1);
        await sleep(delay);
      }
    }

    return { success: false, actions };
  }

  private async attemptL2(): Promise<{
    success: boolean;
    actions: RecoveryAction[];
    noMatch: boolean;
  }> {
    const actions: RecoveryAction[] = [];

    const context: DiagnosisContext = {
      configPath: this.config.gateway.configPath,
      pidFile: this.config.gateway.pidFile,
      gatewayPort: this.config.gateway.port,
      logPath: this.config.gateway.logPath,
      knownGoodPath: this.backupManager.getLatestKnownGood()?.path,
      currentConfig: this.readCurrentConfig(),
    };

    for (let attempt = 0; attempt < this.config.recovery.l2MaxAttempts; attempt++) {
      const result = await this.diagnosisEngine.diagnose(context);

      if (!result) {
        this.emitEvent({ type: "L2_NO_MATCH" });
        return { success: false, actions, noMatch: true };
      }

      this.emitEvent({ type: "L2_ATTEMPT", pattern: result.pattern.name });
      actions.push(result.action);

      if (result.action.result === "success") {
        this.emitEvent({ type: "L2_SUCCESS", pattern: result.pattern.name });
        return { success: true, actions, noMatch: false };
      }

      this.emitEvent({ type: "L2_FAILURE", pattern: result.pattern.name });

      if (attempt < this.config.recovery.l2MaxAttempts - 1) {
        await sleep(this.config.recovery.l2CooldownMs);
      }
    }

    return { success: false, actions, noMatch: false };
  }

  private async attemptL3(): Promise<{
    success: boolean;
    actions: RecoveryAction[];
  }> {
    const actions: RecoveryAction[] = [];
    const l3Patterns = createL3Patterns();

    const context: DiagnosisContext = {
      configPath: this.config.gateway.configPath,
      pidFile: this.config.gateway.pidFile,
      gatewayPort: this.config.gateway.port,
      logPath: this.config.gateway.logPath,
      knownGoodPath: this.backupManager.getLatestKnownGood()?.path,
      currentConfig: this.readCurrentConfig(),
    };

    for (let attempt = 0; attempt < this.config.recovery.l3MaxAttempts; attempt++) {
      let matched = false;

      for (const pattern of l3Patterns) {
        try {
          const detected = await pattern.detect(context);
          if (!detected) continue;

          matched = true;
          this.emitEvent({ type: "L3_ATTEMPT", pattern: pattern.name });
          const action = await pattern.fix(context);
          actions.push(action);

          if (action.result === "success") {
            this.emitEvent({ type: "L3_SUCCESS", pattern: pattern.name });
            return { success: true, actions };
          }

          this.emitEvent({ type: "L3_FAILURE", pattern: pattern.name });
        } catch {
          // Pattern failed — continue to next
        }
      }

      if (!matched) {
        this.emitEvent({ type: "L3_NO_MATCH" });
        return { success: false, actions };
      }

      if (attempt < this.config.recovery.l3MaxAttempts - 1) {
        await sleep(this.config.recovery.l3CooldownMs);
      }
    }

    return { success: false, actions };
  }

  private readCurrentConfig(): Record<string, unknown> | null {
    try {
      const raw = fs.readFileSync(this.config.gateway.configPath, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private emitEvent(event: RecoveryEvent): void {
    this.emit("recovery", event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

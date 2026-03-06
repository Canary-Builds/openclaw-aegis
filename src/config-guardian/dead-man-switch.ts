import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import type { AegisConfig } from "../config/schema.js";
import { BackupManager } from "../backup/manager.js";
import { diffConfigs, isCriticalChange, preflightValidation } from "./guardian.js";

export type SwitchState = "idle" | "countdown" | "committed" | "rolled-back";

export class DeadManSwitch extends EventEmitter {
  private state: SwitchState = "idle";
  private countdownTimer: NodeJS.Timeout | null = null;
  private readonly countdownMs: number;
  private readonly configPath: string;
  private readonly backupManager: BackupManager;
  private lastKnownConfig: Record<string, unknown> | null = null;

  constructor(config: AegisConfig, backupManager: BackupManager) {
    super();
    this.countdownMs = config.deadManSwitch.countdownMs;
    this.configPath = config.gateway.configPath;
    this.backupManager = backupManager;
    this.captureCurrentConfig();
  }

  getState(): SwitchState {
    return this.state;
  }

  onConfigChange(): void {
    const currentConfig = this.readConfig();
    if (!currentConfig || !this.lastKnownConfig) {
      this.startCountdown();
      return;
    }

    const diff = diffConfigs(this.lastKnownConfig, currentConfig);
    if (!isCriticalChange(diff)) {
      this.lastKnownConfig = currentConfig;
      this.emit("non-critical-change", diff);
      return;
    }

    this.backupManager.backup();
    this.startCountdown();
  }

  commit(): void {
    this.clearCountdown();
    this.captureCurrentConfig();
    this.state = "committed";
    this.emit("committed");
    this.state = "idle";
  }

  rollback(): boolean {
    this.clearCountdown();
    const restored = this.backupManager.restoreLatestKnownGood();
    if (restored) {
      this.captureCurrentConfig();
      this.state = "rolled-back";
      this.emit("rolled-back");
      this.state = "idle";
    }
    return restored;
  }

  onHealthy(): void {
    if (this.state === "countdown") {
      this.commit();
    }
  }

  onUnhealthy(): void {
    if (this.state === "countdown") {
      this.rollback();
    }
  }

  destroy(): void {
    this.clearCountdown();
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.state = "countdown";
    this.emit("countdown-started", this.countdownMs);

    this.countdownTimer = setTimeout(() => {
      const preflight = preflightValidation(this.configPath);
      if (preflight.valid) {
        this.commit();
      } else {
        this.emit("countdown-expired-invalid", preflight.errors);
        this.rollback();
      }
    }, this.countdownMs);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private captureCurrentConfig(): void {
    this.lastKnownConfig = this.readConfig();
  }

  private readConfig(): Record<string, unknown> | null {
    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

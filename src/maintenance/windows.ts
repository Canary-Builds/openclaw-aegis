/** Default maximum maintenance duration: 4 hours */
const DEFAULT_MAX_DURATION_MS = 4 * 60 * 60 * 1000;

/** Interval for periodic warnings while maintenance is active */
const WARNING_INTERVAL_MS = 15 * 60 * 1000;

export interface MaintenanceStatus {
  active: boolean;
  activatedAt: number | null;
  expiresAt: number | null;
  activatedBy: string | null;
  remainingMs: number | null;
}

export interface MaintenanceWindowConfig {
  maxDurationMs?: number;
}

export class MaintenanceWindow {
  private activatedAt: number | null = null;
  private expiresAt: number | null = null;
  private activatedBy: string | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private readonly maxDurationMs: number;

  constructor(config: MaintenanceWindowConfig = {}) {
    this.maxDurationMs = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  }

  /**
   * Activate maintenance mode with an optional duration.
   * Returns the resulting status or throws if duration exceeds the safety cap.
   */
  activate(durationMs: number, activatedBy: string = "api"): MaintenanceStatus {
    if (durationMs <= 0) {
      throw new Error("Duration must be positive");
    }
    if (durationMs > this.maxDurationMs) {
      throw new Error(
        `Duration ${durationMs}ms exceeds maximum allowed ${this.maxDurationMs}ms`,
      );
    }

    this.clearTimers();

    const now = Date.now();
    this.activatedAt = now;
    this.expiresAt = now + durationMs;
    this.activatedBy = activatedBy;

    this.expiryTimer = setTimeout(() => {
      this.deactivate();
    }, durationMs);
    this.expiryTimer.unref();

    this.warningTimer = setInterval(() => {
      if (this.isActive()) {
        const remaining = this.expiresAt! - Date.now();
        console.warn(
          `[aegis] Maintenance window still active. Remaining: ${Math.ceil(remaining / 60000)}m. Alerts and recovery are suppressed.`,
        );
      }
    }, WARNING_INTERVAL_MS);
    this.warningTimer.unref();

    console.info(
      `[aegis] Maintenance window activated by "${activatedBy}" for ${Math.ceil(durationMs / 60000)}m`,
    );

    return this.getStatus();
  }

  /**
   * Deactivate maintenance mode immediately.
   */
  deactivate(): MaintenanceStatus {
    const wasActive = this.isActive();
    this.clearTimers();

    this.activatedAt = null;
    this.expiresAt = null;
    this.activatedBy = null;

    if (wasActive) {
      console.info("[aegis] Maintenance window deactivated. Alerts and recovery resumed.");
    }

    return this.getStatus();
  }

  /**
   * Check if maintenance mode is currently active.
   * Fail-open: any error returns false (not in maintenance).
   */
  isActive(): boolean {
    try {
      if (this.expiresAt === null) return false;
      return Date.now() < this.expiresAt;
    } catch {
      return false;
    }
  }

  /**
   * Get the current maintenance window status.
   */
  getStatus(): MaintenanceStatus {
    const active = this.isActive();
    return {
      active,
      activatedAt: active ? this.activatedAt : null,
      expiresAt: active ? this.expiresAt : null,
      activatedBy: active ? this.activatedBy : null,
      remainingMs: active && this.expiresAt !== null ? Math.max(0, this.expiresAt - Date.now()) : null,
    };
  }

  /**
   * Get the configured maximum duration.
   */
  getMaxDurationMs(): number {
    return this.maxDurationMs;
  }

  /**
   * Clean up timers. Call when shutting down.
   */
  destroy(): void {
    this.clearTimers();
    this.activatedAt = null;
    this.expiresAt = null;
    this.activatedBy = null;
  }

  private clearTimers(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.warningTimer) {
      clearInterval(this.warningTimer);
      this.warningTimer = null;
    }
  }
}

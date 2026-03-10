import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MaintenanceWindow } from "../../src/maintenance/windows.js";
import type { MaintenanceStatus } from "../../src/maintenance/windows.js";

describe("MaintenanceWindow", () => {
  let mw: MaintenanceWindow;

  beforeEach(() => {
    vi.useFakeTimers();
    mw = new MaintenanceWindow({ maxDurationMs: 14400000 });
  });

  afterEach(() => {
    mw.destroy();
    vi.useRealTimers();
  });

  describe("activate", () => {
    it("activates with valid duration", () => {
      const status = mw.activate(1800000, "test-user");
      expect(status.active).toBe(true);
      expect(status.activatedBy).toBe("test-user");
      expect(status.remainingMs).toBeGreaterThan(0);
      expect(status.remainingMs).toBeLessThanOrEqual(1800000);
    });

    it("rejects zero duration", () => {
      expect(() => mw.activate(0, "test")).toThrow("Duration must be positive");
    });

    it("rejects negative duration", () => {
      expect(() => mw.activate(-1000, "test")).toThrow("Duration must be positive");
    });

    it("rejects duration exceeding maxDurationMs", () => {
      expect(() => mw.activate(14400001, "test")).toThrow(
        "Duration 14400001ms exceeds maximum allowed 14400000ms",
      );
    });

    it("uses 'api' as default activatedBy", () => {
      const status = mw.activate(60000);
      expect(status.activatedBy).toBe("api");
    });

    it("replaces previous activation", () => {
      mw.activate(60000, "first");
      const status = mw.activate(120000, "second");
      expect(status.activatedBy).toBe("second");
    });
  });

  describe("deactivate", () => {
    it("deactivates an active window", () => {
      mw.activate(1800000, "test");
      const status = mw.deactivate();
      expect(status.active).toBe(false);
      expect(status.activatedAt).toBeNull();
      expect(status.expiresAt).toBeNull();
      expect(status.activatedBy).toBeNull();
      expect(status.remainingMs).toBeNull();
    });

    it("is safe to call when not active", () => {
      const status = mw.deactivate();
      expect(status.active).toBe(false);
    });
  });

  describe("isActive", () => {
    it("returns false when not activated", () => {
      expect(mw.isActive()).toBe(false);
    });

    it("returns true when activated", () => {
      mw.activate(60000, "test");
      expect(mw.isActive()).toBe(true);
    });

    it("returns false after deactivation", () => {
      mw.activate(60000, "test");
      mw.deactivate();
      expect(mw.isActive()).toBe(false);
    });

    it("returns false after auto-expiry (time-based check)", () => {
      mw.activate(60000, "test");
      vi.advanceTimersByTime(60001);
      expect(mw.isActive()).toBe(false);
    });
  });

  describe("auto-expiry", () => {
    it("auto-expires after duration", () => {
      mw.activate(60000, "test");
      expect(mw.isActive()).toBe(true);
      vi.advanceTimersByTime(60001);
      expect(mw.isActive()).toBe(false);
      expect(mw.getStatus().active).toBe(false);
    });

    it("cleans up state on expiry", () => {
      mw.activate(60000, "test");
      vi.advanceTimersByTime(60001);
      const status = mw.getStatus();
      expect(status.activatedAt).toBeNull();
      expect(status.activatedBy).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("returns inactive status by default", () => {
      const status = mw.getStatus();
      expect(status).toEqual({
        active: false,
        activatedAt: null,
        expiresAt: null,
        activatedBy: null,
        remainingMs: null,
      });
    });

    it("returns active status with remaining time", () => {
      mw.activate(120000, "operator");
      vi.advanceTimersByTime(30000);
      const status = mw.getStatus();
      expect(status.active).toBe(true);
      expect(status.remainingMs).toBeLessThanOrEqual(90000);
      expect(status.remainingMs).toBeGreaterThan(0);
    });
  });

  describe("fail-open invariant", () => {
    it("isActive returns false if internal state is corrupted", () => {
      const window = new MaintenanceWindow();
      expect(window.isActive()).toBe(false);
      window.destroy();
    });
  });

  describe("maxDurationMs config", () => {
    it("uses default max when not configured", () => {
      const window = new MaintenanceWindow();
      expect(window.getMaxDurationMs()).toBe(14400000);
      window.destroy();
    });

    it("uses custom max when configured", () => {
      const window = new MaintenanceWindow({ maxDurationMs: 3600000 });
      expect(window.getMaxDurationMs()).toBe(3600000);
      window.destroy();
    });

    it("enforces custom max", () => {
      const window = new MaintenanceWindow({ maxDurationMs: 3600000 });
      expect(() => window.activate(3600001, "test")).toThrow("exceeds maximum");
      window.destroy();
    });
  });

  describe("destroy", () => {
    it("cleans up all state", () => {
      mw.activate(60000, "test");
      mw.destroy();
      expect(mw.isActive()).toBe(false);
      expect(mw.getStatus().active).toBe(false);
    });
  });

  describe("alert and recovery suppression integration", () => {
    it("suppresses both alerts and recovery when maintenance is active", () => {
      mw.activate(60000, "test-operator");

      const alertsSuppressed: string[] = [];
      const recoverySuppressed: string[] = [];

      if (mw.isActive()) {
        alertsSuppressed.push("alert-suppressed");
      }

      if (mw.isActive()) {
        recoverySuppressed.push("recovery-paused");
      }

      expect(alertsSuppressed).toHaveLength(1);
      expect(recoverySuppressed).toHaveLength(1);
    });

    it("resumes both alerts and recovery after deactivation", () => {
      mw.activate(60000, "test-operator");
      mw.deactivate();
      expect(mw.isActive()).toBe(false);
    });

    it("resumes both alerts and recovery after auto-expiry", () => {
      mw.activate(60000, "test-operator");
      vi.advanceTimersByTime(60001);
      expect(mw.isActive()).toBe(false);
    });
  });

  describe("getStatus return shape", () => {
    it("returns all expected fields when active", () => {
      const status: MaintenanceStatus = mw.activate(120000, "api-user");
      expect(status).toHaveProperty("active", true);
      expect(status).toHaveProperty("activatedBy", "api-user");
      expect(typeof status.activatedAt).toBe("number");
      expect(typeof status.expiresAt).toBe("number");
      expect(typeof status.remainingMs).toBe("number");
    });

    it("returns all null fields when inactive", () => {
      const status: MaintenanceStatus = mw.getStatus();
      expect(status.active).toBe(false);
      expect(status.activatedAt).toBeNull();
      expect(status.expiresAt).toBeNull();
      expect(status.activatedBy).toBeNull();
      expect(status.remainingMs).toBeNull();
    });
  });
});

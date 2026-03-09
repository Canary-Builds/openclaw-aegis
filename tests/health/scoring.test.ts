import { describe, it, expect } from "vitest";
import { computeHealthScore, DegradedConfirmation } from "../../src/health/scoring.js";
import type { HealthProbeResult } from "../../src/types/index.js";

function makeProbe(name: string, healthy: boolean, score: number): HealthProbeResult {
  return { name, healthy, score, latencyMs: 1 };
}

describe("computeHealthScore", () => {
  it("computes correct score for all-healthy probes", () => {
    const results: HealthProbeResult[] = [
      makeProbe("process", true, 2),
      makeProbe("port", true, 2),
      makeProbe("http", true, 2),
      makeProbe("config", true, 2),
      makeProbe("websocket", true, 2),
      makeProbe("tun", true, 2),
      makeProbe("memory", true, 2),
      makeProbe("cpu", true, 2),
      makeProbe("disk", true, 2),
      makeProbe("logTail", true, 2),
      makeProbe("channels", true, 2),
    ];

    const score = computeHealthScore(results);
    // Raw: (2*2)*4 + (2*1)*7 = 30. Normalized: (30/30)*10 = 10
    expect(score.total).toBe(10);
    expect(score.band).toBe("healthy");
  });

  it("classifies critical when most probes fail", () => {
    const results: HealthProbeResult[] = [
      makeProbe("process", false, 0),
      makeProbe("port", false, 0),
      makeProbe("http", false, 0),
      makeProbe("config", false, 0),
      makeProbe("websocket", false, 0),
      makeProbe("tun", false, 0),
      makeProbe("memory", false, 0),
      makeProbe("cpu", true, 2),
      makeProbe("disk", true, 2),
      makeProbe("logTail", true, 2),
      makeProbe("channels", false, 0),
    ];

    // Raw: (2*1)*3 = 6. Normalized: round((6/30)*10) = 2 → critical
    const score = computeHealthScore(results);
    expect(score.total).toBe(2);
    expect(score.band).toBe("critical");
  });

  it("classifies degraded for partial failures", () => {
    const results: HealthProbeResult[] = [
      makeProbe("process", true, 2),
      makeProbe("port", false, 0),
      makeProbe("http", false, 0),
      makeProbe("config", true, 2),
      makeProbe("websocket", false, 0),
      makeProbe("tun", true, 2),
      makeProbe("memory", true, 2),
      makeProbe("cpu", true, 2),
      makeProbe("disk", true, 2),
      makeProbe("logTail", true, 2),
      makeProbe("channels", true, 2),
    ];

    // Raw: (2*2)+(0)+(0)+(2*2)+(0)+(2*1)+(2*1)+(2*1)+(2*1)+(2*1)+(2*1) = 20. Normalized: round((20/30)*10) = 7
    const score = computeHealthScore(results, { healthyMin: 8, degradedMin: 4 });
    expect(score.total).toBe(7);
    expect(score.band).toBe("degraded");
  });
});

describe("DegradedConfirmation", () => {
  it("does not escalate on first degraded check", () => {
    const confirm = new DegradedConfirmation(2);
    expect(confirm.update("degraded")).toBe(false);
  });

  it("escalates after required consecutive degraded checks", () => {
    const confirm = new DegradedConfirmation(2);
    confirm.update("degraded");
    expect(confirm.update("degraded")).toBe(true);
  });

  it("resets counter on healthy check", () => {
    const confirm = new DegradedConfirmation(2);
    confirm.update("degraded");
    confirm.update("healthy");
    expect(confirm.update("degraded")).toBe(false);
  });

  it("always escalates on critical", () => {
    const confirm = new DegradedConfirmation(2);
    expect(confirm.update("critical")).toBe(true);
  });

  it("resets counter on critical", () => {
    const confirm = new DegradedConfirmation(2);
    confirm.update("degraded");
    confirm.update("critical");
    // Counter should be reset
    expect(confirm.update("degraded")).toBe(false);
  });

  it("tracks consecutive count", () => {
    const confirm = new DegradedConfirmation(3);
    confirm.update("degraded");
    expect(confirm.getCount()).toBe(1);
    confirm.update("degraded");
    expect(confirm.getCount()).toBe(2);
    confirm.update("healthy");
    expect(confirm.getCount()).toBe(0);
  });
});

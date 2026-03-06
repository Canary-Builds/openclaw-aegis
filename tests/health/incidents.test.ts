import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { IncidentLogger } from "../../src/incidents/logger.js";
import { computeStatistics } from "../../src/incidents/statistics.js";

describe("IncidentLogger", () => {
  let tmpDir: string;
  let logger: IncidentLogger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-incidents-"));
    logger = new IncidentLogger(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts and tracks an incident", () => {
    const id = logger.startIncident();
    expect(id).toBeTruthy();
    expect(logger.getCurrentIncidentId()).toBe(id);
  });

  it("logs events with SHA-256 checksums", () => {
    logger.startIncident();
    const event = logger.log("TEST_EVENT", { key: "value" });

    expect(event.type).toBe("TEST_EVENT");
    expect(event.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(event.timestamp).toBeTruthy();
  });

  it("retrieves incident events", () => {
    const id = logger.startIncident();
    logger.log("EVENT_1", { a: 1 });
    logger.log("EVENT_2", { b: 2 });

    const events = logger.getIncidentEvents(id);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("EVENT_1");
    expect(events[1].type).toBe("EVENT_2");
  });

  it("lists incidents", () => {
    logger.startIncident();
    logger.log("EVENT", {});
    logger.endIncident();

    const incidents = logger.getIncidents();
    expect(incidents.length).toBeGreaterThanOrEqual(1);
  });

  it("computes MTTR while incident is active", () => {
    logger.startIncident();
    expect(logger.getMttr()).not.toBeNull();
    expect(logger.getMttr()!).toBeGreaterThanOrEqual(0);
  });

  it("creates files with correct permissions", () => {
    const id = logger.startIncident();
    logger.log("EVENT", { data: "test" });

    const eventFile = path.join(tmpDir, id, "events.jsonl");
    const stat = fs.statSync(eventFile);
    // 0o600 = 384 decimal
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe("computeStatistics", () => {
  let tmpDir: string;
  let logger: IncidentLogger;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-stats-"));
    logger = new IncidentLogger(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns zero stats for no incidents", () => {
    const stats = computeStatistics(logger);
    expect(stats.totalIncidents).toBe(0);
    expect(stats.resolvedIncidents).toBe(0);
    expect(stats.averageMttrMs).toBe(0);
  });

  it("computes stats for resolved incidents", () => {
    logger.startIncident();
    logger.log("INCIDENT_START", {});
    logger.log("RECOVERY_ATTEMPT", { level: "L1" });
    logger.log("RECOVERY_SUCCESS", { level: "L1" });
    logger.endIncident();

    const stats = computeStatistics(logger);
    expect(stats.totalIncidents).toBe(1);
    expect(stats.resolvedIncidents).toBe(1);
    expect(stats.averageMttrMs).toBeGreaterThanOrEqual(0);
  });
});

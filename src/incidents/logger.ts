import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { IncidentEvent } from "../types/index.js";

export class IncidentLogger {
  private currentIncidentId: string | null = null;
  private incidentStartTime: number | null = null;

  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  }

  startIncident(): string {
    this.currentIncidentId = new Date().toISOString().replace(/[:.]/g, "-");
    this.incidentStartTime = Date.now();
    return this.currentIncidentId;
  }

  endIncident(): void {
    this.currentIncidentId = null;
    this.incidentStartTime = null;
  }

  getCurrentIncidentId(): string | null {
    return this.currentIncidentId;
  }

  getMttr(): number | null {
    if (!this.incidentStartTime) return null;
    return Date.now() - this.incidentStartTime;
  }

  log(type: string, data: Record<string, unknown>): IncidentEvent {
    const incidentId = this.currentIncidentId ?? "no-incident";
    const incidentDir = path.join(this.baseDir, incidentId);
    fs.mkdirSync(incidentDir, { recursive: true, mode: 0o700 });

    const event: IncidentEvent = {
      timestamp: new Date().toISOString(),
      type,
      data,
      checksum: "",
    };

    const payload = JSON.stringify({ timestamp: event.timestamp, type: event.type, data: event.data });
    event.checksum = crypto.createHash("sha256").update(payload).digest("hex");

    const logFile = path.join(incidentDir, "events.jsonl");
    fs.appendFileSync(logFile, JSON.stringify(event) + "\n", { mode: 0o600 });

    return event;
  }

  getIncidents(): string[] {
    try {
      return fs
        .readdirSync(this.baseDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "no-incident")
        .map((d) => d.name)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  getIncidentEvents(incidentId: string): IncidentEvent[] {
    const logFile = path.join(this.baseDir, incidentId, "events.jsonl");
    if (!fs.existsSync(logFile)) return [];

    return fs
      .readFileSync(logFile, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as IncidentEvent);
  }
}

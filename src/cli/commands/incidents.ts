import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { expandHome } from "../../config/loader.js";

interface IncidentEvent {
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
}

interface IncidentSummary {
  id: string;
  started: string;
  resolved: boolean;
  events: IncidentEvent[];
  durationMs: number | null;
}

function parseIncident(filePath: string): IncidentSummary {
  const id = path.basename(filePath, ".jsonl");
  const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  const events: IncidentEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as IncidentEvent);
    } catch { /* skip malformed lines */ }
  }

  const started = events[0]?.timestamp ?? "unknown";
  const resolvedEvent = events.find((e) => e.type === "INCIDENT_RESOLVED");
  const unresolvedEvent = events.find((e) => e.type === "INCIDENT_UNRESOLVED");
  const resolved = !!resolvedEvent;

  let durationMs: number | null = null;
  const endEvent = resolvedEvent ?? unresolvedEvent;
  if (endEvent && events[0]) {
    durationMs = new Date(endEvent.timestamp).getTime() - new Date(events[0].timestamp).getTime();
  }

  return { id, started, resolved, events, durationMs };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export const incidentsCommand = new Command("incidents")
  .description("Browse past incident logs")
  .option("--json", "Output as JSON")
  .option("--last <n>", "Show last N incidents", "10")
  .argument("[incident-id]", "Show details for a specific incident")
  .action(async (incidentId: string | undefined, opts: { json?: boolean; last: string }) => {
    const incidentsDir = expandHome("~/.openclaw/aegis/incidents");

    if (!fs.existsSync(incidentsDir)) {
      console.log("No incidents recorded yet.");
      return;
    }

    const files = fs.readdirSync(incidentsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();

    if (files.length === 0) {
      console.log("No incidents recorded yet.");
      return;
    }

    // Detail view for a specific incident
    if (incidentId) {
      const file = files.find((f) => f.startsWith(incidentId));
      if (!file) {
        console.log(`Incident "${incidentId}" not found.`);
        return;
      }

      const incident = parseIncident(path.join(incidentsDir, file));

      if (opts.json) {
        process.stdout.write(JSON.stringify(incident, null, 2) + "\n");
        return;
      }

      const status = incident.resolved ? "\x1b[32mRESOLVED\x1b[0m" : "\x1b[31mUNRESOLVED\x1b[0m";
      const duration = incident.durationMs !== null ? formatDuration(incident.durationMs) : "ongoing";
      console.log(`\nIncident: ${incident.id}`);
      console.log(`Status:   ${status}`);
      console.log(`Started:  ${incident.started}`);
      console.log(`Duration: ${duration}`);
      console.log(`\nTimeline:\n`);

      for (const event of incident.events) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icon = eventIcon(event.type);
        const detail = formatEventDetail(event);
        console.log(`  ${time}  ${icon} ${event.type}${detail}`);
      }

      console.log();
      return;
    }

    // List view
    const limit = parseInt(opts.last, 10) || 10;
    const incidents = files.slice(0, limit).map((f) => parseIncident(path.join(incidentsDir, f)));

    if (opts.json) {
      process.stdout.write(JSON.stringify(incidents, null, 2) + "\n");
      return;
    }

    const resolved = incidents.filter((i) => i.resolved).length;
    const unresolved = incidents.length - resolved;
    console.log(`\n${incidents.length} incident(s) — ${resolved} resolved, ${unresolved} unresolved\n`);

    for (const inc of incidents) {
      const icon = inc.resolved ? "\x1b[32m+\x1b[0m" : "\x1b[31m-\x1b[0m";
      const duration = inc.durationMs !== null ? formatDuration(inc.durationMs) : "ongoing";
      const eventCount = inc.events.length;
      const date = new Date(inc.started).toLocaleString();
      console.log(`  ${icon} ${inc.id}  ${date}  ${duration}  (${eventCount} events)`);
    }

    console.log(`\nRun 'aegis incidents <id>' for details.\n`);
  });

function eventIcon(type: string): string {
  switch (type) {
    case "INCIDENT_START": return "\x1b[31m>\x1b[0m";
    case "L1_ATTEMPT": return "\x1b[33m~\x1b[0m";
    case "L1_SUCCESS": return "\x1b[32m+\x1b[0m";
    case "L2_ATTEMPT": return "\x1b[33m~\x1b[0m";
    case "L2_SUCCESS": return "\x1b[32m+\x1b[0m";
    case "L4_ALERT": return "\x1b[31m!\x1b[0m";
    case "INCIDENT_RESOLVED": return "\x1b[32m+\x1b[0m";
    case "INCIDENT_UNRESOLVED": return "\x1b[31mx\x1b[0m";
    case "DEAD_MAN_SWITCH_ROLLBACK": return "\x1b[33m<\x1b[0m";
    case "CIRCUIT_BREAKER_TRIPPED": return "\x1b[31m#\x1b[0m";
    default: return " ";
  }
}

function formatEventDetail(event: IncidentEvent): string {
  const d = event.data;
  if (d.attempt) return ` (attempt ${d.attempt})`;
  if (d.pattern) return ` — ${d.pattern}`;
  if (d.reason) return ` — ${d.reason}`;
  return "";
}

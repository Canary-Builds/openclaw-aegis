import type { HealthHistory } from "../observability/health-history.js";
import type { IncidentLogger } from "../incidents/logger.js";

export interface RcaResult {
  incidentId?: string;
  rootCause: string;
  confidence: number;
  evidence: string[];
  suggestion: string;
  correlatedProbes: string[];
  timestamp: string;
}

interface FailureSignature {
  name: string;
  /** Probes that must be failing */
  requiredProbes: string[];
  /** Probes that may optionally fail */
  optionalProbes: string[];
  /** Log patterns to look for in incident events */
  logPatterns: RegExp[];
  rootCause: string;
  suggestion: string;
}

const FAILURE_SIGNATURES: FailureSignature[] = [
  {
    name: "oom_kill",
    requiredProbes: ["memory"],
    optionalProbes: ["process", "http", "port"],
    logPatterns: [/out of memory/i, /heap.*limit/i, /oom/i, /SIGKILL/i],
    rootCause: "Gateway killed by OOM (out-of-memory) — RSS exceeded system or container limits",
    suggestion: "Increase memory limit or investigate memory leaks. Check for unbounded caches, stream backpressure, or large payload accumulation.",
  },
  {
    name: "port_conflict",
    requiredProbes: ["port"],
    optionalProbes: ["http", "process"],
    logPatterns: [/EADDRINUSE/i, /address already in use/i, /port.*conflict/i],
    rootCause: "Gateway port is already in use by another process",
    suggestion: "Find the conflicting process with `lsof -i :PORT` or `ss -tlnp` and stop it, or change the gateway port.",
  },
  {
    name: "config_corruption",
    requiredProbes: ["config"],
    optionalProbes: ["http", "process"],
    logPatterns: [/JSON.*parse/i, /invalid.*config/i, /syntax.*error/i, /unexpected.*token/i],
    rootCause: "Gateway configuration file is corrupted or contains invalid syntax",
    suggestion: "Restore from known-good backup via `aegis` or manually fix the config file. Check for incomplete writes.",
  },
  {
    name: "network_failure",
    requiredProbes: ["tun"],
    optionalProbes: ["http", "websocket"],
    logPatterns: [/ENETUNREACH/i, /network.*unreachable/i, /DNS.*resolution/i, /ECONNREFUSED/i],
    rootCause: "Network connectivity lost — TUN/VPN interface down or DNS failure",
    suggestion: "Check network interfaces (`ip addr`), DNS resolution (`dig`), and VPN/TUN status. May need L3 network repair.",
  },
  {
    name: "disk_exhaustion",
    requiredProbes: ["disk"],
    optionalProbes: ["logTail", "config"],
    logPatterns: [/ENOSPC/i, /no space/i, /disk.*full/i, /write.*failed/i],
    rootCause: "Disk space exhausted — no room for logs, config, or temporary files",
    suggestion: "Free disk space: truncate logs, clear temp files, remove old backups. Consider L3 disk cleanup.",
  },
  {
    name: "cpu_saturation",
    requiredProbes: ["cpu"],
    optionalProbes: ["http", "websocket"],
    logPatterns: [/cpu.*100/i, /event.*loop.*lag/i, /timeout/i],
    rootCause: "CPU saturation — gateway event loop is overloaded",
    suggestion: "Check for infinite loops, heavy computation, or excessive connections. Consider scaling or adding rate limits.",
  },
  {
    name: "channel_disconnect",
    requiredProbes: ["channels"],
    optionalProbes: [],
    logPatterns: [/whatsapp.*disconnect/i, /telegram.*error/i, /listener.*not.*active/i, /channel.*down/i],
    rootCause: "Messaging channel(s) disconnected — WhatsApp/Telegram/Slack listener lost connection",
    suggestion: "Restart affected channels via `openclaw channels restart`. Check API credentials and rate limits.",
  },
  {
    name: "process_crash",
    requiredProbes: ["process"],
    optionalProbes: ["port", "http", "websocket"],
    logPatterns: [/SIGTERM/i, /SIGKILL/i, /exit.*code/i, /fatal/i, /crash/i],
    rootCause: "Gateway process crashed or was killed externally",
    suggestion: "Check system logs (`journalctl`) for kill signals. May be systemd restart limits, watchdog timeout, or external process manager.",
  },
  {
    name: "websocket_failure",
    requiredProbes: ["websocket"],
    optionalProbes: ["http"],
    logPatterns: [/websocket.*close/i, /ws.*error/i, /upgrade.*failed/i],
    rootCause: "WebSocket connections failing — upgrade rejected or connections dropping",
    suggestion: "Check proxy/reverse proxy WebSocket support, connection limits, and keep-alive settings.",
  },
  {
    name: "cascading_failure",
    requiredProbes: ["http", "port", "process"],
    optionalProbes: ["memory", "cpu", "disk"],
    logPatterns: [],
    rootCause: "Cascading failure — multiple core systems failing simultaneously",
    suggestion: "Full gateway restart recommended. If persistent, check infrastructure: host resources, container health, systemd limits.",
  },
];

export class RootCauseAnalyzer {
  private readonly healthHistory: HealthHistory;
  private readonly incidentLogger?: IncidentLogger;
  private lastAnalysis: RcaResult[] = [];

  constructor(healthHistory: HealthHistory, incidentLogger?: IncidentLogger) {
    this.healthHistory = healthHistory;
    this.incidentLogger = incidentLogger;
  }

  /** Analyze current state and return ranked root cause candidates */
  analyze(): RcaResult[] {
    const recent = this.healthHistory.getLatest(10);
    if (recent.length === 0) return [];

    const latest = recent[recent.length - 1];
    const failingProbes = Object.entries(latest.probes)
      .filter(([, p]) => !p.healthy)
      .map(([name]) => name);

    if (failingProbes.length === 0) {
      this.lastAnalysis = [];
      return [];
    }

    // Get incident events for log pattern matching
    const eventTexts = this.getRecentEventTexts();

    const results: RcaResult[] = [];

    for (const sig of FAILURE_SIGNATURES) {
      const match = this.matchSignature(sig, failingProbes, eventTexts);
      if (match) results.push(match);
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    this.lastAnalysis = results;
    return results;
  }

  /** Analyze a specific incident by ID */
  analyzeIncident(incidentId: string): RcaResult[] {
    if (!this.incidentLogger) return [];

    const events = this.incidentLogger.getIncidentEvents(incidentId);
    if (events.length === 0) return [];

    // Extract probe failures from incident events
    const failingProbes: string[] = [];
    const eventTexts: string[] = [];

    for (const event of events) {
      eventTexts.push(JSON.stringify(event.data));
      if (event.type === "INCIDENT_START" && event.data["failedProbes"]) {
        const probes = event.data["failedProbes"];
        if (Array.isArray(probes)) failingProbes.push(...probes.map(String));
      }
    }

    // Also check health history around incident time
    const startTime = new Date(events[0].timestamp).getTime();
    const snapshots = this.healthHistory.getRange(Date.now() - startTime + 60000);
    const nearIncident = snapshots.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return Math.abs(t - startTime) < 30000;
    });

    for (const snap of nearIncident) {
      for (const [name, probe] of Object.entries(snap.probes)) {
        if (!probe.healthy && !failingProbes.includes(name)) {
          failingProbes.push(name);
        }
      }
    }

    const results: RcaResult[] = [];
    for (const sig of FAILURE_SIGNATURES) {
      const match = this.matchSignature(sig, failingProbes, eventTexts);
      if (match) {
        match.incidentId = incidentId;
        results.push(match);
      }
    }

    results.sort((a, b) => b.confidence - a.confidence);
    return results;
  }

  /** Get the last analysis results */
  getLastAnalysis(): RcaResult[] {
    return [...this.lastAnalysis];
  }

  private matchSignature(
    sig: FailureSignature,
    failingProbes: string[],
    eventTexts: string[],
  ): RcaResult | null {
    // Check required probes
    const requiredMatches = sig.requiredProbes.filter((p) => failingProbes.includes(p));
    if (requiredMatches.length < sig.requiredProbes.length) return null;

    // Check optional probes for bonus confidence
    const optionalMatches = sig.optionalProbes.filter((p) => failingProbes.includes(p));

    // Check log patterns
    const logMatches: string[] = [];
    for (const pattern of sig.logPatterns) {
      for (const text of eventTexts) {
        if (pattern.test(text)) {
          logMatches.push(pattern.source);
          break;
        }
      }
    }

    // Calculate confidence score
    let confidence = 0.4; // Base for matching required probes
    confidence += (optionalMatches.length / Math.max(sig.optionalProbes.length, 1)) * 0.3;
    if (sig.logPatterns.length > 0) {
      confidence += (logMatches.length / sig.logPatterns.length) * 0.3;
    } else {
      confidence += 0.1; // Small bonus for signatures without log patterns
    }

    // Build evidence
    const evidence: string[] = [];
    evidence.push(`Failing probes: ${requiredMatches.join(", ")}`);
    if (optionalMatches.length > 0) {
      evidence.push(`Also failing: ${optionalMatches.join(", ")}`);
    }
    if (logMatches.length > 0) {
      evidence.push(`Log patterns matched: ${logMatches.join(", ")}`);
    }

    return {
      rootCause: sig.rootCause,
      confidence: Math.min(confidence, 1),
      evidence,
      suggestion: sig.suggestion,
      correlatedProbes: [...requiredMatches, ...optionalMatches],
      timestamp: new Date().toISOString(),
    };
  }

  private getRecentEventTexts(): string[] {
    if (!this.incidentLogger) return [];

    const ids = this.incidentLogger.getIncidents();
    if (ids.length === 0) return [];

    // Get events from last incident
    const lastId = ids[ids.length - 1];
    const events = this.incidentLogger.getIncidentEvents(lastId);
    return events.map((e) => JSON.stringify(e.data));
  }
}

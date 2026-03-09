import * as http from "node:http";
import * as os from "node:os";
import * as fs from "node:fs";
import type { AegisConfig } from "../config/schema.js";
import type { HealthMonitor } from "../health/monitor.js";
import type { RecoveryOrchestrator } from "../recovery/orchestrator.js";
import type { BackupManager } from "../backup/manager.js";
import type { IncidentLogger } from "../incidents/logger.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";
import type { DeadManSwitch } from "../config-guardian/dead-man-switch.js";
import type { MetricsCollector } from "../observability/metrics.js";
import type { HealthHistory } from "../observability/health-history.js";
import type { SlaTracker } from "../observability/sla.js";
import type { RecoveryTracer } from "../observability/tracing.js";
import { computeStatistics } from "../incidents/statistics.js";
import type { AlertPayload } from "../types/index.js";

const SENSITIVE_KEYS = new Set([
  "botToken",
  "chatId",
  "accessToken",
  "phoneNumberId",
  "recipientNumber",
  "webhookUrl",
  "secret",
  "password",
  "username",
  "apiToken",
  "userKey",
  "token",
]);

function scrubObject(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(scrubObject);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key) && typeof value === "string") {
        result[key] = value.slice(0, 4) + "****";
      } else {
        result[key] = scrubObject(value);
      }
    }
    return result;
  }
  return obj;
}

type RouteResponse = { status: number; body: unknown; contentType?: string };
type RouteHandler = (
  params: Record<string, string>,
  req: http.IncomingMessage,
) => RouteResponse | Promise<RouteResponse>;

interface AegisApiDeps {
  config: AegisConfig;
  monitor: HealthMonitor;
  recovery?: RecoveryOrchestrator;
  backup?: BackupManager;
  incidents?: IncidentLogger;
  alerts?: AlertDispatcher;
  deadManSwitch?: DeadManSwitch;
  metrics?: MetricsCollector;
  healthHistory?: HealthHistory;
  slaTracker?: SlaTracker;
  tracer?: RecoveryTracer;
}

export class AegisApiServer {
  private server: http.Server | null = null;
  private readonly startedAt = Date.now();
  private readonly routes: Map<
    string,
    { method: string; pattern: RegExp; paramNames: string[]; handler: RouteHandler }
  > = new Map();
  private alertHistory: {
    timestamp: string;
    provider: string;
    success: boolean;
    durationMs: number;
  }[] = [];

  constructor(private readonly deps: AegisApiDeps) {
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Health & Monitoring
    this.route("GET", "/health", this.handleHealth.bind(this));
    this.route("GET", "/probes", this.handleProbes.bind(this));
    this.route("GET", "/probes/:name", this.handleProbeByName.bind(this));

    // Incidents
    this.route("GET", "/incidents", this.handleIncidents.bind(this));
    this.route("GET", "/incidents/stats", this.handleIncidentStats.bind(this));
    this.route("GET", "/incidents/:id", this.handleIncidentById.bind(this));

    // Recovery
    this.route("GET", "/recovery/status", this.handleRecoveryStatus.bind(this));
    this.route("GET", "/recovery/circuit-breaker", this.handleCircuitBreaker.bind(this));
    this.route("GET", "/recovery/anti-flap", this.handleAntiFlap.bind(this));

    // Config
    this.route("GET", "/config", this.handleConfig.bind(this));
    this.route("GET", "/config/backups", this.handleConfigBackups.bind(this));
    this.route("GET", "/config/guardian", this.handleConfigGuardian.bind(this));

    // Alerts
    this.route("GET", "/alerts/channels", this.handleAlertChannels.bind(this));
    this.route("POST", "/alerts/test", this.handleAlertTest.bind(this));
    this.route("GET", "/alerts/history", this.handleAlertHistory.bind(this));

    // System
    this.route("GET", "/version", this.handleVersion.bind(this));
    this.route("GET", "/uptime", this.handleUptime.bind(this));
    this.route("GET", "/platform", this.handlePlatform.bind(this));

    // Observability (Phase 4)
    this.route("GET", "/metrics", this.handleMetrics.bind(this));
    this.route("GET", "/health/history", this.handleHealthHistory.bind(this));
    this.route("GET", "/health/history/stats", this.handleHealthHistoryStats.bind(this));
    this.route("GET", "/health/history/probe/:name", this.handleProbeTrend.bind(this));
    this.route("GET", "/sla", this.handleSla.bind(this));
    this.route("GET", "/sla/:period", this.handleSlaPeriod.bind(this));
    this.route("GET", "/traces", this.handleTraces.bind(this));
    this.route("GET", "/traces/:traceId", this.handleTraceById.bind(this));
  }

  private route(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:([a-zA-Z]+)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.set(`${method}:${path}`, { method, pattern, paramNames, handler });
  }

  private matchRoute(
    method: string,
    url: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of this.routes.values()) {
      if (route.method !== method) continue;
      const match = url.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1] ?? "";
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  // --- Health & Monitoring ---

  private async handleHealth(): Promise<RouteResponse> {
    const score = this.deps.monitor.getLastScore();
    if (!score) {
      const freshScore = await this.deps.monitor.runAllProbes();
      return {
        status: 200,
        body: {
          band: freshScore.band,
          score: freshScore.total,
          probesPassed: freshScore.probeResults.filter((p) => p.healthy).length,
          probesFailed: freshScore.probeResults.filter((p) => !p.healthy).length,
          total: freshScore.probeResults.length,
        },
      };
    }
    return {
      status: 200,
      body: {
        band: score.band,
        score: score.total,
        probesPassed: score.probeResults.filter((p) => p.healthy).length,
        probesFailed: score.probeResults.filter((p) => !p.healthy).length,
        total: score.probeResults.length,
      },
    };
  }

  private async handleProbes(): Promise<RouteResponse> {
    const score = this.deps.monitor.getLastScore() ?? (await this.deps.monitor.runAllProbes());
    return {
      status: 200,
      body: {
        band: score.band,
        score: score.total,
        probes: score.probeResults.map((p) => ({
          name: p.name,
          healthy: p.healthy,
          score: p.score,
          latencyMs: p.latencyMs,
          message: p.message ?? null,
        })),
      },
    };
  }

  private async handleProbeByName(params: Record<string, string>): Promise<RouteResponse> {
    const score = this.deps.monitor.getLastScore() ?? (await this.deps.monitor.runAllProbes());
    const probe = score.probeResults.find((p) => p.name === params.name);
    if (!probe) {
      return { status: 404, body: { error: `Probe '${params.name}' not found` } };
    }
    return {
      status: 200,
      body: {
        name: probe.name,
        healthy: probe.healthy,
        score: probe.score,
        latencyMs: probe.latencyMs,
        message: probe.message ?? null,
      },
    };
  }

  // --- Incidents ---

  private handleIncidents(): RouteResponse {
    if (!this.deps.incidents) {
      return { status: 200, body: { incidents: [], total: 0 } };
    }

    const ids = this.deps.incidents.getIncidents();
    const incidents = ids.map((id) => {
      const events = this.deps.incidents!.getIncidentEvents(id);
      const start = events[0];
      const end = events.find(
        (e) => e.type === "INCIDENT_RESOLVED" || e.type === "INCIDENT_UNRESOLVED",
      );
      const startTime = start ? new Date(start.timestamp).getTime() : 0;
      const endTime = end ? new Date(end.timestamp).getTime() : 0;
      const resolved = end?.type === "INCIDENT_RESOLVED";

      return {
        id,
        status: end ? (resolved ? "resolved" : "unresolved") : "ongoing",
        startedAt: start?.timestamp ?? null,
        durationMs: endTime > startTime ? endTime - startTime : null,
        eventCount: events.length,
      };
    });

    return { status: 200, body: { incidents, total: incidents.length } };
  }

  private handleIncidentStats(): RouteResponse {
    if (!this.deps.incidents) {
      return {
        status: 200,
        body: {
          totalIncidents: 0,
          resolvedIncidents: 0,
          averageMttrMs: 0,
          byTier: {},
          byPattern: {},
        },
      };
    }
    const stats = computeStatistics(this.deps.incidents);
    return { status: 200, body: stats };
  }

  private handleIncidentById(params: Record<string, string>): RouteResponse {
    if (!this.deps.incidents) {
      return { status: 404, body: { error: "Incident logger not available" } };
    }

    const events = this.deps.incidents.getIncidentEvents(params.id);
    if (events.length === 0) {
      return { status: 404, body: { error: `Incident '${params.id}' not found` } };
    }

    const start = events[0];
    const end = events.find(
      (e) => e.type === "INCIDENT_RESOLVED" || e.type === "INCIDENT_UNRESOLVED",
    );
    const startTime = start ? new Date(start.timestamp).getTime() : 0;
    const endTime = end ? new Date(end.timestamp).getTime() : 0;

    return {
      status: 200,
      body: {
        id: params.id,
        status: end ? (end.type === "INCIDENT_RESOLVED" ? "resolved" : "unresolved") : "ongoing",
        startedAt: start?.timestamp ?? null,
        durationMs: endTime > startTime ? endTime - startTime : null,
        events: events.map((e) => ({
          timestamp: e.timestamp,
          type: e.type,
          data: e.data,
        })),
      },
    };
  }

  // --- Recovery ---

  private handleRecoveryStatus(): RouteResponse {
    if (!this.deps.recovery) {
      return { status: 200, body: { state: "idle", recovering: false } };
    }

    const recovering = this.deps.recovery.isRecovering();
    const cb = this.deps.recovery.getCircuitBreaker();

    return {
      status: 200,
      body: {
        recovering,
        state: recovering ? "active" : "idle",
        circuitBreakerTripped: cb.isTripped(),
      },
    };
  }

  private handleCircuitBreaker(): RouteResponse {
    if (!this.deps.recovery) {
      return {
        status: 200,
        body: {
          tripped: false,
          failedCycles: 0,
          maxCycles: this.deps.config.recovery.circuitBreakerMaxCycles,
        },
      };
    }

    const cb = this.deps.recovery.getCircuitBreaker();
    return {
      status: 200,
      body: {
        tripped: cb.isTripped(),
        failedCycles: cb.getFailedCycleCount(),
        maxCycles: this.deps.config.recovery.circuitBreakerMaxCycles,
        windowMs: this.deps.config.recovery.circuitBreakerWindowMs,
      },
    };
  }

  private handleAntiFlap(): RouteResponse {
    return {
      status: 200,
      body: {
        maxRestarts: this.deps.config.recovery.antiFlap.maxRestarts,
        windowMs: this.deps.config.recovery.antiFlap.windowMs,
        cooldownMs: this.deps.config.recovery.antiFlap.cooldownMs,
        decayMs: this.deps.config.recovery.antiFlap.decayMs,
      },
    };
  }

  // --- Config ---

  private handleConfig(): RouteResponse {
    return { status: 200, body: scrubObject(this.deps.config) };
  }

  private handleConfigBackups(): RouteResponse {
    if (!this.deps.backup) {
      return { status: 200, body: { chronological: [], knownGood: [] } };
    }

    return {
      status: 200,
      body: {
        chronological: this.deps.backup.getChronologicalBackups().map((b) => ({
          timestamp: b.timestamp,
          checksum: b.checksum,
        })),
        knownGood: this.deps.backup.getKnownGoodEntries().map((b) => ({
          timestamp: b.timestamp,
          checksum: b.checksum,
          promotedAt: b.promotedAt,
        })),
      },
    };
  }

  private handleConfigGuardian(): RouteResponse {
    if (!this.deps.deadManSwitch) {
      return {
        status: 200,
        body: {
          state: "idle",
          enabled: this.deps.config.deadManSwitch.enabled,
          countdownMs: this.deps.config.deadManSwitch.countdownMs,
        },
      };
    }

    return {
      status: 200,
      body: {
        state: this.deps.deadManSwitch.getState(),
        enabled: this.deps.config.deadManSwitch.enabled,
        countdownMs: this.deps.config.deadManSwitch.countdownMs,
      },
    };
  }

  // --- Alerts ---

  private handleAlertChannels(): RouteResponse {
    const channels = this.deps.config.alerts.channels.map((ch) => scrubObject(ch));
    return {
      status: 200,
      body: {
        channels,
        total: channels.length,
      },
    };
  }

  private async handleAlertTest(): Promise<RouteResponse> {
    if (!this.deps.alerts || !this.deps.alerts.hasProviders()) {
      return { status: 400, body: { error: "No alert channels configured" } };
    }

    const alert: AlertPayload = {
      severity: "info",
      title: "Aegis Test Alert (API)",
      body: "This is a test alert sent from the Aegis API.",
      timestamp: new Date().toISOString(),
    };

    const result = await this.deps.alerts.dispatch(alert);

    for (const r of result.results) {
      this.alertHistory.push({
        timestamp: new Date().toISOString(),
        provider: r.provider,
        success: r.success,
        durationMs: r.durationMs,
      });
    }

    // Keep last 100 entries
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }

    return {
      status: result.allFailed ? 500 : 200,
      body: {
        sent: result.sent,
        results: result.results.map((r) => ({
          provider: r.provider,
          success: r.success,
          durationMs: r.durationMs,
          error: r.error ?? null,
        })),
      },
    };
  }

  private handleAlertHistory(): RouteResponse {
    return {
      status: 200,
      body: {
        history: this.alertHistory,
        total: this.alertHistory.length,
      },
    };
  }

  // --- System ---

  private async handleVersion(): Promise<RouteResponse> {
    let version = "unknown";
    try {
      const path = await import("node:path");
      // In CJS bundle, __dirname points to dist/ subdirectory
      const candidates = [
        path.join(__dirname, "..", "..", "package.json"),
        path.join(__dirname, "..", "package.json"),
        path.join(process.cwd(), "package.json"),
      ];
      for (const pkgPath of candidates) {
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
          if (pkg.name === "openclaw-aegis") {
            version = String(pkg.version ?? "unknown");
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }

    return { status: 200, body: { version } };
  }

  private handleUptime(): RouteResponse {
    const uptimeMs = Date.now() - this.startedAt;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return {
      status: 200,
      body: {
        uptimeMs,
        uptime: `${hours}h ${minutes}m ${seconds}s`,
        startedAt: new Date(this.startedAt).toISOString(),
      },
    };
  }

  private handlePlatform(): RouteResponse {
    return {
      status: 200,
      body: {
        type: this.deps.config.platform.type,
        os: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        hostname: os.hostname(),
      },
    };
  }

  // --- Observability (Phase 4) ---

  private handleMetrics(): RouteResponse {
    if (!this.deps.metrics) {
      return { status: 501, body: { error: "Metrics not available" } };
    }
    return {
      status: 200,
      body: this.deps.metrics.render(),
      contentType: "text/plain; version=0.0.4; charset=utf-8",
    };
  }

  private handleHealthHistory(_p: Record<string, string>, req: http.IncomingMessage): RouteResponse {
    if (!this.deps.healthHistory) {
      return { status: 501, body: { error: "Health history not available" } };
    }

    // Parse query params: ?since=1h or ?since=3600000 or ?count=100
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sinceParam = url.searchParams.get("since");
    const countParam = url.searchParams.get("count");

    if (countParam) {
      const count = parseInt(countParam, 10);
      return { status: 200, body: { snapshots: this.deps.healthHistory.getLatest(count) } };
    }

    const sinceMs = sinceParam ? parseDuration(sinceParam) : 3600000; // default 1h
    const snapshots = this.deps.healthHistory.getRange(sinceMs);
    return { status: 200, body: { snapshots, count: snapshots.length, sinceMs } };
  }

  private handleHealthHistoryStats(_p: Record<string, string>, req: http.IncomingMessage): RouteResponse {
    if (!this.deps.healthHistory) {
      return { status: 501, body: { error: "Health history not available" } };
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sinceParam = url.searchParams.get("since");
    const sinceMs = sinceParam ? parseDuration(sinceParam) : 3600000;

    const stats = this.deps.healthHistory.computeStats(sinceMs);
    return { status: 200, body: stats };
  }

  private handleProbeTrend(params: Record<string, string>, req: http.IncomingMessage): RouteResponse {
    if (!this.deps.healthHistory) {
      return { status: 501, body: { error: "Health history not available" } };
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sinceParam = url.searchParams.get("since");
    const sinceMs = sinceParam ? parseDuration(sinceParam) : 3600000;

    const trend = this.deps.healthHistory.getProbeTrend(params.name, sinceMs);
    return { status: 200, body: { probe: params.name, trend, count: trend.length } };
  }

  private handleSla(): RouteResponse {
    if (!this.deps.slaTracker) {
      return { status: 501, body: { error: "SLA tracking not available" } };
    }

    return {
      status: 200,
      body: {
        "1h": this.deps.slaTracker.report1h(),
        "24h": this.deps.slaTracker.report24h(),
        "7d": this.deps.slaTracker.report7d(),
        "30d": this.deps.slaTracker.report30d(),
      },
    };
  }

  private handleSlaPeriod(params: Record<string, string>): RouteResponse {
    if (!this.deps.slaTracker) {
      return { status: 501, body: { error: "SLA tracking not available" } };
    }

    const periodMs = parseDuration(params.period);
    return { status: 200, body: this.deps.slaTracker.generateReport(periodMs) };
  }

  private handleTraces(): RouteResponse {
    if (!this.deps.tracer) {
      return { status: 501, body: { error: "Tracing not available" } };
    }

    const traces = this.deps.tracer.getRecentTraces(20);
    return {
      status: 200,
      body: {
        traces: traces.map((spans) => ({
          traceId: spans[0]?.traceId ?? "unknown",
          spanCount: spans.length,
          rootOperation: spans.find((s) => !s.parentSpanId)?.operationName ?? "unknown",
          startTimeMs: Math.min(...spans.map((s) => s.startTimeMs)),
          durationMs: Math.max(...spans.map((s) => s.endTimeMs)) - Math.min(...spans.map((s) => s.startTimeMs)),
          status: spans.some((s) => s.status === "error") ? "error" : "ok",
        })),
        total: traces.length,
      },
    };
  }

  private handleTraceById(params: Record<string, string>): RouteResponse {
    if (!this.deps.tracer) {
      return { status: 501, body: { error: "Tracing not available" } };
    }

    const spans = this.deps.tracer.getTrace(params.traceId);
    if (spans.length === 0) {
      return { status: 404, body: { error: `Trace '${params.traceId}' not found` } };
    }

    return {
      status: 200,
      body: {
        traceId: params.traceId,
        spans,
        total: spans.length,
      },
    };
  }

  // --- Server lifecycle ---

  recordAlertResult(result: { provider: string; success: boolean; durationMs: number }): void {
    this.alertHistory.push({
      timestamp: new Date().toISOString(),
      ...result,
    });
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }
  }

  start(): Promise<void> {
    const { port, host } = this.deps.config.api;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = (req.url ?? "/").split("?")[0];
        const method = (req.method ?? "GET").toUpperCase();

        // CORS for dashboard integration
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const matched = this.matchRoute(method, url ?? "/");
        if (!matched) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const sendResponse = ({ status, body, contentType }: RouteResponse) => {
          const ct = contentType ?? "application/json";
          res.writeHead(status, { "Content-Type": ct });
          if (typeof body === "string") {
            res.end(body);
          } else {
            res.end(JSON.stringify(body, null, 2));
          }
        };

        const sendError = (err: unknown) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
          );
        };

        try {
          const result = matched.handler(matched.params, req);
          if (result instanceof Promise) {
            result.then(sendResponse).catch(sendError);
          } else {
            sendResponse(result);
          }
        } catch (err) {
          sendError(err);
        }
      });

      this.server.on("error", reject);
      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getAddress(): { host: string; port: number } {
    return { host: this.deps.config.api.host, port: this.deps.config.api.port };
  }
}

/** Parse duration strings like "1h", "24h", "7d", "30m" to milliseconds */
function parseDuration(input: string): number {
  const num = parseInt(input, 10);
  if (!isNaN(num) && input === String(num)) return num; // raw milliseconds

  const match = input.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 3600000; // default 1h

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms": return value;
    case "s": return value * 1000;
    case "m": return value * 60000;
    case "h": return value * 3600000;
    case "d": return value * 86400000;
    default: return 3600000;
  }
}

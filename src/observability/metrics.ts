import type { HealthMonitor } from "../health/monitor.js";
import type { RecoveryOrchestrator } from "../recovery/orchestrator.js";
import type { IncidentLogger } from "../incidents/logger.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";
import type { CircuitBreaker } from "../recovery/circuit-breaker.js";
import { computeStatistics } from "../incidents/statistics.js";
import { PROBE_WEIGHTS } from "../types/index.js";

/**
 * Prometheus-compatible metrics exporter.
 * Renders all Aegis internals in Prometheus text exposition format.
 */

interface MetricsDeps {
  monitor: HealthMonitor;
  recovery?: RecoveryOrchestrator;
  incidents?: IncidentLogger;
  alerts?: AlertDispatcher;
  startedAt: number;
}

interface CounterState {
  recoveryAttempts: Record<string, number>; // by level
  recoverySuccesses: Record<string, number>;
  recoveryFailures: Record<string, number>;
  alertsSent: number;
  alertsFailed: number;
  alertsByProvider: Record<string, { sent: number; failed: number }>;
  healthChecksTotal: number;
  escalationsTotal: number;
  circuitBreakerTrips: number;
}

export class MetricsCollector {
  private readonly deps: MetricsDeps;
  private readonly counters: CounterState = {
    recoveryAttempts: {},
    recoverySuccesses: {},
    recoveryFailures: {},
    alertsSent: 0,
    alertsFailed: 0,
    alertsByProvider: {},
    healthChecksTotal: 0,
    escalationsTotal: 0,
    circuitBreakerTrips: 0,
  };

  constructor(deps: MetricsDeps) {
    this.deps = deps;
    this.wireEvents();
  }

  private wireEvents(): void {
    // Count health checks and escalations
    this.deps.monitor.on("check", () => {
      this.counters.healthChecksTotal++;
    });

    this.deps.monitor.on("escalate", () => {
      this.counters.escalationsTotal++;
    });

    // Count recovery events
    if (this.deps.recovery) {
      this.deps.recovery.on("recovery", (event: Record<string, unknown>) => {
        const type = String(event["type"] ?? "");

        if (type.endsWith("_ATTEMPT")) {
          const level = type.replace("_ATTEMPT", "");
          this.counters.recoveryAttempts[level] =
            (this.counters.recoveryAttempts[level] ?? 0) + 1;
        } else if (type.endsWith("_SUCCESS")) {
          const level = type.replace("_SUCCESS", "");
          this.counters.recoverySuccesses[level] =
            (this.counters.recoverySuccesses[level] ?? 0) + 1;
        } else if (type.endsWith("_FAILURE")) {
          const level = type.replace("_FAILURE", "");
          this.counters.recoveryFailures[level] =
            (this.counters.recoveryFailures[level] ?? 0) + 1;
        } else if (type === "CIRCUIT_BREAKER_TRIPPED") {
          this.counters.circuitBreakerTrips++;
        }
      });
    }
  }

  /** Record an alert send result (called by daemon event wiring) */
  recordAlertResult(provider: string, success: boolean): void {
    if (success) {
      this.counters.alertsSent++;
    } else {
      this.counters.alertsFailed++;
    }
    if (!this.counters.alertsByProvider[provider]) {
      this.counters.alertsByProvider[provider] = { sent: 0, failed: 0 };
    }
    if (success) {
      this.counters.alertsByProvider[provider].sent++;
    } else {
      this.counters.alertsByProvider[provider].failed++;
    }
  }

  /** Render all metrics in Prometheus text exposition format */
  render(): string {
    const lines: string[] = [];

    const add = (
      name: string,
      type: "gauge" | "counter",
      help: string,
      values: { labels?: Record<string, string>; value: number }[],
    ) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const v of values) {
        if (v.labels && Object.keys(v.labels).length > 0) {
          const labelStr = Object.entries(v.labels)
            .map(([k, val]) => `${k}="${val}"`)
            .join(",");
          lines.push(`${name}{${labelStr}} ${v.value}`);
        } else {
          lines.push(`${name} ${v.value}`);
        }
      }
    };

    // --- Health ---
    const score = this.deps.monitor.getLastScore();
    add("aegis_health_score", "gauge", "Current health score (0-10)", [
      { value: score?.total ?? 0 },
    ]);

    const bandValue = score?.band === "healthy" ? 2 : score?.band === "degraded" ? 1 : 0;
    add("aegis_health_band", "gauge", "Health band (0=critical, 1=degraded, 2=healthy)", [
      { value: bandValue },
    ]);

    // Per-probe scores
    if (score) {
      const probeValues = score.probeResults.map((p) => ({
        labels: { probe: p.name },
        value: p.score,
      }));
      add("aegis_probe_score", "gauge", "Individual probe score", probeValues);

      const probeHealthy = score.probeResults.map((p) => ({
        labels: { probe: p.name },
        value: p.healthy ? 1 : 0,
      }));
      add("aegis_probe_healthy", "gauge", "Probe health status (0=unhealthy, 1=healthy)", probeHealthy);

      const probeLatency = score.probeResults.map((p) => ({
        labels: { probe: p.name },
        value: p.latencyMs,
      }));
      add("aegis_probe_latency_ms", "gauge", "Probe latency in milliseconds", probeLatency);

      const probeWeight = Object.entries(PROBE_WEIGHTS).map(([name, weight]) => ({
        labels: { probe: name },
        value: weight,
      }));
      add("aegis_probe_weight", "gauge", "Probe weight in health scoring", probeWeight);
    }

    // --- Health check counters ---
    add("aegis_health_checks_total", "counter", "Total health checks performed", [
      { value: this.counters.healthChecksTotal },
    ]);
    add("aegis_escalations_total", "counter", "Total escalations triggered", [
      { value: this.counters.escalationsTotal },
    ]);

    // --- Recovery ---
    const levels = ["L1", "L2", "L3"];
    const attemptValues = levels.map((l) => ({
      labels: { level: l },
      value: this.counters.recoveryAttempts[l] ?? 0,
    }));
    add("aegis_recovery_attempts_total", "counter", "Total recovery attempts by level", attemptValues);

    const successValues = levels.map((l) => ({
      labels: { level: l },
      value: this.counters.recoverySuccesses[l] ?? 0,
    }));
    add("aegis_recovery_successes_total", "counter", "Total recovery successes by level", successValues);

    const failureValues = levels.map((l) => ({
      labels: { level: l },
      value: this.counters.recoveryFailures[l] ?? 0,
    }));
    add("aegis_recovery_failures_total", "counter", "Total recovery failures by level", failureValues);

    // Recovery state
    const recovering = this.deps.recovery?.isRecovering() ? 1 : 0;
    add("aegis_recovery_active", "gauge", "Whether recovery is currently in progress", [
      { value: recovering },
    ]);

    // Circuit breaker
    let cbTripped = 0;
    let cbFailedCycles = 0;
    if (this.deps.recovery) {
      const cb: CircuitBreaker = this.deps.recovery.getCircuitBreaker();
      cbTripped = cb.isTripped() ? 1 : 0;
      cbFailedCycles = cb.getFailedCycleCount();
    }
    add("aegis_circuit_breaker_tripped", "gauge", "Whether circuit breaker is tripped", [
      { value: cbTripped },
    ]);
    add("aegis_circuit_breaker_failed_cycles", "gauge", "Number of failed recovery cycles in window", [
      { value: cbFailedCycles },
    ]);
    add("aegis_circuit_breaker_trips_total", "counter", "Total circuit breaker trips", [
      { value: this.counters.circuitBreakerTrips },
    ]);

    // --- Incidents ---
    if (this.deps.incidents) {
      const stats = computeStatistics(this.deps.incidents);
      add("aegis_incidents_total", "gauge", "Total incidents recorded", [
        { value: stats.totalIncidents },
      ]);
      add("aegis_incidents_resolved", "gauge", "Total resolved incidents", [
        { value: stats.resolvedIncidents },
      ]);
      add("aegis_mttr_average_ms", "gauge", "Average mean time to recovery in milliseconds", [
        { value: Math.round(stats.averageMttrMs) },
      ]);

      for (const [tier, data] of Object.entries(stats.byTier)) {
        add("aegis_mttr_by_tier_ms", "gauge", "Average MTTR by recovery tier", [
          { labels: { tier }, value: Math.round(data.averageMttrMs) },
        ]);
      }
    }

    // --- Alerts ---
    add("aegis_alerts_sent_total", "counter", "Total alerts sent successfully", [
      { value: this.counters.alertsSent },
    ]);
    add("aegis_alerts_failed_total", "counter", "Total alerts that failed to send", [
      { value: this.counters.alertsFailed },
    ]);

    for (const [provider, data] of Object.entries(this.counters.alertsByProvider)) {
      add("aegis_alerts_by_provider_total", "counter", "Alert results by provider", [
        { labels: { provider, result: "success" }, value: data.sent },
        { labels: { provider, result: "failure" }, value: data.failed },
      ]);
    }

    // --- Uptime ---
    const uptimeMs = Date.now() - this.deps.startedAt;
    add("aegis_uptime_seconds", "gauge", "Aegis daemon uptime in seconds", [
      { value: Math.floor(uptimeMs / 1000) },
    ]);
    add("aegis_start_time_seconds", "gauge", "Aegis daemon start time as Unix timestamp", [
      { value: Math.floor(this.deps.startedAt / 1000) },
    ]);

    // --- Process ---
    const mem = process.memoryUsage();
    add("aegis_process_rss_bytes", "gauge", "Aegis process RSS in bytes", [
      { value: mem.rss },
    ]);
    add("aegis_process_heap_used_bytes", "gauge", "Aegis process heap used in bytes", [
      { value: mem.heapUsed },
    ]);

    lines.push("");
    return lines.join("\n");
  }
}

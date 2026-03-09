import type { HealthHistory } from "./health-history.js";
import type { IncidentLogger } from "../incidents/logger.js";
import { computeStatistics } from "../incidents/statistics.js";

export interface SlaReport {
  /** Time range this report covers (ms) */
  periodMs: number;
  /** Total health checks in the period */
  totalChecks: number;
  /** Number of checks where band was "healthy" */
  healthyChecks: number;
  /** Uptime percentage (0-100) */
  uptimePercent: number;
  /** Number of checks where band was "degraded" */
  degradedChecks: number;
  /** Number of checks where band was "critical" */
  criticalChecks: number;
  /** Total incidents in the period */
  totalIncidents: number;
  /** Resolved incidents */
  resolvedIncidents: number;
  /** Unresolved incidents */
  unresolvedIncidents: number;
  /** Average MTTR in ms */
  averageMttrMs: number;
  /** Longest incident duration in ms */
  longestIncidentMs: number;
  /** Time spent in healthy state (estimated from check intervals) */
  healthyTimeMs: number;
  /** Time spent in degraded state */
  degradedTimeMs: number;
  /** Time spent in critical state */
  criticalTimeMs: number;
}

/**
 * SLA tracker — computes uptime percentages and availability reports
 * from health history and incident data.
 */
export class SlaTracker {
  constructor(
    private readonly healthHistory: HealthHistory,
    private readonly incidents: IncidentLogger | undefined,
    private readonly checkIntervalMs: number = 10000,
  ) {}

  /** Generate an SLA report for a given time range */
  generateReport(periodMs: number): SlaReport {
    const snapshots = this.healthHistory.getRange(periodMs);

    let healthyChecks = 0;
    let degradedChecks = 0;
    let criticalChecks = 0;

    for (const snap of snapshots) {
      switch (snap.band) {
        case "healthy":
          healthyChecks++;
          break;
        case "degraded":
          degradedChecks++;
          break;
        case "critical":
          criticalChecks++;
          break;
      }
    }

    const totalChecks = snapshots.length;
    const uptimePercent = totalChecks > 0 ? (healthyChecks / totalChecks) * 100 : 100;

    // Estimate time in each state based on check interval
    const healthyTimeMs = healthyChecks * this.checkIntervalMs;
    const degradedTimeMs = degradedChecks * this.checkIntervalMs;
    const criticalTimeMs = criticalChecks * this.checkIntervalMs;

    // Incident stats
    let totalIncidents = 0;
    let resolvedIncidents = 0;
    let unresolvedIncidents = 0;
    let averageMttrMs = 0;
    let longestIncidentMs = 0;

    if (this.incidents) {
      const stats = computeStatistics(this.incidents);
      totalIncidents = stats.totalIncidents;
      resolvedIncidents = stats.resolvedIncidents;
      unresolvedIncidents = totalIncidents - resolvedIncidents;
      averageMttrMs = stats.averageMttrMs;

      // Find longest incident
      const ids = this.incidents.getIncidents();
      for (const id of ids) {
        const events = this.incidents.getIncidentEvents(id);
        const start = events.find((e) => e.type === "INCIDENT_START");
        const end = events.find(
          (e) => e.type === "INCIDENT_RESOLVED" || e.type === "INCIDENT_UNRESOLVED",
        );
        if (start && end) {
          const duration =
            new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime();
          if (duration > longestIncidentMs) longestIncidentMs = duration;
        }
      }
    }

    return {
      periodMs,
      totalChecks,
      healthyChecks,
      uptimePercent: Math.round(uptimePercent * 1000) / 1000,
      degradedChecks,
      criticalChecks,
      totalIncidents,
      resolvedIncidents,
      unresolvedIncidents,
      averageMttrMs: Math.round(averageMttrMs),
      longestIncidentMs,
      healthyTimeMs,
      degradedTimeMs,
      criticalTimeMs,
    };
  }

  /** Predefined report periods */
  report1h(): SlaReport {
    return this.generateReport(3600000);
  }

  report24h(): SlaReport {
    return this.generateReport(86400000);
  }

  report7d(): SlaReport {
    return this.generateReport(604800000);
  }

  report30d(): SlaReport {
    return this.generateReport(2592000000);
  }
}

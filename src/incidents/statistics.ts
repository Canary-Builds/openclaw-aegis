import type { IncidentEvent } from "../types/index.js";
import { IncidentLogger } from "./logger.js";

export interface MttrStats {
  totalIncidents: number;
  resolvedIncidents: number;
  averageMttrMs: number;
  byTier: Record<string, { count: number; averageMttrMs: number }>;
  byPattern: Record<string, { count: number; averageMttrMs: number }>;
}

export function computeStatistics(logger: IncidentLogger): MttrStats {
  const incidents = logger.getIncidents();
  const stats: MttrStats = {
    totalIncidents: incidents.length,
    resolvedIncidents: 0,
    averageMttrMs: 0,
    byTier: {},
    byPattern: {},
  };

  const mttrs: number[] = [];

  for (const incidentId of incidents) {
    const events = logger.getIncidentEvents(incidentId);
    const mttr = computeIncidentMttr(events);

    if (mttr !== null) {
      stats.resolvedIncidents++;
      mttrs.push(mttr);

      const tier = findRecoveryTier(events);
      if (tier) {
        if (!stats.byTier[tier]) {
          stats.byTier[tier] = { count: 0, averageMttrMs: 0 };
        }
        stats.byTier[tier].count++;
        stats.byTier[tier].averageMttrMs += mttr;
      }

      const pattern = findPattern(events);
      if (pattern) {
        if (!stats.byPattern[pattern]) {
          stats.byPattern[pattern] = { count: 0, averageMttrMs: 0 };
        }
        stats.byPattern[pattern].count++;
        stats.byPattern[pattern].averageMttrMs += mttr;
      }
    }
  }

  if (mttrs.length > 0) {
    stats.averageMttrMs = mttrs.reduce((a, b) => a + b, 0) / mttrs.length;
  }

  for (const tier of Object.values(stats.byTier)) {
    if (tier.count > 0) tier.averageMttrMs /= tier.count;
  }
  for (const pattern of Object.values(stats.byPattern)) {
    if (pattern.count > 0) pattern.averageMttrMs /= pattern.count;
  }

  return stats;
}

function computeIncidentMttr(events: IncidentEvent[]): number | null {
  const start = events.find((e) => e.type === "INCIDENT_START");
  const end = events.find((e) => e.type === "INCIDENT_RESOLVED" || e.type === "RECOVERY_SUCCESS");

  if (!start || !end) return null;

  return new Date(end.timestamp).getTime() - new Date(start.timestamp).getTime();
}

function findRecoveryTier(events: IncidentEvent[]): string | null {
  const recovery = events.find(
    (e) => e.type === "RECOVERY_SUCCESS" || e.type === "RECOVERY_ATTEMPT",
  );
  return recovery ? String(recovery.data["level"] ?? "unknown") : null;
}

function findPattern(events: IncidentEvent[]): string | null {
  const diagnosis = events.find((e) => e.type === "DIAGNOSIS_MATCH");
  return diagnosis ? String(diagnosis.data["pattern"] ?? "unknown") : null;
}

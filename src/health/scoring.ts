import type { HealthProbeResult, HealthScore, HealthBand } from "../types/index.js";
import { PROBE_WEIGHTS, MAX_HEALTH_SCORE } from "../types/index.js";

export interface ScoringThresholds {
  healthyMin: number;
  degradedMin: number;
}

const DEFAULT_THRESHOLDS: ScoringThresholds = {
  healthyMin: 7,
  degradedMin: 4,
};

export function computeHealthScore(
  results: HealthProbeResult[],
  thresholds: ScoringThresholds = DEFAULT_THRESHOLDS,
): HealthScore {
  let rawTotal = 0;

  for (const result of results) {
    const weight = PROBE_WEIGHTS[result.name] ?? 1;
    rawTotal += result.score * weight;
  }

  const normalized = MAX_HEALTH_SCORE > 0 ? Math.round((rawTotal / MAX_HEALTH_SCORE) * 10) : 0;
  const band = classifyBand(normalized, thresholds);

  return { total: normalized, band, probeResults: results };
}

function classifyBand(score: number, thresholds: ScoringThresholds): HealthBand {
  if (score >= thresholds.healthyMin) return "healthy";
  if (score >= thresholds.degradedMin) return "degraded";
  return "critical";
}

export class DegradedConfirmation {
  private consecutiveDegradedCount = 0;
  private readonly requiredCount: number;

  constructor(requiredCount: number = 2) {
    this.requiredCount = requiredCount;
  }

  update(band: HealthBand): boolean {
    if (band === "degraded") {
      this.consecutiveDegradedCount++;
      return this.consecutiveDegradedCount >= this.requiredCount;
    }

    if (band === "critical") {
      this.consecutiveDegradedCount = 0;
      return true;
    }

    this.consecutiveDegradedCount = 0;
    return false;
  }

  reset(): void {
    this.consecutiveDegradedCount = 0;
  }

  getCount(): number {
    return this.consecutiveDegradedCount;
  }
}

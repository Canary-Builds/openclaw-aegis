import type { HealthHistory } from "../observability/health-history.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";
import type { AlertPayload } from "../types/index.js";

export interface PredictiveConfig {
  /** Minimum data points for trend calculation (default: 120 = 20 min at 10s) */
  minDataPoints: number;
  /** How far back to analyze trends (ms, default: 2h) */
  trendWindowMs: number;
  /** Alert when predicted time-to-threshold is below this (ms, default: 1h) */
  warningHorizonMs: number;
  /** Cooldown between predictive alerts (ms, default: 30 min) */
  alertCooldownMs: number;
}

export interface Prediction {
  type: "memory_exhaustion" | "disk_full" | "score_degradation" | "latency_breach";
  probe: string;
  currentValue: number;
  threshold: number;
  ratePerHour: number;
  estimatedTimeToThresholdMs: number;
  confidence: number;
  timestamp: string;
  message: string;
}

const DEFAULT_CONFIG: PredictiveConfig = {
  minDataPoints: 120,
  trendWindowMs: 7200000,
  warningHorizonMs: 3600000,
  alertCooldownMs: 1800000,
};

export class PredictiveAlerter {
  private readonly config: PredictiveConfig;
  private readonly healthHistory: HealthHistory;
  private readonly alertDispatcher?: AlertDispatcher;
  private readonly thresholds: { memoryMb: number; diskMb: number; healthyMin: number };
  private lastAlertTime: Map<string, number> = new Map();
  private predictions: Prediction[] = [];

  constructor(
    healthHistory: HealthHistory,
    thresholds: { memoryMb: number; diskMb: number; healthyMin: number },
    alertDispatcher?: AlertDispatcher,
    config?: Partial<PredictiveConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.healthHistory = healthHistory;
    this.thresholds = thresholds;
    this.alertDispatcher = alertDispatcher;
  }

  /** Run predictive analysis and return predictions within warning horizon */
  analyze(): Prediction[] {
    const snapshots = this.healthHistory.getRange(this.config.trendWindowMs);
    if (snapshots.length < this.config.minDataPoints) return [];

    const predictions: Prediction[] = [];

    // 1. Score degradation trend
    const scorePrediction = this.predictScoreDegradation(snapshots);
    if (scorePrediction) predictions.push(scorePrediction);

    // 2. Memory exhaustion (via memory probe latency as proxy for RSS)
    const memPrediction = this.predictProbeThresholdBreach(
      snapshots,
      "memory",
      this.thresholds.memoryMb,
      "memory_exhaustion",
    );
    if (memPrediction) predictions.push(memPrediction);

    // 3. Disk full
    const diskPrediction = this.predictProbeThresholdBreach(
      snapshots,
      "disk",
      this.thresholds.diskMb,
      "disk_full",
    );
    if (diskPrediction) predictions.push(diskPrediction);

    // 4. Latency breach for critical probes
    for (const probe of ["http", "port", "websocket"]) {
      const latPrediction = this.predictLatencyBreach(snapshots, probe);
      if (latPrediction) predictions.push(latPrediction);
    }

    // Fire alerts for predictions within warning horizon
    for (const pred of predictions) {
      if (pred.estimatedTimeToThresholdMs <= this.config.warningHorizonMs) {
        this.fireAlert(pred);
      }
    }

    this.predictions = predictions;
    return predictions;
  }

  /** Get the most recently computed predictions */
  getPredictions(): Prediction[] {
    return [...this.predictions];
  }

  private predictScoreDegradation(
    snapshots: { score: number; timestamp: string }[],
  ): Prediction | null {
    const points = snapshots.map((s) => ({
      t: new Date(s.timestamp).getTime(),
      v: s.score,
    }));

    const trend = linearRegression(points);
    if (trend.slope >= 0) return null; // Score not declining

    // When will score hit degradedMin threshold?
    const current = points[points.length - 1].v;
    const target = this.thresholds.healthyMin;
    if (current <= target) return null; // Already below threshold

    const msToThreshold = ((current - target) / Math.abs(trend.slope)) * 3600000;
    if (msToThreshold <= 0 || msToThreshold > 86400000 * 7) return null; // >7 days = not useful

    const hoursToThreshold = msToThreshold / 3600000;

    return {
      type: "score_degradation",
      probe: "aggregate",
      currentValue: current,
      threshold: target,
      ratePerHour: trend.slope,
      estimatedTimeToThresholdMs: msToThreshold,
      confidence: trend.r2,
      timestamp: new Date().toISOString(),
      message: `Health score declining at ${Math.abs(trend.slope).toFixed(2)}/hr — will reach DEGRADED threshold (${target}) in ~${hoursToThreshold.toFixed(1)}h (confidence: ${(trend.r2 * 100).toFixed(0)}%)`,
    };
  }

  private predictProbeThresholdBreach(
    snapshots: { probes: Record<string, { score: number; latencyMs: number }>; timestamp: string }[],
    probe: string,
    _threshold: number,
    type: "memory_exhaustion" | "disk_full",
  ): Prediction | null {
    // Use probe score trend — score going from 2→1→0 indicates approaching threshold
    const points = snapshots
      .filter((s) => s.probes[probe])
      .map((s) => ({
        t: new Date(s.timestamp).getTime(),
        v: s.probes[probe].score,
      }));

    if (points.length < this.config.minDataPoints / 2) return null;

    const trend = linearRegression(points);
    if (trend.slope >= 0) return null; // Score not declining

    const current = points[points.length - 1].v;
    if (current <= 0) return null; // Already at 0

    // When will score hit 0?
    const msToZero = (current / Math.abs(trend.slope)) * 3600000;
    if (msToZero <= 0 || msToZero > 86400000 * 7) return null;

    const hoursToZero = msToZero / 3600000;
    const label = type === "memory_exhaustion" ? "Memory" : "Disk";

    return {
      type,
      probe,
      currentValue: current,
      threshold: 0,
      ratePerHour: trend.slope,
      estimatedTimeToThresholdMs: msToZero,
      confidence: trend.r2,
      timestamp: new Date().toISOString(),
      message: `${label} probe score declining — will reach critical (0) in ~${hoursToZero.toFixed(1)}h (rate: ${Math.abs(trend.slope).toFixed(3)}/hr, confidence: ${(trend.r2 * 100).toFixed(0)}%)`,
    };
  }

  private predictLatencyBreach(
    snapshots: { probes: Record<string, { latencyMs: number }>; timestamp: string }[],
    probe: string,
  ): Prediction | null {
    const points = snapshots
      .filter((s) => s.probes[probe])
      .map((s) => ({
        t: new Date(s.timestamp).getTime(),
        v: s.probes[probe].latencyMs,
      }));

    if (points.length < this.config.minDataPoints / 2) return null;

    const trend = linearRegression(points);
    if (trend.slope <= 0) return null; // Latency not increasing

    const current = points[points.length - 1].v;
    const threshold = 5000; // 5s timeout threshold

    if (current >= threshold) return null; // Already over

    const msToThreshold = ((threshold - current) / trend.slope) * 3600000;
    if (msToThreshold <= 0 || msToThreshold > 86400000 * 7) return null;

    const hoursToThreshold = msToThreshold / 3600000;

    return {
      type: "latency_breach",
      probe,
      currentValue: current,
      threshold,
      ratePerHour: trend.slope,
      estimatedTimeToThresholdMs: msToThreshold,
      confidence: trend.r2,
      timestamp: new Date().toISOString(),
      message: `${probe} latency increasing at ${trend.slope.toFixed(1)}ms/hr — will reach timeout (${threshold}ms) in ~${hoursToThreshold.toFixed(1)}h (current: ${current.toFixed(0)}ms)`,
    };
  }

  private fireAlert(prediction: Prediction): void {
    if (!this.alertDispatcher) return;

    const key = `${prediction.type}:${prediction.probe}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(key) ?? 0;
    if (now - lastAlert < this.config.alertCooldownMs) return;

    this.lastAlertTime.set(key, now);

    const hours = (prediction.estimatedTimeToThresholdMs / 3600000).toFixed(1);
    const alert: AlertPayload = {
      severity: "warning",
      title: `Predictive Alert: ${prediction.type.replace(/_/g, " ")}`,
      body: `${prediction.message}\n\nEstimated time to threshold: ${hours}h`,
      timestamp: prediction.timestamp,
    };

    void this.alertDispatcher.dispatch(alert);
  }
}

/** Simple linear regression returning slope (units per hour), intercept, and R² */
function linearRegression(points: { t: number; v: number }[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  if (points.length < 2) return { slope: 0, intercept: 0, r2: 0 };

  const n = points.length;
  // Normalize time to hours from first point
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 3600000);
  const ys = points.map((p) => p.v);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² (coefficient of determination)
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - predicted) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2: Math.max(0, r2) };
}

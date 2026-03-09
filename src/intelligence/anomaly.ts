import type { HealthHistory } from "../observability/health-history.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";
import type { AlertPayload } from "../types/index.js";

export interface AnomalyConfig {
  /** Minimum data points to establish a baseline (default: 60 = 10 min at 10s intervals) */
  minBaseline: number;
  /** How far back to look for baseline (ms, default: 1h) */
  baselineWindowMs: number;
  /** Standard deviations before flagging anomaly (default: 2.5) */
  scoreDeviationThreshold: number;
  /** Standard deviations for latency anomaly (default: 3.0) */
  latencyDeviationThreshold: number;
  /** Consecutive anomalous checks before alerting (default: 3) */
  confirmationCount: number;
  /** Cooldown between alerts for same anomaly type (ms, default: 15 min) */
  alertCooldownMs: number;
}

export interface Anomaly {
  type: "score" | "probe_latency" | "probe_failure_rate";
  probe?: string;
  current: number;
  baseline: number;
  stddev: number;
  deviations: number;
  timestamp: string;
  message: string;
}

interface ProbeBaseline {
  avgLatency: number;
  stddevLatency: number;
  failRate: number;
}

const DEFAULT_CONFIG: AnomalyConfig = {
  minBaseline: 60,
  baselineWindowMs: 3600000,
  scoreDeviationThreshold: 2.5,
  latencyDeviationThreshold: 3.0,
  confirmationCount: 3,
  alertCooldownMs: 900000,
};

export class AnomalyDetector {
  private readonly config: AnomalyConfig;
  private readonly healthHistory: HealthHistory;
  private readonly alertDispatcher?: AlertDispatcher;
  private consecutiveCounts: Map<string, number> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private detectedAnomalies: Anomaly[] = [];

  constructor(
    healthHistory: HealthHistory,
    alertDispatcher?: AlertDispatcher,
    config?: Partial<AnomalyConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.healthHistory = healthHistory;
    this.alertDispatcher = alertDispatcher;
  }

  /** Run anomaly detection against current health history */
  analyze(): Anomaly[] {
    const snapshots = this.healthHistory.getRange(this.config.baselineWindowMs);
    if (snapshots.length < this.config.minBaseline) return [];

    const anomalies: Anomaly[] = [];

    // Split into baseline (older 80%) and recent (latest 20%)
    const splitIdx = Math.floor(snapshots.length * 0.8);
    const baseline = snapshots.slice(0, splitIdx);
    const recent = snapshots.slice(splitIdx);

    if (baseline.length < 10 || recent.length < 3) return [];

    // 1. Check aggregate score anomaly
    const scoreAnomaly = this.checkScoreAnomaly(baseline, recent);
    if (scoreAnomaly) anomalies.push(scoreAnomaly);

    // 2. Check per-probe latency anomalies
    const probeNames = new Set<string>();
    for (const snap of snapshots) {
      for (const name of Object.keys(snap.probes)) {
        probeNames.add(name);
      }
    }

    for (const probe of probeNames) {
      const latencyAnomaly = this.checkLatencyAnomaly(probe, baseline, recent);
      if (latencyAnomaly) anomalies.push(latencyAnomaly);

      const failRateAnomaly = this.checkFailRateAnomaly(probe, baseline, recent);
      if (failRateAnomaly) anomalies.push(failRateAnomaly);
    }

    // Track consecutive counts and fire alerts
    for (const anomaly of anomalies) {
      const key = anomaly.probe ? `${anomaly.type}:${anomaly.probe}` : anomaly.type;
      const count = (this.consecutiveCounts.get(key) ?? 0) + 1;
      this.consecutiveCounts.set(key, count);

      if (count >= this.config.confirmationCount) {
        this.fireAnomalyAlert(anomaly, key);
      }
    }

    // Reset counters for anomaly types not detected this cycle
    const detectedKeys = new Set(
      anomalies.map((a) => (a.probe ? `${a.type}:${a.probe}` : a.type)),
    );
    for (const key of this.consecutiveCounts.keys()) {
      if (!detectedKeys.has(key)) {
        this.consecutiveCounts.delete(key);
      }
    }

    this.detectedAnomalies = anomalies;
    return anomalies;
  }

  /** Get the most recently detected anomalies */
  getAnomalies(): Anomaly[] {
    return [...this.detectedAnomalies];
  }

  /** Get computed baselines for all probes */
  getBaselines(): { score: { avg: number; stddev: number }; probes: Record<string, ProbeBaseline> } {
    const snapshots = this.healthHistory.getRange(this.config.baselineWindowMs);
    const splitIdx = Math.floor(snapshots.length * 0.8);
    const baseline = snapshots.slice(0, splitIdx);

    const scores = baseline.map((s) => s.score);
    const scoreAvg = mean(scores);
    const scoreStddev = stddev(scores, scoreAvg);

    const probes: Record<string, ProbeBaseline> = {};
    const probeNames = new Set<string>();
    for (const snap of baseline) {
      for (const name of Object.keys(snap.probes)) {
        probeNames.add(name);
      }
    }

    for (const name of probeNames) {
      const latencies = baseline.filter((s) => s.probes[name]).map((s) => s.probes[name].latencyMs);
      const failures = baseline.filter((s) => s.probes[name]).filter((s) => !s.probes[name].healthy).length;
      const total = baseline.filter((s) => s.probes[name]).length;

      const avgLat = mean(latencies);
      probes[name] = {
        avgLatency: avgLat,
        stddevLatency: stddev(latencies, avgLat),
        failRate: total > 0 ? failures / total : 0,
      };
    }

    return { score: { avg: scoreAvg, stddev: scoreStddev }, probes };
  }

  private checkScoreAnomaly(
    baseline: { score: number; timestamp: string }[],
    recent: { score: number; timestamp: string }[],
  ): Anomaly | null {
    const baseScores = baseline.map((s) => s.score);
    const avg = mean(baseScores);
    const sd = stddev(baseScores, avg);

    if (sd === 0) return null; // No variance — can't detect anomaly

    const recentAvg = mean(recent.map((s) => s.score));
    const deviations = (avg - recentAvg) / sd; // Positive = score dropped

    if (deviations >= this.config.scoreDeviationThreshold) {
      return {
        type: "score",
        current: recentAvg,
        baseline: avg,
        stddev: sd,
        deviations,
        timestamp: new Date().toISOString(),
        message: `Health score dropped to ${recentAvg.toFixed(1)} (baseline: ${avg.toFixed(1)} ± ${sd.toFixed(1)}, ${deviations.toFixed(1)}σ deviation)`,
      };
    }

    return null;
  }

  private checkLatencyAnomaly(
    probe: string,
    baseline: { probes: Record<string, { latencyMs: number }> }[],
    recent: { probes: Record<string, { latencyMs: number }>; timestamp: string }[],
  ): Anomaly | null {
    const baseLatencies = baseline.filter((s) => s.probes[probe]).map((s) => s.probes[probe].latencyMs);
    const recentLatencies = recent.filter((s) => s.probes[probe]).map((s) => s.probes[probe].latencyMs);

    if (baseLatencies.length < 10 || recentLatencies.length < 3) return null;

    const avg = mean(baseLatencies);
    const sd = stddev(baseLatencies, avg);

    if (sd === 0) return null;

    const recentAvg = mean(recentLatencies);
    const deviations = (recentAvg - avg) / sd; // Positive = latency increased

    if (deviations >= this.config.latencyDeviationThreshold) {
      return {
        type: "probe_latency",
        probe,
        current: recentAvg,
        baseline: avg,
        stddev: sd,
        deviations,
        timestamp: new Date().toISOString(),
        message: `${probe} latency spiked to ${recentAvg.toFixed(0)}ms (baseline: ${avg.toFixed(0)}ms ± ${sd.toFixed(0)}ms, ${deviations.toFixed(1)}σ)`,
      };
    }

    return null;
  }

  private checkFailRateAnomaly(
    probe: string,
    baseline: { probes: Record<string, { healthy: boolean }> }[],
    recent: { probes: Record<string, { healthy: boolean }>; timestamp: string }[],
  ): Anomaly | null {
    const baseTotal = baseline.filter((s) => s.probes[probe]).length;
    const baseFails = baseline.filter((s) => s.probes[probe] && !s.probes[probe].healthy).length;
    const recentTotal = recent.filter((s) => s.probes[probe]).length;
    const recentFails = recent.filter((s) => s.probes[probe] && !s.probes[probe].healthy).length;

    if (baseTotal < 10 || recentTotal < 3) return null;

    const baseRate = baseFails / baseTotal;
    const recentRate = recentFails / recentTotal;

    // If baseline has near-zero failures but recent has >30% failure rate
    if (baseRate < 0.05 && recentRate > 0.3) {
      return {
        type: "probe_failure_rate",
        probe,
        current: recentRate,
        baseline: baseRate,
        stddev: 0,
        deviations: 0,
        timestamp: new Date().toISOString(),
        message: `${probe} failure rate jumped to ${(recentRate * 100).toFixed(0)}% (baseline: ${(baseRate * 100).toFixed(0)}%)`,
      };
    }

    return null;
  }

  private fireAnomalyAlert(anomaly: Anomaly, key: string): void {
    if (!this.alertDispatcher) return;

    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(key) ?? 0;
    if (now - lastAlert < this.config.alertCooldownMs) return;

    this.lastAlertTime.set(key, now);

    const alert: AlertPayload = {
      severity: "warning",
      title: `Anomaly Detected: ${anomaly.type}${anomaly.probe ? ` (${anomaly.probe})` : ""}`,
      body: anomaly.message,
      timestamp: anomaly.timestamp,
    };

    void this.alertDispatcher.dispatch(alert);
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

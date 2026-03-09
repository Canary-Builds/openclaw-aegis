import * as fs from "node:fs";
import * as path from "node:path";
import type { HealthScore } from "../types/index.js";

interface HealthSnapshot {
  timestamp: string;
  score: number;
  band: string;
  probes: Record<string, { healthy: boolean; score: number; latencyMs: number }>;
}

/**
 * Health history time-series store.
 * Persists health check results over time for trend analysis.
 * Stores in JSONL format, one snapshot per line.
 */
export class HealthHistory {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private cache: HealthSnapshot[] = [];
  private loaded = false;

  constructor(basePath: string, maxEntries: number = 8640) {
    // 8640 = 24 hours at 10s intervals
    fs.mkdirSync(basePath, { recursive: true });
    this.filePath = path.join(basePath, "health-history.jsonl");
    this.maxEntries = maxEntries;
  }

  /** Record a health check result */
  record(score: HealthScore): void {
    const snapshot: HealthSnapshot = {
      timestamp: new Date().toISOString(),
      score: score.total,
      band: score.band,
      probes: {},
    };

    for (const probe of score.probeResults) {
      snapshot.probes[probe.name] = {
        healthy: probe.healthy,
        score: probe.score,
        latencyMs: probe.latencyMs,
      };
    }

    this.ensureLoaded();
    this.cache.push(snapshot);

    // Rotate if over limit
    if (this.cache.length > this.maxEntries) {
      this.cache = this.cache.slice(-this.maxEntries);
      this.rewrite();
    } else {
      // Append only
      fs.appendFileSync(this.filePath, JSON.stringify(snapshot) + "\n", { mode: 0o600 });
    }
  }

  /** Get all recorded snapshots */
  getAll(): HealthSnapshot[] {
    this.ensureLoaded();
    return [...this.cache];
  }

  /** Get snapshots within a time range */
  getRange(sinceMs: number): HealthSnapshot[] {
    this.ensureLoaded();
    const cutoff = new Date(Date.now() - sinceMs).toISOString();
    return this.cache.filter((s) => s.timestamp >= cutoff);
  }

  /** Get the latest N snapshots */
  getLatest(count: number): HealthSnapshot[] {
    this.ensureLoaded();
    return this.cache.slice(-count);
  }

  /** Get per-probe trend for a specific probe */
  getProbeTrend(
    probeName: string,
    sinceMs: number,
  ): { timestamp: string; healthy: boolean; score: number; latencyMs: number }[] {
    const snapshots = this.getRange(sinceMs);
    return snapshots
      .filter((s) => s.probes[probeName])
      .map((s) => ({
        timestamp: s.timestamp,
        ...s.probes[probeName],
      }));
  }

  /** Compute summary statistics for a time range */
  computeStats(sinceMs: number): {
    count: number;
    avgScore: number;
    minScore: number;
    maxScore: number;
    bandCounts: Record<string, number>;
    probeFailRates: Record<string, number>;
  } {
    const snapshots = this.getRange(sinceMs);
    if (snapshots.length === 0) {
      return {
        count: 0,
        avgScore: 0,
        minScore: 0,
        maxScore: 0,
        bandCounts: {},
        probeFailRates: {},
      };
    }

    let totalScore = 0;
    let minScore = Infinity;
    let maxScore = -Infinity;
    const bandCounts: Record<string, number> = {};
    const probeFailCounts: Record<string, number> = {};
    const probeTotalCounts: Record<string, number> = {};

    for (const snap of snapshots) {
      totalScore += snap.score;
      if (snap.score < minScore) minScore = snap.score;
      if (snap.score > maxScore) maxScore = snap.score;
      bandCounts[snap.band] = (bandCounts[snap.band] ?? 0) + 1;

      for (const [name, probe] of Object.entries(snap.probes)) {
        probeTotalCounts[name] = (probeTotalCounts[name] ?? 0) + 1;
        if (!probe.healthy) {
          probeFailCounts[name] = (probeFailCounts[name] ?? 0) + 1;
        }
      }
    }

    const probeFailRates: Record<string, number> = {};
    for (const [name, total] of Object.entries(probeTotalCounts)) {
      probeFailRates[name] = (probeFailCounts[name] ?? 0) / total;
    }

    return {
      count: snapshots.length,
      avgScore: totalScore / snapshots.length,
      minScore,
      maxScore,
      bandCounts,
      probeFailRates,
    };
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (!fs.existsSync(this.filePath)) return;

    try {
      const content = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!content) return;

      this.cache = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HealthSnapshot);

      // Trim if over limit
      if (this.cache.length > this.maxEntries) {
        this.cache = this.cache.slice(-this.maxEntries);
        this.rewrite();
      }
    } catch {
      this.cache = [];
    }
  }

  private rewrite(): void {
    const content = this.cache.map((s) => JSON.stringify(s)).join("\n") + "\n";
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
  }
}

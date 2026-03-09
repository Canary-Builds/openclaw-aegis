import type { AlertPayload } from "../types/index.js";
import type { AlertDispatcher } from "../alerts/dispatcher.js";

export interface NoiseReductionConfig {
  /** Window for grouping related alerts (ms, default: 5 min) */
  groupingWindowMs: number;
  /** Max alerts of same type before deduplication kicks in (default: 3) */
  dedupThreshold: number;
  /** Time before escalating severity (ms, default: 15 min) */
  escalationDelayMs: number;
  /** Maximum alerts to buffer before forced flush (default: 20) */
  maxBufferSize: number;
  /** Digest interval — how often to send grouped digests (ms, default: 5 min) */
  digestIntervalMs: number;
}

interface AlertGroup {
  key: string;
  alerts: AlertPayload[];
  firstSeen: number;
  lastSeen: number;
  count: number;
  escalated: boolean;
  lastDigestSent: number;
}

export interface NoiseStats {
  totalReceived: number;
  totalSuppressed: number;
  totalGrouped: number;
  totalEscalated: number;
  activeGroups: number;
  suppressionRate: string;
}

const DEFAULT_CONFIG: NoiseReductionConfig = {
  groupingWindowMs: 300000,
  dedupThreshold: 3,
  escalationDelayMs: 900000,
  maxBufferSize: 20,
  digestIntervalMs: 300000,
};

export class AlertNoiseReducer {
  private readonly config: NoiseReductionConfig;
  private readonly dispatcher: AlertDispatcher;
  private groups: Map<string, AlertGroup> = new Map();
  private totalReceived = 0;
  private totalSuppressed = 0;
  private totalGrouped = 0;
  private totalEscalated = 0;
  private digestTimer: NodeJS.Timeout | null = null;

  constructor(dispatcher: AlertDispatcher, config?: Partial<NoiseReductionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dispatcher = dispatcher;
  }

  /** Start the digest timer for periodic grouped alert delivery */
  start(): void {
    if (this.digestTimer) return;
    this.digestTimer = setInterval(() => {
      void this.flushDigests();
    }, this.config.digestIntervalMs);
  }

  /** Stop the digest timer and flush remaining alerts */
  stop(): void {
    if (this.digestTimer) {
      clearInterval(this.digestTimer);
      this.digestTimer = null;
    }
    void this.flushDigests();
  }

  /**
   * Process an incoming alert through noise reduction.
   * Returns true if the alert was sent immediately, false if buffered/suppressed.
   */
  async process(alert: AlertPayload): Promise<{ sent: boolean; grouped: boolean; suppressed: boolean }> {
    this.totalReceived++;

    const key = this.computeGroupKey(alert);
    const now = Date.now();

    const existing = this.groups.get(key);

    if (!existing) {
      // First alert of this type — send immediately
      const group: AlertGroup = {
        key,
        alerts: [alert],
        firstSeen: now,
        lastSeen: now,
        count: 1,
        escalated: false,
        lastDigestSent: now,
      };
      this.groups.set(key, group);

      await this.dispatcher.dispatch(alert);
      return { sent: true, grouped: false, suppressed: false };
    }

    // Existing group — check if within grouping window
    if (now - existing.lastSeen > this.config.groupingWindowMs) {
      // Window expired — treat as new group
      existing.alerts = [alert];
      existing.firstSeen = now;
      existing.lastSeen = now;
      existing.count = 1;
      existing.escalated = false;
      existing.lastDigestSent = now;

      await this.dispatcher.dispatch(alert);
      return { sent: true, grouped: false, suppressed: false };
    }

    // Within window — group it
    existing.alerts.push(alert);
    existing.lastSeen = now;
    existing.count++;
    this.totalGrouped++;

    // Check dedup threshold
    if (existing.count > this.config.dedupThreshold) {
      this.totalSuppressed++;
      return { sent: false, grouped: true, suppressed: true };
    }

    // Check escalation
    if (!existing.escalated && now - existing.firstSeen > this.config.escalationDelayMs) {
      existing.escalated = true;
      this.totalEscalated++;

      const escalated: AlertPayload = {
        ...alert,
        severity: "critical",
        title: `[ESCALATED] ${alert.title}`,
        body: `${alert.body}\n\nThis alert has been recurring for ${Math.floor((now - existing.firstSeen) / 60000)} minutes (${existing.count} occurrences). Escalating severity.`,
      };

      await this.dispatcher.dispatch(escalated);
      return { sent: true, grouped: true, suppressed: false };
    }

    // Buffer overflow — force flush
    if (existing.alerts.length >= this.config.maxBufferSize) {
      await this.sendDigest(existing);
      return { sent: true, grouped: true, suppressed: false };
    }

    return { sent: false, grouped: true, suppressed: true };
  }

  /** Get noise reduction statistics */
  getStats(): NoiseStats {
    return {
      totalReceived: this.totalReceived,
      totalSuppressed: this.totalSuppressed,
      totalGrouped: this.totalGrouped,
      totalEscalated: this.totalEscalated,
      activeGroups: this.groups.size,
      suppressionRate: this.totalReceived > 0
        ? ((this.totalSuppressed / this.totalReceived) * 100).toFixed(1) + "%"
        : "0%",
    };
  }

  /** Get active alert groups */
  getActiveGroups(): { key: string; count: number; firstSeen: string; lastSeen: string; escalated: boolean }[] {
    const now = Date.now();
    const active: { key: string; count: number; firstSeen: string; lastSeen: string; escalated: boolean }[] = [];

    for (const [, group] of this.groups) {
      if (now - group.lastSeen < this.config.groupingWindowMs) {
        active.push({
          key: group.key,
          count: group.count,
          firstSeen: new Date(group.firstSeen).toISOString(),
          lastSeen: new Date(group.lastSeen).toISOString(),
          escalated: group.escalated,
        });
      }
    }

    return active;
  }

  private async flushDigests(): Promise<void> {
    const now = Date.now();

    for (const [key, group] of this.groups) {
      // Clean up expired groups
      if (now - group.lastSeen > this.config.groupingWindowMs * 2) {
        this.groups.delete(key);
        continue;
      }

      // Send digest for active groups with buffered alerts
      if (group.alerts.length > 1 && now - group.lastDigestSent >= this.config.digestIntervalMs) {
        await this.sendDigest(group);
      }
    }
  }

  private async sendDigest(group: AlertGroup): Promise<void> {
    if (group.alerts.length === 0) return;

    const latest = group.alerts[group.alerts.length - 1];
    const digest: AlertPayload = {
      severity: group.escalated ? "critical" : latest.severity,
      title: `[${group.count}x] ${latest.title}`,
      body: `${latest.body}\n\n--- Alert Digest ---\nOccurrences: ${group.count}\nFirst seen: ${new Date(group.firstSeen).toISOString()}\nLast seen: ${new Date(group.lastSeen).toISOString()}\nSuppressed: ${Math.max(0, group.count - this.config.dedupThreshold)}`,
      timestamp: new Date().toISOString(),
      incidentId: latest.incidentId,
      recoveryActions: latest.recoveryActions,
      healthScore: latest.healthScore,
    };

    await this.dispatcher.dispatch(digest);
    group.lastDigestSent = Date.now();
    group.alerts = [];
  }

  private computeGroupKey(alert: AlertPayload): string {
    // Group by severity + title pattern (remove numbers and timestamps for matching)
    const normalizedTitle = alert.title.replace(/\d+/g, "N").replace(/\[.*?\]/g, "");
    return `${alert.severity}:${normalizedTitle.trim()}`;
  }
}

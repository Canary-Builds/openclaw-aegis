import * as fs from "node:fs";
import { EventEmitter } from "node:events";

export interface ConfigChangeEvent {
  path: string;
  timestamp: number;
  source: "polling" | "fswatch";
}

export class ConfigChangeDetector extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;
  private lastMtime: number = 0;
  private changeTimestamps: number[] = [];
  private readonly stormThreshold: number;
  private readonly stormWindowMs: number;

  constructor(
    private readonly configPath: string,
    private readonly pollIntervalMs: number = 2000,
    stormThreshold: number = 5,
    stormWindowMs: number = 60000,
  ) {
    super();
    this.stormThreshold = stormThreshold;
    this.stormWindowMs = stormWindowMs;
  }

  start(): void {
    this.initMtime();
    this.startPolling();
    this.startFsWatch();
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private initMtime(): void {
    try {
      const stat = fs.statSync(this.configPath);
      this.lastMtime = stat.mtimeMs;
    } catch {
      this.lastMtime = 0;
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      this.checkMtime("polling");
    }, this.pollIntervalMs);
  }

  private startFsWatch(): void {
    try {
      this.watcher = fs.watch(this.configPath, () => {
        this.checkMtime("fswatch");
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // fs.watch unavailable — polling is the primary mechanism
    }
  }

  private checkMtime(source: "polling" | "fswatch"): void {
    try {
      const stat = fs.statSync(this.configPath);
      if (stat.mtimeMs > this.lastMtime) {
        this.lastMtime = stat.mtimeMs;
        const event: ConfigChangeEvent = {
          path: this.configPath,
          timestamp: Date.now(),
          source,
        };
        this.recordChange(event.timestamp);
        this.emit("change", event);
      }
    } catch {
      // File may not exist yet
    }
  }

  private recordChange(timestamp: number): void {
    this.changeTimestamps.push(timestamp);
    const cutoff = timestamp - this.stormWindowMs;
    this.changeTimestamps = this.changeTimestamps.filter((t) => t > cutoff);

    if (this.changeTimestamps.length > this.stormThreshold) {
      this.emit("storm", {
        count: this.changeTimestamps.length,
        windowMs: this.stormWindowMs,
      });
    }
  }

  getRecentChangeCount(): number {
    const cutoff = Date.now() - this.stormWindowMs;
    return this.changeTimestamps.filter((t) => t > cutoff).length;
  }
}

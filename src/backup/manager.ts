import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { BackupEntry, KnownGoodEntry } from "../types/index.js";
import type { AegisConfig } from "../config/schema.js";
import { expandHome } from "../config/loader.js";

const METADATA_FILE = "metadata.json";

interface BackupMetadata {
  chronological: BackupEntry[];
  knownGood: KnownGoodEntry[];
}

export class BackupManager {
  private readonly basePath: string;
  private readonly maxChronological: number;
  private readonly maxKnownGood: number;
  private readonly knownGoodStabilityMs: number;
  private readonly configPath: string;

  constructor(config: AegisConfig) {
    this.basePath = expandHome(config.backup.basePath);
    this.maxChronological = config.backup.maxChronological;
    this.maxKnownGood = config.backup.maxKnownGood;
    this.knownGoodStabilityMs = config.backup.knownGoodStabilityMs;
    this.configPath = config.gateway.configPath;
  }

  init(): void {
    fs.mkdirSync(path.join(this.basePath, "chronological"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.basePath, "known-good"), { recursive: true, mode: 0o700 });
  }

  backup(): BackupEntry {
    this.init();
    const content = fs.readFileSync(this.configPath, "utf-8");
    const checksum = sha256(content);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}.json`;
    const backupPath = path.join(this.basePath, "chronological", filename);

    atomicWrite(backupPath, content);

    const entry: BackupEntry = { path: backupPath, timestamp: new Date().toISOString(), checksum };
    const meta = this.loadMetadata();
    meta.chronological.push(entry);

    while (meta.chronological.length > this.maxChronological) {
      const removed = meta.chronological.shift();
      if (removed) {
        try {
          fs.unlinkSync(removed.path);
        } catch {
          /* already gone */
        }
      }
    }

    this.saveMetadata(meta);
    return entry;
  }

  restoreLatestKnownGood(): boolean {
    const meta = this.loadMetadata();
    const latest = meta.knownGood[meta.knownGood.length - 1];
    if (!latest) return false;
    return this.restoreFromEntry(latest);
  }

  restoreFromEntry(entry: BackupEntry): boolean {
    if (!fs.existsSync(entry.path)) return false;

    const content = fs.readFileSync(entry.path, "utf-8");
    const checksum = sha256(content);
    if (checksum !== entry.checksum) return false;

    atomicWrite(this.configPath, content);
    return true;
  }

  promoteToKnownGood(): KnownGoodEntry | null {
    if (!fs.existsSync(this.configPath)) return null;

    const content = fs.readFileSync(this.configPath, "utf-8");
    const checksum = sha256(content);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `known-good-${timestamp}.json`;
    const knownGoodPath = path.join(this.basePath, "known-good", filename);

    atomicWrite(knownGoodPath, content);

    const entry: KnownGoodEntry = {
      path: knownGoodPath,
      timestamp: new Date().toISOString(),
      checksum,
      promotedAt: new Date().toISOString(),
    };

    const meta = this.loadMetadata();
    meta.knownGood.push(entry);

    while (meta.knownGood.length > this.maxKnownGood) {
      const removed = meta.knownGood.shift();
      if (removed) {
        try {
          fs.unlinkSync(removed.path);
        } catch {
          /* already gone */
        }
      }
    }

    this.saveMetadata(meta);
    return entry;
  }

  getLatestKnownGood(): KnownGoodEntry | null {
    const meta = this.loadMetadata();
    return meta.knownGood[meta.knownGood.length - 1] ?? null;
  }

  getChronologicalBackups(): BackupEntry[] {
    return this.loadMetadata().chronological;
  }

  getKnownGoodEntries(): KnownGoodEntry[] {
    return this.loadMetadata().knownGood;
  }

  getKnownGoodStabilityMs(): number {
    return this.knownGoodStabilityMs;
  }

  private loadMetadata(): BackupMetadata {
    const metaPath = path.join(this.basePath, METADATA_FILE);
    try {
      const raw = fs.readFileSync(metaPath, "utf-8");
      return JSON.parse(raw) as BackupMetadata;
    } catch {
      return { chronological: [], knownGood: [] };
    }
  }

  private saveMetadata(meta: BackupMetadata): void {
    const metaPath = path.join(this.basePath, METADATA_FILE);
    atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  }
}

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function atomicWrite(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, targetPath);
}

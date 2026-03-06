import * as fs from "node:fs";
import type { AegisConfig } from "../config/schema.js";
import { BackupManager } from "../backup/manager.js";
import { CRITICAL_CONFIG_KEYS } from "../types/index.js";

export interface PreflightResult {
  valid: boolean;
  errors: string[];
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export function preflightValidation(configPath: string): PreflightResult {
  const errors: string[] = [];

  if (!fs.existsSync(configPath)) {
    return { valid: false, errors: ["Gateway config file not found"] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    return { valid: false, errors: [`Cannot read config: ${err instanceof Error ? err.message : String(err)}`] };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { valid: false, errors: ["Config is not valid JSON"] };
  }

  if (!("port" in parsed)) {
    errors.push("Missing required key: port");
  }

  const poisonKeys = ["autoAck", "autoAckMessage"];
  for (const key of poisonKeys) {
    if (key in parsed) {
      errors.push(`Poison key detected: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function diffConfigs(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): ConfigDiff {
  const oldKeys = new Set(Object.keys(oldConfig));
  const newKeys = new Set(Object.keys(newConfig));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key);
    } else if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
      modified.push(key);
    }
  }

  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, modified };
}

export function isCriticalChange(diff: ConfigDiff): boolean {
  const criticalSet = new Set<string>(CRITICAL_CONFIG_KEYS);

  for (const key of [...diff.added, ...diff.removed, ...diff.modified]) {
    if (criticalSet.has(key)) return true;
  }

  if (diff.added.length > 0 || diff.removed.length > 0) return true;

  return false;
}

export function startupConfigValidation(config: AegisConfig, backupManager: BackupManager): boolean {
  const preflight = preflightValidation(config.gateway.configPath);
  if (preflight.valid) return true;

  const knownGood = backupManager.getLatestKnownGood();
  if (!knownGood) return false;

  return backupManager.restoreFromEntry(knownGood);
}

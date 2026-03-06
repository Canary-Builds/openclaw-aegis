import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROTECTED_CONFIG_KEYS } from "../types/index.js";
import { atomicWrite, sha256 } from "../backup/manager.js";
import { diffConfigs } from "../config-guardian/guardian.js";

const execFileAsync = promisify(execFile);

export interface DoctorResult {
  success: boolean;
  diff: { added: string[]; removed: string[]; modified: string[] } | null;
  rejected: boolean;
  rejectedReason?: string;
  output: string;
}

export async function safeDoctorFix(configPath: string): Promise<DoctorResult> {
  if (!fs.existsSync(configPath)) {
    return { success: false, diff: null, rejected: false, output: "Config file not found" };
  }

  const beforeContent = fs.readFileSync(configPath, "utf-8");
  const beforeChecksum = sha256(beforeContent);
  let beforeConfig: Record<string, unknown>;
  try {
    beforeConfig = JSON.parse(beforeContent) as Record<string, unknown>;
  } catch {
    return { success: false, diff: null, rejected: false, output: "Config is not valid JSON before doctor" };
  }

  const tmpBackup = `${configPath}.aegis-doctor-backup.${process.pid}`;
  atomicWrite(tmpBackup, beforeContent);

  let output: string;
  try {
    const result = await execFileAsync("openclaw", ["doctor", "--fix"], { timeout: 30000 });
    output = result.stdout + result.stderr;
  } catch (err) {
    try { fs.unlinkSync(tmpBackup); } catch { /* cleanup */ }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, diff: null, rejected: false, output: `doctor --fix failed: ${msg}` };
  }

  const afterContent = fs.readFileSync(configPath, "utf-8");
  const afterChecksum = sha256(afterContent);

  if (afterChecksum === beforeChecksum) {
    try { fs.unlinkSync(tmpBackup); } catch { /* cleanup */ }
    return { success: true, diff: null, rejected: false, output };
  }

  let afterConfig: Record<string, unknown>;
  try {
    afterConfig = JSON.parse(afterContent) as Record<string, unknown>;
  } catch {
    atomicWrite(configPath, beforeContent);
    try { fs.unlinkSync(tmpBackup); } catch { /* cleanup */ }
    return { success: false, diff: null, rejected: true, rejectedReason: "doctor produced invalid JSON", output };
  }

  const diff = diffConfigs(beforeConfig, afterConfig);
  const protectedSet = new Set<string>(PROTECTED_CONFIG_KEYS);
  const protectedRemovals = diff.removed.filter((key) => protectedSet.has(key));

  if (protectedRemovals.length > 0) {
    atomicWrite(configPath, beforeContent);
    try { fs.unlinkSync(tmpBackup); } catch { /* cleanup */ }
    return {
      success: false,
      diff,
      rejected: true,
      rejectedReason: `doctor removed protected keys: ${protectedRemovals.join(", ")}`,
      output,
    };
  }

  try { fs.unlinkSync(tmpBackup); } catch { /* cleanup */ }
  return { success: true, diff, rejected: false, output };
}

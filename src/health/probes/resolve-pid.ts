import * as fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Resolve gateway PID. Tries systemd user service first, then falls back to PID file.
 * @param pidSource - systemd unit name (e.g. "openclaw-gateway.service") or path to PID file
 * @returns PID number, or null if unresolvable
 */
export function resolvePid(pidSource: string): number | null {
  // If it looks like a systemd unit name (contains ".service" or no path separators)
  if (pidSource.endsWith(".service") || !pidSource.includes("/")) {
    const pid = resolveFromSystemd(pidSource);
    if (pid !== null) return pid;
  }

  // Fall back to PID file
  return resolveFromFile(pidSource);
}

function resolveFromSystemd(unit: string): number | null {
  try {
    const output = execFileSync("systemctl", ["--user", "show", "-p", "MainPID", "--value", unit], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const pid = parseInt(output, 10);
    if (!isNaN(pid) && pid > 0) return pid;
    return null;
  } catch {
    return null;
  }
}

function resolveFromFile(pidFile: string): number | null {
  try {
    if (!fs.existsSync(pidFile)) return null;
    const pidStr = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid) && pid > 0) return pid;
    return null;
  } catch {
    return null;
  }
}

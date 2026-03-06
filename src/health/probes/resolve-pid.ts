import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Resolve gateway PID.
 * - systemd: `systemctl --user show` (Linux)
 * - launchd: `launchctl list <label>` (macOS)
 * - PID file: reads PID from file path
 *
 * @param pidSource - service name or path to PID file
 * @returns PID number, or null if unresolvable
 */
export function resolvePid(pidSource: string): number | null {
  const isPath = pidSource.includes("/");

  if (!isPath) {
    if (os.platform() === "darwin") {
      const pid = resolveFromLaunchd(pidSource);
      if (pid !== null) return pid;
    }

    const pid = resolveFromSystemd(pidSource);
    if (pid !== null) return pid;
  }

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

function resolveFromLaunchd(label: string): number | null {
  try {
    const output = execFileSync("launchctl", ["list", label], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // launchctl list <label> outputs a table with "PID" = <number> or
    // a header line containing the PID as the first column
    const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
    if (pidMatch) {
      const pid = parseInt(pidMatch[1], 10);
      if (!isNaN(pid) && pid > 0) return pid;
    }

    // Fallback: parse tabular output (PID is first column of second line)
    const lines = output.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      if (parts[0]) {
        const pid = parseInt(parts[0], 10);
        if (!isNaN(pid) && pid > 0) return pid;
      }
    }

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

import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

const execFileAsync = promisify(execFile);

export async function tunProbe(_target: ProbeTarget): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    // Check if any TUN device exists
    const tunDevices = fs
      .readdirSync("/sys/class/net")
      .filter((dev) => {
        try {
          const type = fs.readFileSync(`/sys/class/net/${dev}/type`, "utf-8").trim();
          return type === "65534"; // ARPHRD_NONE — typical for TUN
        } catch {
          return false;
        }
      });

    if (tunDevices.length === 0) {
      return {
        name: "tun",
        healthy: true,
        score: 2,
        message: "No TUN device configured (not required)",
        latencyMs: Date.now() - start,
      };
    }

    // Check if TUN device is UP
    const tunDev = tunDevices[0];
    if (!tunDev) {
      return {
        name: "tun",
        healthy: true,
        score: 2,
        message: "No TUN device configured (not required)",
        latencyMs: Date.now() - start,
      };
    }
    const { stdout } = await execFileAsync("ip", ["link", "show", tunDev]);
    const isUp = stdout.includes("state UP") || stdout.includes(",UP");

    return {
      name: "tun",
      healthy: isUp,
      score: isUp ? 2 : 0,
      message: isUp ? undefined : `TUN device ${tunDev} is DOWN`,
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      name: "tun",
      healthy: true,
      score: 2,
      message: "TUN probe skipped (not available on this platform)",
      latencyMs: Date.now() - start,
    };
  }
}

import * as fs from "node:fs";
import * as os from "node:os";
import { execSync } from "node:child_process";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";
import { resolvePid } from "./resolve-pid.js";

async function getCpuPercentLinux(pid: number, sampleMs: number): Promise<number | null> {
  const statPath = `/proc/${pid}/stat`;
  if (!fs.existsSync(statPath)) return null;

  const readCpuTime = (): number => {
    const stat = fs.readFileSync(statPath, "utf-8");
    const fields = stat.split(" ");
    const utime = parseInt(fields[13] ?? "0", 10) || 0;
    const stime = parseInt(fields[14] ?? "0", 10) || 0;
    return utime + stime;
  };

  const cpuTime1 = readCpuTime();
  await new Promise((r) => setTimeout(r, sampleMs));
  const cpuTime2 = readCpuTime();

  const clockTicks = 100;
  const cpuDelta = (cpuTime2 - cpuTime1) / clockTicks;
  return (cpuDelta / (sampleMs / 1000)) * 100;
}

function getCpuPercentMac(pid: number): number | null {
  try {
    const output = execSync(`ps -o %cpu= -p ${pid}`, { encoding: "utf-8" }).trim();
    const cpu = parseFloat(output);
    if (isNaN(cpu)) return null;
    return cpu;
  } catch {
    return null;
  }
}

export async function cpuProbe(
  _target: ProbeTarget,
  pidSource: string,
  thresholdPercent: number = 90,
  sampleMs: number = 1000,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    const pid = resolvePid(pidSource);

    if (pid === null) {
      return {
        name: "cpu",
        healthy: false,
        score: 0,
        message: "Gateway process not found — cannot check CPU",
        latencyMs: Date.now() - start,
      };
    }

    let cpuPercent: number | null;
    if (os.platform() === "darwin") {
      cpuPercent = getCpuPercentMac(pid);
    } else {
      cpuPercent = await getCpuPercentLinux(pid, sampleMs);
    }

    if (cpuPercent === null) {
      return {
        name: "cpu",
        healthy: false,
        score: 0,
        message: `Could not read CPU usage for process ${pid}`,
        latencyMs: Date.now() - start,
      };
    }
    const healthy = cpuPercent < thresholdPercent;

    return {
      name: "cpu",
      healthy,
      score: healthy ? 2 : 0,
      message: healthy
        ? undefined
        : `CPU ${cpuPercent.toFixed(1)}% exceeds threshold ${thresholdPercent}%`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "cpu",
      healthy: false,
      score: 0,
      message: `CPU probe error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}

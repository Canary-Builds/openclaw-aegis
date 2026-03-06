import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiagnosisContext, FailurePattern, RecoveryAction } from "../types/index.js";
import { BackupManager } from "../backup/manager.js";

const execFileAsync = promisify(execFile);

export class DiagnosisEngine {
  private readonly patterns: FailurePattern[];

  constructor(backupManager: BackupManager) {
    this.patterns = createPatterns(backupManager);
  }

  async diagnose(context: DiagnosisContext): Promise<{ pattern: FailurePattern; action: RecoveryAction } | null> {
    for (const pattern of this.patterns) {
      try {
        const matched = await pattern.detect(context);
        if (matched) {
          const action = await pattern.fix(context);
          return { pattern, action };
        }
      } catch {
        // Pattern detection failed — skip to next
      }
    }
    return null;
  }

  getPatterns(): FailurePattern[] {
    return [...this.patterns];
  }
}

function createPatterns(backupManager: BackupManager): FailurePattern[] {
  return [
    {
      id: 1,
      name: "runtime-config-injection",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        if (!ctx.currentConfig) return false;
        const poisonKeys = ["autoAck", "autoAckMessage", "groupAllowFrom", "allowlist"];
        return poisonKeys.some((key) => key in ctx.currentConfig!);
      },
      async fix(_ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        const restored = backupManager.restoreLatestKnownGood();
        return {
          level: "L2",
          action: "restore-known-good-config",
          result: restored ? "success" : "failure",
          durationMs: Date.now() - start,
        };
      },
    },
    {
      id: 2,
      name: "stale-pid-file",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        if (!fs.existsSync(ctx.pidFile)) return false;
        const pidStr = fs.readFileSync(ctx.pidFile, "utf-8").trim();
        const pid = parseInt(pidStr, 10);
        if (isNaN(pid) || pid <= 0) return true;
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      },
      async fix(ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        try {
          fs.unlinkSync(ctx.pidFile);
          return { level: "L2", action: "delete-stale-pid", result: "success", durationMs: Date.now() - start };
        } catch {
          return { level: "L2", action: "delete-stale-pid", result: "failure", durationMs: Date.now() - start };
        }
      },
    },
    {
      id: 3,
      name: "port-conflict",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        try {
          const { stdout } = await execFileAsync("lsof", ["-i", `:${ctx.gatewayPort}`, "-t"]);
          const pids = stdout.trim().split("\n").filter(Boolean);
          if (pids.length === 0) return false;

          if (fs.existsSync(ctx.pidFile)) {
            const gatewayPid = fs.readFileSync(ctx.pidFile, "utf-8").trim();
            return !pids.includes(gatewayPid);
          }
          return pids.length > 0;
        } catch {
          return false;
        }
      },
      async fix(ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        try {
          const { stdout } = await execFileAsync("lsof", ["-i", `:${ctx.gatewayPort}`, "-t"]);
          const pids = stdout.trim().split("\n").filter(Boolean);
          return {
            level: "L2",
            action: `port-conflict-detected-pids:${pids.join(",")}`,
            result: "skipped",
            durationMs: Date.now() - start,
          };
        } catch {
          return { level: "L2", action: "port-conflict-check", result: "failure", durationMs: Date.now() - start };
        }
      },
    },
    {
      id: 4,
      name: "file-permission-error",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        try {
          const stat = fs.statSync(ctx.configPath);
          const mode = stat.mode & 0o777;
          return mode !== 0o600 && mode !== 0o644;
        } catch {
          return false;
        }
      },
      async fix(ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        try {
          fs.chmodSync(ctx.configPath, 0o600);
          return { level: "L2", action: "fix-permissions", result: "success", durationMs: Date.now() - start };
        } catch {
          return { level: "L2", action: "fix-permissions", result: "failure", durationMs: Date.now() - start };
        }
      },
    },
    {
      id: 5,
      name: "config-corrupted",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        if (!fs.existsSync(ctx.configPath)) return true;
        try {
          const raw = fs.readFileSync(ctx.configPath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return !("port" in parsed);
        } catch {
          return true;
        }
      },
      async fix(_ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        const restored = backupManager.restoreLatestKnownGood();
        return {
          level: "L2",
          action: "restore-known-good-config",
          result: restored ? "success" : "failure",
          durationMs: Date.now() - start,
        };
      },
    },
    {
      id: 6,
      name: "oom-kill",
      async detect(_ctx: DiagnosisContext): Promise<boolean> {
        try {
          const { stdout } = await execFileAsync("dmesg", ["--time-format", "reltime"], { timeout: 5000 });
          return /oom_kill_process|Out of memory/.test(stdout);
        } catch {
          return false;
        }
      },
      async fix(): Promise<RecoveryAction> {
        return { level: "L4", action: "oom-kill-detected-escalate", result: "skipped", durationMs: 0 };
      },
    },
  ];
}

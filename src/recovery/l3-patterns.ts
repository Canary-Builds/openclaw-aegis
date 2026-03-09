import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import type { DiagnosisContext, FailurePattern, RecoveryAction } from "../types/index.js";

const execFileAsync = promisify(execFile);

export function createL3Patterns(): FailurePattern[] {
  return [
    // L3-1: Network Repair — DNS resolution, stale routes, TUN interface reset
    {
      id: 101,
      name: "network-repair",
      async detect(_ctx: DiagnosisContext): Promise<boolean> {
        // Check if DNS resolution is broken
        try {
          await execFileAsync("getent", ["hosts", "localhost"], { timeout: 5000 });
        } catch {
          return true;
        }

        // Check if TUN device exists but is DOWN
        if (os.platform() === "linux") {
          try {
            const netDir = "/sys/class/net";
            if (fs.existsSync(netDir)) {
              const ifaces = fs.readdirSync(netDir);
              for (const iface of ifaces) {
                const typePath = path.join(netDir, iface, "type");
                if (!fs.existsSync(typePath)) continue;
                const type = fs.readFileSync(typePath, "utf-8").trim();
                if (type === "65534") {
                  const operstatePath = path.join(netDir, iface, "operstate");
                  if (fs.existsSync(operstatePath)) {
                    const state = fs.readFileSync(operstatePath, "utf-8").trim();
                    if (state === "down") return true;
                  }
                }
              }
            }
          } catch {
            // Not critical if we can't check
          }
        }

        // Check if default route exists
        try {
          const cmd = os.platform() === "darwin" ? "netstat" : "ip";
          const args = os.platform() === "darwin" ? ["-rn"] : ["route", "show", "default"];
          const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
          if (!stdout.includes("default") && !stdout.includes("0.0.0.0")) return true;
        } catch {
          return true;
        }

        return false;
      },
      async fix(_ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        let fixed = false;

        // Attempt 1: Flush DNS cache
        try {
          if (os.platform() === "darwin") {
            await execFileAsync("dscacheutil", ["-flushcache"], { timeout: 5000 });
          } else {
            await execFileAsync("systemd-resolve", ["--flush-caches"], { timeout: 5000 });
          }
          fixed = true;
        } catch {
          // DNS flush is best-effort
        }

        // Attempt 2: Bring TUN interface up if it's down (Linux)
        if (os.platform() === "linux") {
          try {
            const netDir = "/sys/class/net";
            if (fs.existsSync(netDir)) {
              const ifaces = fs.readdirSync(netDir);
              for (const iface of ifaces) {
                const typePath = path.join(netDir, iface, "type");
                if (!fs.existsSync(typePath)) continue;
                const type = fs.readFileSync(typePath, "utf-8").trim();
                if (type === "65534") {
                  const operstatePath = path.join(netDir, iface, "operstate");
                  if (fs.existsSync(operstatePath)) {
                    const state = fs.readFileSync(operstatePath, "utf-8").trim();
                    if (state === "down") {
                      await execFileAsync("ip", ["link", "set", iface, "up"], { timeout: 5000 });
                      fixed = true;
                    }
                  }
                }
              }
            }
          } catch {
            // TUN fix is best-effort
          }
        }

        return {
          level: "L3",
          action: "network-repair",
          result: fixed ? "success" : "failure",
          durationMs: Date.now() - start,
        };
      },
    },

    // L3-2: Process Resurrection — re-download/reinstall gateway if binary missing
    {
      id: 102,
      name: "process-resurrection",
      async detect(_ctx: DiagnosisContext): Promise<boolean> {
        // Check if the openclaw binary exists and is executable
        try {
          await execFileAsync("which", ["openclaw"], { timeout: 5000 });
          return false;
        } catch {
          // Binary not found in PATH
          return true;
        }
      },
      async fix(_ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        try {
          // Attempt npm reinstall
          await execFileAsync("npm", ["install", "-g", "openclaw"], {
            timeout: 120000,
            env: { ...process.env, NODE_ENV: "production" },
          });

          // Verify it's now available
          await execFileAsync("which", ["openclaw"], { timeout: 5000 });

          return {
            level: "L3",
            action: "process-resurrection-reinstall",
            result: "success",
            durationMs: Date.now() - start,
          };
        } catch {
          return {
            level: "L3",
            action: "process-resurrection-reinstall",
            result: "failure",
            durationMs: Date.now() - start,
          };
        }
      },
    },

    // L3-3: Dependency Health — check node_modules integrity, rebuild if needed
    {
      id: 103,
      name: "dependency-health",
      async detect(_ctx: DiagnosisContext): Promise<boolean> {
        // Find the gateway installation directory
        const installDir = resolveGatewayInstallDir();
        if (!installDir) return false;

        const nodeModules = path.join(installDir, "node_modules");

        // Check if node_modules exists
        if (!fs.existsSync(nodeModules)) return true;

        // Check for .package-lock.json corruption
        const lockPath = path.join(nodeModules, ".package-lock.json");
        if (fs.existsSync(lockPath)) {
          try {
            const raw = fs.readFileSync(lockPath, "utf-8");
            JSON.parse(raw);
          } catch {
            return true; // Corrupted lock file
          }
        }

        // Check for missing native modules (.node files referenced but absent)
        try {
          await execFileAsync(
            "node",
            ["-e", "try { require('openclaw') } catch(e) { if (e.code === 'MODULE_NOT_FOUND') process.exit(1) }"],
            { timeout: 10000, cwd: installDir },
          );
          return false;
        } catch {
          return true;
        }
      },
      async fix(_ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        const installDir = resolveGatewayInstallDir();
        if (!installDir) {
          return {
            level: "L3",
            action: "dependency-rebuild",
            result: "failure",
            durationMs: Date.now() - start,
          };
        }

        try {
          // Remove node_modules and reinstall
          const nodeModules = path.join(installDir, "node_modules");
          if (fs.existsSync(nodeModules)) {
            fs.rmSync(nodeModules, { recursive: true, force: true });
          }

          await execFileAsync("npm", ["install", "--production"], {
            timeout: 120000,
            cwd: installDir,
          });

          return {
            level: "L3",
            action: "dependency-rebuild",
            result: "success",
            durationMs: Date.now() - start,
          };
        } catch {
          return {
            level: "L3",
            action: "dependency-rebuild",
            result: "failure",
            durationMs: Date.now() - start,
          };
        }
      },
    },

    // L3-4: Safe Mode Boot — start gateway with minimal config
    {
      id: 104,
      name: "safe-mode-boot",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        // Safe mode is a last-resort — only trigger when process is dead
        // AND config looks valid (so L2 config fixes won't help)
        try {
          // Process must be dead
          const { stdout } = await execFileAsync("pgrep", ["-f", "openclaw"], { timeout: 5000 });
          if (stdout.trim().length > 0) return false; // Process running, not our problem
        } catch {
          // pgrep returns exit 1 when no process found — that's what we want
        }

        // Config must exist and be valid JSON (if config is broken, L2 handles it)
        if (!fs.existsSync(ctx.configPath)) return false;
        try {
          const raw = fs.readFileSync(ctx.configPath, "utf-8");
          JSON.parse(raw);
        } catch {
          return false; // Bad config is L2's job
        }

        // Normal restart already failed (we're in L3), config is valid, process is dead
        // → try safe mode
        return true;
      },
      async fix(ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();

        // Create a minimal safe-mode config
        const safeModeConfig = createSafeModeConfig(ctx.configPath, ctx.gatewayPort);
        const safeModeConfigPath = ctx.configPath + ".safemode";

        try {
          fs.writeFileSync(safeModeConfigPath, JSON.stringify(safeModeConfig, null, 2));

          // Start with safe mode config
          await execFileAsync(
            "openclaw",
            ["gateway", "start", "--config", safeModeConfigPath],
            { timeout: 30000 },
          );

          // Verify it came up
          await sleep(3000);
          try {
            await execFileAsync("pgrep", ["-f", "openclaw"], { timeout: 5000 });
          } catch {
            return {
              level: "L3",
              action: "safe-mode-boot",
              result: "failure",
              durationMs: Date.now() - start,
            };
          }

          return {
            level: "L3",
            action: "safe-mode-boot",
            result: "success",
            durationMs: Date.now() - start,
          };
        } catch {
          return {
            level: "L3",
            action: "safe-mode-boot",
            result: "failure",
            durationMs: Date.now() - start,
          };
        } finally {
          // Clean up safe mode config
          try {
            fs.unlinkSync(safeModeConfigPath);
          } catch {
            // Best effort
          }
        }
      },
    },

    // L3-5: Disk Cleanup — free space when disk is full (logs, temp files, old backups)
    {
      id: 105,
      name: "disk-cleanup",
      async detect(ctx: DiagnosisContext): Promise<boolean> {
        try {
          const configDir = path.dirname(ctx.configPath);
          const { stdout } = await execFileAsync("df", ["-BM", configDir], { timeout: 5000 });
          const lines = stdout.trim().split("\n");
          if (lines.length < 2) return false;
          const parts = lines[1].split(/\s+/);
          const availStr = parts[3];
          if (!availStr) return false;
          const availMb = parseInt(availStr.replace("M", ""), 10);
          return !isNaN(availMb) && availMb < 50; // Critical: less than 50MB
        } catch {
          return false;
        }
      },
      fix(ctx: DiagnosisContext): Promise<RecoveryAction> {
        const start = Date.now();
        let freedBytes = 0;

        // 1. Rotate/truncate gateway logs
        if (fs.existsSync(ctx.logPath)) {
          try {
            const stat = fs.statSync(ctx.logPath);
            if (stat.size > 10 * 1024 * 1024) {
              // Keep last 1MB, truncate the rest
              const content = fs.readFileSync(ctx.logPath, "utf-8");
              const tail = content.slice(-1024 * 1024);
              fs.writeFileSync(ctx.logPath, tail);
              freedBytes += stat.size - tail.length;
            }
          } catch {
            // Best effort
          }
        }

        // 2. Clean old log files (*.log.1, *.log.2, etc.)
        try {
          const logDir = path.dirname(ctx.logPath);
          if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            for (const file of files) {
              if (/\.log\.\d+$/.test(file) || /\.log\.gz$/.test(file)) {
                const filePath = path.join(logDir, file);
                const stat = fs.statSync(filePath);
                freedBytes += stat.size;
                fs.unlinkSync(filePath);
              }
            }
          }
        } catch {
          // Best effort
        }

        // 3. Clean temp files in openclaw directory
        try {
          const openclawDir = path.dirname(ctx.configPath);
          const tmpDir = path.join(openclawDir, "tmp");
          if (fs.existsSync(tmpDir)) {
            const stat = fs.statSync(tmpDir);
            fs.rmSync(tmpDir, { recursive: true, force: true });
            freedBytes += stat.size;
          }
        } catch {
          // Best effort
        }

        return Promise.resolve({
          level: "L3" as const,
          action: `disk-cleanup-freed-${Math.round(freedBytes / 1024 / 1024)}mb`,
          result: freedBytes > 0 ? ("success" as const) : ("failure" as const),
          durationMs: Date.now() - start,
        });
      },
    },
  ];
}

function resolveGatewayInstallDir(): string | null {
  try {
    const output = execSync("which openclaw", { encoding: "utf-8", timeout: 5000 }).trim();
    // Follow symlinks to find the actual install directory
    const realPath = fs.realpathSync(output);
    // Typical npm global: /usr/lib/node_modules/openclaw/dist/cli.js → go up to package root
    let dir = path.dirname(realPath);
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      dir = path.dirname(dir);
    }
    return null;
  } catch {
    return null;
  }
}

function createSafeModeConfig(originalConfigPath: string, port: number): Record<string, unknown> {
  // Read original config and strip everything except the bare minimum
  let original: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(originalConfigPath, "utf-8");
    original = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Start from scratch
  }

  return {
    port,
    authToken: original["authToken"] ?? original["token"],
    // No plugins, no custom routes, no webhooks — bare minimum to boot
    safeMode: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

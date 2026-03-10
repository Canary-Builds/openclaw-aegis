import { Command } from "commander";
import * as http from "node:http";

const DURATION_REGEX = /^(\d+)(s|m|h)$/;

function parseDuration(input: string): number {
  const match = DURATION_REGEX.exec(input);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use format: 30m, 2h, 3600s`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000 };
  return value * multipliers[unit];
}

function apiRequest(
  port: number,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 500, data: JSON.parse(data) as Record<string, unknown> });
          } catch {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      },
    );
    req.on("error", (err) => {
      reject(new Error(`Cannot connect to Aegis API on port ${port}: ${err.message}`));
    });
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export const maintenanceCommand = new Command("maintenance")
  .description("Manage maintenance windows — suppress alerts and pause recovery")
  .option("-p, --port <port>", "Aegis API port", "3001");

maintenanceCommand
  .command("on [duration]")
  .description("Activate maintenance mode (default: 30m). Accepts: 30m, 2h, 3600s")
  .action(async (duration: string | undefined, _opts: unknown, cmd: Command) => {
    const port = parseInt(cmd.parent?.opts().port ?? "3001", 10);
    const durationMs = parseDuration(duration ?? "30m");

    try {
      const { status, data } = await apiRequest(port, "POST", "/maintenance/activate", {
        durationMs,
        activatedBy: "cli",
      });

      if (status === 200) {
        const remaining = typeof data["remainingMs"] === "number" ? Math.ceil(data["remainingMs"] / 60000) : "?";
        process.stdout.write(`\x1b[33mMaintenance mode ACTIVE\x1b[0m — alerts suppressed, recovery paused for ~${remaining}m\n`);
      } else {
        const msg = typeof data["error"] === "string" ? data["error"] : "Unknown error";
        process.stderr.write(`Failed to activate maintenance: ${msg}\n`);
        process.exit(1);
      }
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

maintenanceCommand
  .command("off")
  .description("Deactivate maintenance mode — resume alerts and recovery")
  .action(async (_opts: unknown, cmd: Command) => {
    const port = parseInt(cmd.parent?.parent?.opts().port ?? "3001", 10);

    try {
      const { status, data } = await apiRequest(port, "POST", "/maintenance/deactivate", {});

      if (status === 200) {
        process.stdout.write(`\x1b[32mMaintenance mode OFF\x1b[0m — alerts and recovery resumed\n`);
      } else {
        const msg = typeof data["error"] === "string" ? data["error"] : "Unknown error";
        process.stderr.write(`Failed to deactivate: ${msg}\n`);
        process.exit(1);
      }
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

maintenanceCommand
  .command("status")
  .description("Show current maintenance window status")
  .action(async (_opts: unknown, cmd: Command) => {
    const port = parseInt(cmd.parent?.parent?.opts().port ?? "3001", 10);

    try {
      const { status, data } = await apiRequest(port, "GET", "/maintenance");

      if (status === 200) {
        if (data["active"]) {
          const remaining = typeof data["remainingMs"] === "number" ? Math.ceil(data["remainingMs"] / 60000) : "?";
          const by = typeof data["activatedBy"] === "string" ? data["activatedBy"] : "unknown";
          process.stdout.write(`\x1b[33mMaintenance ACTIVE\x1b[0m — ~${remaining}m remaining (activated by: ${by})\n`);
        } else {
          process.stdout.write(`\x1b[32mNo active maintenance window\x1b[0m\n`);
        }
      } else {
        process.stderr.write(`Failed to get status\n`);
        process.exit(1);
      }
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

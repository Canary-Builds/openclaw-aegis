import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  PlatformAdapter,
  PlatformInstallConfig,
  PlatformServiceStatus,
} from "../types/index.js";

const execFileAsync = promisify(execFile);

export class SystemdAdapter implements PlatformAdapter {
  readonly name = "systemd";
  private serviceName = "openclaw-aegis";
  private watchdogInterval: NodeJS.Timeout | null = null;
  private watchdogSec = 30;

  async install(config: PlatformInstallConfig): Promise<void> {
    this.serviceName = config.serviceName;
    this.watchdogSec = config.watchdogSec;

    const unit = this.generateUnitFile(config);
    const unitPath = path.join("/etc/systemd/system", `${config.serviceName}.service`);

    fs.writeFileSync(unitPath, unit, { mode: 0o644 });
    await execFileAsync("systemctl", ["daemon-reload"]);
    await execFileAsync("systemctl", ["enable", config.serviceName]);
  }

  async start(): Promise<void> {
    await execFileAsync("systemctl", ["start", this.serviceName]);
  }

  async stop(): Promise<void> {
    this.stopWatchdogHeartbeat();
    await execFileAsync("systemctl", ["stop", this.serviceName]);
  }

  async restart(): Promise<void> {
    await execFileAsync("systemctl", ["restart", this.serviceName]);
  }

  async status(): Promise<PlatformServiceStatus> {
    try {
      const { stdout } = await execFileAsync("systemctl", ["is-active", this.serviceName]);
      const state = stdout.trim();
      if (state === "active") return "running";
      if (state === "inactive") return "stopped";
      if (state === "failed") return "failed";
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  async notifyWatchdog(): Promise<void> {
    const socketPath = process.env["NOTIFY_SOCKET"];
    if (!socketPath) return;

    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(socketPath, () => {
        socket.end("WATCHDOG=1", () => {
          resolve();
        });
      });
      socket.on("error", reject);
      socket.setTimeout(1000);
      socket.on("timeout", () => {
        socket.destroy();
        resolve();
      });
    });
  }

  startWatchdogHeartbeat(): void {
    const intervalMs = (this.watchdogSec / 2) * 1000;
    this.watchdogInterval = setInterval(() => {
      void this.notifyWatchdog();
    }, intervalMs);
  }

  stopWatchdogHeartbeat(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  generateUnitFile(config: PlatformInstallConfig): string {
    const rwPaths = config.readWritePaths.join(" ");
    return `[Unit]
Description=OpenClaw Aegis Self-Healing Daemon
After=network.target
Documentation=https://github.com/Canary-Builds/openclaw-aegis

[Service]
Type=notify
ExecStart=/usr/bin/node ${config.execPath}
ExecStartPre=/usr/bin/node ${config.execPath} preflight
WorkingDirectory=${config.workingDirectory}
User=${config.user}
Restart=on-failure
RestartSec=5
StartLimitIntervalUSec=120s
StartLimitBurst=5
WatchdogSec=${config.watchdogSec}
ProtectSystem=strict
PrivateTmp=true
ReadWritePaths=${rwPaths}

[Install]
WantedBy=multi-user.target
`;
  }
}

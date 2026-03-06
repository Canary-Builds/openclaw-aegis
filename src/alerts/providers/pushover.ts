import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface PushoverConfig {
  apiToken: string;
  userKey: string;
  device?: string;
}

export class PushoverProvider implements AlertProvider {
  readonly name = "pushover";
  private readonly config: PushoverConfig;

  constructor(config: PushoverConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const priority = alert.severity === "critical" ? 1 : alert.severity === "warning" ? 0 : -1;

    const params: Record<string, string> = {
      token: this.config.apiToken,
      user: this.config.userKey,
      title: alert.title,
      message: alert.body,
      priority: String(priority),
      timestamp: String(Math.floor(new Date(alert.timestamp).getTime() / 1000)),
    };
    if (this.config.device) {
      params.device = this.config.device;
    }

    try {
      const response = await fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });

      const data = await response.json() as { status: number; errors?: string[] };
      const ok = data.status === 1;

      return {
        provider: this.name,
        success: ok,
        error: ok ? undefined : (data.errors?.join(", ") ?? `HTTP ${response.status}`),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        provider: this.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  async test(): Promise<boolean> {
    try {
      const result = await this.send({
        severity: "info",
        title: "Aegis Alert Test",
        body: "This is a test alert from OpenClaw Aegis.",
        timestamp: new Date().toISOString(),
      });
      return result.success;
    } catch {
      return false;
    }
  }
}

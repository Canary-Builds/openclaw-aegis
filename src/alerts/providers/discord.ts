import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
}

export class DiscordProvider implements AlertProvider {
  readonly name = "discord";
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const color = alert.severity === "critical" ? 0xED4245 : alert.severity === "warning" ? 0xFEE75C : 0x57F287;

    const payload: Record<string, unknown> = {
      embeds: [{
        title: alert.title,
        description: alert.body,
        color,
        timestamp: alert.timestamp,
        footer: { text: "OpenClaw Aegis" },
      }],
    };
    if (this.config.username) {
      payload.username = this.config.username;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const ok = response.status === 204 || response.ok;
      return {
        provider: this.name,
        success: ok,
        error: ok ? undefined : `HTTP ${response.status}`,
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

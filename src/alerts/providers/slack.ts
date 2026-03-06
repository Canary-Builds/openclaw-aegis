import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface SlackConfig {
  webhookUrl: string;
  channel?: string;
}

export class SlackProvider implements AlertProvider {
  readonly name = "slack";
  private readonly config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const icon = alert.severity === "critical" ? ":rotating_light:" : alert.severity === "warning" ? ":warning:" : ":information_source:";

    const payload: Record<string, unknown> = {
      text: `${icon} *${alert.title}*\n\n${alert.body}`,
    };
    if (this.config.channel) {
      payload.channel = this.config.channel;
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const ok = response.ok;
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

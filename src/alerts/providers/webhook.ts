import * as crypto from "node:crypto";
import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface WebhookConfig {
  url: string;
  secret?: string;
}

export class WebhookProvider implements AlertProvider {
  readonly name = "webhook";
  private readonly config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const body = JSON.stringify(alert);
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (this.config.secret) {
      const signature = crypto.createHmac("sha256", this.config.secret).update(body).digest("hex");
      headers["X-Aegis-Signature"] = `sha256=${signature}`;
    }

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers,
        body,
      });

      return {
        provider: this.name,
        success: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`,
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
        title: "Aegis Webhook Test",
        body: "This is a test alert from OpenClaw Aegis.",
        timestamp: new Date().toISOString(),
      });
      return result.success;
    } catch {
      return false;
    }
  }
}

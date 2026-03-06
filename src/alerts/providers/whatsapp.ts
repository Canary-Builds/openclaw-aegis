import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  recipientNumber: string;
}

/**
 * WhatsApp Business Cloud API provider.
 * Sends alerts directly via Meta's API — completely out-of-band from OpenClaw.
 */
export class WhatsAppProvider implements AlertProvider {
  readonly name = "whatsapp";
  private readonly config: WhatsAppConfig;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const url = `https://graph.facebook.com/v21.0/${this.config.phoneNumberId}/messages`;
    const icon = alert.severity === "critical" ? "\u{1F6A8}" : alert.severity === "warning" ? "\u{26A0}\u{FE0F}" : "\u{2139}\u{FE0F}";
    const text = `${icon} *${alert.title}*\n\n${alert.body}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: this.config.recipientNumber,
          type: "text",
          text: { body: text },
        }),
      });

      const data = await response.json() as { messages?: { id: string }[]; error?: { message: string } };
      const success = response.ok && !!data.messages?.length;

      return {
        provider: this.name,
        success,
        error: success ? undefined : (data.error?.message ?? `HTTP ${response.status}`),
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

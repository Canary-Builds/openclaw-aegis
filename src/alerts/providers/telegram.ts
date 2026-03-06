import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramProvider implements AlertProvider {
  readonly name = "telegram";
  private readonly config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const icon =
      alert.severity === "critical"
        ? "\u{1F6A8}"
        : alert.severity === "warning"
          ? "\u{26A0}\u{FE0F}"
          : "\u{2139}\u{FE0F}";
    const text = `${icon} *${escapeMarkdown(alert.title)}*\n\n${escapeMarkdown(alert.body)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: "MarkdownV2",
        }),
      });

      const data = (await response.json()) as { ok: boolean; description?: string };

      return {
        provider: this.name,
        success: data.ok,
        error: data.ok ? undefined : data.description,
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

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

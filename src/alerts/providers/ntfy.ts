import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface NtfyConfig {
  url: string;
  topic: string;
  priority: number;
}

export class NtfyProvider implements AlertProvider {
  readonly name = "ntfy";
  private readonly config: NtfyConfig;

  constructor(config: NtfyConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const url = `${this.config.url}/${this.config.topic}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Title: alert.title,
          Priority: String(this.config.priority),
          Tags: alertSeverityToTag(alert.severity),
        },
        body: alert.body,
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

function alertSeverityToTag(severity: string): string {
  switch (severity) {
    case "critical":
      return "rotating_light";
    case "warning":
      return "warning";
    default:
      return "information_source";
  }
}

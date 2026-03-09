import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  event: string;
  message?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured JSON logger.
 * Writes one JSON object per line (JSONL) — compatible with Loki, ELK, Datadog, etc.
 */
export class StructuredLogger {
  private stream: fs.WriteStream | null = null;
  private readonly minLevel: number;

  constructor(
    logPath: string | null,
    minLevelName: LogLevel = "info",
    private readonly stdout: boolean = true,
  ) {
    this.minLevel = LOG_LEVEL_PRIORITY[minLevelName];

    if (logPath) {
      const dir = path.dirname(logPath);
      fs.mkdirSync(dir, { recursive: true });
      this.stream = fs.createWriteStream(logPath, { flags: "a", mode: 0o600 });
    }
  }

  log(level: LogLevel, component: string, event: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) return;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      event,
      ...data,
    };

    const line = JSON.stringify(entry);

    if (this.stream) {
      this.stream.write(line + "\n");
    }

    if (this.stdout) {
      if (level === "error") {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
    }
  }

  debug(component: string, event: string, data?: Record<string, unknown>): void {
    this.log("debug", component, event, data);
  }

  info(component: string, event: string, data?: Record<string, unknown>): void {
    this.log("info", component, event, data);
  }

  warn(component: string, event: string, data?: Record<string, unknown>): void {
    this.log("warn", component, event, data);
  }

  error(component: string, event: string, data?: Record<string, unknown>): void {
    this.log("error", component, event, data);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

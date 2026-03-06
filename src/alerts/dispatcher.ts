import type { AlertPayload, AlertProvider, AlertResult } from "../types/index.js";

export interface DispatchResult {
  sent: boolean;
  results: AlertResult[];
  allFailed: boolean;
}

export class AlertDispatcher {
  private readonly providers: AlertProvider[] = [];
  private readonly retryBackoffMs: number[];
  private readonly retryAttempts: number;

  constructor(retryAttempts: number = 3, retryBackoffMs: number[] = [5000, 15000, 45000]) {
    this.retryAttempts = retryAttempts;
    this.retryBackoffMs = retryBackoffMs;
  }

  addProvider(provider: AlertProvider): void {
    this.providers.push(provider);
  }

  getProviders(): AlertProvider[] {
    return [...this.providers];
  }

  hasProviders(): boolean {
    return this.providers.length > 0;
  }

  async dispatch(alert: AlertPayload): Promise<DispatchResult> {
    if (this.providers.length === 0) {
      return { sent: false, results: [], allFailed: true };
    }

    const scrubbed = scrubSensitiveData(alert);
    const results: AlertResult[] = [];

    for (const provider of this.providers) {
      const result = await this.sendWithRetry(provider, scrubbed);
      results.push(result);
    }

    const anySuccess = results.some((r) => r.success);
    return { sent: anySuccess, results, allFailed: !anySuccess };
  }

  async testAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const provider of this.providers) {
      try {
        const ok = await provider.test();
        results.set(provider.name, ok);
      } catch {
        results.set(provider.name, false);
      }
    }
    return results;
  }

  private async sendWithRetry(provider: AlertProvider, alert: AlertPayload): Promise<AlertResult> {
    let lastResult: AlertResult = {
      provider: provider.name,
      success: false,
      error: "No attempts made",
      durationMs: 0,
    };

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        lastResult = await provider.send(alert);
        if (lastResult.success) return lastResult;
      } catch (err) {
        lastResult = {
          provider: provider.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        };
      }

      if (attempt < this.retryAttempts) {
        const delay = this.retryBackoffMs[attempt] ?? this.retryBackoffMs[this.retryBackoffMs.length - 1] ?? 5000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return lastResult;
  }
}

export function scrubSensitiveData(alert: AlertPayload): AlertPayload {
  return {
    ...alert,
    body: scrubString(alert.body),
    title: scrubString(alert.title),
  };
}

function scrubString(input: string): string {
  return input.replace(
    /("[^"]*(?:key|secret|token|password|credential|auth)[^"]*"\s*:\s*)"[^"]*"/gi,
    '$1"[REDACTED]"',
  );
}
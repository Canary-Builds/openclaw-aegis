import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HealthScore, RecoveryAction } from "../types/index.js";

const execFileAsync = promisify(execFile);

export interface RunbookStep {
  run?: string;
  wait?: string;
  log?: string;
}

export interface RunbookTrigger {
  probe?: string;
  band?: string;
  message_contains?: string;
}

export interface RunbookDefinition {
  name: string;
  description?: string;
  trigger: RunbookTrigger;
  steps: RunbookStep[];
  escalate_if_fails?: boolean;
  timeout_ms?: number;
  enabled?: boolean;
}

export interface RunbookResult {
  runbook: string;
  triggered: boolean;
  steps: { step: RunbookStep; result: "success" | "failure" | "skipped"; output?: string; durationMs: number }[];
  success: boolean;
  durationMs: number;
}

export class RunbookEngine {
  private runbooks: RunbookDefinition[] = [];
  private readonly basePath: string;
  private lastResults: RunbookResult[] = [];

  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(basePath, { recursive: true });
    this.loadRunbooks();
  }

  /** Load all YAML/JSON runbook files from basePath */
  loadRunbooks(): void {
    this.runbooks = [];

    if (!fs.existsSync(this.basePath)) return;

    const files = fs.readdirSync(this.basePath).filter(
      (f) => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    for (const file of files) {
      try {
        const fullPath = path.join(this.basePath, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const def = this.parseRunbook(content, file);
        if (def) this.runbooks.push(def);
      } catch {
        // Skip invalid files
      }
    }
  }

  /** Evaluate triggers against current health score and execute matching runbooks */
  async evaluate(score: HealthScore): Promise<RunbookResult[]> {
    const results: RunbookResult[] = [];

    for (const runbook of this.runbooks) {
      if (runbook.enabled === false) continue;

      const triggered = this.matchesTrigger(runbook.trigger, score);
      if (!triggered) continue;

      const result = await this.executeRunbook(runbook);
      results.push(result);
    }

    this.lastResults = results;
    return results;
  }

  /** Execute a specific runbook by name */
  async executeByName(name: string): Promise<RunbookResult | null> {
    const runbook = this.runbooks.find((r) => r.name === name);
    if (!runbook) return null;
    return this.executeRunbook(runbook);
  }

  /** Get all loaded runbook definitions */
  getRunbooks(): RunbookDefinition[] {
    return [...this.runbooks];
  }

  /** Get results from last evaluation */
  getLastResults(): RunbookResult[] {
    return [...this.lastResults];
  }

  /** Convert runbook results to recovery actions for incident logging */
  toRecoveryActions(results: RunbookResult[]): RecoveryAction[] {
    return results.map((r) => ({
      level: "L2" as const,
      action: `runbook:${r.runbook}`,
      result: r.success ? "success" as const : "failure" as const,
      durationMs: r.durationMs,
    }));
  }

  private matchesTrigger(trigger: RunbookTrigger, score: HealthScore): boolean {
    // Band trigger
    if (trigger.band && score.band !== trigger.band) return false;

    // Probe trigger
    if (trigger.probe) {
      const probe = score.probeResults.find((p) => p.name === trigger.probe);
      if (!probe || probe.healthy) return false; // Probe must be failing
    }

    // Message contains trigger
    if (trigger.message_contains) {
      const pattern = trigger.message_contains.toLowerCase();
      const hasMatch = score.probeResults.some(
        (p) => p.message && p.message.toLowerCase().includes(pattern),
      );
      if (!hasMatch) return false;
    }

    // At least one trigger condition must be specified
    return !!(trigger.band || trigger.probe || trigger.message_contains);
  }

  private async executeRunbook(runbook: RunbookDefinition): Promise<RunbookResult> {
    const start = Date.now();
    const stepResults: RunbookResult["steps"] = [];
    let allSuccess = true;
    const timeoutMs = runbook.timeout_ms ?? 60000;

    for (const step of runbook.steps) {
      const stepStart = Date.now();

      if (Date.now() - start > timeoutMs) {
        stepResults.push({ step, result: "skipped", durationMs: 0 });
        allSuccess = false;
        continue;
      }

      try {
        if (step.run) {
          const { stdout } = await execFileAsync("sh", ["-c", step.run], {
            timeout: Math.min(30000, timeoutMs - (Date.now() - start)),
          });
          stepResults.push({
            step,
            result: "success",
            output: stdout.trim().slice(0, 500),
            durationMs: Date.now() - stepStart,
          });
        } else if (step.wait) {
          const waitMs = parseDuration(step.wait);
          await sleep(waitMs);
          stepResults.push({ step, result: "success", durationMs: Date.now() - stepStart });
        } else if (step.log) {
          stepResults.push({ step, result: "success", output: step.log, durationMs: 0 });
        } else {
          stepResults.push({ step, result: "skipped", durationMs: 0 });
        }
      } catch (err) {
        allSuccess = false;
        stepResults.push({
          step,
          result: "failure",
          output: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
          durationMs: Date.now() - stepStart,
        });

        // Stop on first failure
        break;
      }
    }

    return {
      runbook: runbook.name,
      triggered: true,
      steps: stepResults,
      success: allSuccess,
      durationMs: Date.now() - start,
    };
  }

  private parseRunbook(content: string, filename: string): RunbookDefinition | null {
    if (filename.endsWith(".json")) {
      const parsed = JSON.parse(content) as RunbookDefinition;
      return this.validateRunbook(parsed);
    }

    // Simple YAML parser for runbook format (no external dependency)
    const def = this.parseSimpleYaml(content);
    return this.validateRunbook(def);
  }

  private validateRunbook(def: unknown): RunbookDefinition | null {
    if (!def || typeof def !== "object") return null;
    const d = def as Record<string, unknown>;

    if (typeof d.name !== "string" || !d.name) return null;
    if (!d.trigger || typeof d.trigger !== "object") return null;
    if (!Array.isArray(d.steps) || d.steps.length === 0) return null;

    return {
      name: d.name as string,
      description: typeof d.description === "string" ? d.description : undefined,
      trigger: d.trigger as RunbookTrigger,
      steps: d.steps as RunbookStep[],
      escalate_if_fails: d.escalate_if_fails === true,
      timeout_ms: typeof d.timeout_ms === "number" ? d.timeout_ms : undefined,
      enabled: d.enabled !== false,
    };
  }

  /** Minimal YAML-like parser for runbook definitions (handles flat keys, lists, nested objects) */
  private parseSimpleYaml(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = content.split("\n");
    let currentKey = "";
    let currentList: Record<string, unknown>[] | null = null;
    let currentItem: Record<string, unknown> | null = null;

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim().startsWith("#") || line.trim() === "") continue;

      // Top-level key
      const topMatch = line.match(/^(\w[\w_]*):\s*(.*)$/);
      if (topMatch) {
        if (currentList && currentKey) {
          if (currentItem) currentList.push(currentItem);
          result[currentKey] = currentList;
        }
        currentKey = topMatch[1];
        const value = topMatch[2].trim();
        if (value) {
          result[currentKey] = this.parseYamlValue(value);
          currentList = null;
          currentItem = null;
        } else {
          currentList = null;
          currentItem = null;
        }
        continue;
      }

      // Nested key (2-space indent)
      const nestedMatch = line.match(/^  (\w[\w_]*):\s*(.*)$/);
      if (nestedMatch) {
        if (!result[currentKey] || typeof result[currentKey] !== "object" || Array.isArray(result[currentKey])) {
          result[currentKey] = {};
        }
        (result[currentKey] as Record<string, unknown>)[nestedMatch[1]] = this.parseYamlValue(nestedMatch[2].trim());
        continue;
      }

      // List item with object
      const listItemMatch = line.match(/^  - (\w[\w_]*):\s*(.*)$/);
      if (listItemMatch) {
        if (!currentList) currentList = [];
        if (currentItem) currentList.push(currentItem);
        currentItem = { [listItemMatch[1]]: this.parseYamlValue(listItemMatch[2].trim()) };
        continue;
      }

      // List item continuation (4-space indent)
      const contMatch = line.match(/^    (\w[\w_]*):\s*(.*)$/);
      if (contMatch && currentItem) {
        currentItem[contMatch[1]] = this.parseYamlValue(contMatch[2].trim());
        continue;
      }
    }

    if (currentList && currentKey) {
      if (currentItem) currentList.push(currentItem);
      result[currentKey] = currentList;
    }

    return result;
  }

  private parseYamlValue(val: string): unknown {
    if (val === "true") return true;
    if (val === "false") return false;
    if (val === "null" || val === "~") return null;
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1);
    }
    return val;
  }
}

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return parseInt(input, 10) || 5000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms": return value;
    case "s": return value * 1000;
    case "m": return value * 60000;
    case "h": return value * 3600000;
    default: return 5000;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

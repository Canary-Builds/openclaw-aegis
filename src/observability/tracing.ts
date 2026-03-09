import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "ok" | "error";
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes?: Record<string, string | number | boolean>;
}

interface ActiveSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  startTimeMs: number;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

/**
 * Recovery action tracer.
 * Records structured spans for every recovery step — compatible with
 * OpenTelemetry JSON format for import into Jaeger, Tempo, etc.
 *
 * Each recovery cycle gets a unique traceId. Individual steps (L1 attempt,
 * L2 diagnosis, L3 repair) become spans within that trace.
 */
export class RecoveryTracer {
  private readonly filePath: string;
  private readonly activeSpans: Map<string, ActiveSpan> = new Map();
  private readonly completedTraces: Span[][] = [];
  private readonly maxTraces: number;

  constructor(basePath: string, maxTraces: number = 100) {
    fs.mkdirSync(basePath, { recursive: true });
    this.filePath = path.join(basePath, "traces.jsonl");
    this.maxTraces = maxTraces;
  }

  /** Start a new trace (recovery cycle) */
  startTrace(operationName: string): string {
    const traceId = crypto.randomBytes(16).toString("hex");
    const spanId = crypto.randomBytes(8).toString("hex");

    this.activeSpans.set(traceId, {
      traceId,
      spanId,
      parentSpanId: null,
      operationName,
      startTimeMs: Date.now(),
      attributes: {},
      events: [],
    });

    return traceId;
  }

  /** Start a child span within a trace */
  startSpan(traceId: string, operationName: string, attributes?: Record<string, string | number | boolean>): string {
    const parentSpan = this.activeSpans.get(traceId);
    const spanId = crypto.randomBytes(8).toString("hex");

    this.activeSpans.set(spanId, {
      traceId,
      spanId,
      parentSpanId: parentSpan?.spanId ?? null,
      operationName,
      startTimeMs: Date.now(),
      attributes: attributes ?? {},
      events: [],
    });

    return spanId;
  }

  /** Add an event to an active span */
  addEvent(spanId: string, name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.events.push({
      name,
      timestampMs: Date.now(),
      attributes,
    });
  }

  /** Set attributes on an active span */
  setAttributes(spanId: string, attributes: Record<string, string | number | boolean>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    Object.assign(span.attributes, attributes);
  }

  /** End a span */
  endSpan(spanId: string, status: "ok" | "error" = "ok"): Span | null {
    const active = this.activeSpans.get(spanId);
    if (!active) return null;

    this.activeSpans.delete(spanId);
    const now = Date.now();

    const span: Span = {
      traceId: active.traceId,
      spanId: active.spanId,
      parentSpanId: active.parentSpanId,
      operationName: active.operationName,
      serviceName: "aegis",
      startTimeMs: active.startTimeMs,
      endTimeMs: now,
      durationMs: now - active.startTimeMs,
      status,
      attributes: active.attributes,
      events: active.events,
    };

    // Persist
    fs.appendFileSync(this.filePath, JSON.stringify(span) + "\n", { mode: 0o600 });

    return span;
  }

  /** End a trace (the root span) and all remaining child spans */
  endTrace(traceId: string, status: "ok" | "error" = "ok"): Span[] {
    const spans: Span[] = [];

    // End all child spans first
    for (const [id, active] of this.activeSpans) {
      if (active.traceId === traceId && id !== traceId) {
        const span = this.endSpan(id, status);
        if (span) spans.push(span);
      }
    }

    // End root span
    const rootSpan = this.endSpan(traceId, status);
    if (rootSpan) spans.push(rootSpan);

    // Cache completed trace
    if (spans.length > 0) {
      this.completedTraces.push(spans);
      if (this.completedTraces.length > this.maxTraces) {
        this.completedTraces.shift();
      }
    }

    return spans;
  }

  /** Get recent completed traces */
  getRecentTraces(count: number = 20): Span[][] {
    return this.completedTraces.slice(-count);
  }

  /** Get all spans for a specific trace ID from disk */
  getTrace(traceId: string): Span[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      return fs
        .readFileSync(this.filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Span)
        .filter((span) => span.traceId === traceId);
    } catch {
      return [];
    }
  }
}

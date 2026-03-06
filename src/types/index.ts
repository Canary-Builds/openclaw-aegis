export interface HealthProbeResult {
  name: string;
  healthy: boolean;
  score: number;
  message?: string;
  latencyMs: number;
}

export type ProbeTarget = { type: "local" } | { type: "remote"; host: string; port: number };

export interface RecoveryAction {
  level: "L1" | "L2" | "L4";
  action: string;
  result: "success" | "failure" | "skipped";
  durationMs: number;
}

export interface IncidentEvent {
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
  checksum: string;
}

export type HealthBand = "healthy" | "degraded" | "critical";

export interface HealthScore {
  total: number;
  band: HealthBand;
  probeResults: HealthProbeResult[];
}

export interface BackupEntry {
  path: string;
  timestamp: string;
  checksum: string;
}

export interface KnownGoodEntry extends BackupEntry {
  promotedAt: string;
}

export interface AlertPayload {
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  timestamp: string;
  incidentId?: string;
  recoveryActions?: RecoveryAction[];
  healthScore?: HealthScore;
}

export interface AlertResult {
  provider: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface AlertProvider {
  name: string;
  send(alert: AlertPayload): Promise<AlertResult>;
  test(): Promise<boolean>;
}

export interface PlatformAdapter {
  name: string;
  install(config: PlatformInstallConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<PlatformServiceStatus>;
  notifyWatchdog(): Promise<void>;
}

export interface PlatformInstallConfig {
  serviceName: string;
  execPath: string;
  workingDirectory: string;
  user: string;
  watchdogSec: number;
  readWritePaths: string[];
}

export type PlatformServiceStatus = "running" | "stopped" | "failed" | "unknown";

export interface FailurePattern {
  id: number;
  name: string;
  detect(context: DiagnosisContext): Promise<boolean>;
  fix(context: DiagnosisContext): Promise<RecoveryAction>;
}

export interface DiagnosisContext {
  configPath: string;
  pidFile: string;
  gatewayPort: number;
  logPath: string;
  knownGoodPath?: string;
  currentConfig: Record<string, unknown> | null;
}

export const PROBE_WEIGHTS: Record<string, number> = {
  process: 2,
  port: 2,
  http: 2,
  config: 2,
  websocket: 1,
  tun: 1,
  memory: 1,
  cpu: 1,
  disk: 1,
  logTail: 1,
};

export const MAX_HEALTH_SCORE = Object.values(PROBE_WEIGHTS).reduce((a, b) => a + b, 0) * 2;

export const PROTECTED_CONFIG_KEYS = [
  "allowFrom",
  "groupAllowFrom",
  "authToken",
  "token",
  "webhookUrl",
  "apiKey",
] as const;

export const CRITICAL_CONFIG_KEYS = [
  "gateway.port",
  "authToken",
  "token",
  "autoAck",
  "autoAckMessage",
  "allowFrom",
  "groupAllowFrom",
] as const;

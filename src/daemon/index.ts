import type { HealthScore, AlertPayload } from "../types/index.js";
import type { AegisConfig } from "../config/schema.js";
import { HealthMonitor } from "../health/monitor.js";
import { BackupManager } from "../backup/manager.js";
import { DeadManSwitch } from "../config-guardian/dead-man-switch.js";
import { startupConfigValidation } from "../config-guardian/guardian.js";
import { ConfigChangeDetector } from "../config/detector.js";
import { DiagnosisEngine } from "../diagnosis/engine.js";
import { RecoveryOrchestrator } from "../recovery/orchestrator.js";
import { AlertDispatcher } from "../alerts/dispatcher.js";
import { IncidentLogger } from "../incidents/logger.js";
import { SystemdAdapter } from "../platform/systemd.js";
import { NtfyProvider } from "../alerts/providers/ntfy.js";
import { WebhookProvider } from "../alerts/providers/webhook.js";
import { TelegramProvider } from "../alerts/providers/telegram.js";
import { expandHome } from "../config/loader.js";

export class AegisDaemon {
  private readonly config: AegisConfig;
  private readonly monitor: HealthMonitor;
  private readonly backupManager: BackupManager;
  private readonly deadManSwitch: DeadManSwitch;
  private readonly configDetector: ConfigChangeDetector;
  private readonly diagnosisEngine: DiagnosisEngine;
  private readonly orchestrator: RecoveryOrchestrator;
  private readonly alertDispatcher: AlertDispatcher;
  private readonly incidentLogger: IncidentLogger;
  private readonly platformAdapter: SystemdAdapter;
  private knownGoodTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: AegisConfig) {
    this.config = config;
    this.monitor = new HealthMonitor(config);
    this.backupManager = new BackupManager(config);
    this.deadManSwitch = new DeadManSwitch(config, this.backupManager);
    this.configDetector = new ConfigChangeDetector(
      config.gateway.configPath,
      config.monitoring.configPollIntervalMs,
    );
    this.diagnosisEngine = new DiagnosisEngine(this.backupManager);
    this.orchestrator = new RecoveryOrchestrator(config, this.diagnosisEngine, this.backupManager);
    this.alertDispatcher = new AlertDispatcher(
      config.alerts.retryAttempts,
      config.alerts.retryBackoffMs,
    );
    this.incidentLogger = new IncidentLogger(expandHome("~/.openclaw/aegis/incidents"));
    this.platformAdapter = new SystemdAdapter();

    this.setupAlertProviders();
    this.wireEvents();
  }

  async start(): Promise<void> {
    this.backupManager.init();

    startupConfigValidation(this.config, this.backupManager);

    if (!this.alertDispatcher.hasProviders()) {
      console.error(
        "WARNING: No alert channels configured. Aegis cannot notify you during incidents. Run 'aegis init' to add alerts.",
      );
    }

    this.configDetector.start();
    this.monitor.start();
    this.platformAdapter.startWatchdogHeartbeat();
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.monitor.stop();
    this.configDetector.stop();
    this.deadManSwitch.destroy();
    this.platformAdapter.stopWatchdogHeartbeat();
    if (this.knownGoodTimer) {
      clearTimeout(this.knownGoodTimer);
      this.knownGoodTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getMonitor(): HealthMonitor {
    return this.monitor;
  }

  getBackupManager(): BackupManager {
    return this.backupManager;
  }

  getAlertDispatcher(): AlertDispatcher {
    return this.alertDispatcher;
  }

  getIncidentLogger(): IncidentLogger {
    return this.incidentLogger;
  }

  getOrchestrator(): RecoveryOrchestrator {
    return this.orchestrator;
  }

  getDeadManSwitch(): DeadManSwitch {
    return this.deadManSwitch;
  }

  private setupAlertProviders(): void {
    for (const channel of this.config.alerts.channels) {
      switch (channel.type) {
        case "ntfy":
          this.alertDispatcher.addProvider(
            new NtfyProvider({ url: channel.url, topic: channel.topic, priority: channel.priority }),
          );
          break;
        case "webhook":
          this.alertDispatcher.addProvider(
            new WebhookProvider({ url: channel.url, secret: channel.secret }),
          );
          break;
        case "telegram":
          this.alertDispatcher.addProvider(
            new TelegramProvider({ botToken: channel.botToken, chatId: channel.chatId }),
          );
          break;
      }
    }
  }

  private wireEvents(): void {
    this.configDetector.on("change", () => {
      if (this.config.deadManSwitch.enabled) {
        this.deadManSwitch.onConfigChange();
      }
    });

    this.configDetector.on("storm", (data: { count: number; windowMs: number }) => {
      this.incidentLogger.log("CONFIG_WRITE_STORM", data);
    });

    this.monitor.on("escalate", (score: HealthScore) => {
      this.deadManSwitch.onUnhealthy();
      void this.handleEscalation(score);
    });

    this.monitor.on("check", (score: HealthScore) => {
      if (score.band === "healthy") {
        this.deadManSwitch.onHealthy();
        this.scheduleKnownGoodPromotion();
      } else {
        this.cancelKnownGoodPromotion();
      }
    });

    this.orchestrator.on("recovery", (event: Record<string, unknown>) => {
      this.incidentLogger.log(String(event["type"] ?? "RECOVERY_EVENT"), event);
    });

    this.deadManSwitch.on("rolled-back", () => {
      this.incidentLogger.log("DEAD_MAN_SWITCH_ROLLBACK", {});
    });

    this.deadManSwitch.on("countdown-started", (ms: number) => {
      this.incidentLogger.log("DEAD_MAN_SWITCH_COUNTDOWN", { countdownMs: ms });
    });
  }

  private async handleEscalation(score: HealthScore): Promise<void> {
    this.incidentLogger.startIncident();
    this.incidentLogger.log("INCIDENT_START", { score: score.total, band: score.band });

    const actions = await this.orchestrator.recover(score);

    const anySuccess = actions.some((a) => a.result === "success");
    if (anySuccess) {
      this.incidentLogger.log("INCIDENT_RESOLVED", { actions });
      this.incidentLogger.endIncident();
    } else {
      const alert: AlertPayload = {
        severity: "critical",
        title: "OpenClaw Gateway Recovery Failed",
        body: `Aegis could not restore the gateway. Health score: ${score.total}/10 (${score.band}). Recovery actions: ${actions.map((a) => `${a.level}/${a.action}:${a.result}`).join(", ")}`,
        timestamp: new Date().toISOString(),
        recoveryActions: actions,
        healthScore: score,
      };

      const dispatchResult = await this.alertDispatcher.dispatch(alert);

      if (!this.alertDispatcher.hasProviders() || dispatchResult.allFailed) {
        this.incidentLogger.log("L4_ALERT_FAILED", {
          reason: !this.alertDispatcher.hasProviders()
            ? "No alert channels configured"
            : "All alert channels failed",
          results: dispatchResult.results,
        });
        console.error(
          "L4 escalation triggered but no alert channels configured -- entering monitoring-only mode. Human notification FAILED.",
        );
      }

      this.incidentLogger.log("INCIDENT_UNRESOLVED", { actions });
      this.incidentLogger.endIncident();
    }
  }

  private scheduleKnownGoodPromotion(): void {
    if (this.knownGoodTimer) return;
    this.knownGoodTimer = setTimeout(() => {
      this.backupManager.promoteToKnownGood();
      this.knownGoodTimer = null;
    }, this.backupManager.getKnownGoodStabilityMs());
  }

  private cancelKnownGoodPromotion(): void {
    if (this.knownGoodTimer) {
      clearTimeout(this.knownGoodTimer);
      this.knownGoodTimer = null;
    }
  }
}

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
import { MetricsCollector } from "../observability/metrics.js";
import { StructuredLogger } from "../observability/logger.js";
import { HealthHistory } from "../observability/health-history.js";
import { SlaTracker } from "../observability/sla.js";
import { RecoveryTracer } from "../observability/tracing.js";
import { AnomalyDetector } from "../intelligence/anomaly.js";
import { PredictiveAlerter } from "../intelligence/predictive.js";

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
  private readonly metrics: MetricsCollector;
  private readonly logger: StructuredLogger;
  private readonly healthHistory: HealthHistory;
  private readonly slaTracker: SlaTracker;
  private readonly tracer: RecoveryTracer;
  private readonly anomalyDetector: AnomalyDetector;
  private readonly predictiveAlerter: PredictiveAlerter;
  private knownGoodTimer: NodeJS.Timeout | null = null;
  private predictiveCheckCount = 0;
  private running = false;
  private readonly startedAt = Date.now();

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

    // Observability
    const obs = config.observability;
    this.logger = new StructuredLogger(
      obs.logging.enabled ? expandHome(obs.logging.filePath) : null,
      obs.logging.level,
      obs.logging.stdout,
    );
    this.healthHistory = new HealthHistory(
      expandHome(obs.healthHistory.basePath),
      obs.healthHistory.maxEntries,
    );
    this.tracer = new RecoveryTracer(
      expandHome(obs.tracing.basePath),
      obs.tracing.maxTraces,
    );
    this.slaTracker = new SlaTracker(
      this.healthHistory,
      this.incidentLogger,
      config.monitoring.intervalMs,
    );
    // Intelligence
    const intel = config.intelligence;
    this.anomalyDetector = new AnomalyDetector(
      this.healthHistory,
      this.alertDispatcher,
      intel.anomaly.enabled ? {
        minBaseline: intel.anomaly.minBaseline,
        baselineWindowMs: intel.anomaly.baselineWindowMs,
        scoreDeviationThreshold: intel.anomaly.scoreDeviationThreshold,
        latencyDeviationThreshold: intel.anomaly.latencyDeviationThreshold,
        confirmationCount: intel.anomaly.confirmationCount,
        alertCooldownMs: intel.anomaly.alertCooldownMs,
      } : undefined,
    );

    this.predictiveAlerter = new PredictiveAlerter(
      this.healthHistory,
      {
        memoryMb: config.health.memoryThresholdMb,
        diskMb: config.health.diskThresholdMb,
        healthyMin: config.health.healthyMin,
      },
      this.alertDispatcher,
      intel.predictive.enabled ? {
        minDataPoints: intel.predictive.minDataPoints,
        trendWindowMs: intel.predictive.trendWindowMs,
        warningHorizonMs: intel.predictive.warningHorizonMs,
        alertCooldownMs: intel.predictive.alertCooldownMs,
      } : undefined,
    );

    this.metrics = new MetricsCollector({
      monitor: this.monitor,
      recovery: this.orchestrator,
      incidents: this.incidentLogger,
      alerts: this.alertDispatcher,
      startedAt: this.startedAt,
    });

    this.setupAlertProviders();
    this.wireEvents();
  }

  async start(): Promise<void> {
    this.backupManager.init();

    startupConfigValidation(this.config, this.backupManager);

    if (!this.alertDispatcher.hasProviders()) {
      this.logger.warn("alerts", "no_channels", {
        message: "No alert channels configured. Run 'aegis init' to add alerts.",
      });
    }

    this.configDetector.start();
    this.monitor.start();
    this.platformAdapter.startWatchdogHeartbeat();
    this.running = true;
    this.logger.info("daemon", "started", { port: this.config.gateway.port });
  }

  stop(): void {
    this.running = false;
    this.monitor.stop();
    this.configDetector.stop();
    this.deadManSwitch.destroy();
    this.platformAdapter.stopWatchdogHeartbeat();
    this.logger.close();
    if (this.knownGoodTimer) {
      clearTimeout(this.knownGoodTimer);
      this.knownGoodTimer = null;
    }
    this.logger.info("daemon", "stopped");
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

  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  getLogger(): StructuredLogger {
    return this.logger;
  }

  getHealthHistory(): HealthHistory {
    return this.healthHistory;
  }

  getSlaTracker(): SlaTracker {
    return this.slaTracker;
  }

  getTracer(): RecoveryTracer {
    return this.tracer;
  }

  getAnomalyDetector(): AnomalyDetector {
    return this.anomalyDetector;
  }

  getPredictiveAlerter(): PredictiveAlerter {
    return this.predictiveAlerter;
  }

  private setupAlertProviders(): void {
    for (const channel of this.config.alerts.channels) {
      switch (channel.type) {
        case "ntfy":
          this.alertDispatcher.addProvider(
            new NtfyProvider({
              url: channel.url,
              topic: channel.topic,
              priority: channel.priority,
            }),
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
      this.logger.info("config", "change_detected");
      if (this.config.deadManSwitch.enabled) {
        this.deadManSwitch.onConfigChange();
      }
    });

    this.configDetector.on("storm", (data: { count: number; windowMs: number }) => {
      this.logger.warn("config", "write_storm", data);
      this.incidentLogger.log("CONFIG_WRITE_STORM", data);
    });

    this.monitor.on("escalate", (score: HealthScore) => {
      this.logger.error("health", "escalation", {
        score: score.total,
        band: score.band,
        failedProbes: score.probeResults.filter((p) => !p.healthy).map((p) => p.name),
      });
      this.deadManSwitch.onUnhealthy();
      void this.handleEscalation(score);
    });

    this.monitor.on("check", (score: HealthScore) => {
      this.logger.debug("health", "check", {
        score: score.total,
        band: score.band,
      });

      // Record to health history
      if (this.config.observability.healthHistory.enabled) {
        this.healthHistory.record(score);
      }

      // Run anomaly detection
      if (this.config.intelligence.anomaly.enabled) {
        const anomalies = this.anomalyDetector.analyze();
        if (anomalies.length > 0) {
          this.logger.warn("intelligence", "anomalies_detected", {
            count: anomalies.length,
            types: anomalies.map((a) => a.type),
          });
        }
      }

      // Run predictive analysis (every 10th check to save CPU)
      this.predictiveCheckCount = (this.predictiveCheckCount ?? 0) + 1;
      if (this.config.intelligence.predictive.enabled && this.predictiveCheckCount % 10 === 0) {
        const predictions = this.predictiveAlerter.analyze();
        if (predictions.length > 0) {
          this.logger.warn("intelligence", "predictions_generated", {
            count: predictions.length,
            types: predictions.map((p) => p.type),
          });
        }
      }

      if (score.band === "healthy") {
        this.deadManSwitch.onHealthy();
        this.scheduleKnownGoodPromotion();
      } else {
        this.cancelKnownGoodPromotion();
      }
    });

    this.orchestrator.on("recovery", (event: Record<string, unknown>) => {
      const type = String(event["type"] ?? "RECOVERY_EVENT");
      this.logger.info("recovery", type.toLowerCase(), event);
      this.incidentLogger.log(type, event);
    });

    this.deadManSwitch.on("rolled-back", () => {
      this.logger.warn("config-guardian", "dead_man_switch_rollback");
      this.incidentLogger.log("DEAD_MAN_SWITCH_ROLLBACK", {});
    });

    this.deadManSwitch.on("countdown-started", (ms: number) => {
      this.logger.info("config-guardian", "dead_man_switch_countdown", { countdownMs: ms });
      this.incidentLogger.log("DEAD_MAN_SWITCH_COUNTDOWN", { countdownMs: ms });
    });
  }

  private async handleEscalation(score: HealthScore): Promise<void> {
    this.incidentLogger.startIncident();
    this.incidentLogger.log("INCIDENT_START", { score: score.total, band: score.band });

    // Start recovery trace
    let traceId: string | undefined;
    if (this.config.observability.tracing.enabled) {
      traceId = this.tracer.startTrace("recovery-cycle");
      this.tracer.setAttributes(traceId, {
        "health.score": score.total,
        "health.band": score.band,
      });
    }

    const actions = await this.orchestrator.recover(score);

    // Record spans for each recovery action
    if (traceId && this.config.observability.tracing.enabled) {
      for (const action of actions) {
        const spanId = this.tracer.startSpan(traceId, `${action.level}/${action.action}`, {
          "recovery.level": action.level,
          "recovery.action": action.action,
          "recovery.result": action.result,
          "recovery.duration_ms": action.durationMs,
        });
        this.tracer.endSpan(spanId, action.result === "success" ? "ok" : "error");
      }
    }

    const anySuccess = actions.some((a) => a.result === "success");
    if (anySuccess) {
      this.logger.info("recovery", "incident_resolved", {
        actions: actions.map((a) => `${a.level}/${a.action}:${a.result}`),
      });
      this.incidentLogger.log("INCIDENT_RESOLVED", { actions });
      this.incidentLogger.endIncident();
      if (traceId) this.tracer.endTrace(traceId, "ok");
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

      // Record alert results in metrics
      for (const r of dispatchResult.results) {
        this.metrics.recordAlertResult(r.provider, r.success);
      }

      if (!this.alertDispatcher.hasProviders() || dispatchResult.allFailed) {
        this.logger.error("alerts", "l4_alert_failed", {
          reason: !this.alertDispatcher.hasProviders()
            ? "No alert channels configured"
            : "All alert channels failed",
        });
        this.incidentLogger.log("L4_ALERT_FAILED", {
          reason: !this.alertDispatcher.hasProviders()
            ? "No alert channels configured"
            : "All alert channels failed",
          results: dispatchResult.results,
        });
      }

      this.incidentLogger.log("INCIDENT_UNRESOLVED", { actions });
      this.incidentLogger.endIncident();
      if (traceId) this.tracer.endTrace(traceId, "error");
    }
  }

  private scheduleKnownGoodPromotion(): void {
    if (this.knownGoodTimer) return;
    this.knownGoodTimer = setTimeout(() => {
      this.backupManager.promoteToKnownGood();
      this.logger.info("backup", "known_good_promoted");
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

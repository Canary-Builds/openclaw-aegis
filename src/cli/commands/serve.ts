import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_PATH, expandHome } from "../../config/loader.js";
import { HealthMonitor } from "../../health/monitor.js";
import { AegisApiServer } from "../../api/server.js";
import { BackupManager } from "../../backup/manager.js";
import { IncidentLogger } from "../../incidents/logger.js";
import { AlertDispatcher } from "../../alerts/dispatcher.js";
import { NtfyProvider } from "../../alerts/providers/ntfy.js";
import { TelegramProvider } from "../../alerts/providers/telegram.js";
import { WhatsAppProvider } from "../../alerts/providers/whatsapp.js";
import { WebhookProvider } from "../../alerts/providers/webhook.js";
import { SlackProvider } from "../../alerts/providers/slack.js";
import { DiscordProvider } from "../../alerts/providers/discord.js";
import { EmailProvider } from "../../alerts/providers/email.js";
import { PushoverProvider } from "../../alerts/providers/pushover.js";
import { DeadManSwitch } from "../../config-guardian/dead-man-switch.js";
import { RecoveryOrchestrator } from "../../recovery/orchestrator.js";
import { DiagnosisEngine } from "../../diagnosis/engine.js";
import { AnomalyDetector } from "../../intelligence/anomaly.js";
import { PredictiveAlerter } from "../../intelligence/predictive.js";
import { RootCauseAnalyzer } from "../../intelligence/rca.js";
import { RunbookEngine } from "../../intelligence/runbooks.js";
import { AlertNoiseReducer } from "../../intelligence/noise-reduction.js";
import { TelegramBotListener } from "../../bot/telegram.js";
import { WhatsAppBotListener } from "../../bot/whatsapp.js";
import { SlackBotListener } from "../../bot/slack.js";
import { DiscordBotListener } from "../../bot/discord.js";
import type { BotDeps } from "../../bot/commands.js";
import type { AlertPayload, HealthScore } from "../../types/index.js";
import { MaintenanceWindow } from "../../maintenance/windows.js";

export const serveCommand = new Command("serve")
  .description("Start the Aegis API server and bot listeners")
  .option("-c, --config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .option("-p, --port <port>", "API port (overrides config)")
  .option("--host <host>", "API host (overrides config)")
  .option("--bot", "Enable bot listeners (overrides config)")
  .action(async (opts: { config: string; port?: string; host?: string; bot?: boolean }) => {
    const configFile = expandHome(opts.config);
    const config = loadConfig(configFile);

    // Apply CLI overrides
    if (opts.port) config.api.port = parseInt(opts.port, 10);
    if (opts.host) config.api.host = opts.host;
    if (opts.bot) config.bot.enabled = true;

    const monitor = new HealthMonitor(config);
    const backupManager = new BackupManager(config);
    backupManager.init();
    const incidentLogger = new IncidentLogger(expandHome("~/.openclaw/aegis/incidents"));
    const alertDispatcher = new AlertDispatcher(
      config.alerts.retryAttempts,
      config.alerts.retryBackoffMs,
    );
    const deadManSwitch = new DeadManSwitch(config, backupManager);
    const diagnosisEngine = new DiagnosisEngine(backupManager);
    const recovery = new RecoveryOrchestrator(config, diagnosisEngine, backupManager);

    // Register alert providers from config
    for (const ch of config.alerts.channels) {
      switch (ch.type) {
        case "ntfy":
          alertDispatcher.addProvider(new NtfyProvider(ch));
          break;
        case "telegram":
          alertDispatcher.addProvider(new TelegramProvider(ch));
          break;
        case "whatsapp":
          alertDispatcher.addProvider(new WhatsAppProvider(ch));
          break;
        case "webhook":
          alertDispatcher.addProvider(new WebhookProvider(ch));
          break;
        case "slack":
          alertDispatcher.addProvider(new SlackProvider(ch));
          break;
        case "discord":
          alertDispatcher.addProvider(new DiscordProvider(ch));
          break;
        case "email":
          alertDispatcher.addProvider(new EmailProvider(ch));
          break;
        case "pushover":
          alertDispatcher.addProvider(new PushoverProvider(ch));
          break;
      }
    }

    // Wire monitor → recovery + alerts + incidents
    let escalationActive = false;
    monitor.on("escalate", async (score: HealthScore) => {
      if (escalationActive) return;
      escalationActive = true;
      try {
        const incidentId = incidentLogger.startIncident();
        console.log(
          `[aegis] ESCALATION: band=${score.band} score=${score.total} incident=${incidentId}`,
        );
        incidentLogger.log("escalation", {
          score: score.total,
          band: score.band,
          probes: score.probeResults,
        });

        const alert: AlertPayload = {
          severity: score.band === "critical" ? "critical" : "warning",
          title: `Gateway ${score.band.toUpperCase()}: health score ${score.total}`,
          body: `Aegis detected gateway health degradation.\nBand: ${score.band}\nScore: ${score.total}\nFailed probes: ${score.probeResults.filter((p) => !p.healthy).map((p) => p.name).join(", ") || "none"}`,
          timestamp: new Date().toISOString(),
          incidentId: incidentId ?? undefined,
          healthScore: score,
        };
        void alertDispatcher.dispatch(alert);

        const actions = await recovery.recover(score);
        incidentLogger.log("recovery_result", { actions });

        if (actions.some((a) => a.result === "success")) {
          console.log(`[aegis] Recovery succeeded after ${actions.length} action(s)`);
          incidentLogger.log("recovery_success", { actions });
          incidentLogger.endIncident();
        } else {
          console.log(`[aegis] Recovery FAILED — all ${actions.length} action(s) exhausted`);
          incidentLogger.log("recovery_failed", { actions });
          const failAlert: AlertPayload = {
            severity: "critical",
            title: "Gateway recovery FAILED — manual intervention required",
            body: `Aegis exhausted all recovery actions.\nActions attempted: ${actions.map((a) => `${a.level}/${a.action}=${a.result}`).join(", ")}`,
            timestamp: new Date().toISOString(),
            incidentId: incidentId ?? undefined,
            recoveryActions: actions,
          };
          void alertDispatcher.dispatch(failAlert);
        }
      } catch (err) {
        console.error(
          `[aegis] Escalation handler error: ${err instanceof Error ? err.message : String(err)}`,
        );
        incidentLogger.log("escalation_error", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        escalationActive = false;
      }
    });

    // Wire recovery events for logging
    recovery.on("recovery", (event: { type: string }) => {
      console.log(`[aegis] Recovery event: ${event.type}`);
      incidentLogger.log("recovery_event", event);
    });

    // Intelligence modules
    const intel = config.intelligence;
    const anomalyDetector = new AnomalyDetector(monitor, {
      minBaseline: intel.anomaly.minBaseline,
      baselineWindowMs: intel.anomaly.baselineWindowMs,
      scoreDeviationThreshold: intel.anomaly.scoreDeviationThreshold,
      latencyDeviationThreshold: intel.anomaly.latencyDeviationThreshold,
      confirmationCount: intel.anomaly.confirmationCount,
      alertCooldownMs: intel.anomaly.alertCooldownMs,
    });
    const predictiveAlerter = new PredictiveAlerter(monitor, {
      minDataPoints: intel.predictive.minDataPoints,
      trendWindowMs: intel.predictive.trendWindowMs,
      warningHorizonMs: intel.predictive.warningHorizonMs,
      alertCooldownMs: intel.predictive.alertCooldownMs,
    });
    const rootCauseAnalyzer = new RootCauseAnalyzer(monitor);
    const runbookEngine = intel.runbooks.enabled
      ? new RunbookEngine(expandHome(intel.runbooks.basePath))
      : undefined;
    const noiseReducer = intel.noiseReduction.enabled
      ? new AlertNoiseReducer(alertDispatcher, {
          groupingWindowMs: intel.noiseReduction.groupingWindowMs,
          dedupThreshold: intel.noiseReduction.dedupThreshold,
          escalationDelayMs: intel.noiseReduction.escalationDelayMs,
          maxBufferSize: intel.noiseReduction.maxBufferSize,
          digestIntervalMs: intel.noiseReduction.digestIntervalMs,
        })
      : undefined;

    const maintenanceWindow = config.maintenance.enabled
      ? new MaintenanceWindow({ maxDurationMs: config.maintenance.maxDurationMs })
      : undefined;

    const api = new AegisApiServer({
      config,
      monitor,
      recovery,
      backup: backupManager,
      incidents: incidentLogger,
      alerts: alertDispatcher,
      deadManSwitch,
      anomalyDetector,
      predictiveAlerter,
      rootCauseAnalyzer,
      runbookEngine,
      noiseReducer,
      maintenanceWindow,
    });

    // Start health monitoring in background
    monitor.start();

    const startedAt = Date.now();

    try {
      await api.start();
      const addr = api.getAddress();
      console.log(`Aegis API server listening on http://${addr.host}:${addr.port}`);
    } catch (err) {
      console.error(
        `Failed to start API server: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    // Start bot listeners
    const botStoppers: (() => void | Promise<void>)[] = [];

    if (config.bot.enabled) {
      const botDeps: BotDeps = {
        config,
        monitor,
        recovery,
        backup: backupManager,
        incidents: incidentLogger,
        alerts: alertDispatcher,
        deadManSwitch,
        startedAt,
      };

      // Telegram bot — reuses alert channel credentials
      if (config.bot.telegram.enabled) {
        const tgConfig = config.alerts.channels.find((ch) => ch.type === "telegram");
        if (tgConfig && tgConfig.type === "telegram") {
          const tg = new TelegramBotListener(tgConfig.botToken, tgConfig.chatId, botDeps);
          await tg.start();
          botStoppers.push(() => tg.stop());
          console.log("  Bot: Telegram listener active (polling)");
        } else {
          console.log("  Bot: Telegram enabled but no Telegram alert channel configured");
        }
      }

      // WhatsApp bot — webhook server
      if (config.bot.whatsapp.enabled) {
        const waConfig = config.alerts.channels.find((ch) => ch.type === "whatsapp");
        if (waConfig && waConfig.type === "whatsapp") {
          const wa = new WhatsAppBotListener(
            {
              phoneNumberId: waConfig.phoneNumberId,
              accessToken: waConfig.accessToken,
              recipientNumber: waConfig.recipientNumber,
              verifyToken: config.bot.whatsapp.verifyToken,
            },
            botDeps,
          );
          await wa.start(config.bot.whatsapp.webhookPort);
          botStoppers.push(() => wa.stop());
          console.log(`  Bot: WhatsApp webhook on port ${config.bot.whatsapp.webhookPort}`);
        } else {
          console.log("  Bot: WhatsApp enabled but no WhatsApp alert channel configured");
        }
      }

      // Slack bot — slash command server
      if (config.bot.slack.enabled) {
        const sl = new SlackBotListener({ signingSecret: config.bot.slack.signingSecret }, botDeps);
        await sl.start(config.bot.slack.webhookPort);
        botStoppers.push(() => sl.stop());
        console.log(`  Bot: Slack slash commands on port ${config.bot.slack.webhookPort}`);
      }

      // Discord bot — polling
      if (config.bot.discord.enabled) {
        const dcConfig = config.bot.discord;
        if (dcConfig.botToken && dcConfig.channelId) {
          const dc = new DiscordBotListener(
            { botToken: dcConfig.botToken, channelId: dcConfig.channelId },
            botDeps,
          );
          await dc.start();
          botStoppers.push(() => dc.stop());
          console.log("  Bot: Discord listener active (polling)");
        } else {
          console.log("  Bot: Discord enabled but botToken/channelId not configured");
        }
      }
    }

    console.log("");
    console.log("Press Ctrl+C to stop.");

    const shutdown = () => {
      console.log("\nShutting down...");
      monitor.stop();
      deadManSwitch.destroy();
      for (const stop of botStoppers) {
        void stop();
      }
      void api.stop().then(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_PATH, expandHome } from "../../config/loader.js";
import { HealthMonitor } from "../../health/monitor.js";
import { AegisApiServer } from "../../api/server.js";
import { BackupManager } from "../../backup/manager.js";
import { IncidentLogger } from "../../incidents/logger.js";
import { AlertDispatcher } from "../../alerts/dispatcher.js";
import { DeadManSwitch } from "../../config-guardian/dead-man-switch.js";
import { RecoveryOrchestrator } from "../../recovery/orchestrator.js";
import { DiagnosisEngine } from "../../diagnosis/engine.js";

export const serveCommand = new Command("serve")
  .description("Start the Aegis API server for dashboard integration")
  .option("-c, --config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .option("-p, --port <port>", "API port (overrides config)")
  .option("--host <host>", "API host (overrides config)")
  .action(async (opts: { config: string; port?: string; host?: string }) => {
    const configFile = expandHome(opts.config);
    const config = loadConfig(configFile);

    // Apply CLI overrides
    if (opts.port) config.api.port = parseInt(opts.port, 10);
    if (opts.host) config.api.host = opts.host;

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

    const api = new AegisApiServer({
      config,
      monitor,
      recovery,
      backup: backupManager,
      incidents: incidentLogger,
      alerts: alertDispatcher,
      deadManSwitch,
    });

    // Start health monitoring in background
    monitor.start();

    try {
      await api.start();
      const addr = api.getAddress();
      console.log(`Aegis API server listening on http://${addr.host}:${addr.port}`);
      console.log("");
      console.log("Endpoints:");
      console.log("  GET  /health              Health summary");
      console.log("  GET  /probes              All probe results");
      console.log("  GET  /probes/:name        Single probe detail");
      console.log("  GET  /incidents           Incident list");
      console.log("  GET  /incidents/stats     MTTR and statistics");
      console.log("  GET  /incidents/:id       Incident timeline");
      console.log("  GET  /recovery/status     Recovery state");
      console.log("  GET  /recovery/circuit-breaker");
      console.log("  GET  /recovery/anti-flap");
      console.log("  GET  /config              Current config (scrubbed)");
      console.log("  GET  /config/backups      Backup list");
      console.log("  GET  /config/guardian      Dead man's switch status");
      console.log("  GET  /alerts/channels     Alert channels (scrubbed)");
      console.log("  POST /alerts/test         Send test alert");
      console.log("  GET  /alerts/history      Recent alert deliveries");
      console.log("  GET  /version             Aegis version");
      console.log("  GET  /uptime              Server uptime");
      console.log("  GET  /platform            OS and runtime info");
      console.log("");
      console.log("Press Ctrl+C to stop.");
    } catch (err) {
      console.error(
        `Failed to start API server: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const shutdown = () => {
      console.log("\nShutting down...");
      monitor.stop();
      deadManSwitch.destroy();
      void api.stop().then(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_PATH } from "../../config/loader.js";
import { HealthMonitor } from "../../health/monitor.js";

export const statusCommand = new Command("status")
  .description("Show current health status and recovery stats")
  .option("-c, --config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .action(async (opts: { config: string }) => {
    const config = loadConfig(opts.config);
    const monitor = new HealthMonitor(config);

    const score = await monitor.runAllProbes();

    const bandColors: Record<string, string> = {
      healthy: "\x1b[32m",
      degraded: "\x1b[33m",
      critical: "\x1b[31m",
    };
    const reset = "\x1b[0m";
    const color = bandColors[score.band] ?? "";

    process.stdout.write(
      `\nHealth: ${color}${score.band.toUpperCase()}${reset} (score: ${score.total})\n\n`,
    );

    for (const probe of score.probeResults) {
      const icon = probe.healthy ? "\x1b[32m+\x1b[0m" : "\x1b[31m-\x1b[0m";
      const msg = probe.message ? ` — ${probe.message}` : "";
      process.stdout.write(`  ${icon} ${probe.name} (${probe.latencyMs}ms)${msg}\n`);
    }

    if (config.alerts.channels.length === 0) {
      process.stdout.write(
        `\n\x1b[33mWARNING: No alert channels configured. Aegis cannot notify you during incidents. Run 'aegis init' to add alerts.\x1b[0m\n`,
      );
    }

    process.stdout.write("\n");
  });

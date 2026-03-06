import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_PATH } from "../../config/loader.js";
import { HealthMonitor } from "../../health/monitor.js";

export const checkCommand = new Command("check")
  .description("Run all health probes once and exit")
  .option("-c, --config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .option("--json", "Output as JSON")
  .action(async (opts: { config: string; json?: boolean }) => {
    const config = loadConfig(opts.config);
    const monitor = new HealthMonitor(config);

    const score = await monitor.runAllProbes();

    if (opts.json) {
      process.stdout.write(JSON.stringify(score, null, 2) + "\n");
    } else {
      const failed = score.probeResults.filter((p) => !p.healthy);
      process.stdout.write(`Health: ${score.band.toUpperCase()} (score: ${score.total})\n`);
      process.stdout.write(
        `Probes: ${score.probeResults.length - failed.length} passed, ${failed.length} failed\n`,
      );

      if (failed.length > 0) {
        process.stdout.write("\nFailed probes:\n");
        for (const probe of failed) {
          process.stdout.write(`  - ${probe.name}: ${probe.message ?? "failed"}\n`);
        }
      }
    }

    process.exit(score.band === "healthy" ? 0 : 1);
  });

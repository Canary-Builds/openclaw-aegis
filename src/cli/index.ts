import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { statusCommand } from "./commands/status.js";
import { checkCommand } from "./commands/check.js";
import { initCommand } from "./commands/init.js";
import { testAlertCommand } from "./commands/test-alert.js";
import { incidentsCommand } from "./commands/incidents.js";

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

const program = new Command();

program
  .name("aegis")
  .description("OpenClaw Aegis — self-healing sidecar for the OpenClaw gateway")
  .version(getVersion());

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(checkCommand);
program.addCommand(testAlertCommand);
program.addCommand(incidentsCommand);

program.parse(process.argv);

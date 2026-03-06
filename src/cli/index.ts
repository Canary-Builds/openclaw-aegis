import { Command } from "commander";
import { statusCommand } from "./commands/status.js";
import { checkCommand } from "./commands/check.js";
import { initCommand } from "./commands/init.js";
import { testAlertCommand } from "./commands/test-alert.js";

const program = new Command();

program
  .name("aegis")
  .description("OpenClaw Aegis — self-healing sidecar for the OpenClaw gateway")
  .version("1.0.0");

program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(checkCommand);
program.addCommand(testAlertCommand);

program.parse(process.argv);

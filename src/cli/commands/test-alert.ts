import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_PATH } from "../../config/loader.js";
import { AlertDispatcher } from "../../alerts/dispatcher.js";
import { NtfyProvider } from "../../alerts/providers/ntfy.js";
import { TelegramProvider } from "../../alerts/providers/telegram.js";
import { WhatsAppProvider } from "../../alerts/providers/whatsapp.js";
import { WebhookProvider } from "../../alerts/providers/webhook.js";
import { SlackProvider } from "../../alerts/providers/slack.js";
import type { AlertPayload } from "../../types/index.js";

export const testAlertCommand = new Command("test-alert")
  .description("Send a test alert to all configured channels")
  .option("-c, --config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .action(async (opts: { config: string }) => {
    const config = loadConfig(opts.config);

    if (config.alerts.channels.length === 0) {
      console.log("No alert channels configured. Run 'aegis init' to add one.");
      process.exit(1);
    }

    const dispatcher = new AlertDispatcher(1, [1000]);

    for (const ch of config.alerts.channels) {
      switch (ch.type) {
        case "ntfy":
          dispatcher.addProvider(new NtfyProvider(ch));
          break;
        case "telegram":
          dispatcher.addProvider(new TelegramProvider(ch));
          break;
        case "whatsapp":
          dispatcher.addProvider(new WhatsAppProvider(ch));
          break;
        case "webhook":
          dispatcher.addProvider(new WebhookProvider(ch));
          break;
        case "slack":
          dispatcher.addProvider(new SlackProvider(ch));
          break;
      }
    }

    const alert: AlertPayload = {
      severity: "info",
      title: "Aegis Test Alert",
      body: "This is a test notification from OpenClaw Aegis. If you see this, alerts are working.",
      timestamp: new Date().toISOString(),
    };

    console.log(`Sending test alert to ${dispatcher.getProviders().length} channel(s)...\n`);

    const result = await dispatcher.dispatch(alert);

    for (const r of result.results) {
      if (r.success) {
        console.log(`  + ${r.provider}: sent (${r.durationMs}ms)`);
      } else {
        console.log(`  - ${r.provider}: failed — ${r.error}`);
      }
    }

    console.log(result.sent ? "\nTest alert sent successfully." : "\nAll channels failed.");
    process.exit(result.sent ? 0 : 1);
  });

import type { BotDeps } from "./commands.js";
import { BotCommandHandler } from "./commands.js";

export class TelegramBotListener {
  private readonly handler: BotCommandHandler;
  private running = false;
  private offset = 0;
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(botToken: string, chatId: string, deps: BotDeps) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.handler = new BotCommandHandler(deps);
  }

  async start(): Promise<void> {
    this.running = true;
    // Register commands with Telegram
    await this.setMyCommands();
    void this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async setMyCommands(): Promise<void> {
    const commands = this.handler.getCommandList().map((c) => ({
      command: c.name,
      description: c.description,
    }));

    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
    } catch {
      /* non-critical */
    }
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=30&allowed_updates=["message"]`,
          { signal: AbortSignal.timeout(35000) },
        );

        const data = (await response.json()) as {
          ok: boolean;
          result: {
            update_id: number;
            message?: {
              chat: { id: number };
              text?: string;
            };
          }[];
        };

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            const msg = update.message;
            if (!msg?.text) continue;

            // Only respond to messages from the configured chat
            if (String(msg.chat.id) !== this.chatId) continue;

            const result = await this.handler.handle(msg.text);
            if (result) {
              await this.sendMessage(result.text);
            }
          }
        }
      } catch {
        // Network error or timeout — wait before retrying
        if (this.running) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  private async sendMessage(text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
    } catch {
      /* best effort */
    }
  }
}

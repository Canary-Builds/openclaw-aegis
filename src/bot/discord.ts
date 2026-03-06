import type { BotDeps } from "./commands.js";
import { BotCommandHandler } from "./commands.js";

export class DiscordBotListener {
  private readonly handler: BotCommandHandler;
  private running = false;
  private readonly botToken: string;
  private readonly channelId: string;
  private lastMessageId: string | null = null;

  constructor(config: { botToken: string; channelId: string }, deps: BotDeps) {
    this.botToken = config.botToken;
    this.channelId = config.channelId;
    this.handler = new BotCommandHandler(deps);
  }

  async start(): Promise<void> {
    this.running = true;
    // Get initial position by fetching latest message
    await this.fetchLatestMessageId();
    void this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async fetchLatestMessageId(): Promise<void> {
    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${this.channelId}/messages?limit=1`,
        {
          headers: { Authorization: `Bot ${this.botToken}` },
        },
      );

      if (response.ok) {
        const messages = (await response.json()) as { id: string }[];
        if (messages.length > 0 && messages[0]) {
          this.lastMessageId = messages[0].id;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        let url = `https://discord.com/api/v10/channels/${this.channelId}/messages?limit=10`;
        if (this.lastMessageId) {
          url += `&after=${this.lastMessageId}`;
        }

        const response = await fetch(url, {
          headers: { Authorization: `Bot ${this.botToken}` },
        });

        if (response.ok) {
          const messages = (await response.json()) as {
            id: string;
            content: string;
            author: { bot?: boolean };
          }[];

          // Process oldest first
          const sorted = messages.reverse();
          for (const msg of sorted) {
            this.lastMessageId = msg.id;

            // Skip bot messages
            if (msg.author.bot) continue;

            // Only process messages that start with / or !
            if (!msg.content.startsWith("/") && !msg.content.startsWith("!")) continue;

            const input = msg.content.replace(/^[/!]/, "");
            const result = await this.handler.handle(input);
            if (result) {
              await this.sendMessage(result.text);
            }
          }
        }

        // Discord rate limit: poll every 2 seconds
        await new Promise((r) => setTimeout(r, 2000));
      } catch {
        if (this.running) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  private async sendMessage(text: string): Promise<void> {
    try {
      await fetch(`https://discord.com/api/v10/channels/${this.channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: text }),
      });
    } catch {
      /* best effort */
    }
  }
}

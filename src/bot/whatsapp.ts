import * as http from "node:http";
import type { BotDeps } from "./commands.js";
import { BotCommandHandler } from "./commands.js";

interface WhatsAppWebhookMessage {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          from: string;
          text?: { body: string };
        }[];
      };
    }[];
  }[];
}

export class WhatsAppBotListener {
  private readonly handler: BotCommandHandler;
  private server: http.Server | null = null;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly recipientNumber: string;
  private readonly verifyToken: string;

  constructor(
    config: {
      phoneNumberId: string;
      accessToken: string;
      recipientNumber: string;
      verifyToken?: string;
    },
    deps: BotDeps,
  ) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.recipientNumber = config.recipientNumber;
    this.verifyToken = config.verifyToken ?? "aegis-verify";
    this.handler = new BotCommandHandler(deps);
  }

  start(port: number, host: string = "127.0.0.1"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url?.startsWith("/webhook")) {
          this.handleVerification(req, res);
          return;
        }

        if (req.method === "POST" && req.url?.startsWith("/webhook")) {
          this.handleIncoming(req, res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      this.server.on("error", reject);
      this.server.listen(port, host, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleVerification(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.verifyToken) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge ?? "ok");
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
  }

  private handleIncoming(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      // Acknowledge immediately
      res.writeHead(200);
      res.end("OK");

      void this.processMessage(body);
    });
  }

  private async processMessage(rawBody: string): Promise<void> {
    try {
      const data = JSON.parse(rawBody) as WhatsAppWebhookMessage;
      const messages = data.entry?.[0]?.changes?.[0]?.value?.messages;
      if (!messages?.length) return;

      for (const msg of messages) {
        // Only respond to the configured recipient
        if (msg.from !== this.recipientNumber) continue;
        if (!msg.text?.body) continue;

        const result = await this.handler.handle(msg.text.body);
        if (result) {
          await this.sendMessage(msg.from, result.text);
        }
      }
    } catch {
      /* ignore malformed payloads */
    }
  }

  private async sendMessage(to: string, text: string): Promise<void> {
    try {
      await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      });
    } catch {
      /* best effort */
    }
  }
}

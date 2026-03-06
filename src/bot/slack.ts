import * as http from "node:http";
import * as crypto from "node:crypto";
import type { BotDeps } from "./commands.js";
import { BotCommandHandler } from "./commands.js";

export class SlackBotListener {
  private readonly handler: BotCommandHandler;
  private server: http.Server | null = null;
  private readonly signingSecret: string | null;

  constructor(config: { signingSecret?: string }, deps: BotDeps) {
    this.signingSecret = config.signingSecret ?? null;
    this.handler = new BotCommandHandler(deps);
  }

  start(port: number, host: string = "127.0.0.1"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === "POST" && req.url?.startsWith("/slack")) {
          this.handleSlashCommand(req, res);
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

  private handleSlashCommand(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      // Verify signature if signing secret is configured
      if (this.signingSecret && !this.verifySignature(req, body)) {
        res.writeHead(401);
        res.end("Invalid signature");
        return;
      }

      const params = new URLSearchParams(body);
      const command = params.get("command") ?? "";
      const text = params.get("text") ?? "";

      // Slack slash commands come as /aegis with text being the subcommand
      // e.g., /aegis health or just the command name
      const cmdInput = text || command.replace(/^\/aegis/, "").trim() || "help";

      void this.handler
        .handle(cmdInput)
        .then((result) => {
          if (result) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                response_type: "in_channel",
                text: result.text,
              }),
            );
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                response_type: "ephemeral",
                text: "Unknown command. Try: /aegis help",
              }),
            );
          }
        })
        .catch(() => {
          res.writeHead(500);
          res.end("Internal error");
        });
    });
  }

  private verifySignature(req: http.IncomingMessage, body: string): boolean {
    if (!this.signingSecret) return true;

    const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;
    const signature = req.headers["x-slack-signature"] as string | undefined;

    if (!timestamp || !signature) return false;

    // Reject requests older than 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

    const basestring = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", this.signingSecret).update(basestring).digest("hex");
    const expected = `v0=${hmac}`;

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}

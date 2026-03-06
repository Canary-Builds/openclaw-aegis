import * as net from "node:net";
import * as tls from "node:tls";
import type { AlertPayload, AlertProvider, AlertResult } from "../../types/index.js";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string;
}

export class EmailProvider implements AlertProvider {
  readonly name = "email";
  private readonly config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async send(alert: AlertPayload): Promise<AlertResult> {
    const start = Date.now();
    const icon = alert.severity === "critical" ? "[CRITICAL]" : alert.severity === "warning" ? "[WARNING]" : "[INFO]";
    const subject = `${icon} ${alert.title}`;

    try {
      await this.sendSmtp(subject, alert.body);
      return {
        provider: this.name,
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        provider: this.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  async test(): Promise<boolean> {
    try {
      const result = await this.send({
        severity: "info",
        title: "Aegis Alert Test",
        body: "This is a test alert from OpenClaw Aegis.",
        timestamp: new Date().toISOString(),
      });
      return result.success;
    } catch {
      return false;
    }
  }

  private sendSmtp(subject: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = 15000;
      let socket: net.Socket | tls.TLSSocket;

      const connect = () => {
        if (this.config.secure) {
          socket = tls.connect({
            host: this.config.host,
            port: this.config.port,
            rejectUnauthorized: true,
          });
        } else {
          socket = net.createConnection({
            host: this.config.host,
            port: this.config.port,
          });
        }

        socket.setTimeout(timeout);

        let buffer = "";
        let step = 0;

        const commands = [
          `EHLO aegis\r\n`,
          `AUTH LOGIN\r\n`,
          `${Buffer.from(this.config.username).toString("base64")}\r\n`,
          `${Buffer.from(this.config.password).toString("base64")}\r\n`,
          `MAIL FROM:<${this.config.from}>\r\n`,
          `RCPT TO:<${this.config.to}>\r\n`,
          `DATA\r\n`,
          `From: ${this.config.from}\r\nTo: ${this.config.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\nX-Mailer: OpenClaw-Aegis\r\n\r\n${body}\r\n.\r\n`,
          `QUIT\r\n`,
        ];

        socket.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\r\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line) continue;
            const code = parseInt(line.substring(0, 3), 10);

            if (line.charAt(3) === "-") continue;

            if (code >= 400) {
              socket.destroy();
              reject(new Error(`SMTP error: ${line}`));
              return;
            }

            if (step < commands.length) {
              socket.write(commands[step]!);
              step++;
            }

            if (step >= commands.length && code === 221) {
              socket.end();
              resolve();
              return;
            }
          }
        });

        socket.on("timeout", () => {
          socket.destroy();
          reject(new Error("SMTP connection timed out"));
        });

        socket.on("error", (err: Error) => {
          reject(new Error(`SMTP error: ${err.message}`));
        });
      };

      if (!this.config.secure && this.config.port === 587) {
        const plain = net.createConnection({
          host: this.config.host,
          port: this.config.port,
        });
        plain.setTimeout(timeout);

        let buf = "";
        let startTlsSent = false;
        let ehloSent = false;

        plain.on("data", (data: Buffer) => {
          buf += data.toString();
          const lines = buf.split("\r\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line) continue;
            const code = parseInt(line.substring(0, 3), 10);
            if (line.charAt(3) === "-") continue;

            if (code >= 400) {
              plain.destroy();
              reject(new Error(`SMTP error: ${line}`));
              return;
            }

            if (!ehloSent) {
              plain.write("EHLO aegis\r\n");
              ehloSent = true;
            } else if (!startTlsSent) {
              plain.write("STARTTLS\r\n");
              startTlsSent = true;
            } else if (code === 220 && startTlsSent) {
              socket = tls.connect({
                socket: plain,
                host: this.config.host,
                rejectUnauthorized: true,
              }, () => {
                let step2 = 0;
                let buffer2 = "";
                const cmds = [
                  `EHLO aegis\r\n`,
                  `AUTH LOGIN\r\n`,
                  `${Buffer.from(this.config.username).toString("base64")}\r\n`,
                  `${Buffer.from(this.config.password).toString("base64")}\r\n`,
                  `MAIL FROM:<${this.config.from}>\r\n`,
                  `RCPT TO:<${this.config.to}>\r\n`,
                  `DATA\r\n`,
                  `From: ${this.config.from}\r\nTo: ${this.config.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\nX-Mailer: OpenClaw-Aegis\r\n\r\n${body}\r\n.\r\n`,
                  `QUIT\r\n`,
                ];

                socket.write(cmds[0]!);
                step2 = 1;

                socket.on("data", (d: Buffer) => {
                  buffer2 += d.toString();
                  const ls = buffer2.split("\r\n");
                  buffer2 = ls.pop() ?? "";

                  for (const l of ls) {
                    if (!l) continue;
                    const c = parseInt(l.substring(0, 3), 10);
                    if (l.charAt(3) === "-") continue;

                    if (c >= 400) {
                      socket.destroy();
                      reject(new Error(`SMTP error: ${l}`));
                      return;
                    }

                    if (step2 < cmds.length) {
                      socket.write(cmds[step2]!);
                      step2++;
                    }

                    if (step2 >= cmds.length && c === 221) {
                      socket.end();
                      resolve();
                      return;
                    }
                  }
                });
              });
              return;
            }
          }
        });

        plain.on("timeout", () => { plain.destroy(); reject(new Error("SMTP connection timed out")); });
        plain.on("error", (err: Error) => { reject(new Error(`SMTP error: ${err.message}`)); });
      } else {
        connect();
      }
    });
  }
}

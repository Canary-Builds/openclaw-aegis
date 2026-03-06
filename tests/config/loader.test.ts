import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, expandHome, resolveConfigPaths } from "../../src/config/loader.js";
import { aegisConfigSchema } from "../../src/config/schema.js";

describe("expandHome", () => {
  it("expands ~ to home directory", () => {
    const result = expandHome("~/test/path");
    expect(result).toBe(path.join(os.homedir(), "test/path"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandHome("relative/path")).toBe("relative/path");
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when config file does not exist", () => {
    const config = loadConfig(path.join(tmpDir, "nonexistent.toml"));
    expect(config.gateway.port).toBeGreaterThan(0);
    expect(config.monitoring.intervalMs).toBe(10000);
    expect(config.monitoring.configPollIntervalMs).toBe(2000);
    expect(config.recovery.l1MaxAttempts).toBe(3);
    expect(config.backup.maxChronological).toBe(20);
    expect(config.backup.maxKnownGood).toBe(3);
    expect(config.deadManSwitch.countdownMs).toBe(30000);
    expect(config.alerts.channels).toEqual([]);
  });

  it("loads and validates a TOML config file", () => {
    const configPath = path.join(tmpDir, "config.toml");
    fs.writeFileSync(
      configPath,
      `
[gateway]
port = 3000
configPath = "${tmpDir}/openclaw.json"
pidFile = "${tmpDir}/gateway.pid"
logPath = "${tmpDir}/gateway.log"

[monitoring]
intervalMs = 5000

[recovery]
l1MaxAttempts = 5
`,
    );

    const config = loadConfig(configPath);
    expect(config.gateway.port).toBe(3000);
    expect(config.monitoring.intervalMs).toBe(5000);
    expect(config.recovery.l1MaxAttempts).toBe(5);
  });

  it("rejects invalid config values", () => {
    const configPath = path.join(tmpDir, "bad.toml");
    fs.writeFileSync(
      configPath,
      `
[gateway]
port = 99999
`,
    );

    expect(() => loadConfig(configPath)).toThrow();
  });
});

describe("aegisConfigSchema", () => {
  it("parses empty object with all defaults", () => {
    const config = aegisConfigSchema.parse({});
    expect(config.gateway.port).toBe(3000);
    expect(config.platform.type).toBe("systemd");
    expect(config.platform.watchdogSec).toBe(30);
  });

  it("validates alert channel configs", () => {
    const config = aegisConfigSchema.parse({
      alerts: {
        channels: [
          { type: "ntfy", topic: "test-topic" },
          { type: "webhook", url: "https://example.com/hook" },
          { type: "telegram", botToken: "123:abc", chatId: "456" },
        ],
      },
    });

    expect(config.alerts.channels).toHaveLength(3);
    expect(config.alerts.channels[0].type).toBe("ntfy");
    expect(config.alerts.channels[1].type).toBe("webhook");
    expect(config.alerts.channels[2].type).toBe("telegram");
  });
});

describe("resolveConfigPaths", () => {
  it("resolves ~ in gateway paths", () => {
    const config = aegisConfigSchema.parse({});
    const resolved = resolveConfigPaths(config);
    expect(resolved.gateway.configPath).toContain(os.homedir());
    // pidFile defaults to systemd unit name (no ~ to resolve)
    expect(resolved.gateway.pidFile).toBe("openclaw-gateway.service");
    expect(resolved.gateway.logPath).toContain(os.homedir());
    expect(resolved.backup.basePath).toContain(os.homedir());
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as net from "node:net";
import { processProbe } from "../../src/health/probes/process.js";
import { portProbe } from "../../src/health/probes/port.js";
import { httpHealthProbe } from "../../src/health/probes/http.js";
import { configProbe } from "../../src/health/probes/config.js";
import { memoryProbe } from "../../src/health/probes/memory.js";
import { diskProbe } from "../../src/health/probes/disk.js";
import { logTailProbe } from "../../src/health/probes/log-tail.js";
import { websocketProbe } from "../../src/health/probes/websocket.js";

const LOCAL: { type: "local" } = { type: "local" };

describe("processProbe", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-probe-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns healthy when PID is current process", async () => {
    const pidFile = path.join(tmpDir, "test.pid");
    fs.writeFileSync(pidFile, String(process.pid));

    const result = await processProbe(LOCAL, pidFile);
    expect(result.healthy).toBe(true);
    expect(result.score).toBe(2);
  });

  it("returns unhealthy when PID file is missing", async () => {
    const result = await processProbe(LOCAL, path.join(tmpDir, "missing.pid"));
    expect(result.healthy).toBe(false);
    expect(result.score).toBe(0);
  });

  it("returns unhealthy for stale PID", async () => {
    const pidFile = path.join(tmpDir, "stale.pid");
    fs.writeFileSync(pidFile, "999999999");

    const result = await processProbe(LOCAL, pidFile);
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("not running");
  });

  it("returns unhealthy for invalid PID", async () => {
    const pidFile = path.join(tmpDir, "bad.pid");
    fs.writeFileSync(pidFile, "notanumber");

    const result = await processProbe(LOCAL, pidFile);
    expect(result.healthy).toBe(false);
  });
});

describe("portProbe", () => {
  it("returns healthy when port is open", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;

    const result = await portProbe(LOCAL, port, 2000);
    expect(result.healthy).toBe(true);
    expect(result.score).toBe(2);

    server.close();
  });

  it("returns unhealthy when port is closed", async () => {
    const result = await portProbe(LOCAL, 59999, 1000);
    expect(result.healthy).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe("httpHealthProbe", () => {
  it("returns healthy on 200 response", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;

    const result = await httpHealthProbe(LOCAL, port, "/health", 2000);
    expect(result.healthy).toBe(true);

    server.close();
  });

  it("returns unhealthy on 500 response", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(500);
      res.end("error");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as net.AddressInfo).port;

    const result = await httpHealthProbe(LOCAL, port, "/health", 2000);
    expect(result.healthy).toBe(false);

    server.close();
  });

  it("returns unhealthy when server is not running", async () => {
    const result = await httpHealthProbe(LOCAL, 59998, "/health", 1000);
    expect(result.healthy).toBe(false);
  });
});

describe("configProbe", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns healthy for valid config", async () => {
    const configPath = path.join(tmpDir, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 18789 } }));

    const result = await configProbe(LOCAL, configPath);
    expect(result.healthy).toBe(true);
    expect(result.score).toBe(2);
  });

  it("detects missing config file", async () => {
    const result = await configProbe(LOCAL, path.join(tmpDir, "missing.json"));
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("detects invalid JSON", async () => {
    const configPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(configPath, "not json {{{");

    const result = await configProbe(LOCAL, configPath);
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("not valid JSON");
  });

  it("accepts config without gateway.port (optional key)", async () => {
    const configPath = path.join(tmpDir, "empty.json");
    fs.writeFileSync(configPath, "{}");

    const result = await configProbe(LOCAL, configPath);
    expect(result.healthy).toBe(true);
  });

  it("detects poison keys", async () => {
    const configPath = path.join(tmpDir, "poison.json");
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 18789 }, autoAck: true }));

    const result = await configProbe(LOCAL, configPath);
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("Poison keys");
    expect(result.message).toContain("autoAck");
  });
});

describe("diskProbe", () => {
  it("returns healthy when disk has space", async () => {
    const result = await diskProbe(LOCAL, "/tmp/test", 1);
    expect(result.healthy).toBe(true);
  });
});

describe("logTailProbe", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-log-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns healthy when no errors in log", async () => {
    const logPath = path.join(tmpDir, "gateway.log");
    fs.writeFileSync(logPath, "INFO: Gateway started\nINFO: Connected\n");

    const result = await logTailProbe(LOCAL, logPath);
    expect(result.healthy).toBe(true);
  });

  it("detects error patterns in log", async () => {
    const logPath = path.join(tmpDir, "gateway.log");
    fs.writeFileSync(logPath, "ERROR: ECONNRESET\nFATAL: uncaught exception\n");

    const result = await logTailProbe(LOCAL, logPath);
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("ECONNRESET");
  });

  it("returns healthy when log file does not exist", async () => {
    const result = await logTailProbe(LOCAL, path.join(tmpDir, "missing.log"));
    expect(result.healthy).toBe(true);
  });
});

describe("websocketProbe", () => {
  it("returns unhealthy when no WS server is running", async () => {
    const result = await websocketProbe(LOCAL, 59997, 1000);
    expect(result.healthy).toBe(false);
  });
});

describe("memoryProbe", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-mem-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unhealthy when PID file missing", async () => {
    const result = await memoryProbe(LOCAL, path.join(tmpDir, "missing.pid"));
    expect(result.healthy).toBe(false);
  });
});

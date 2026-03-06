import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ConfigChangeDetector, type ConfigChangeEvent } from "../../src/config/detector.js";

describe("ConfigChangeDetector", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-detector-"));
    configPath = path.join(tmpDir, "openclaw.json");
    fs.writeFileSync(configPath, JSON.stringify({ port: 18789 }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects config changes via polling", async () => {
    const detector = new ConfigChangeDetector(configPath, 100);
    const changes: ConfigChangeEvent[] = [];

    detector.on("change", (event: ConfigChangeEvent) => {
      changes.push(event);
    });

    detector.start();

    // Wait for initial poll cycle
    await new Promise((r) => setTimeout(r, 150));

    // Modify the file
    fs.writeFileSync(configPath, JSON.stringify({ port: 3000 }));

    // Wait for detection
    await new Promise((r) => setTimeout(r, 250));

    detector.stop();

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].path).toBe(configPath);
  });

  it("detects config write storms", async () => {
    const detector = new ConfigChangeDetector(configPath, 50, 3, 5000);
    let stormDetected = false;

    detector.on("storm", () => {
      stormDetected = true;
    });

    detector.start();
    await new Promise((r) => setTimeout(r, 60));

    // Rapidly modify the file
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 70));
      fs.writeFileSync(configPath, JSON.stringify({ port: 3000 + i }));
    }

    await new Promise((r) => setTimeout(r, 200));
    detector.stop();

    expect(stormDetected).toBe(true);
  });

  it("tracks recent change count", async () => {
    const detector = new ConfigChangeDetector(configPath, 50, 5, 60000);
    detector.start();
    await new Promise((r) => setTimeout(r, 60));

    fs.writeFileSync(configPath, JSON.stringify({ port: 3001 }));
    await new Promise((r) => setTimeout(r, 100));

    expect(detector.getRecentChangeCount()).toBeGreaterThanOrEqual(1);
    detector.stop();
  });

  it("detects changes via polling source", async () => {
    // Verify that polling-based detection reports the correct source
    const detector = new ConfigChangeDetector(configPath, 100);
    const changes: ConfigChangeEvent[] = [];

    detector.on("change", (event: ConfigChangeEvent) => {
      changes.push(event);
    });

    detector.start();
    await new Promise((r) => setTimeout(r, 150));

    fs.writeFileSync(configPath, JSON.stringify({ port: 9999 }));
    await new Promise((r) => setTimeout(r, 250));

    detector.stop();

    // At minimum, polling should detect the change (fs.watch may also fire)
    expect(changes.length).toBeGreaterThanOrEqual(1);
    // At least one detection source should be present
    expect(changes[0].source).toMatch(/^(polling|fswatch)$/);
  });
});

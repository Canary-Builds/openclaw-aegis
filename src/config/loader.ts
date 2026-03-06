import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import TOML from "@iarna/toml";
import { aegisConfigSchema, type AegisConfig } from "./schema.js";

export function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

export function resolveConfigPaths(config: AegisConfig): AegisConfig {
  return {
    ...config,
    gateway: {
      ...config.gateway,
      configPath: expandHome(config.gateway.configPath),
      pidFile: expandHome(config.gateway.pidFile),
      logPath: expandHome(config.gateway.logPath),
    },
    backup: {
      ...config.backup,
      basePath: expandHome(config.backup.basePath),
    },
  };
}

export function loadConfig(configPath: string): AegisConfig {
  const resolvedPath = expandHome(configPath);

  if (!fs.existsSync(resolvedPath)) {
    const defaults = aegisConfigSchema.parse({});
    defaults.gateway.port = detectGatewayPort();
    return resolveConfigPaths(defaults);
  }

  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed: unknown = TOML.parse(raw);
  const validated = aegisConfigSchema.parse(parsed);
  return resolveConfigPaths(validated);
}

export function detectGatewayPort(): number {
  try {
    const configPath = expandHome("~/.openclaw/openclaw.json");
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      const gateway = raw?.gateway as Record<string, unknown> | undefined;
      if (gateway?.port && typeof gateway.port === "number") return gateway.port;
      // Check top-level port
      if (raw?.port && typeof raw.port === "number") return raw.port;
    }
  } catch {
    /* ignore */
  }
  return 3000;
}

export const DEFAULT_CONFIG_PATH = "~/.openclaw/aegis/config.toml";

export function getConfigDir(): string {
  return expandHome("~/.openclaw/aegis");
}

export function ensureConfigDir(): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

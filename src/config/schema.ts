import { z } from "zod";

const alertChannelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ntfy"),
    url: z.string().url().default("https://ntfy.sh"),
    topic: z.string().min(1),
    priority: z.number().int().min(1).max(5).default(4),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    secret: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("telegram"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({
    type: z.literal("whatsapp"),
    phoneNumberId: z.string().min(1),
    accessToken: z.string().min(1),
    recipientNumber: z.string().min(1),
  }),
  z.object({
    type: z.literal("slack"),
    webhookUrl: z.string().url(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("discord"),
    webhookUrl: z.string().url(),
    username: z.string().optional(),
  }),
  z.object({
    type: z.literal("email"),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    username: z.string().min(1),
    password: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    type: z.literal("pushover"),
    apiToken: z.string().min(1),
    userKey: z.string().min(1),
    device: z.string().optional(),
  }),
]);

export type AlertChannelConfig = z.infer<typeof alertChannelSchema>;

export const aegisConfigSchema = z.object({
  gateway: z
    .object({
      configPath: z.string().default("~/.openclaw/openclaw.json"),
      pidFile: z.string().default("openclaw-gateway.service"),
      port: z.number().int().min(1).max(65535).default(3000),
      logPath: z.string().default("~/.openclaw/logs/gateway.log"),
      healthEndpoint: z.string().default("/health"),
    })
    .default({}),

  monitoring: z
    .object({
      intervalMs: z.number().int().min(1000).default(10000),
      probeTimeoutMs: z.number().int().min(500).default(5000),
      configPollIntervalMs: z.number().int().min(500).default(2000),
      degradedConfirmationCount: z.number().int().min(1).default(2),
    })
    .default({}),

  health: z
    .object({
      healthyMin: z.number().int().min(0).default(7),
      degradedMin: z.number().int().min(0).default(4),
      memoryThresholdMb: z.number().int().min(0).default(512),
      cpuThresholdPercent: z.number().int().min(0).max(100).default(90),
      diskThresholdMb: z.number().int().min(0).default(100),
    })
    .default({}),

  recovery: z
    .object({
      l1MaxAttempts: z.number().int().min(1).default(3),
      l1BackoffBaseMs: z.number().int().min(1000).default(5000),
      l1BackoffMultiplier: z.number().min(1).default(3),
      l2MaxAttempts: z.number().int().min(1).default(2),
      l2CooldownMs: z.number().int().min(1000).default(60000),
      l3Enabled: z.boolean().default(false),
      l3MaxAttempts: z.number().int().min(1).default(2),
      l3CooldownMs: z.number().int().min(1000).default(30000),
      l3SafeModeArgs: z.array(z.string()).default(["--no-plugins", "--default-routes"]),
      circuitBreakerMaxCycles: z.number().int().min(1).default(3),
      circuitBreakerWindowMs: z.number().int().min(60000).default(3600000),
      antiFlap: z
        .object({
          maxRestarts: z.number().int().min(1).default(5),
          windowMs: z.number().int().min(60000).default(900000),
          cooldownMs: z.number().int().min(60000).default(600000),
          decayMs: z.number().int().min(60000).default(21600000),
        })
        .default({}),
    })
    .default({}),

  backup: z
    .object({
      maxChronological: z.number().int().min(1).default(20),
      maxKnownGood: z.number().int().min(1).default(3),
      knownGoodStabilityMs: z.number().int().min(10000).default(60000),
      basePath: z.string().default("~/.openclaw/aegis/backups"),
    })
    .default({}),

  deadManSwitch: z
    .object({
      countdownMs: z.number().int().min(5000).default(30000),
      enabled: z.boolean().default(true),
    })
    .default({}),

  alerts: z
    .object({
      channels: z.array(alertChannelSchema).default([]),
      retryAttempts: z.number().int().min(0).default(3),
      retryBackoffMs: z.array(z.number().int()).default([5000, 15000, 45000]),
    })
    .default({}),

  observability: z
    .object({
      logging: z
        .object({
          enabled: z.boolean().default(true),
          level: z.enum(["debug", "info", "warn", "error"]).default("info"),
          filePath: z.string().default("~/.openclaw/aegis/logs/aegis.jsonl"),
          stdout: z.boolean().default(true),
        })
        .default({}),
      healthHistory: z
        .object({
          enabled: z.boolean().default(true),
          maxEntries: z.number().int().min(100).default(8640),
          basePath: z.string().default("~/.openclaw/aegis/history"),
        })
        .default({}),
      tracing: z
        .object({
          enabled: z.boolean().default(true),
          basePath: z.string().default("~/.openclaw/aegis/traces"),
          maxTraces: z.number().int().min(10).default(100),
        })
        .default({}),
    })
    .default({}),

  intelligence: z
    .object({
      anomaly: z
        .object({
          enabled: z.boolean().default(true),
          minBaseline: z.number().int().min(10).default(60),
          baselineWindowMs: z.number().int().min(60000).default(3600000),
          scoreDeviationThreshold: z.number().min(1).default(2.5),
          latencyDeviationThreshold: z.number().min(1).default(3.0),
          confirmationCount: z.number().int().min(1).default(3),
          alertCooldownMs: z.number().int().min(60000).default(900000),
        })
        .default({}),
      predictive: z
        .object({
          enabled: z.boolean().default(true),
          minDataPoints: z.number().int().min(10).default(120),
          trendWindowMs: z.number().int().min(60000).default(7200000),
          warningHorizonMs: z.number().int().min(60000).default(3600000),
          alertCooldownMs: z.number().int().min(60000).default(1800000),
        })
        .default({}),
      runbooks: z
        .object({
          enabled: z.boolean().default(false),
          basePath: z.string().default("~/.openclaw/aegis/runbooks"),
        })
        .default({}),
      noiseReduction: z
        .object({
          enabled: z.boolean().default(true),
          groupingWindowMs: z.number().int().min(10000).default(300000),
          dedupThreshold: z.number().int().min(1).default(3),
          escalationDelayMs: z.number().int().min(60000).default(900000),
          maxBufferSize: z.number().int().min(5).default(20),
          digestIntervalMs: z.number().int().min(30000).default(300000),
        })
        .default({}),
    })
    .default({}),

  maintenance: z
    .object({
      enabled: z.boolean().default(false),
      maxDurationMs: z.number().int().min(60000).default(14400000),
    })
    .default({}),

  api: z
    .object({
      enabled: z.boolean().default(false),
      port: z.number().int().min(1).max(65535).default(3001),
      host: z.string().default("127.0.0.1"),
    })
    .default({}),

  bot: z
    .object({
      enabled: z.boolean().default(false),
      telegram: z
        .object({
          enabled: z.boolean().default(false),
        })
        .default({}),
      whatsapp: z
        .object({
          enabled: z.boolean().default(false),
          webhookPort: z.number().int().min(1).max(65535).default(3002),
          verifyToken: z.string().default("aegis-verify"),
        })
        .default({}),
      slack: z
        .object({
          enabled: z.boolean().default(false),
          webhookPort: z.number().int().min(1).max(65535).default(3003),
          signingSecret: z.string().optional(),
        })
        .default({}),
      discord: z
        .object({
          enabled: z.boolean().default(false),
          botToken: z.string().optional(),
          channelId: z.string().optional(),
        })
        .default({}),
    })
    .default({}),

  platform: z
    .object({
      type: z.enum(["systemd", "launchd"]).default("systemd"),
      watchdogSec: z.number().int().min(10).default(30),
    })
    .default({}),
});

export type AegisConfig = z.infer<typeof aegisConfigSchema>;

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
]);

export type AlertChannelConfig = z.infer<typeof alertChannelSchema>;

export const aegisConfigSchema = z.object({
  gateway: z
    .object({
      configPath: z.string().default("~/.openclaw/openclaw.json"),
      pidFile: z.string().default("openclaw-gateway.service"),
      port: z.number().int().min(1).max(65535).default(18789),
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

  platform: z
    .object({
      type: z.enum(["systemd", "launchd"]).default("systemd"),
      watchdogSec: z.number().int().min(10).default(30),
    })
    .default({}),
});

export type AegisConfig = z.infer<typeof aegisConfigSchema>;

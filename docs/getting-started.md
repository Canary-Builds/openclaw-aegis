# Getting Started

## Prerequisites

- **Node.js** >= 18 ([download](https://nodejs.org))
- **OpenClaw Gateway** installed and running
- **Linux** (systemd) or **macOS** (launchd)

## Installation

### npm (recommended)

```bash
npm install -g openclaw-aegis
```

### From source

```bash
git clone https://github.com/Canary-Builds/openclaw-aegis.git
cd openclaw-aegis
npm install
npm run build
npm link
```

## Setup

### Auto mode (zero prompts)

```bash
aegis init --auto
```

This detects your gateway port from `~/.openclaw/openclaw.json`, sets sensible defaults, and writes the config to `~/.openclaw/aegis/config.toml`.

### Interactive mode

```bash
aegis init
```

Walks you through:
1. Gateway port (auto-detected)
2. Memory threshold
3. Alert channels (ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, webhook)

## Verify

```bash
aegis check
```

Expected output:
```
Health: HEALTHY (score: 10)
Probes: 10 passed, 0 failed
```

### Detailed status

```bash
aegis status
```

Shows each probe individually:
```
Health: HEALTHY (score: 10)

  + process (27ms)
  + port (79ms)
  + http (80ms)
  + config (1ms)
  + tun (72ms)
  + memory (17ms)
  + cpu (1021ms)
  + disk (29ms)
  + logTail (0ms)
  + websocket (25ms)
```

## Test Alerts

After configuring alert channels:

```bash
aegis test-alert
```

```
Sending test alert to 1 channel(s)...

  + telegram: sent (342ms)

Test alert sent successfully.
```

## What's Next

- [Configuration Reference](configuration.md) — tune thresholds, add alert channels
- [Architecture](architecture.md) — understand the probe pipeline and recovery tiers
- [Alerts](alerts.md) — set up ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, or webhooks

# OpenClaw Aegis

**Self-healing sidecar for the OpenClaw Gateway.**

Aegis monitors your OpenClaw gateway, detects failures in seconds, fixes them automatically, and alerts you through out-of-band channels that don't depend on the gateway being up.

[![npm](https://img.shields.io/npm/v/openclaw-aegis)](https://www.npmjs.com/package/openclaw-aegis)
[![CI](https://github.com/Canary-Builds/openclaw-aegis/actions/workflows/ci.yml/badge.svg)](https://github.com/Canary-Builds/openclaw-aegis/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why Aegis?

When your OpenClaw gateway crashes, **everything goes dark** — Telegram, WhatsApp, all channels. If the crash was caused by a bad config, restarting doesn't help. The `.bak` files may contain the same poison. You only find out when you notice messages aren't arriving.

Aegis prevents this:

1. **Detects** failures via 10 health probes (process, port, config, memory, CPU, disk, logs, network, WebSocket, HTTP)
2. **Diagnoses** the root cause using 6 failure pattern matchers
3. **Fixes** automatically — restores known-good config, clears stale PIDs, runs safe `doctor --fix`
4. **Alerts** you through channels that bypass the gateway entirely (ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, webhook)
5. **Responds** to bot commands — message `/health` on Telegram, WhatsApp, Slack, or Discord and get real-time status

**Total downtime: ~15 seconds instead of hours.**

---

## Quick Start

```bash
# Install
npm install -g openclaw-aegis

# Configure (auto-detects your gateway)
aegis init --auto

# Verify
aegis check
```

Output:
```
Health: HEALTHY (score: 10)
Probes: 10 passed, 0 failed
```

---

## Commands

| Command | Description |
|---------|-------------|
| `aegis init` | Interactive setup wizard |
| `aegis init --auto` | Auto-detect everything, zero prompts |
| `aegis check` | Run all 10 health probes once |
| `aegis check --json` | JSON output for scripting |
| `aegis status` | Health dashboard with per-probe details |
| `aegis test-alert` | Send a test notification to all configured channels |
| `aegis incidents` | Browse past incident logs |
| `aegis incidents <id>` | Show full timeline for a specific incident |
| `aegis serve` | Start REST API server + bot listeners |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first setup, verification |
| [Architecture](docs/architecture.md) | System design, probe pipeline, recovery tiers |
| [Configuration](docs/configuration.md) | Full TOML reference with every option |
| [Alerts](docs/alerts.md) | Setting up ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, webhooks |
| [CLI Reference](docs/cli-reference.md) | Every command with examples and options |
| [Contributing](docs/contributing.md) | Development setup, testing, PR process |
| [Releasing](docs/releasing.md) | Version bumps, npm publish, GitHub releases |
| [Roadmap](docs/roadmap.md) | Feature timeline, planned phases, inspiration sources |

---

## How It Works

```
OpenClaw Gateway                  Aegis Sidecar
┌─────────────────────┐          ┌──────────────────────────────┐
│                     │          │  Health Monitor (10 probes)  │
│  ~/.openclaw/       │◄────────►│  Config Guardian             │
│    openclaw.json    │          │  Dead Man's Switch           │
│    logs/            │          │  Recovery Orchestrator        │
│                     │          │    L1: Restart               │
│  systemd/launchd    │◄─────────│    L2: Targeted Repair       │
│                     │          │    L4: Human Alert           │
└─────────────────────┘          │  Alert Dispatcher            │
                                 │  (8 alert providers)         │
                                 └──────────────────────────────┘
                                          │
                                    Out-of-band
                                    (never through
                                     the gateway)
                                          │
                                          ▼
                                      Your phone
```

---

## Requirements

- Node.js >= 18
- OpenClaw Gateway (any version with `openclaw gateway health` support)
- Linux (systemd) or macOS (launchd)

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Canary Builds](https://canarybuilds.com).

# Architecture

## Overview

Aegis is a sidecar process that runs alongside your OpenClaw gateway. It continuously monitors gateway health, detects failures, attempts automatic recovery, and alerts you through out-of-band channels when human intervention is needed.

```
┌─────────────────────────────────────────────────────────┐
│                      AEGIS DAEMON                       │
│                                                         │
│  ┌─────────────────┐     ┌──────────────────────┐      │
│  │  Health Monitor  │     │   Config Guardian     │      │
│  │  (10 Probes)     │────►│  (Dead Man's Switch)  │      │
│  └────────┬─────────┘     └──────────┬───────────┘      │
│           │                          │                   │
│           ▼                          ▼                   │
│  ┌─────────────────┐     ┌──────────────────────┐      │
│  │ Diagnosis Engine │     │   Backup Manager      │      │
│  │ (6 Patterns)     │     │  (Known-Good Track)   │      │
│  └────────┬─────────┘     └──────────────────────┘      │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────────────────────────────────┐       │
│  │           Recovery Orchestrator               │       │
│  │  L1: Restart │ L2: Repair │ L3: Deep │ L4: Alert │   │
│  └──────────────────────────────────────────────┘       │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────┐     ┌──────────────────────┐      │
│  │ Incident Logger  │     │  Alert Dispatcher     │      │
│  │ (Timeline+MTTR)  │     │  (Out-of-band)        │      │
│  └─────────────────┘     └──────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Health Monitor

The monitor runs all 10 probes on a configurable interval (default: 10 seconds). Each probe returns a health score (0 = failed, 1 = degraded, 2 = healthy) weighted by importance.

### Probe Pipeline

```
Every 10s:
  Run all 10 probes in parallel (with per-probe timeout)
    → Compute aggregate health score
    → Classify: HEALTHY / DEGRADED / CRITICAL
    → If DEGRADED for N consecutive checks → escalate
    → If CRITICAL → escalate immediately
```

### Ten Health Probes

| Probe | Weight | What It Checks | Failure Indicates |
|-------|--------|----------------|-------------------|
| **process** | 2 | PID alive via systemd/launchd or `kill -0` | Crash, OOM kill |
| **port** | 2 | TCP connect to gateway port | Zombie process, port conflict |
| **http** | 2 | `openclaw gateway health` exit code | Internal gateway error |
| **config** | 2 | Valid JSON, no poison keys | Config corruption |
| **websocket** | 1 | WS handshake to gateway | Protocol/auth failure |
| **tun** | 1 | Default route exists, TUN if configured | Network issues |
| **memory** | 1 | RSS below threshold (via `/proc` on Linux, `ps` on macOS) | Memory leak, approaching OOM |
| **cpu** | 1 | CPU % below threshold (via `/proc` on Linux, `ps` on macOS) | Infinite loop, runaway |
| **disk** | 1 | Sufficient space on config partition | Disk full |
| **logTail** | 1 | Recent error patterns in gateway logs | Emerging issues |

### Health Scoring

- **Max score**: 20 (all probes at weight × 2)
- **Healthy**: score >= 7 (configurable)
- **Degraded**: score >= 4 (configurable)
- **Critical**: score < 4

Degraded requires N consecutive confirmations before escalation (default: 2) to prevent flapping.

### PID Resolution

Aegis resolves the gateway PID using a platform-aware strategy:

1. **launchd** (macOS): `launchctl list <label>` — parses PID from output
2. **systemd** (Linux): `systemctl --user show -p MainPID <unit>`
3. **PID file** (fallback): reads the configured PID file path

Platform is auto-detected at runtime. This handles standard OpenClaw installations on both Linux (systemd user service) and macOS (launchd), plus custom setups using PID files.

## Config Guardian

### Dead Man's Switch

Protects against bad config changes:

```
1. Config file changes detected (via polling)
2. Backup current config → ~/.openclaw/aegis/backups/
3. Start 30s countdown
4. Monitor health during countdown
5. If healthy when timer expires → commit as known-good
6. If unhealthy → AUTO-ROLLBACK to last known-good config
```

### Config-Write Storm Protection

The `ConfigChangeDetector` watches `openclaw.json` for rapid writes. If more than 5 changes occur in 60 seconds, it flags a storm event. This prevents overlapping recovery cycles during config migrations.

### Pre-flight Validation

Before any restart, the guardian checks:
- Config file exists and is valid JSON
- No poison keys (`autoAck`, `autoAckMessage`)

If pre-flight fails, **L1 restart is blocked** — no crash loop.

## Recovery Orchestrator

### Four-Tier Cascade

**L1 — Quick Restart (5s)**
- Pre-flight config validation first
- If config valid: `openclaw gateway restart`
- If config invalid: skip, escalate to L2
- Exponential backoff: 5s → 15s → 45s, max 3 attempts

**L2 — Targeted Repair (30s-2min)**
- Diagnosis engine matches against 6 known failure patterns
- Applies targeted fix, then retries L1
- 2 attempts with 60s cooldown

**L3 — Deep Repair (30s-2min)**
- Riskier automated fixes that go beyond pattern matching
- 5 repair strategies: network repair, process resurrection, dependency rebuild, safe mode boot, disk cleanup
- 2 attempts with 30s cooldown between each
- If L3 succeeds, retries L1 restart

**L4 — Human Alert (instant)**
- Full incident report with timeline
- Out-of-band delivery — never through the gateway
- Alert includes health score, recovery actions taken, and failure reason

### L3 Deep Repair — 5 Strategies

| # | Strategy | Detection | Fix |
|---|----------|-----------|-----|
| 1 | **Network repair** | DNS fails, TUN device down, no default route | Flush DNS cache, bring TUN up, restore routing |
| 2 | **Process resurrection** | `openclaw` binary missing from PATH | `npm install -g openclaw` to reinstall |
| 3 | **Dependency health** | node_modules missing, corrupted lock file, failed require | Delete node_modules and `npm install --production` |
| 4 | **Safe mode boot** | Process dead, config valid, normal restart failed | Start with minimal config (no plugins, default routes) |
| 5 | **Disk cleanup** | Less than 50MB free on config partition | Truncate logs, delete rotated logs, clear temp files |

### Diagnosis Engine — 6 Failure Patterns

| # | Pattern | Detection | Fix |
|---|---------|-----------|-----|
| 1 | **Runtime config injection** | Poison keys in config (`autoAck`, `autoAckMessage`) | Restore known-good config |
| 2 | **Stale PID file** | PID file exists but process is dead | Delete PID file |
| 3 | **Port conflict** | Another process holds the gateway port | Report conflicting PIDs |
| 4 | **File permission error** | Config file has wrong permissions | Fix to 0600 |
| 5 | **Config corrupted** | Invalid JSON or missing required keys | Restore known-good config |
| 6 | **OOM kill** | `oom_kill_process` in dmesg | Escalate to L4 (can't auto-fix) |

### Anti-Flap Protection

- **Crash counter**: sliding window of 5 restarts in 15 minutes
- **Cooldown**: 10 minutes after exceeding window
- **Circuit breaker**: 3 full escalation cycles in 1 hour → stop all auto-recovery, alert human
- **Decay**: crash counter resets after 6 hours of stability

## Backup Manager

Two-tier backup system:

### Chronological Backups
- Timestamped snapshots of `openclaw.json`
- Created on every config change detected
- Rotated: keeps last 20 (configurable)
- Stored at `~/.openclaw/aegis/backups/chronological/`

### Known-Good Configs
- Promoted from chronological after 60s of confirmed stability
- **Separate from OpenClaw's `.bak` chain** — guaranteed to work
- Keeps last 5 (configurable)
- Stored at `~/.openclaw/aegis/backups/known-good/`

All backups use atomic writes (write to `.tmp`, then `rename`) and SHA-256 integrity checks on restore.

## Alert Dispatcher

Alerts are sent **out-of-band** — directly to external APIs, never through the OpenClaw gateway. This ensures you get notified even when the gateway is completely down.

Supported providers:
- **ntfy** — push notifications via ntfy.sh
- **Telegram** — direct Telegram Bot API
- **WhatsApp** — Meta WhatsApp Business Cloud API
- **Slack** — Incoming Webhooks with mrkdwn formatting
- **Discord** — Webhooks with rich embeds, color-coded by severity
- **Email** — SMTP with STARTTLS/TLS support
- **Pushover** — push notifications with priority levels
- **Webhook** — generic HTTP POST with HMAC-SHA256 signing

Each alert is scrubbed for sensitive data (tokens, keys, passwords) before dispatch.

Retry: configurable attempts with exponential backoff (default: 3 attempts at 5s/15s/45s).

## Incident Logger

Every recovery action is logged with full timeline:

```
~/.openclaw/aegis/incidents/
  └── {incident-id}.jsonl    ← append-only event log
```

Events: `INCIDENT_START`, `L1_ATTEMPT`, `L1_SUCCESS`, `L2_ATTEMPT`, `DEAD_MAN_SWITCH_ROLLBACK`, `L4_ALERT`, `INCIDENT_RESOLVED`, `INCIDENT_UNRESOLVED`

Used for MTTR calculation and post-incident review.

## REST API

The API server (`aegis serve`) exposes all Aegis internals via JSON endpoints on localhost. Designed for dashboard integration — the OpenClaw dashboard can poll `/probes` every 10s and render a live health view.

18 endpoints covering health, probes, incidents, recovery, config, alerts, and system info. All sensitive data (tokens, passwords, webhook URLs) is scrubbed before sending. CORS enabled for frontend access.

## Bot Commands

Four platforms support two-way messaging — users send a command, Aegis replies with real-time data:

| Platform | Method | Notes |
|----------|--------|-------|
| **Telegram** | Long polling (`getUpdates`) | Reuses alert channel `botToken`/`chatId` |
| **WhatsApp** | Webhook server | Receives Meta Cloud API callbacks |
| **Slack** | Slash commands | HTTP endpoint with HMAC-SHA256 verification |
| **Discord** | REST polling | Polls channel messages every 2s |

Push-only providers (ntfy, Email, Pushover, Webhook) remain alert-only.

8 commands: `/health`, `/status`, `/incidents`, `/recovery`, `/backups`, `/alerts`, `/version`, `/help`

## Platform Adapters

### systemd (Linux)

Integrates with the existing `openclaw-gateway.service`:
- PID resolution via `systemctl --user show`
- Watchdog heartbeat via `sd_notify`
- Hardened service parameters: `StartLimitIntervalUSec=120s` (fixes the default 10s which only allows 1 retry)

### launchd (macOS)

Generates a plist for `~/Library/LaunchAgents/` with keep-alive and watchdog support.

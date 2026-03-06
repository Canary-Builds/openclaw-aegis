# Changelog

All notable changes to OpenClaw Aegis are documented here.

## [1.2.0] - 2026-03-06

### Added

- `aegis incidents` — browse past incident logs with timeline view
- `aegis incidents <id>` — full event timeline for a specific incident
- `--json` and `--last N` options for scripting

### Fixed

- `aegis --version` now reads from `package.json` instead of hardcoded value

## [1.1.0] - 2026-03-06

### Added

- **Discord** alert provider — rich embeds with color-coded severity
- **Email (SMTP)** alert provider — STARTTLS and direct TLS support
- **Pushover** alert provider — push notifications with priority mapping
- **Slack** alert provider — Incoming Webhooks with mrkdwn formatting

## [1.0.0] - 2026-03-06

### Added

- **Health Monitor** with 10 probes: process, port, HTTP, config, WebSocket, TUN/network, memory, CPU, disk, log tail
- **Health scoring** with configurable bands (HEALTHY/DEGRADED/CRITICAL) and weighted probe scores
- **PID resolution** via systemd (`systemctl --user show`) with PID file fallback
- **Config Guardian** with dead man's switch — auto-rollback on bad config changes within 30s
- **Config-write storm protection** — detects rapid config changes and prevents overlapping recovery
- **Pre-flight validation** — blocks restart if config is invalid, missing required keys, or contains poison keys
- **Recovery Orchestrator** with 4-tier cascade:
  - L1: Quick restart with exponential backoff (5s/15s/45s, 3 attempts)
  - L2: Targeted repair via 6 failure pattern matchers
  - L4: Human alert with full incident timeline
- **Diagnosis Engine** matching 6 failure patterns:
  - Runtime config injection (poison keys)
  - Stale PID file
  - Port conflict
  - File permission error
  - Config corruption
  - OOM kill
- **Anti-flap protection** — sliding window crash counter, cooldown, decay
- **Circuit breaker** — stops auto-recovery after 3 failed escalation cycles in 1 hour
- **Backup Manager** with two-tier system:
  - Chronological snapshots (last 20)
  - Known-good configs promoted after 60s stability (last 5)
  - Atomic writes with SHA-256 integrity verification
- **Alert Dispatcher** with 8 out-of-band providers:
  - ntfy (push notifications)
  - Telegram (Bot API with MarkdownV2)
  - WhatsApp (Business Cloud API)
  - Slack (Incoming Webhooks with mrkdwn)
  - Discord (Webhooks with rich embeds, color-coded)
  - Email (SMTP with STARTTLS/TLS)
  - Pushover (push notifications with priority mapping)
  - Webhook (HTTP POST with HMAC-SHA256 signing)
- **Sensitive data scrubbing** on all outbound alerts
- **Alert retry** with configurable exponential backoff
- **Incident Logger** with append-only JSONL event logs and MTTR tracking
- **CLI commands**:
  - `aegis init` — interactive setup wizard with `--auto` mode
  - `aegis check` — one-shot health check with `--json` output
  - `aegis status` — color-coded health dashboard
  - `aegis test-alert` — send test notifications to all channels
- **Platform adapters** for systemd (Linux) and launchd (macOS)
- **TOML configuration** with full schema validation (Zod)
- **Path expansion** — `~` resolved at config load time

### Infrastructure

- TypeScript with strict mode, ES2022 target
- tsup for bundling
- Vitest for testing
- ESLint + Prettier for code quality
- Node.js >= 18 required

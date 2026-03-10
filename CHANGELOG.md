# Changelog

All notable changes to OpenClaw Aegis are documented here.

## [1.12.0] - 2026-03-11

### Added

- **Maintenance windows** — scheduled alert and recovery suppression during planned downtime
  - `MaintenanceWindow` class with activate/deactivate/auto-expiry and fail-open design
  - `[maintenance]` config section with `maxDurationMs` safety cap (default: 4 hours)
  - REST API: `GET /maintenance`, `POST /maintenance/activate`, `POST /maintenance/deactivate`
  - CLI: `aegis maintenance on [duration]`, `aegis maintenance off`, `aegis maintenance status`
  - Health probes continue running during maintenance; only alerts and recovery are suppressed
  - Auto-expiry timer with periodic warnings every 15 minutes
  - Startup log message confirms no active maintenance window
  - Incident logging for MAINTENANCE_ACTIVATED, MAINTENANCE_DEACTIVATED, ESCALATION_SUPPRESSED events

## [1.11.0] - 2026-03-15

### Added

- **Zero-touch auto-install** — `npm install -g openclaw-aegis` now does everything automatically
  - Auto-generates config via `aegis init --auto` if `~/.openclaw/aegis/config.toml` is missing
  - Creates and enables systemd user service on Linux (`~/.config/systemd/user/openclaw-aegis.service`)
  - Creates and loads launchd plist on macOS (`~/Library/LaunchAgents/com.openclaw.aegis.plist`)
  - Enables `loginctl enable-linger` so the service persists after logout (Linux)
  - Skips automatically in CI environments (`CI` or `AEGIS_SKIP_POSTINSTALL` env vars)
  - Graceful fallback: warns but doesn't crash the install if any step fails
- New file: `scripts/postinstall.js` — npm postinstall hook for automatic service setup

## [1.10.0] - 2026-03-14

### Added

- **Alert noise reduction** — intelligent alert grouping, deduplication, and escalation
  - Groups related alerts by normalized severity + title pattern
  - Deduplication: suppresses repeated alerts after configurable threshold (default: 3)
  - Digest mode: batches grouped alerts into periodic summaries (default: every 5 min)
  - Smart escalation: auto-escalates recurring alerts to critical after 15 min
  - Buffer overflow protection: forces flush at configurable max buffer size
  - Suppression rate tracking and active group monitoring
- New config section: `[intelligence.noiseReduction]` with 6 tunable parameters
- 2 new API endpoints:
  - `GET /alerts/noise` — noise reduction statistics (suppression rate, grouped/escalated counts)
  - `GET /alerts/groups` — active alert groups with counts and escalation status
- Total API endpoints: 35 (was 33)
- **Phase 5 Intelligence complete** — all 5 features shipped (anomaly detection, predictive alerts, root cause analysis, YAML runbooks, noise reduction)

## [1.9.0] - 2026-03-13

### Added

- **YAML runbook engine** — user-defined recovery playbooks with custom triggers and step sequences
  - Trigger on probe failures, health bands, or message patterns
  - Steps: `run` (shell commands), `wait` (delays), `log` (messages)
  - Runbooks execute before standard L1/L2/L3 recovery — if a runbook resolves the issue, recovery is skipped
  - Timeout protection (default 60s per runbook)
  - Supports both JSON and YAML format runbook files
  - `escalate_if_fails` option to continue to standard recovery on failure
- New config section: `[intelligence.runbooks]` (`enabled`, `basePath`)
- 2 new API endpoints:
  - `GET /runbooks` — list loaded runbook definitions
  - `GET /runbooks/results` — results from last runbook evaluation
- Total API endpoints: 33 (was 31)

## [1.8.0] - 2026-03-12

### Added

- **Root cause analysis engine** — correlates probe failures, log patterns, and incident events to identify why failures happen
  - 10 failure signatures: OOM kill, port conflict, config corruption, network failure, disk exhaustion, CPU saturation, channel disconnect, process crash, WebSocket failure, cascading failure
  - Confidence scoring based on required probe matches, optional probe correlation, and log pattern evidence
  - Per-incident analysis: `GET /rca/:incidentId` for post-mortem investigation
  - Live analysis: `GET /rca` for current state root cause identification
  - Actionable suggestions for each identified root cause
  - Auto-runs during escalation, results logged to incident timeline
- 2 new API endpoints:
  - `GET /rca` — live root cause analysis
  - `GET /rca/:incidentId` — root cause analysis for specific incident
- Total API endpoints: 31 (was 29)

## [1.7.0] - 2026-03-11

### Added

- **Predictive alerts** — trend analysis engine that projects when thresholds will be breached
  - Memory exhaustion: projects when memory probe score will reach critical based on declining trend
  - Disk full: projects when disk probe score will hit zero based on fill rate
  - Score degradation: projects when aggregate health score will drop below HEALTHY threshold
  - Latency breach: projects when probe latency will exceed timeout for HTTP, port, WebSocket probes
  - Linear regression with R² confidence scoring
  - Configurable warning horizon (default: 1h), runs every 10th health check to save CPU
- New config section: `[intelligence.predictive]` with 5 tunable parameters
- 1 new API endpoint:
  - `GET /predictions` — current predictions with estimated time-to-threshold
- Total API endpoints: 29 (was 28)

## [1.6.0] - 2026-03-10

### Added

- **Anomaly detection engine** — learns baseline health patterns and alerts on statistical deviations
  - Score anomaly: detects when aggregate health score drops below baseline (configurable σ threshold)
  - Latency anomaly: detects per-probe latency spikes beyond normal variance
  - Failure rate anomaly: detects sudden probe failure rate increases vs historical baseline
  - Requires confirmation (default 3 consecutive detections) before alerting to avoid false positives
  - Alert cooldown (default 15 min) prevents notification spam
  - Feeds from existing health history time-series data
- New config section: `[intelligence.anomaly]` with 7 tunable parameters
- 2 new API endpoints:
  - `GET /anomalies` — currently detected anomalies
  - `GET /anomalies/baselines` — computed baselines for score and all probes
- Total API endpoints: 28 (was 26)

## [1.5.3] - 2026-03-09

### Added

- **Interactive `/repair` bot command** — two-step confirmation flow for on-demand L3 deep repair
  - `/repair` shows a warning listing all 5 destructive L3 strategies and their impact
  - `/repair confirm` executes L3 deep repair and returns per-action results
  - Works even when `l3Enabled = false` in config — gives users manual control when automated L3 is disabled
- New public `triggerL3()` method on `RecoveryOrchestrator` for programmatic L3 invocation

## [1.5.2] - 2026-03-09

### Changed

- **L3 deep repair is now disabled by default** (`l3Enabled = false`) — L3 strategies (network repair, process resurrection, dependency rebuild, safe mode boot, disk cleanup) are destructive and can affect other services on the server
- When L3 is disabled and recovery reaches L4, the alert message explicitly tells you L3 is disabled and how to enable it (`l3Enabled = true` in `[recovery]` config)
- New recovery event: `L3_DISABLED` — emitted when L3 would have run but is turned off

## [1.5.1] - 2026-03-09

### Added

- **Channel readiness probe** — 11th health probe that checks all configured messaging channels (WhatsApp, Telegram, etc.) are actually connected and ready to deliver messages via `openclaw channels status --json`
  - Score 2: all channels ready
  - Score 1: some channels degraded (running but not connected)
  - Score 0: no channels running or command failed
- Detects WhatsApp Web listener disconnections, Telegram bot failures, and startup gaps where channels aren't ready yet

## [1.5.0] - 2026-03-09

### Added

- **Prometheus `/metrics` endpoint** — exposes health scores, probe results, recovery counts, circuit breaker state, alert stats, MTTR, and process memory in Prometheus text exposition format
- **Structured JSON logging** — JSONL format logs compatible with Loki, ELK, Datadog. Configurable log level, file output, and stdout toggle
- **Health history time-series** — stores every health check result over time (default: 24 hours at 10s intervals). Query by time range or count, compute trend statistics
- **SLA tracking and uptime reports** — calculates uptime percentages, time in each health band, incident counts, and MTTR for any time period (1h/24h/7d/30d presets)
- **Recovery tracing** — records structured spans for every recovery step with timing, compatible with OpenTelemetry JSON format for import into Jaeger/Tempo
- 8 new API endpoints:
  - `GET /metrics` — Prometheus scrape target
  - `GET /health/history` — time-series health data (`?since=1h` or `?count=100`)
  - `GET /health/history/stats` — aggregated health statistics
  - `GET /health/history/probe/:name` — per-probe trend data
  - `GET /sla` — uptime reports for all periods
  - `GET /sla/:period` — uptime report for specific period
  - `GET /traces` — recent recovery traces
  - `GET /traces/:traceId` — full span detail for a trace
- New config section: `[observability]` with `logging`, `healthHistory`, and `tracing` subsections
- Total API endpoints: 26 (was 18)

## [1.4.0] - 2026-03-09

### Added

- **L3 Deep Repair** recovery tier between L2 (targeted) and L4 (human escalation)
  - **Network repair**: DNS cache flush, TUN interface reset, default route detection
  - **Process resurrection**: Reinstall gateway binary via `npm install -g openclaw` if missing
  - **Dependency health**: Detect corrupted node_modules, rebuild with `npm install --production`
  - **Safe mode boot**: Start gateway with minimal config (no plugins, default routes) when normal restart fails
  - **Disk cleanup**: Truncate oversized logs, delete rotated log files, clear temp directories
- Recovery cascade now: L1 → L2 → L3 → L4 (was L1 → L2 → L4)
- New recovery events: `L3_ATTEMPT`, `L3_SUCCESS`, `L3_FAILURE`, `L3_NO_MATCH`
- New config options: `l3MaxAttempts`, `l3CooldownMs`, `l3SafeModeArgs`

## [1.3.0] - 2026-03-06

### Added

- **REST API server** (`aegis serve`) — 18 JSON endpoints for dashboard integration
  - Health, probes, incidents, recovery, config, alerts, system info
  - CORS enabled, sensitive data auto-scrubbed
  - Zero external dependencies (uses `node:http`)
- **Two-way bot commands** for Telegram, WhatsApp, Slack, Discord
  - 8 commands: `/health`, `/status`, `/incidents`, `/recovery`, `/backups`, `/alerts`, `/version`, `/help`
  - Telegram: long polling via `getUpdates` API
  - WhatsApp: webhook server for Meta Cloud API callbacks
  - Slack: slash command endpoint with HMAC signature verification
  - Discord: REST API polling with message commands
  - Reuses existing alert channel credentials
- New `[api]` config section: `enabled`, `port`, `host`
- New `[bot]` config section with per-platform enable flags

## [1.2.3] - 2026-03-06

### Fixed

- Gateway port is now auto-detected from `~/.openclaw/openclaw.json` at runtime instead of using a hardcoded default
- Shared `detectGatewayPort()` used by both `aegis init` and config loader — no more mismatched ports

## [1.2.2] - 2026-03-06

### Fixed

- Config probe no longer requires `gateway.port` in `openclaw.json` — the key is optional in OpenClaw and Aegis already knows the port from its own config

## [1.2.1] - 2026-03-06

### Fixed

- macOS: memory probe now uses `ps -o rss=` instead of `/proc` (which doesn't exist on macOS)
- macOS: CPU probe now uses `ps -o %cpu=` instead of `/proc`
- Config probe accepts `port` at top level or nested under `gateway` (fixes false "missing gateway.port" error)

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

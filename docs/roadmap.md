# Roadmap

For the interactive scrollable timeline, open [roadmap.html](roadmap.html) in your browser.

## Timeline Overview

### Phase 1: Foundation (v1.0-v1.2) — Shipped
- 10 health probes (process, port, HTTP, config, WebSocket, TUN, memory, CPU, disk, log tail)
- L1/L2/L3/L4 recovery cascade with anti-flap and circuit breaker
- 8 alert providers (ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, webhook)
- Config guardian with dead man's switch and two-tier backup
- Cross-platform: macOS (launchd) + Linux (systemd)

### Phase 2: Integration (v1.3) — Shipped
- REST API server (18 JSON endpoints)
- Two-way bot commands (Telegram, WhatsApp, Slack, Discord)
- Auto port detection from openclaw.json
- Incident browser CLI

### Phase 3: L3 Recovery (v1.4) — Shipped
- **Deep repair tier** between L2 (targeted) and L4 (human)
- Network repair (DNS, routes, TUN resets)
- Process resurrection (re-download/reinstall)
- Dependency health (node_modules integrity)
- Safe mode boot (minimal config startup)

### Phase 4: Observability (v1.5) — Shipped
- Prometheus /metrics endpoint (26 metric families)
- Structured JSON logging (Loki/ELK compatible, configurable level/output)
- Health history time-series (24h default, per-probe trends)
- SLA tracking and uptime reports (1h/24h/7d/30d presets)
- OpenTelemetry-compatible recovery traces (span-level timing)

### Phase 5: Intelligence (v2.0) — Planned
- Anomaly detection (baseline + deviation)
- Predictive alerts (memory leak trajectory, disk fill rate)
- Root cause analysis (correlate probes + logs + events)
- User-defined YAML runbooks
- Alert noise reduction (grouping, dedup, smart escalation)

### Phase 6: Fleet Management (v2.1) — Planned
- **Fleet mode** — monitor multiple OpenClaw instances, not just local
- **Remote probes** — health check remote nodes over Tailscale/WireGuard
- **Per-client dashboard** — usage, status, incidents per client
- **Deployment** — push updates to satellite nodes from central
- **Cost tracking** — tokens used per client per day
- Config sync with drift detection
- Rolling restarts across fleet

### Phase 7: Ecosystem (v2.2) — Planned
- Plugin system (custom probes, recovery actions, alert providers)
- Standalone web dashboard
- Terraform provider
- GitHub/GitLab integration (auto-create issues, deployment checks)

### Phase 8: Autonomous (v3.0) — Vision
- LLM-powered diagnosis
- Self-evolving runbooks (learn from recoveries)
- Chaos engineering (controlled fault injection)
- Security scanning (CVEs, permissions, exposed ports)
- Cross-service mesh monitoring

## Feature Inspiration

| Source | What We Took |
|--------|-------------|
| Monit | Process supervision, resource limits, anti-flap, network checks |
| PM2 | Memory auto-restart, platform adapters, CLI UX |
| Supervisord | Recovery cascade, event logging |
| Datadog | Anomaly detection, SLA tracking, metrics export |
| PagerDuty | Runbook automation, alert intelligence, MTTR |
| Grafana/Prometheus | Time-series metrics, health history |
| Netflix Chaos Monkey | Chaos engineering for recovery validation |
| Healthchecks.io | Dead man's switch, heartbeat monitoring |

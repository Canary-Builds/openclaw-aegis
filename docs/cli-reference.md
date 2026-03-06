# CLI Reference

## `aegis init`

Interactive setup wizard. Detects your gateway configuration and walks you through alert channel setup.

```bash
aegis init [--auto]
```

| Option | Description |
|--------|-------------|
| `--auto` | Auto-detect everything, zero prompts |

**Interactive mode** prompts for:
1. Gateway port (auto-detected from `~/.openclaw/openclaw.json`)
2. Memory threshold (default: 768MB)
3. Alert channels (ntfy, Telegram, WhatsApp, Slack, Discord, Email, Pushover, webhook)

Writes config to `~/.openclaw/aegis/config.toml` and runs a health check to verify.

**Auto mode** detects the gateway port, uses sensible defaults, and writes the config with no prompts:

```bash
$ aegis init --auto
Auto-detecting configuration...
  Gateway port: 3000
  PID source: openclaw-gateway.service (systemd)    # or ai.openclaw.gateway (launchd) on macOS
  Memory threshold: 768MB
Config written to ~/.openclaw/aegis/config.toml
Health: HEALTHY (10/10 probes passed)

Setup complete.
```

If a config already exists, interactive mode asks before overwriting. Auto mode always overwrites.

---

## `aegis check`

Runs all 10 health probes once and exits. Returns exit code 0 for healthy, 1 otherwise.

```bash
aegis check [--config <path>] [--json]
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Config file path (default: `~/.openclaw/aegis/config.toml`) |
| `--json` | Output as JSON |

**Standard output:**

```
Health: HEALTHY (score: 10)
Probes: 10 passed, 0 failed
```

**With failures:**

```
Health: DEGRADED (score: 6)
Probes: 8 passed, 2 failed

Failed probes:
  - memory: RSS 845MB exceeds threshold 768MB
  - logTail: 3 error patterns detected in recent logs
```

**JSON output** (`--json`):

```json
{
  "band": "healthy",
  "total": 10,
  "probeResults": [
    {
      "name": "process",
      "healthy": true,
      "score": 2,
      "latencyMs": 27,
      "message": null
    }
  ]
}
```

Useful for scripting and monitoring integrations:

```bash
# Nagios/Icinga check
aegis check --json | jq -e '.band == "healthy"'

# Cron health report
aegis check --json >> /var/log/aegis-health.jsonl
```

---

## `aegis status`

Health dashboard with per-probe details and color-coded output.

```bash
aegis status [--config <path>]
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Config file path (default: `~/.openclaw/aegis/config.toml`) |

**Output:**

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

Color codes:
- Green `+` = probe passed
- Red `-` = probe failed
- Health band: green (HEALTHY), yellow (DEGRADED), red (CRITICAL)

Warns if no alert channels are configured:

```
WARNING: No alert channels configured. Aegis cannot notify you during incidents. Run 'aegis init' to add alerts.
```

---

## `aegis test-alert`

Sends a test notification to all configured alert channels.

```bash
aegis test-alert [--config <path>]
```

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Config file path (default: `~/.openclaw/aegis/config.toml`) |

**Output:**

```
Sending test alert to 2 channel(s)...

  + telegram: sent (342ms)
  + ntfy: sent (156ms)

Test alert sent successfully.
```

Uses minimal retry (1 attempt, 1s backoff) to give fast feedback. Exits 0 on success, 1 if all channels fail.

If no channels are configured:

```
No alert channels configured. Run 'aegis init' to add one.
```

---

## `aegis incidents`

Browse past incident logs. Shows a summary of recent incidents with status, duration, and event count.

```bash
aegis incidents [incident-id] [--json] [--last <n>]
```

| Option | Description |
|--------|-------------|
| `[incident-id]` | Show full timeline for a specific incident |
| `--json` | Output as JSON |
| `--last <n>` | Show last N incidents (default: 10) |

**List view:**

```
3 incident(s) — 2 resolved, 1 unresolved

  + abc123  3/6/2026, 2:15:00 PM  14.2s  (5 events)
  + def456  3/5/2026, 9:30:00 AM  8.1s   (3 events)
  - ghi789  3/4/2026, 11:00:00 PM  ongoing  (7 events)

Run 'aegis incidents <id>' for details.
```

**Detail view** (`aegis incidents abc123`):

```
Incident: abc123
Status:   RESOLVED
Started:  2026-03-06T06:15:00.000Z
Duration: 14.2s

Timeline:

  14:15:00  > INCIDENT_START
  14:15:00  ~ L1_ATTEMPT (attempt 1)
  14:15:05  ~ L1_ATTEMPT (attempt 2)
  14:15:10  ~ L2_ATTEMPT — stale-pid
  14:15:11  + L2_SUCCESS — stale-pid
  14:15:14  + INCIDENT_RESOLVED
```

Incident logs are stored at `~/.openclaw/aegis/incidents/` as append-only JSONL files.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / Healthy |
| `1` | Failure / Unhealthy / All alerts failed |

---

## Global Config Path

All commands default to `~/.openclaw/aegis/config.toml`. Override with `-c` or `--config`:

```bash
aegis check --config /etc/aegis/custom.toml
aegis status -c ~/my-config.toml
```

# Configuration Reference

Aegis is configured via TOML at `~/.openclaw/aegis/config.toml`. Run `aegis init` to generate this file.

## Full Example

```toml
[gateway]
configPath = "~/.openclaw/openclaw.json"
pidFile = "openclaw-gateway.service"          # systemd unit name or path to PID file
port = 18789
logPath = "~/.openclaw/logs/gateway.log"
healthEndpoint = "/health"

[monitoring]
intervalMs = 10000                             # health check interval
probeTimeoutMs = 5000                          # per-probe timeout
configPollIntervalMs = 2000                    # config change detection interval
degradedConfirmationCount = 2                  # consecutive degraded checks before escalation

[health]
healthyMin = 7                                 # minimum score for HEALTHY band
degradedMin = 4                                # minimum score for DEGRADED band
memoryThresholdMb = 768                        # RSS above this = probe failure
cpuThresholdPercent = 90                       # CPU above this = probe failure
diskThresholdMb = 100                          # free space below this = probe failure

[recovery]
l1MaxAttempts = 3                              # restart attempts before escalating
l1BackoffBaseMs = 5000                         # initial backoff between restarts
l1BackoffMultiplier = 3                        # exponential multiplier (5s → 15s → 45s)
l2MaxAttempts = 2                              # targeted repair attempts
l2CooldownMs = 60000                           # cooldown between L2 attempts
circuitBreakerMaxCycles = 3                    # full escalation cycles before tripping
circuitBreakerWindowMs = 3600000               # circuit breaker window (1 hour)

[recovery.antiFlap]
maxRestarts = 5                                # max restarts in window before cooldown
windowMs = 900000                              # sliding window (15 minutes)
cooldownMs = 600000                            # cooldown duration (10 minutes)
decayMs = 21600000                             # counter decay after stability (6 hours)

[backup]
maxChronological = 20                          # chronological backup retention
maxKnownGood = 5                               # known-good config retention
knownGoodStabilityMs = 60000                   # stability period before promoting to known-good
basePath = "~/.openclaw/aegis/backups"

[deadManSwitch]
enabled = true
countdownMs = 30000                            # countdown after config change (30s)

[alerts]
retryAttempts = 3
retryBackoffMs = [5000, 15000, 45000]

[[alerts.channels]]
type = "telegram"
botToken = "123456789:ABCdefGHIjklMNOpqrsTUV"
chatId = "987654321"

[[alerts.channels]]
type = "slack"
webhookUrl = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
channel = "#alerts"                              # optional channel override

[[alerts.channels]]
type = "discord"
webhookUrl = "https://discord.com/api/webhooks/YOUR/WEBHOOK_URL"
username = "Aegis"                               # optional display name

[[alerts.channels]]
type = "email"
host = "smtp.gmail.com"
port = 587
secure = false
username = "you@gmail.com"
password = "app-password-here"
from = "aegis@yourdomain.com"
to = "alerts@yourdomain.com"

[[alerts.channels]]
type = "pushover"
apiToken = "your-app-api-token"
userKey = "your-user-key"
device = "myphone"                               # optional target device

[platform]
type = "systemd"                               # "systemd" or "launchd"
watchdogSec = 30
```

## Section Reference

### `[gateway]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `configPath` | string | `~/.openclaw/openclaw.json` | Path to OpenClaw gateway config |
| `pidFile` | string | `openclaw-gateway.service` | systemd unit name or PID file path |
| `port` | integer | `18789` | Gateway port (auto-detected by `aegis init`) |
| `logPath` | string | `~/.openclaw/logs/gateway.log` | Gateway log file path |
| `healthEndpoint` | string | `/health` | HTTP health check endpoint |

**pidFile** accepts two formats:
- **systemd unit name**: `openclaw-gateway.service` — resolves PID via `systemctl --user show`
- **File path**: `~/.openclaw/gateway.pid` — reads PID from file

### `[monitoring]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `intervalMs` | integer | `10000` | How often to run health probes (ms) |
| `probeTimeoutMs` | integer | `5000` | Per-probe timeout (ms) |
| `configPollIntervalMs` | integer | `2000` | Config change detection interval (ms) |
| `degradedConfirmationCount` | integer | `2` | Consecutive degraded checks before escalation |

### `[health]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `healthyMin` | integer | `7` | Minimum aggregate score for HEALTHY |
| `degradedMin` | integer | `4` | Minimum aggregate score for DEGRADED |
| `memoryThresholdMb` | integer | `512` | Memory probe fails above this (MB) |
| `cpuThresholdPercent` | integer | `90` | CPU probe fails above this (%) |
| `diskThresholdMb` | integer | `100` | Disk probe fails below this free space (MB) |

### `[recovery]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `l1MaxAttempts` | integer | `3` | Max restart attempts |
| `l1BackoffBaseMs` | integer | `5000` | Initial backoff (ms) |
| `l1BackoffMultiplier` | number | `3` | Exponential multiplier |
| `l2MaxAttempts` | integer | `2` | Max targeted repair attempts |
| `l2CooldownMs` | integer | `60000` | Cooldown between L2 attempts (ms) |
| `circuitBreakerMaxCycles` | integer | `3` | Escalation cycles before circuit breaker trips |
| `circuitBreakerWindowMs` | integer | `3600000` | Circuit breaker window (ms) |

### `[recovery.antiFlap]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxRestarts` | integer | `5` | Max restarts before cooldown |
| `windowMs` | integer | `900000` | Sliding window (15 min) |
| `cooldownMs` | integer | `600000` | Cooldown duration (10 min) |
| `decayMs` | integer | `21600000` | Counter decay after stability (6 hours) |

### `[backup]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxChronological` | integer | `20` | Chronological backup retention count |
| `maxKnownGood` | integer | `3` | Known-good config retention count |
| `knownGoodStabilityMs` | integer | `60000` | Stability period before promotion (ms) |
| `basePath` | string | `~/.openclaw/aegis/backups` | Backup storage directory |

### `[deadManSwitch]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable config change monitoring |
| `countdownMs` | integer | `30000` | Countdown after config change (ms) |

### `[alerts]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `retryAttempts` | integer | `3` | Alert delivery retry count |
| `retryBackoffMs` | integer[] | `[5000, 15000, 45000]` | Backoff between retries (ms) |

### `[[alerts.channels]]`

See [Alerts](alerts.md) for channel configuration.

### `[platform]`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `type` | string | `systemd` | `"systemd"` or `"launchd"` |
| `watchdogSec` | integer | `30` | Watchdog heartbeat interval (s) |

## Path Expansion

All paths support `~` expansion to the user's home directory. Paths are resolved at config load time.

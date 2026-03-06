# Contributing

## Development Setup

### Prerequisites

- Node.js >= 18
- npm >= 9

### Clone and Install

```bash
git clone https://github.com/Canary-Builds/openclaw-aegis.git
cd openclaw-aegis
npm install
```

### Build

```bash
npm run build
```

Uses [tsup](https://tsup.egoist.dev/) for fast TypeScript bundling. Output goes to `dist/`.

### Development Mode

```bash
npm run dev
```

Watches for changes and rebuilds automatically.

### Link for Local Testing

```bash
npm link
aegis check
```

## Project Structure

```
openclaw-aegis/
  src/
    cli/                    # CLI commands (commander.js)
      commands/
        init.ts             # aegis init — setup wizard
        check.ts            # aegis check — one-shot health check
        status.ts           # aegis status — dashboard
        test-alert.ts       # aegis test-alert — alert verification
      index.ts              # CLI entrypoint
    config/
      loader.ts             # TOML config loading and path expansion
      schema.ts             # Zod schema for config validation
    health/
      monitor.ts            # Health monitor — runs all probes
      probes/               # Individual health probes
        process.ts          # PID alive check
        port.ts             # TCP port check
        http.ts             # HTTP health endpoint
        config.ts           # Config file validation
        websocket.ts        # WebSocket handshake
        tun.ts              # TUN/network check
        memory.ts           # RSS memory usage
        cpu.ts              # CPU percentage
        disk.ts             # Free disk space
        log-tail.ts         # Error pattern scanning
        resolve-pid.ts      # Shared PID resolution (launchd + systemd + file)
    recovery/
      orchestrator.ts       # L1/L2/L4 recovery cascade
      circuit-breaker.ts    # Circuit breaker for recovery loops
    diagnosis/
      engine.ts             # 6 failure pattern matchers
    config-guardian/
      guardian.ts           # Preflight validation, config diff
      dead-man-switch.ts    # Config change rollback timer
    backup/
      manager.ts            # Two-tier backup (chronological + known-good)
    alerts/
      dispatcher.ts         # Alert dispatch with retry and scrubbing
      providers/
        ntfy.ts             # ntfy.sh push notifications
        telegram.ts         # Telegram Bot API
        whatsapp.ts         # WhatsApp Business Cloud API
        slack.ts            # Slack Incoming Webhooks
        discord.ts          # Discord Webhooks with embeds
        email.ts            # SMTP email (STARTTLS/TLS)
        pushover.ts         # Pushover push notifications
        webhook.ts          # Generic webhook with HMAC signing
    api/
      server.ts             # REST API server (18 endpoints)
    bot/
      commands.ts           # Shared command handler (8 commands)
      telegram.ts           # Telegram long polling listener
      whatsapp.ts           # WhatsApp webhook listener
      slack.ts              # Slack slash command listener
      discord.ts            # Discord REST polling listener
    daemon/
      index.ts              # Main daemon class
    types/
      index.ts              # Shared TypeScript types
  tests/
    config/                 # Config loading tests
    health/                 # Probe tests
  docs/                     # Documentation
```

## Testing

### Run Tests

```bash
npm test
```

Uses [Vitest](https://vitest.dev/) as the test runner.

### Watch Mode

```bash
npm run test:watch
```

### Coverage

```bash
npm run test:coverage
```

### Writing Tests

Tests live in `tests/` mirroring the `src/` structure. Example:

```typescript
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/loader.js";

describe("loadConfig", () => {
  it("should load defaults when no config exists", () => {
    const config = loadConfig("/nonexistent/path.toml");
    expect(config.gateway.port).toBe(3000);
  });
});
```

Key testing patterns:
- Mock `fs` operations for file-dependent probes
- Mock `child_process` for systemd/launchd/process probes
- Use real config files in `tests/fixtures/` for integration tests

## Code Quality

### Linting

```bash
npm run lint
```

Uses ESLint with `@typescript-eslint` rules.

### Formatting

```bash
npm run format        # fix
npm run format:check  # check only
```

Uses Prettier.

### Type Checking

```bash
npm run typecheck
```

Runs `tsc --noEmit` with strict mode enabled.

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Run the full check suite:
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
5. Commit with a clear message describing the change
6. Push and open a PR against `main`

### Commit Messages

Use conventional-style prefixes:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `test:` adding or fixing tests
- `refactor:` code change that neither fixes a bug nor adds a feature
- `chore:` maintenance (dependencies, CI, tooling)

### PR Checklist

- [ ] All tests pass (`npm test`)
- [ ] No type errors (`npm run typecheck`)
- [ ] No lint warnings (`npm run lint`)
- [ ] New features have tests
- [ ] Documentation updated if needed

## Architecture Notes

Before contributing, read the [Architecture](architecture.md) document. Key principles:

- **Out-of-band**: Alerts never route through the gateway
- **Pre-flight first**: Always validate config before restarting
- **Atomic writes**: Backups use write-then-rename to prevent corruption
- **No crash loops**: Anti-flap, circuit breaker, and exponential backoff prevent runaway restarts
- **Scrub before send**: Sensitive data is stripped from all outbound alerts

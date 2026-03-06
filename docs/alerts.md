# Alerts

Aegis sends alerts **out-of-band** — directly to external APIs, never through the OpenClaw gateway. This guarantees you get notified even when the gateway is completely down.

## How It Works

When recovery reaches L4 (or the circuit breaker trips), the Alert Dispatcher:

1. Scrubs sensitive data (tokens, keys, passwords) from the alert payload
2. Sends to every configured channel in sequence
3. Retries failed sends with exponential backoff (default: 3 attempts at 5s/15s/45s)
4. Reports per-channel results

## Providers

### ntfy

[ntfy](https://ntfy.sh) is a simple HTTP-based push notification service. Self-hostable or use the public instance.

```toml
[[alerts.channels]]
type = "ntfy"
topic = "aegis-alerts"
url = "https://ntfy.sh"
priority = 4
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | `"ntfy"` | yes | Provider identifier |
| `topic` | string | yes | ntfy topic name |
| `url` | string | yes | ntfy server URL |
| `priority` | integer | yes | Notification priority (1-5, where 5 = urgent) |

**Setup:**

1. Install [ntfy](https://ntfy.sh/docs/install/) on your phone
2. Subscribe to your chosen topic (e.g., `aegis-alerts`)
3. Add the config above
4. Run `aegis test-alert` to verify

**Self-hosted:** Replace `url` with your ntfy instance URL (e.g., `https://ntfy.example.com`).

---

### Telegram

Sends messages via the [Telegram Bot API](https://core.telegram.org/bots/api). Messages are formatted with MarkdownV2.

```toml
[[alerts.channels]]
type = "telegram"
botToken = "123456789:ABCdefGHIjklMNOpqrsTUV"
chatId = "987654321"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | `"telegram"` | yes | Provider identifier |
| `botToken` | string | yes | Bot token from @BotFather |
| `chatId` | string | yes | Chat/group/channel ID |

**Setup:**

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUV`)
4. Start a conversation with your bot (send `/start`)
5. Get your chat ID:
   ```bash
   curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
   ```
6. Add the config above with your token and chat ID
7. Run `aegis test-alert` to verify

**Group chats:** Add the bot to the group, send a message, then use `getUpdates` to find the group's chat ID (will be negative).

---

### WhatsApp

Sends messages via the [Meta WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api). This is Meta's official API — it requires a WhatsApp Business account.

```toml
[[alerts.channels]]
type = "whatsapp"
phoneNumberId = "1234567890"
accessToken = "EAAxxxxxxx..."
recipientNumber = "61412345678"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | `"whatsapp"` | yes | Provider identifier |
| `phoneNumberId` | string | yes | WhatsApp Business phone number ID |
| `accessToken` | string | yes | Cloud API access token |
| `recipientNumber` | string | yes | Recipient number with country code (no `+`) |

**Setup:**

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create or select an app with WhatsApp product enabled
3. In the WhatsApp section, find your **Phone Number ID** and generate a **temporary access token** (or create a permanent System User token)
4. The recipient number must include the country code without `+` (e.g., `61412345678` for Australia)
5. Add the config above
6. Run `aegis test-alert` to verify

**Why Business?** Meta only provides programmatic WhatsApp messaging through their Business Cloud API. There is no consumer API. The free tier includes 1,000 conversations per month, which is more than enough for alert notifications.

---

### Slack

Sends messages via [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks). Uses Slack's mrkdwn formatting.

```toml
[[alerts.channels]]
type = "slack"
webhookUrl = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
channel = "#alerts"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | `"slack"` | yes | Provider identifier |
| `webhookUrl` | string | yes | Slack Incoming Webhook URL |
| `channel` | string | no | Channel override (e.g., `#alerts`) |

**Setup:**

1. Go to your Slack workspace settings or visit [Slack API: Incoming Webhooks](https://api.slack.com/messaging/webhooks)
2. Create a new app (or use an existing one) and enable **Incoming Webhooks**
3. Click **Add New Webhook to Workspace** and select the channel
4. Copy the webhook URL (format: `https://hooks.slack.com/services/T.../B.../xxx`)
5. Add the config above
6. Run `aegis test-alert` to verify

**Channel override:** By default, messages go to the channel selected when creating the webhook. Set `channel` to override (the app must have permission to post there).

---

### Webhook

Sends a JSON POST to any URL. Optionally signed with HMAC-SHA256 for verification.

```toml
[[alerts.channels]]
type = "webhook"
url = "https://your-server.com/aegis-webhook"
secret = "your-hmac-secret"
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | `"webhook"` | yes | Provider identifier |
| `url` | string | yes | HTTP(S) endpoint URL |
| `secret` | string | no | HMAC-SHA256 signing secret |

**Request format:**

```http
POST /aegis-webhook HTTP/1.1
Content-Type: application/json
X-Aegis-Signature: sha256=<hmac-hex-digest>

{
  "severity": "critical",
  "title": "Gateway Down — Recovery Failed",
  "body": "L1 restart failed (3 attempts). L2 repair failed...",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Signature verification** (Node.js example):

```javascript
const crypto = require("crypto");

function verify(body, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}
```

The `X-Aegis-Signature` header is only present when `secret` is configured.

## Multiple Channels

You can configure multiple channels. Aegis sends to all of them:

```toml
[alerts]
retryAttempts = 3
retryBackoffMs = [5000, 15000, 45000]

[[alerts.channels]]
type = "telegram"
botToken = "123456789:ABCdefGHIjklMNOpqrsTUV"
chatId = "987654321"

[[alerts.channels]]
type = "ntfy"
topic = "aegis-alerts"
url = "https://ntfy.sh"
priority = 4
```

An alert is considered "sent" if **at least one** channel succeeds.

## Retry Behavior

Each channel is retried independently:

| Attempt | Default Delay |
|---------|---------------|
| 1st retry | 5 seconds |
| 2nd retry | 15 seconds |
| 3rd retry | 45 seconds |

Configure via `[alerts]`:

```toml
[alerts]
retryAttempts = 3
retryBackoffMs = [5000, 15000, 45000]
```

## Sensitive Data Scrubbing

Before dispatch, alert payloads are scrubbed. Any JSON key containing `key`, `secret`, `token`, `password`, `credential`, or `auth` has its value replaced with `[REDACTED]`.

This prevents accidental leakage of config secrets in alert messages.

## Alert Severity Levels

| Severity | When | ntfy Priority | Telegram/Slack Icon |
|----------|------|---------------|---------------------|
| `critical` | Gateway down, recovery failed | 5 (urgent) | Red siren / `:rotating_light:` |
| `warning` | Degraded, circuit breaker | 4 (high) | Warning sign / `:warning:` |
| `info` | Test alerts, recovery success | 3 (default) | Info / `:information_source:` |

## Testing

After configuring channels:

```bash
aegis test-alert
```

```
Sending test alert to 2 channel(s)...

  + telegram: sent (342ms)
  + ntfy: sent (156ms)

Test alert sent successfully.
```

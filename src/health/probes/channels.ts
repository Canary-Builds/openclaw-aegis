import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HealthProbeResult, ProbeTarget } from "../../types/index.js";

const execFileAsync = promisify(execFile);

interface ChannelAccount {
  accountId?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  linked?: boolean;
  lastError?: string | null;
}

interface ChannelsStatusJson {
  channels?: Record<string, ChannelAccount | ChannelAccount[]>;
}

/**
 * Channel readiness probe.
 * Checks that all configured messaging channels (WhatsApp, Telegram, etc.)
 * are actually connected and ready to deliver messages.
 *
 * Runs `openclaw channels status --json` and verifies each enabled channel
 * reports `running: true` and (where applicable) `connected: true`.
 *
 * Score:
 *   2 = all channels ready
 *   1 = some channels degraded (running but not connected, or has lastError)
 *   0 = channels command failed or no channels running
 */
export async function channelsProbe(
  _target: ProbeTarget,
  timeoutMs: number = 10000,
): Promise<HealthProbeResult> {
  const start = Date.now();

  try {
    const { stdout } = await execFileAsync("openclaw", ["channels", "status", "--json"], {
      timeout: timeoutMs,
    });

    // Strip ANSI codes and plugin warnings before the JSON
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) {
      return {
        name: "channels",
        healthy: false,
        score: 0,
        message: "No JSON output from openclaw channels status",
        latencyMs: Date.now() - start,
      };
    }

    const json = stdout.slice(jsonStart);
    const data = JSON.parse(json) as ChannelsStatusJson;

    if (!data.channels) {
      return {
        name: "channels",
        healthy: false,
        score: 0,
        message: "No channels configured",
        latencyMs: Date.now() - start,
      };
    }

    const issues: string[] = [];
    let totalEnabled = 0;
    let totalReady = 0;

    for (const [channelName, accountData] of Object.entries(data.channels)) {
      // channels can be a single object or array of accounts
      const accounts: ChannelAccount[] = Array.isArray(accountData)
        ? accountData
        : [accountData];

      for (const account of accounts) {
        if (!account.enabled && !account.configured) continue;
        totalEnabled++;

        const label = account.accountId
          ? `${channelName}/${account.accountId}`
          : channelName;

        if (!account.running) {
          issues.push(`${label}: not running`);
          continue;
        }

        // For channels that have a 'connected' field (e.g., WhatsApp Web)
        if ("connected" in account && !account.connected) {
          issues.push(`${label}: running but not connected`);
          continue;
        }

        // For channels that have a 'linked' field (e.g., WhatsApp)
        if ("linked" in account && !account.linked) {
          issues.push(`${label}: not linked`);
          continue;
        }

        if (account.lastError) {
          issues.push(`${label}: ${account.lastError}`);
          continue;
        }

        totalReady++;
      }
    }

    if (totalEnabled === 0) {
      return {
        name: "channels",
        healthy: true,
        score: 2,
        message: "No channels enabled",
        latencyMs: Date.now() - start,
      };
    }

    if (totalReady === totalEnabled) {
      return {
        name: "channels",
        healthy: true,
        score: 2,
        message: `${totalReady}/${totalEnabled} channels ready`,
        latencyMs: Date.now() - start,
      };
    }

    if (totalReady > 0) {
      // Some channels ready, some not — degraded
      return {
        name: "channels",
        healthy: false,
        score: 1,
        message: `${totalReady}/${totalEnabled} channels ready. Issues: ${issues.join("; ")}`,
        latencyMs: Date.now() - start,
      };
    }

    // No channels ready
    return {
      name: "channels",
      healthy: false,
      score: 0,
      message: `0/${totalEnabled} channels ready. Issues: ${issues.join("; ")}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "channels",
      healthy: false,
      score: 0,
      message: `Channel probe failed: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start,
    };
  }
}

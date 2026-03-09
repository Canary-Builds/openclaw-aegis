#!/usr/bin/env node

/**
 * postinstall script for openclaw-aegis
 * Runs automatically after `npm install -g openclaw-aegis`
 *
 * 1. Generates config if missing (aegis init --auto)
 * 2. Creates systemd user service (Linux) or launchd plist (macOS)
 * 3. Enables and starts the service
 */

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const CONFIG_PATH = path.join(HOME, ".openclaw", "aegis", "config.toml");
const IS_LINUX = os.platform() === "linux";
const IS_MAC = os.platform() === "darwin";

// Find the aegis binary
function findAegisBin() {
  try {
    return execSync("which aegis", { encoding: "utf-8" }).trim();
  } catch {
    // Fallback: look relative to this script
    const candidate = path.join(__dirname, "..", "dist", "cli", "index.js");
    if (fs.existsSync(candidate)) return candidate;
    return null;
  }
}

// Find node binary
function findNodeBin() {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return process.execPath;
  }
}

function log(msg) {
  console.log(`  [aegis] ${msg}`);
}

function warn(msg) {
  console.log(`  [aegis] ⚠ ${msg}`);
}

// Step 1: Generate config if missing
function ensureConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    log("Config exists at " + CONFIG_PATH);
    return true;
  }

  log("Generating config...");
  try {
    const aegisBin = findAegisBin();
    if (!aegisBin) {
      warn("Could not find aegis binary — run 'aegis init --auto' manually");
      return false;
    }
    execFileSync(process.execPath, [aegisBin, "init", "--auto"], {
      stdio: "inherit",
      timeout: 30000,
    });
    return fs.existsSync(CONFIG_PATH);
  } catch (err) {
    warn("Config generation failed: " + (err.message || err));
    return false;
  }
}

// Step 2a: Install systemd user service (Linux)
function installSystemdService() {
  const aegisBin = findAegisBin();
  const nodeBin = findNodeBin();
  if (!aegisBin) {
    warn("Could not find aegis binary — skipping service install");
    return false;
  }

  const serviceDir = path.join(HOME, ".config", "systemd", "user");
  fs.mkdirSync(serviceDir, { recursive: true });

  const servicePath = path.join(serviceDir, "openclaw-aegis.service");
  const unit = `[Unit]
Description=OpenClaw Aegis Self-Healing Daemon
After=network.target
Documentation=https://github.com/Canary-Builds/openclaw-aegis

[Service]
Type=simple
ExecStart=${nodeBin} ${aegisBin} serve
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(servicePath, unit, { mode: 0o644 });
  log("Service file written to " + servicePath);

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { timeout: 10000 });
    execFileSync("systemctl", ["--user", "enable", "openclaw-aegis"], { timeout: 10000 });
    log("Service enabled");

    execFileSync("systemctl", ["--user", "start", "openclaw-aegis"], { timeout: 10000 });
    log("Service started");

    // Enable lingering so service runs after logout
    try {
      const username = os.userInfo().username;
      execFileSync("loginctl", ["enable-linger", username], { timeout: 10000 });
      log("Linger enabled (service persists after logout)");
    } catch {
      warn("Could not enable linger — service may stop on logout. Run: loginctl enable-linger " + os.userInfo().username);
    }

    return true;
  } catch (err) {
    warn("Service start failed: " + (err.message || err));
    warn("Try manually: systemctl --user start openclaw-aegis");
    return false;
  }
}

// Step 2b: Install launchd plist (macOS)
function installLaunchdService() {
  const aegisBin = findAegisBin();
  const nodeBin = findNodeBin();
  if (!aegisBin) {
    warn("Could not find aegis binary — skipping service install");
    return false;
  }

  const plistDir = path.join(HOME, "Library", "LaunchAgents");
  fs.mkdirSync(plistDir, { recursive: true });

  const plistPath = path.join(plistDir, "com.openclaw.aegis.plist");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.aegis</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${aegisBin}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.openclaw/aegis/logs/aegis-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.openclaw/aegis/logs/aegis-stderr.log</string>
</dict>
</plist>
`;

  // Create log dir
  fs.mkdirSync(path.join(HOME, ".openclaw", "aegis", "logs"), { recursive: true });

  fs.writeFileSync(plistPath, plist, { mode: 0o644 });
  log("Plist written to " + plistPath);

  try {
    // Unload first in case it was already loaded
    try { execFileSync("launchctl", ["unload", plistPath], { timeout: 5000 }); } catch { /* ignore */ }
    execFileSync("launchctl", ["load", plistPath], { timeout: 10000 });
    log("Service loaded and started via launchd");
    return true;
  } catch (err) {
    warn("launchd load failed: " + (err.message || err));
    warn("Try manually: launchctl load " + plistPath);
    return false;
  }
}

// Main
function main() {
  // Skip if running in CI or non-interactive
  if (process.env.CI || process.env.AEGIS_SKIP_POSTINSTALL) {
    log("Skipping postinstall (CI/AEGIS_SKIP_POSTINSTALL set)");
    return;
  }

  console.log("");
  log("Setting up OpenClaw Aegis...");

  const configOk = ensureConfig();
  if (!configOk) {
    warn("Config not available — service not installed. Run 'aegis init --auto' then reinstall.");
    return;
  }

  let serviceOk = false;
  if (IS_LINUX) {
    serviceOk = installSystemdService();
  } else if (IS_MAC) {
    serviceOk = installLaunchdService();
  } else {
    warn("Unsupported platform: " + os.platform() + " — run 'aegis serve' manually");
    return;
  }

  console.log("");
  if (serviceOk) {
    log("Aegis is now monitoring your OpenClaw gateway.");
    log("Commands: aegis check | aegis status | aegis incidents");
    log("Service: systemctl --user status openclaw-aegis");
  } else {
    log("Config ready. Start manually: aegis serve");
  }
  console.log("");
}

main();

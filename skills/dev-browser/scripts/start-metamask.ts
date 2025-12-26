/**
 * Start dev-browser server with MetaMask extension support
 *
 * Environment variables:
 *   METAMASK_EXTENSION_PATH - Path to unpacked MetaMask extension
 *   WALLET_PASSWORD - Password for the MetaMask wallet
 *   SEED_PHRASE - (Optional) Seed phrase for wallet import on first run
 *   SYNPRESS_CACHED_PROFILE - (Optional) Path to Synpress cached wallet profile
 */
import { serve } from "@/index.js";
import { execSync } from "child_process";
import { mkdirSync, existsSync, readdirSync, cpSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, "..", "tmp");
const profileDir = join(__dirname, "..", "profiles-metamask");

// MetaMask configuration from environment
const METAMASK_EXTENSION_PATH = process.env.METAMASK_EXTENSION_PATH;
const WALLET_PASSWORD = process.env.WALLET_PASSWORD;
const SEED_PHRASE = process.env.SEED_PHRASE;
const SYNPRESS_CACHED_PROFILE = process.env.SYNPRESS_CACHED_PROFILE;

// Optional network configuration
const NETWORK_CONFIG = process.env.NETWORK_NAME
  ? {
      name: process.env.NETWORK_NAME,
      rpcUrl: process.env.NETWORK_RPC_URL || "",
      chainId: parseInt(process.env.NETWORK_CHAIN_ID || "1", 10),
      symbol: process.env.NETWORK_SYMBOL || "ETH",
      blockExplorerUrl: process.env.NETWORK_EXPLORER_URL,
    }
  : undefined;

if (!METAMASK_EXTENSION_PATH) {
  console.error("Error: METAMASK_EXTENSION_PATH environment variable is required");
  console.log("\nUsage:");
  console.log(
    "  METAMASK_EXTENSION_PATH=/path/to/metamask WALLET_PASSWORD=yourpassword npm run start-metamask"
  );
  console.log("\nOptional environment variables:");
  console.log("  SEED_PHRASE - Seed phrase for wallet import (if not using cached profile)");
  console.log("  SYNPRESS_CACHED_PROFILE - Path to Synpress cached wallet profile");
  console.log(
    "  NETWORK_NAME, NETWORK_RPC_URL, NETWORK_CHAIN_ID, NETWORK_SYMBOL, NETWORK_EXPLORER_URL - Custom network config"
  );
  process.exit(1);
}

if (!WALLET_PASSWORD) {
  console.error("Error: WALLET_PASSWORD environment variable is required");
  process.exit(1);
}

// Create directories
console.log("Creating tmp directory...");
mkdirSync(tmpDir, { recursive: true });
console.log("Creating profiles directory...");
mkdirSync(profileDir, { recursive: true });

// Install Playwright browsers if not already installed
console.log("Checking Playwright browser installation...");

function findPackageManager(): { name: string; command: string } | null {
  const managers = [
    { name: "pnpm", command: "pnpm exec playwright install chromium" },
    { name: "npm", command: "npx playwright install chromium" },
  ];

  for (const manager of managers) {
    try {
      execSync(`which ${manager.name}`, { stdio: "ignore" });
      return manager;
    } catch {
      // Package manager not found, try next
    }
  }
  return null;
}

function isChromiumInstalled(): boolean {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const playwrightCacheDir = join(homeDir, ".cache", "ms-playwright");

  if (!existsSync(playwrightCacheDir)) {
    return false;
  }

  try {
    const entries = readdirSync(playwrightCacheDir);
    return entries.some((entry) => entry.startsWith("chromium"));
  } catch {
    return false;
  }
}

try {
  if (!isChromiumInstalled()) {
    console.log("Playwright Chromium not found. Installing...");
    const pm = findPackageManager();
    if (!pm) {
      throw new Error("No package manager found (tried pnpm, npm)");
    }
    console.log(`Using ${pm.name} to install Playwright...`);
    execSync(pm.command, { stdio: "inherit" });
    console.log("Chromium installed successfully.");
  } else {
    console.log("Playwright Chromium already installed.");
  }
} catch (error) {
  console.error("Failed to install Playwright browsers:", error);
  console.log("You may need to run: npx playwright install chromium");
}

// Validate MetaMask extension exists
if (!existsSync(METAMASK_EXTENSION_PATH)) {
  console.error(`MetaMask extension not found at: ${METAMASK_EXTENSION_PATH}`);
  process.exit(1);
}

console.log(`MetaMask extension found at: ${METAMASK_EXTENSION_PATH}`);

// Copy pre-initialized wallet profile if available and profile doesn't exist
const browserDataDir = join(profileDir, "browser-data");
if (SYNPRESS_CACHED_PROFILE && existsSync(SYNPRESS_CACHED_PROFILE) && !existsSync(browserDataDir)) {
  console.log("Copying pre-initialized wallet profile from Synpress cache...");
  mkdirSync(browserDataDir, { recursive: true });
  cpSync(SYNPRESS_CACHED_PROFILE, browserDataDir, { recursive: true });
  console.log("Wallet profile copied successfully");
} else if (SYNPRESS_CACHED_PROFILE && !existsSync(SYNPRESS_CACHED_PROFILE)) {
  console.log("Note: Synpress cached profile not found at:", SYNPRESS_CACHED_PROFILE);
}

// Check if server is already running
console.log("Checking for existing servers...");
try {
  const res = await fetch("http://localhost:9222", {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    console.log("Server already running on port 9222");
    process.exit(0);
  }
} catch {
  // Server not running, continue to start
}

// Clean up stale CDP port
try {
  const pid = execSync("lsof -ti:9223", { encoding: "utf-8" }).trim();
  if (pid) {
    console.log(`Cleaning up stale Chrome process on CDP port 9223 (PID: ${pid})`);
    execSync(`kill -9 ${pid}`);
  }
} catch {
  // No process on CDP port
}

console.log("\nStarting dev browser server with MetaMask...");
console.log(`  Extension: ${METAMASK_EXTENSION_PATH}`);
console.log(`  Profile: ${profileDir}`);

const server = await serve({
  port: 9222,
  headless: false, // Extensions require headed mode
  profileDir,
  extensionPath: METAMASK_EXTENSION_PATH,
  walletPassword: WALLET_PASSWORD,
  seedPhrase: SEED_PHRASE,
  networkConfig: NETWORK_CONFIG,
});

console.log(`\nDev browser server with MetaMask started`);
console.log(`  WebSocket: ${server.wsEndpoint}`);
console.log(`  Tmp directory: ${tmpDir}`);
console.log(`  Profile directory: ${profileDir}`);
console.log(`\nMetaMask API Endpoints:`);
console.log(`  GET  /metamask/status       - Check MetaMask status`);
console.log(`  POST /metamask/unlock       - Unlock wallet`);
console.log(`  POST /metamask/connect      - Approve dApp connection`);
console.log(`  POST /metamask/sign         - Confirm signature`);
console.log(`  POST /metamask/reject-sign  - Reject signature`);
console.log(`  POST /metamask/confirm-tx   - Confirm transaction`);
console.log(`  POST /metamask/reject-tx    - Reject transaction`);
console.log(`  POST /metamask/add-network  - Add custom network`);
console.log(`  POST /metamask/switch-network - Switch network`);
console.log(`\nReady`);
console.log(`Press Ctrl+C to stop`);

// Keep the process running
await new Promise(() => {});

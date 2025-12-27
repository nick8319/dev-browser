/**
 * Start dev-browser server with MetaMask extension support
 *
 * Usage:
 *   npm run start-metamask -- --project-dir /path/to/project
 *
 * The script will auto-load these environment variables from the project's .env:
 *   METAMASK_EXTENSION_PATH - Path to unpacked MetaMask extension
 *   WALLET_PASSWORD - Password for the MetaMask wallet
 *   SEED_PHRASE - (Optional) Seed phrase for wallet import on first run
 *   SYNPRESS_CACHED_PROFILE - (Optional) Path to Synpress cached wallet profile
 *
 * Alternatively, you can export these variables manually before running.
 */
import { serve } from "@/index.js";
import { config as dotenvConfig } from "dotenv";
import { execSync } from "child_process";
import { mkdirSync, existsSync, readdirSync, cpSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, "..", "tmp");
const profileDir = join(__dirname, "..", "profiles-metamask");

// Parse command line arguments
function parseArgs(): { projectDir?: string } {
  const args = process.argv.slice(2);
  const result: { projectDir?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-dir" && args[i + 1]) {
      result.projectDir = resolve(args[i + 1]);
      i++;
    }
  }

  return result;
}

// Load environment variables from project's .env if --project-dir is specified
function loadEnvFromProject(projectDir: string): boolean {
  const envFiles = [".env.local", ".env"];

  for (const envFile of envFiles) {
    const envPath = join(projectDir, envFile);
    if (existsSync(envPath)) {
      console.log(`Loading environment from: ${envPath}`);
      dotenvConfig({ path: envPath });
      return true;
    }
  }

  return false;
}

// Validate required environment variables and return missing ones
function validateEnvVars(): { valid: boolean; missing: string[] } {
  const required = ["METAMASK_EXTENSION_PATH", "WALLET_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  return { valid: missing.length === 0, missing };
}

// Print usage instructions
function printUsage(missing: string[] = []) {
  console.log("\n" + "=".repeat(60));
  console.log("Dev Browser with MetaMask - Setup Required");
  console.log("=".repeat(60));

  if (missing.length > 0) {
    console.log("\n❌ Missing required environment variables:");
    missing.forEach((key) => console.log(`   - ${key}`));
  }

  console.log("\n📋 OPTION 1: Use --project-dir (Recommended)");
  console.log("   Add these to your project's .env file:\n");
  console.log("   METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-11.9.1");
  console.log("   WALLET_PASSWORD=your_wallet_password");
  console.log('   SEED_PHRASE="your twelve word seed phrase"  # Optional');
  console.log("   SYNPRESS_CACHED_PROFILE=/path/to/cache       # Optional");
  console.log("\n   Then run:");
  console.log("   npm run start-metamask -- --project-dir /path/to/your/project");

  console.log("\n📋 OPTION 2: Export variables manually");
  console.log("   export METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-11.9.1");
  console.log("   export WALLET_PASSWORD=your_wallet_password");
  console.log("   npm run start-metamask");

  console.log("\n💡 TIP: If using Synpress for E2E testing, the MetaMask extension is at:");
  console.log("   packages/e2e/.cache-synpress/metamask-chrome-*/");

  console.log("\n" + "=".repeat(60) + "\n");
}

// Main execution
const args = parseArgs();

// Load .env from project directory if specified
if (args.projectDir) {
  if (!existsSync(args.projectDir)) {
    console.error(`Error: Project directory not found: ${args.projectDir}`);
    process.exit(1);
  }

  const loaded = loadEnvFromProject(args.projectDir);
  if (!loaded) {
    console.log(`Note: No .env file found in ${args.projectDir}`);
    console.log("Falling back to existing environment variables...");
  }
}

// Validate required environment variables
const { valid, missing } = validateEnvVars();
if (!valid) {
  printUsage(missing);
  process.exit(1);
}

// MetaMask configuration from environment
const METAMASK_EXTENSION_PATH = process.env.METAMASK_EXTENSION_PATH!;
const WALLET_PASSWORD = process.env.WALLET_PASSWORD!;
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
  console.error(`\n❌ MetaMask extension not found at: ${METAMASK_EXTENSION_PATH}`);
  console.log("\n💡 Check that the path is correct. Common locations:");
  console.log("   - packages/e2e/.cache-synpress/metamask-chrome-11.9.1/");
  console.log("   - node_modules/@synthetixio/synpress-cache/metamask-chrome-*/");
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

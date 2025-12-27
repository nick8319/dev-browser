import express, { type Express, type Request, type Response } from "express";
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getExtensionId,
  createMetaMaskController,
  importWallet,
  type MetaMaskController,
} from "./metamask";
import type {
  MetaMaskStatusResponse,
  MetaMaskConnectResponse,
  MetaMaskSignResponse,
} from "./types";
import type { Socket } from "net";
import type {
  ServeOptions,
  GetPageRequest,
  GetPageResponse,
  ListPagesResponse,
  ServerInfoResponse,
} from "./types";

export type { ServeOptions, GetPageResponse, ListPagesResponse, ServerInfoResponse };

export interface DevBrowserServer {
  wsEndpoint: string;
  port: number;
  stop: () => Promise<void>;
}

// Helper to retry fetch with exponential backoff
async function fetchWithRetry(
  url: string,
  maxRetries = 5,
  delayMs = 500
): Promise<globalThis.Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

// Helper to add timeout to promises
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms)
    ),
  ]);
}

export async function serve(options: ServeOptions = {}): Promise<DevBrowserServer> {
  const port = options.port ?? 9222;
  const headless = options.headless ?? false;
  const cdpPort = options.cdpPort ?? 9223;
  const profileDir = options.profileDir;

  // Validate port numbers
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 1 and 65535`);
  }
  if (cdpPort < 1 || cdpPort > 65535) {
    throw new Error(`Invalid cdpPort: ${cdpPort}. Must be between 1 and 65535`);
  }
  if (port === cdpPort) {
    throw new Error("port and cdpPort must be different");
  }

  // Determine user data directory for persistent context
  const userDataDir = profileDir
    ? join(profileDir, "browser-data")
    : join(process.cwd(), ".browser-data");

  // Create directory if it doesn't exist
  mkdirSync(userDataDir, { recursive: true });
  console.log(`Using persistent browser profile: ${userDataDir}`);

  console.log("Launching browser with persistent context...");

  // Build browser args
  const browserArgs = [`--remote-debugging-port=${cdpPort}`];

  // For extension loading, we need:
  // 1. --disable-extensions-except to allow only our extension
  // 2. --load-extension to explicitly load the extension
  // Also: ignoreDefaultArgs: ['--disable-extensions'] to prevent Playwright from disabling all extensions
  if (options.extensionPath) {
    browserArgs.push(`--disable-extensions-except=${options.extensionPath}`);
    browserArgs.push(`--load-extension=${options.extensionPath}`);
  }

  // Launch persistent context - this persists cookies, localStorage, cache, etc.
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: options.extensionPath ? false : headless, // Extensions require headed mode
    args: browserArgs,
    // When loading extensions, we need to prevent Playwright from disabling all extensions
    ignoreDefaultArgs: options.extensionPath ? ["--disable-extensions"] : undefined,
  });
  console.log("Browser launched with persistent profile...");

  // Get the CDP WebSocket endpoint from Chrome's JSON API (with retry for slow startup)
  const cdpResponse = await fetchWithRetry(`http://127.0.0.1:${cdpPort}/json/version`);
  const cdpInfo = (await cdpResponse.json()) as { webSocketDebuggerUrl: string };
  const wsEndpoint = cdpInfo.webSocketDebuggerUrl;
  console.log(`CDP WebSocket endpoint: ${wsEndpoint}`);

  // MetaMask extension state
  let extensionId: string | null = null;
  let metamaskController: MetaMaskController | null = null;
  const walletInitializedFile = join(userDataDir, ".wallet-initialized");

  // Initialize MetaMask if extension provided
  if (options.extensionPath) {
    console.log("Detecting MetaMask extension...");
    extensionId = await getExtensionId(context, "MetaMask");

    if (extensionId) {
      console.log(`MetaMask extension ID: ${extensionId}`);

      // Check if wallet needs to be initialized by checking MetaMask UI state
      const setupPage = await context.newPage();
      await setupPage.goto(`chrome-extension://${extensionId}/home.html`);
      await setupPage.waitForTimeout(2000);

      // Check if this is an unlock page (wallet already exists) or onboarding page (new wallet)
      const hasUnlockPage = await setupPage.$(
        '[data-testid="unlock-page"], .unlock-page, input[type="password"]'
      );
      const walletAlreadyExists = hasUnlockPage !== null;

      if (walletAlreadyExists) {
        console.log("Wallet already initialized, unlocking...");
        // Mark as initialized
        writeFileSync(walletInitializedFile, new Date().toISOString());
        await setupPage.close();

        // Create controller and unlock
        if (options.walletPassword) {
          metamaskController = await createMetaMaskController(
            context,
            extensionId,
            options.walletPassword
          );
          await metamaskController.unlock(options.walletPassword);
          console.log("MetaMask wallet unlocked");
        }
      } else if (options.seedPhrase && options.walletPassword) {
        // New wallet - import from seed phrase
        console.log("New wallet detected, importing from seed phrase...");
        try {
          await importWallet(setupPage, options.seedPhrase, options.walletPassword);
          writeFileSync(walletInitializedFile, new Date().toISOString());
          console.log("Wallet imported successfully");
          await setupPage.close();

          // Always create controller after wallet import (needed for API endpoints)
          metamaskController = await createMetaMaskController(
            context,
            extensionId,
            options.walletPassword
          );
          console.log("MetaMask controller initialized");

          // Add network if configured at startup
          if (options.networkConfig) {
            await metamaskController.addNetwork(options.networkConfig);
            console.log(`Added network: ${options.networkConfig.name}`);
          }
        } catch (err) {
          console.error("Failed to import wallet:", err);
          await setupPage.close();
        }
      } else {
        console.log("No wallet credentials provided, skipping wallet setup");
        await setupPage.close();
      }
    } else {
      console.warn("MetaMask extension not found");
    }
  }

  // Registry entry type for page tracking
  interface PageEntry {
    page: Page;
    targetId: string;
  }

  // Registry: name -> PageEntry
  const registry = new Map<string, PageEntry>();

  // Helper to get CDP targetId for a page
  async function getTargetId(page: Page): Promise<string> {
    const cdpSession = await context.newCDPSession(page);
    try {
      const { targetInfo } = await cdpSession.send("Target.getTargetInfo");
      return targetInfo.targetId;
    } finally {
      await cdpSession.detach();
    }
  }

  // Express server for page management
  const app: Express = express();
  app.use(express.json());

  // GET / - server info
  app.get("/", (_req: Request, res: Response) => {
    const response: ServerInfoResponse = {
      wsEndpoint,
      metamaskExtensionId: extensionId ?? undefined,
      metamaskInitialized: metamaskController !== null,
    };
    res.json(response);
  });

  // GET /pages - list all pages
  app.get("/pages", (_req: Request, res: Response) => {
    const response: ListPagesResponse = {
      pages: Array.from(registry.keys()),
    };
    res.json(response);
  });

  // POST /pages - get or create page
  app.post("/pages", async (req: Request, res: Response) => {
    const body = req.body as GetPageRequest;
    const { name } = body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required and must be a string" });
      return;
    }

    if (name.length === 0) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }

    if (name.length > 256) {
      res.status(400).json({ error: "name must be 256 characters or less" });
      return;
    }

    // Check if page already exists
    let entry = registry.get(name);
    if (!entry) {
      // Create new page in the persistent context (with timeout to prevent hangs)
      const page = await withTimeout(context.newPage(), 30000, "Page creation timed out after 30s");
      const targetId = await getTargetId(page);
      entry = { page, targetId };
      registry.set(name, entry);

      // Clean up registry when page is closed (e.g., user clicks X)
      page.on("close", () => {
        registry.delete(name);
      });
    }

    const response: GetPageResponse = { wsEndpoint, name, targetId: entry.targetId };
    res.json(response);
  });

  // DELETE /pages/:name - close a page
  app.delete("/pages/:name", async (req: Request<{ name: string }>, res: Response) => {
    const name = decodeURIComponent(req.params.name);
    const entry = registry.get(name);

    if (entry) {
      await entry.page.close();
      registry.delete(name);
      res.json({ success: true });
      return;
    }

    res.status(404).json({ error: "page not found" });
  });

  // GET /metamask/status - Get MetaMask status
  app.get("/metamask/status", (_req: Request, res: Response) => {
    const response: MetaMaskStatusResponse = {
      extensionId,
      isLocked: metamaskController === null,
      walletInitialized: existsSync(walletInitializedFile),
    };
    res.json(response);
  });

  // POST /metamask/unlock - Unlock MetaMask
  app.post("/metamask/unlock", async (req: Request, res: Response) => {
    const { password } = req.body as { password: string };

    if (!metamaskController && extensionId && password) {
      try {
        metamaskController = await createMetaMaskController(context, extensionId, password);
        await metamaskController.unlock(password);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    } else if (metamaskController) {
      try {
        await metamaskController.unlock(password);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ success: false, error: String(err) });
      }
    } else {
      res.status(400).json({ success: false, error: "MetaMask not available" });
    }
  });

  // POST /metamask/connect - Connect to dApp
  app.post("/metamask/connect", async (_req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.connectToDapp();
      const response: MetaMaskConnectResponse = { success: true };
      res.json(response);
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/sign - Confirm signature
  app.post("/metamask/sign", async (_req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.confirmSignature();
      const response: MetaMaskSignResponse = { success: true };
      res.json(response);
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/reject-sign - Reject signature
  app.post("/metamask/reject-sign", async (_req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.rejectSignature();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/confirm-tx - Confirm transaction
  app.post("/metamask/confirm-tx", async (_req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.confirmTransaction();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/reject-tx - Reject transaction
  app.post("/metamask/reject-tx", async (_req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.rejectTransaction();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/add-network - Add network
  app.post("/metamask/add-network", async (req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      await metamaskController.addNetwork(req.body);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /metamask/switch-network - Switch network
  app.post("/metamask/switch-network", async (req: Request, res: Response) => {
    if (!metamaskController) {
      res.status(400).json({ success: false, error: "MetaMask not initialized" });
      return;
    }

    try {
      const { networkName } = req.body as { networkName: string };
      await metamaskController.switchNetwork(networkName);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // Start the server
  const server = app.listen(port, () => {
    console.log(`HTTP API server running on port ${port}`);
  });

  // Track active connections for clean shutdown
  const connections = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });

  // Track if cleanup has been called to avoid double cleanup
  let cleaningUp = false;

  // Cleanup function
  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;

    console.log("\nShutting down...");

    // Close all active HTTP connections
    for (const socket of connections) {
      socket.destroy();
    }
    connections.clear();

    // Close all pages
    for (const entry of registry.values()) {
      try {
        await entry.page.close();
      } catch {
        // Page might already be closed
      }
    }
    registry.clear();

    // Close context (this also closes the browser)
    try {
      await context.close();
    } catch {
      // Context might already be closed
    }

    server.close();
    console.log("Server stopped.");
  };

  // Synchronous cleanup for forced exits
  const syncCleanup = () => {
    try {
      context.close();
    } catch {
      // Best effort
    }
  };

  // Signal handlers (consolidated to reduce duplication)
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

  const signalHandler = async () => {
    await cleanup();
    process.exit(0);
  };

  const errorHandler = async (err: unknown) => {
    console.error("Unhandled error:", err);
    await cleanup();
    process.exit(1);
  };

  // Register handlers
  signals.forEach((sig) => process.on(sig, signalHandler));
  process.on("uncaughtException", errorHandler);
  process.on("unhandledRejection", errorHandler);
  process.on("exit", syncCleanup);

  // Helper to remove all handlers
  const removeHandlers = () => {
    signals.forEach((sig) => process.off(sig, signalHandler));
    process.off("uncaughtException", errorHandler);
    process.off("unhandledRejection", errorHandler);
    process.off("exit", syncCleanup);
  };

  return {
    wsEndpoint,
    port,
    async stop() {
      removeHandlers();
      await cleanup();
    },
  };
}

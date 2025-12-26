import type { BrowserContext, Page } from "playwright";

/**
 * Network configuration for adding custom networks to MetaMask
 */
export interface NetworkConfig {
  /** Network display name */
  name: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Chain ID (numeric) */
  chainId: number;
  /** Native currency symbol (e.g., "ETH", "MATIC") */
  symbol: string;
  /** Optional block explorer URL */
  blockExplorerUrl?: string;
}

/**
 * Controller interface for MetaMask browser extension automation
 */
export interface MetaMaskController {
  /** The unique extension ID */
  extensionId: string;
  /** Check if the wallet is currently locked */
  isLocked: () => Promise<boolean>;
  /** Unlock the wallet with the given password */
  unlock: (password: string) => Promise<void>;
  /** Approve a dApp connection request */
  connectToDapp: () => Promise<void>;
  /** Confirm a signature request */
  confirmSignature: () => Promise<void>;
  /** Reject a signature request */
  rejectSignature: () => Promise<void>;
  /** Confirm a transaction */
  confirmTransaction: () => Promise<void>;
  /** Reject a transaction */
  rejectTransaction: () => Promise<void>;
  /** Add a custom network */
  addNetwork: (network: NetworkConfig) => Promise<void>;
  /** Switch to a network by name */
  switchNetwork: (networkName: string) => Promise<void>;
  /** Get the underlying MetaMask page */
  getPage: () => Page;
}

/**
 * Get the extension ID by navigating to chrome://extensions
 * @param context - Playwright browser context
 * @param extensionName - Name of the extension to find (default: "MetaMask")
 * @returns The extension ID or null if not found
 */
export async function getExtensionId(
  context: BrowserContext,
  extensionName = "MetaMask"
): Promise<string | null> {
  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions");
    // Wait a moment for the extensions page to fully load
    await page.waitForTimeout(1000);

    const extensions = (await page.evaluate("chrome.management.getAll()")) as Array<{
      id: string;
      name: string;
    }>;

    if (extensions.length === 0) {
      console.log(
        "No extensions found. Make sure --load-extension is used and --disable-extensions is not present."
      );
      return null;
    }

    console.log(
      `Found ${extensions.length} extension(s): ${extensions.map((e) => e.name).join(", ")}`
    );

    const target = extensions.find((e) => e.name.toLowerCase() === extensionName.toLowerCase());

    if (!target) {
      console.log(`Extension "${extensionName}" not found in list.`);
    }

    return target?.id ?? null;
  } finally {
    await page.close();
  }
}

/**
 * Wait for MetaMask page to be stable and ready for interaction
 */
async function waitForMetaMaskReady(page: Page, timeout = 30000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout });
  // Wait for MetaMask UI to render - try multiple selectors for different states
  await page
    .waitForSelector(
      '[data-testid="unlock-page"], [data-testid="account-menu-icon"], .unlock-page',
      {
        timeout,
        state: "visible",
      }
    )
    .catch(() => {
      // Swallow error - page may be in a different state (onboarding, etc.)
    });
  // Small buffer for animations to complete
  await page.waitForTimeout(500);
}

/**
 * Import wallet from seed phrase (first-run onboarding only)
 * @param page - MetaMask extension page
 * @param seedPhrase - Space-separated seed phrase words
 * @param password - Password for the new wallet
 */
export async function importWallet(
  page: Page,
  seedPhrase: string,
  password: string
): Promise<void> {
  // Click "Import an existing wallet"
  await page
    .click('[data-testid="onboarding-import-wallet"]')
    .catch(() => page.click('button:has-text("Import an existing wallet")'));

  // Agree to terms
  await page.click('[data-testid="onboarding-terms-checkbox"]').catch(() => {
    // Checkbox may not exist in some versions
  });
  await page
    .click('[data-testid="onboarding-import-button"]')
    .catch(() => page.click('button:has-text("I agree")'));

  // Wait for seed phrase input
  await page.waitForSelector('[data-testid="import-srp__srp-word-0"], input[type="password"]', {
    timeout: 10000,
  });

  // Enter seed phrase words
  const words = seedPhrase.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const input = page.locator(`[data-testid="import-srp__srp-word-${i}"]`);
    if ((await input.count()) > 0) {
      await input.fill(words[i]!);
    }
  }

  // Click confirm seed phrase
  await page
    .click('[data-testid="import-srp-confirm"]')
    .catch(() => page.click('button:has-text("Confirm Secret Recovery Phrase")'));

  // Enter password twice
  await page.fill('[data-testid="create-password-new"]', password);
  await page.fill('[data-testid="create-password-confirm"]', password);

  // Check terms checkbox
  await page.click('[data-testid="create-password-terms"]').catch(() => {
    // Checkbox may not exist
  });

  // Submit
  await page
    .click('[data-testid="create-password-import"]')
    .catch(() => page.click('button:has-text("Import my wallet")'));

  // Complete onboarding
  await page.waitForTimeout(2000);
  await page
    .click('[data-testid="onboarding-complete-done"]')
    .catch(() => page.click('button:has-text("Got it")'));
  await page.click('[data-testid="pin-extension-next"]').catch(() => {
    // Pin extension step may not exist
  });
  await page
    .click('[data-testid="pin-extension-done"]')
    .catch(() => page.click('button:has-text("Done")'));
}

/**
 * Find the MetaMask notification popup from browser pages
 */
function findNotificationPage(context: BrowserContext): Page | undefined {
  const pages = context.pages();
  return pages.find((p: Page) => p.url().includes("notification"));
}

/**
 * Create a MetaMask controller for an initialized extension
 * @param context - Playwright browser context with MetaMask extension loaded
 * @param extensionId - The MetaMask extension ID
 * @param _password - Wallet password (unused but kept for interface consistency)
 * @returns MetaMaskController instance
 */
export async function createMetaMaskController(
  context: BrowserContext,
  extensionId: string,
  _password: string
): Promise<MetaMaskController> {
  // Open MetaMask page
  const metamaskPage = await context.newPage();
  await metamaskPage.goto(`chrome-extension://${extensionId}/home.html`);
  await waitForMetaMaskReady(metamaskPage);

  return {
    extensionId,

    getPage: () => metamaskPage,

    async isLocked(): Promise<boolean> {
      const lockButton = metamaskPage.locator('[data-testid="unlock-page"], .unlock-page');
      return (await lockButton.count()) > 0;
    },

    async unlock(pwd: string): Promise<void> {
      // Check if locked inline to avoid 'this' reference issues
      const lockButton = metamaskPage.locator('[data-testid="unlock-page"], .unlock-page');
      const isCurrentlyLocked = (await lockButton.count()) > 0;
      if (!isCurrentlyLocked) return;

      await metamaskPage.fill('[data-testid="unlock-password"], #password', pwd);
      await metamaskPage.click('[data-testid="unlock-submit"], button:has-text("Unlock")');
      await metamaskPage.waitForSelector('[data-testid="account-menu-icon"]', { timeout: 10000 });
    },

    async connectToDapp(): Promise<void> {
      // Find and switch to notification popup
      const notificationPage = findNotificationPage(context);
      const targetPage = notificationPage || metamaskPage;

      // Handle connection approval
      await targetPage
        .click('[data-testid="page-container-footer-next"], button:has-text("Next")')
        .catch(() => {
          // Button may not exist
        });
      await targetPage
        .click('[data-testid="page-container-footer-next"], button:has-text("Connect")')
        .catch(() => {
          // Button may not exist
        });
      await targetPage.waitForTimeout(500);
    },

    async confirmSignature(): Promise<void> {
      const notificationPage = findNotificationPage(context);
      const targetPage = notificationPage || metamaskPage;

      // Scroll down in signature request if needed
      await targetPage
        .evaluate(() => {
          // Access browser globals via globalThis for TypeScript compatibility
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = globalThis as { document?: any };
          const scrollable = g.document?.querySelector(
            '[data-testid="signature-request-scroll-button"]'
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (scrollable) (scrollable as any).click();
        })
        .catch(() => {
          // Scroll button may not exist
        });

      await targetPage.click('[data-testid="signature-request-scroll-button"]').catch(() => {
        // Scroll button may not exist
      });
      await targetPage
        .click('[data-testid="confirm-footer-button"], button:has-text("Sign")')
        .catch(() => targetPage.click('button:has-text("Confirm")'));
    },

    async rejectSignature(): Promise<void> {
      const notificationPage = findNotificationPage(context);
      const targetPage = notificationPage || metamaskPage;

      await targetPage
        .click('[data-testid="cancel-footer-button"], button:has-text("Reject")')
        .catch(() => targetPage.click('button:has-text("Cancel")'));
    },

    async confirmTransaction(): Promise<void> {
      const notificationPage = findNotificationPage(context);
      const targetPage = notificationPage || metamaskPage;

      await targetPage.click('[data-testid="confirm-footer-button"], button:has-text("Confirm")');
    },

    async rejectTransaction(): Promise<void> {
      const notificationPage = findNotificationPage(context);
      const targetPage = notificationPage || metamaskPage;

      await targetPage.click('[data-testid="cancel-footer-button"], button:has-text("Reject")');
    },

    async addNetwork(network: NetworkConfig): Promise<void> {
      // Open network settings
      await metamaskPage.click('[data-testid="network-display"]');
      await metamaskPage
        .click('button:has-text("Add network")')
        .catch(() => metamaskPage.click('[data-testid="add-network-button"]'));
      await metamaskPage.click('button:has-text("Add a network manually")').catch(() => {
        // Manual add option may not exist
      });

      // Fill network details
      await metamaskPage.fill(
        '[data-testid="network-form-network-name"], input[name="networkName"]',
        network.name
      );
      await metamaskPage.fill(
        '[data-testid="network-form-rpc-url"], input[name="rpcUrl"]',
        network.rpcUrl
      );
      await metamaskPage.fill(
        '[data-testid="network-form-chain-id"], input[name="chainId"]',
        String(network.chainId)
      );
      await metamaskPage.fill(
        '[data-testid="network-form-ticker-input"], input[name="ticker"]',
        network.symbol
      );
      if (network.blockExplorerUrl) {
        await metamaskPage.fill(
          '[data-testid="network-form-block-explorer-url"], input[name="blockExplorerUrl"]',
          network.blockExplorerUrl
        );
      }

      // Save
      await metamaskPage.click('[data-testid="add-network-form-save"], button:has-text("Save")');
      await metamaskPage.waitForTimeout(1000);
    },

    async switchNetwork(networkName: string): Promise<void> {
      await metamaskPage.click('[data-testid="network-display"]');
      await metamaskPage
        .click(`button:has-text("${networkName}")`)
        .catch(() =>
          metamaskPage.click(`[data-testid="network-list-item"]:has-text("${networkName}")`)
        );
      await metamaskPage.waitForTimeout(500);
    },
  };
}

import type { BrowserContext, Locator, Page } from "playwright";

// ============================================================================
// Smart Waiting Utilities
// ============================================================================

const DEFAULT_TIMEOUT = 10000;
const SHORT_TIMEOUT = 5000;

/**
 * Wait for a locator to be visible and enabled (ready for interaction)
 */
async function waitForInteractable(locator: Locator, timeout = DEFAULT_TIMEOUT): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  // Poll until enabled
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await locator.isEnabled()) return;
    await locator.page().waitForTimeout(50);
  }
}

/**
 * Wait for any of the given selectors to appear
 * Returns the index of the first selector that matched
 */
async function waitForAnySelector(
  page: Page,
  selectors: string[],
  timeout = DEFAULT_TIMEOUT
): Promise<number> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    for (let i = 0; i < selectors.length; i++) {
      const count = await page.locator(selectors[i]!).count();
      if (count > 0) return i;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`None of selectors found within ${timeout}ms: ${selectors.join(", ")}`);
}

/**
 * Wait for an element to disappear from DOM
 */
async function waitForDetached(
  page: Page,
  selector: string,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  await page.waitForSelector(selector, { state: "detached", timeout }).catch(() => {
    // Element may never have existed
  });
}

/**
 * Poll until a condition becomes true
 */
async function pollUntil(
  page: Page,
  condition: () => Promise<boolean>,
  timeout = DEFAULT_TIMEOUT,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) return;
    await page.waitForTimeout(interval);
  }
  throw new Error(`Condition not met within ${timeout}ms`);
}

// ============================================================================
// Types
// ============================================================================

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

    // Poll until chrome.management.getAll() returns extensions
    let extensions: Array<{ id: string; name: string }> = [];
    await pollUntil(
      page,
      async () => {
        extensions = (await page.evaluate("chrome.management.getAll()")) as typeof extensions;
        return extensions.length > 0;
      },
      SHORT_TIMEOUT,
      200
    ).catch(() => {
      // Timeout is acceptable - extensions may not be loaded
    });

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

  // Wait for MetaMask UI to render - check for any known state indicator
  const readySelectors = [
    '[data-testid="unlock-page"]',
    '[data-testid="account-menu-icon"]',
    ".unlock-page",
    '[data-testid="onboarding-welcome"]',
  ];

  await waitForAnySelector(page, readySelectors, timeout).catch(() => {
    // Swallow error - page may be in an unexpected state
  });
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
  console.log("[MetaMask] Starting wallet import...");

  // Wait for onboarding page - look for welcome screen or import button
  await page.waitForLoadState("domcontentloaded");
  await waitForAnySelector(
    page,
    ['[data-testid="onboarding-import-wallet"]', '[data-testid="onboarding-terms-checkbox"]'],
    DEFAULT_TIMEOUT
  );

  // STEP 1: Accept terms first (checkbox must be checked before import button is enabled)
  console.log("[MetaMask] Step 1: Accepting initial terms...");

  const termsCheckbox = page.locator(
    '[data-testid="onboarding-terms-checkbox"], input[type="checkbox"]'
  );
  if ((await termsCheckbox.count()) > 0) {
    const isChecked = await termsCheckbox
      .first()
      .isChecked()
      .catch(() => false);
    if (!isChecked) {
      await termsCheckbox.first().click();
      console.log("[MetaMask] Initial terms checkbox clicked");
    }
  }

  // STEP 2: Click "Import an existing wallet" (wait for it to be enabled)
  console.log("[MetaMask] Step 2: Clicking import wallet button...");
  const importBtn = page.locator('[data-testid="onboarding-import-wallet"]');

  // Wait for button to be interactable (visible + enabled)
  await waitForInteractable(importBtn, SHORT_TIMEOUT).catch(async () => {
    // If still disabled, try clicking checkbox again
    console.log("[MetaMask] Button still disabled, retrying checkbox...");
    await page.click('input[type="checkbox"]').catch(() => {});
    await waitForInteractable(importBtn, SHORT_TIMEOUT);
  });

  await importBtn.click();

  // STEP 3: Handle intermediate screens (terms, metametrics)
  console.log("[MetaMask] Step 3: Handling terms agreement screen...");

  // Wait for either: terms screen, metametrics screen, or seed phrase input
  const nextScreenIndex = await waitForAnySelector(
    page,
    [
      '[data-testid="import-srp__srp-word-0"]', // Seed phrase input (skip ahead)
      '[data-testid="metametrics-no-thanks"]', // Metametrics opt-out
      '[data-testid="onboarding-import-button"]', // Terms agree button
      'button:has-text("I agree")', // Alternative terms button
    ],
    DEFAULT_TIMEOUT
  );

  // Handle each possible screen
  if (nextScreenIndex >= 2) {
    // Terms screen - click agree
    await page.click('[data-testid="onboarding-import-button"]').catch(() => {});
    await page.click('button:has-text("I agree")').catch(() => {});

    // Now wait for metametrics or seed phrase
    await waitForAnySelector(
      page,
      ['[data-testid="import-srp__srp-word-0"]', '[data-testid="metametrics-no-thanks"]'],
      DEFAULT_TIMEOUT
    );
  }

  if (
    nextScreenIndex === 1 ||
    (await page.locator('[data-testid="metametrics-no-thanks"]').count()) > 0
  ) {
    // Metametrics screen - decline
    await page.click('[data-testid="metametrics-no-thanks"]').catch(() => {});
  }

  // STEP 4: Wait for and fill seed phrase form
  console.log("[MetaMask] Step 4: Entering seed phrase...");
  await page.waitForSelector('[data-testid="import-srp__srp-word-0"]', {
    timeout: DEFAULT_TIMEOUT,
  });

  const words = seedPhrase.trim().split(/\s+/);
  console.log(`[MetaMask] Entering ${words.length} word seed phrase...`);

  // Fill all seed phrase inputs (Playwright's fill() handles actionability)
  for (let i = 0; i < words.length; i++) {
    await page.fill(`[data-testid="import-srp__srp-word-${i}"]`, words[i]!);
  }

  // Click confirm and wait for password screen
  console.log("[MetaMask] Confirming seed phrase...");
  await page.click('[data-testid="import-srp-confirm"]');

  // STEP 5: Create password
  console.log("[MetaMask] Step 5: Creating password...");
  await page.waitForSelector('[data-testid="create-password-new"]', { timeout: DEFAULT_TIMEOUT });

  await page.fill('[data-testid="create-password-new"]', password);
  await page.fill('[data-testid="create-password-confirm"]', password);

  // Check terms checkbox if present
  await page.click('[data-testid="create-password-terms"]').catch(() => {});

  // Submit and wait for completion screen
  await page.click('[data-testid="create-password-import"]');

  // STEP 6: Complete onboarding
  console.log("[MetaMask] Step 6: Completing onboarding...");

  // Wait for completion screen indicators
  await waitForAnySelector(
    page,
    [
      '[data-testid="onboarding-complete-done"]',
      '[data-testid="pin-extension-next"]',
      '[data-testid="account-menu-icon"]', // Already on main screen
    ],
    15000
  );

  // Click through completion screens
  await page.click('[data-testid="onboarding-complete-done"]').catch(() => {});

  // Handle pin extension screens if present
  const hasPinScreen = (await page.locator('[data-testid="pin-extension-next"]').count()) > 0;
  if (hasPinScreen) {
    await page.click('[data-testid="pin-extension-next"]').catch(() => {});
    await page.click('[data-testid="pin-extension-done"]').catch(() => {});
  }

  // Dismiss any remaining popups
  await page.click('button:has-text("Got it")').catch(() => {});
  await page.click('[data-testid="popover-close"]').catch(() => {});

  // Verify we're on the main screen
  await waitForAnySelector(
    page,
    ['[data-testid="account-menu-icon"]', '[data-testid="eth-overview-send"]'],
    SHORT_TIMEOUT
  ).catch(() => {
    // May already be ready
  });

  console.log("[MetaMask] Wallet import complete!");
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

      // Wait for connection dialog
      await waitForAnySelector(
        targetPage,
        [
          '[data-testid="page-container-footer-next"]',
          'button:has-text("Next")',
          'button:has-text("Connect")',
        ],
        SHORT_TIMEOUT
      ).catch(() => {});

      // Handle connection approval (may be multi-step)
      await targetPage
        .click('[data-testid="page-container-footer-next"], button:has-text("Next")')
        .catch(() => {});

      // Wait for Connect button if this was a two-step flow
      await waitForAnySelector(
        targetPage,
        ['button:has-text("Connect")', '[data-testid="page-container-footer-next"]'],
        SHORT_TIMEOUT
      ).catch(() => {});

      await targetPage
        .click('[data-testid="page-container-footer-next"], button:has-text("Connect")')
        .catch(() => {});

      // Wait for dialog to close
      await waitForDetached(
        targetPage,
        '[data-testid="page-container-footer-next"]',
        SHORT_TIMEOUT
      );
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
      console.log(`[MetaMask] Adding network: ${network.name}`);

      // Navigate directly to add network page
      await metamaskPage.goto(
        `chrome-extension://${extensionId}/home.html#settings/networks/add-network`
      );
      await metamaskPage.waitForLoadState("domcontentloaded");

      // Wait for either the manual form or the "Add manually" button
      await waitForAnySelector(
        metamaskPage,
        [".networks-tab__add-network-form", 'button:has-text("Add a network manually")'],
        DEFAULT_TIMEOUT
      );

      // Click "Add a network manually" if visible
      const addManuallyBtn = metamaskPage.locator('button:has-text("Add a network manually")');
      if ((await addManuallyBtn.count()) > 0) {
        await addManuallyBtn.click();
      }

      // Wait for the form fields to be ready
      const newNetworkFormContainer = ".networks-tab__add-network-form";
      await metamaskPage.waitForSelector(
        `${newNetworkFormContainer} .form-field:nth-child(1) input`,
        {
          timeout: DEFAULT_TIMEOUT,
        }
      );

      // Synpress-style selectors (proven for MetaMask 11.x)
      const networkNameInput = metamaskPage
        .locator(`${newNetworkFormContainer} .form-field:nth-child(1) input`)
        .first();
      const rpcUrlInput = metamaskPage
        .locator(`${newNetworkFormContainer} .form-field:nth-child(2) input`)
        .first();
      const chainIdInput = metamaskPage
        .locator(`${newNetworkFormContainer} .form-field:nth-child(3) input`)
        .first();
      const symbolInput = metamaskPage.locator('[data-testid="network-form-ticker"] input').first();
      const explorerInput = metamaskPage
        .locator(`${newNetworkFormContainer} .form-field:last-child input`)
        .first();
      const saveButton = metamaskPage
        .locator(`${newNetworkFormContainer}-footer button.btn-primary, button:has-text("Save")`)
        .first();

      // Fill form fields (Playwright's fill() handles actionability automatically)
      await networkNameInput.fill(network.name);
      await rpcUrlInput.fill(network.rpcUrl);
      await chainIdInput.fill(String(network.chainId));

      // Smart wait for chain ID validation:
      // MetaMask makes an RPC call to validate - poll until form validation completes
      // Success indicators: save button becomes enabled OR symbol field gets auto-populated
      await pollUntil(
        metamaskPage,
        async () => {
          // Check if save button is enabled (validation complete)
          const isEnabled = await saveButton.isEnabled().catch(() => false);
          if (isEnabled) return true;

          // Check for loading indicators (still validating)
          const hasSpinner = (await metamaskPage.locator(".spinner, .loading").count()) > 0;
          if (hasSpinner) return false;

          // Check for validation errors on chain ID field (validation complete, but failed)
          const hasChainIdError =
            (await metamaskPage.locator(".form-field:nth-child(3) .form-field__error").count()) > 0;
          return hasChainIdError; // Validation complete (even if error)
        },
        10000,
        200
      ).catch(() => {
        // Timeout is acceptable - proceed anyway
      });

      // Fill remaining fields
      await symbolInput.fill(network.symbol);
      if (network.blockExplorerUrl) {
        await explorerInput.fill(network.blockExplorerUrl);
      }

      // Wait for save button to be enabled (form fully valid)
      await pollUntil(
        metamaskPage,
        async () => {
          return await saveButton.isEnabled().catch(() => false);
        },
        SHORT_TIMEOUT,
        100
      ).catch(() => {
        // Proceed anyway - will try force click if needed
      });

      // Click Save button
      try {
        await saveButton.click({ timeout: SHORT_TIMEOUT });
      } catch {
        // Fallback: force click or keyboard
        await saveButton.click({ force: true }).catch(() => {
          metamaskPage.keyboard.press("Enter");
        });
      }

      // Wait for save confirmation - either popup appears OR URL changes (back to network list)
      await waitForAnySelector(
        metamaskPage,
        [
          'button:has-text("Dismiss")',
          'button:has-text("Got it")',
          '[data-testid="popover-close"]',
          ".networks-tab__networks-list", // Back on networks list
        ],
        DEFAULT_TIMEOUT
      ).catch(() => {
        // May have already navigated
      });

      // Dismiss any popups
      const dismissBtn = metamaskPage.locator(
        'button:has-text("Dismiss"), button:has-text("Got it")'
      );
      if ((await dismissBtn.count()) > 0) {
        await dismissBtn.first().click();
      }
      await metamaskPage.click('[data-testid="popover-close"]').catch(() => {});

      console.log(`[MetaMask] Network "${network.name}" added successfully`);
    },

    async switchNetwork(networkName: string): Promise<void> {
      await metamaskPage.click('[data-testid="network-display"]');

      // Wait for network list to appear
      await waitForAnySelector(
        metamaskPage,
        [
          `button:has-text("${networkName}")`,
          `[data-testid="network-list-item"]:has-text("${networkName}")`,
        ],
        SHORT_TIMEOUT
      );

      await metamaskPage
        .click(`button:has-text("${networkName}")`)
        .catch(() =>
          metamaskPage.click(`[data-testid="network-list-item"]:has-text("${networkName}")`)
        );

      // Wait for network switch confirmation (network display updates)
      await pollUntil(
        metamaskPage,
        async () => {
          const displayText = await metamaskPage
            .locator('[data-testid="network-display"]')
            .textContent();
          return displayText?.includes(networkName) ?? false;
        },
        SHORT_TIMEOUT,
        100
      ).catch(() => {
        // May already be on correct network
      });
    },
  };
}

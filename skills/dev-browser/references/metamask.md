# MetaMask Integration Guide

Complete guide for browser automation with MetaMask wallet for Web3 dApp testing.

## Table of Contents

1. [Setup](#setup)
2. [Server API Endpoints](#server-api-endpoints)
3. [Handling MetaMask Popups](#handling-metamask-popups)
4. [Complete SIWE Login Flow](#complete-siwe-login-flow)
5. [Transaction Flows](#transaction-flows)
6. [Troubleshooting](#troubleshooting)

## Setup

### Prerequisites

- MetaMask extension (unpacked, Manifest V2 compatible - v11.x)
- Playwright 1.48.2 (for Manifest V2 support)
- Optional: Synpress cached wallet profile for pre-initialized wallet

### Environment Variables

```bash
# Required
METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-11.9.1
WALLET_PASSWORD=YourWalletPassword

# Optional
SEED_PHRASE="your twelve word seed phrase here"
SYNPRESS_CACHED_PROFILE=/path/to/cached/browser-profile

# Optional: Custom network
NETWORK_NAME="Base Sepolia"
NETWORK_RPC_URL="https://sepolia.base.org"
NETWORK_CHAIN_ID="84532"
NETWORK_SYMBOL="ETH"
NETWORK_EXPLORER_URL="https://sepolia.basescan.org"
```

### Starting the Server

```bash
cd skills/dev-browser && \
METAMASK_EXTENSION_PATH=/path/to/metamask \
WALLET_PASSWORD=yourpassword \
npm run start-metamask
```

Wait for output:

```
MetaMask wallet unlocked
Dev browser server with MetaMask started
Ready
```

## Server API Endpoints

The server exposes REST endpoints for MetaMask state:

| Endpoint                   | Method | Description                            |
| -------------------------- | ------ | -------------------------------------- |
| `/`                        | GET    | Server info + MetaMask status          |
| `/metamask/status`         | GET    | Wallet lock state, extension ID        |
| `/metamask/unlock`         | POST   | Unlock wallet (body: `{password}`)     |
| `/metamask/connect`        | POST   | Approve dApp connection                |
| `/metamask/sign`           | POST   | Confirm signature request              |
| `/metamask/reject-sign`    | POST   | Reject signature request               |
| `/metamask/confirm-tx`     | POST   | Confirm transaction                    |
| `/metamask/reject-tx`      | POST   | Reject transaction                     |
| `/metamask/add-network`    | POST   | Add custom network                     |
| `/metamask/switch-network` | POST   | Switch network (body: `{networkName}`) |

### Check Status

```bash
curl http://localhost:9222/metamask/status
# {"extensionId":"abc123...","isLocked":false,"walletInitialized":true}
```

## Handling MetaMask Popups

MetaMask opens notification popups for user confirmations. Find them via the browser context:

```typescript
async function findMetaMaskPopup(page) {
  const context = page.context();
  const allPages = context.pages();
  return allPages.find((p) => p.url().includes("notification.html"));
}
```

### Popup URL Patterns

| Action                  | URL Contains                                                         | Example                            |
| ----------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| Connect wallet (step 1) | `#connect/`                                                          | `notification.html#connect/abc123` |
| Connect wallet (step 2) | `#connect/.../confirm-permissions`                                   | Confirm permissions                |
| Sign message            | `#signature-request` or `#confirm-transaction/.../signature-request` | SIWE, personal_sign                |
| Confirm transaction     | `#confirm-transaction` (without signature-request)                   | Send ETH, contract call            |
| Add network             | `#add-network`                                                       | Custom RPC                         |
| Switch network          | `#switch-network`                                                    | Change chains                      |

### Common Button Selectors

```typescript
// Connect wallet flow
await popup.click('button:has-text("Next")'); // Step 1: Select account
await popup.click('button:has-text("Connect")'); // Step 2: Confirm

// Signature requests
await popup.click('button:has-text("Sign")'); // Approve signature
await popup.click('[data-testid="confirm-footer-button"]'); // Alternative

// Transactions
await popup.click('button:has-text("Confirm")'); // Approve transaction
await popup.click('button:has-text("Reject")'); // Reject

// Scrollable content (some signatures require scroll)
await popup.click('[data-testid="signature-request-scroll-button"]');
```

## Complete SIWE Login Flow

Sign-In with Ethereum (SIWE) is a common Web3 authentication pattern. Here's a complete example:

```typescript
import { connect, waitForPageLoad } from "@/client.js";

async function siweLogin(dappUrl: string) {
  const client = await connect();
  const page = await client.page("dapp-login");
  await page.setViewportSize({ width: 1280, height: 800 });

  // 1. Navigate to dApp
  await page.goto(dappUrl);
  await waitForPageLoad(page);

  // 2. Click Connect Wallet button
  await page.click('button:has-text("Connect"), [data-testid="connect-wallet"]');
  await page.waitForTimeout(2000);

  // 3. Handle MetaMask connect popup (2 steps)
  const context = page.context();

  // Step 1: Select account and click Next
  let popup = context.pages().find((p) => p.url().includes("notification.html#connect"));
  if (popup) {
    await popup.waitForTimeout(1000);
    await popup.click('button:has-text("Next")');
    await popup.waitForTimeout(1000);

    // Step 2: Click Connect
    await popup.click('button:has-text("Connect")');
    await popup.waitForTimeout(2000);
  }

  // 4. Handle SIWE signature request
  popup = context.pages().find((p) => p.url().includes("signature-request"));
  if (popup) {
    await popup.waitForTimeout(1000);
    await popup.click('button:has-text("Sign")');
    await popup.waitForTimeout(2000);
  }

  // 5. Verify login success
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "tmp/logged-in.png" });

  console.log("Login complete. URL:", page.url());
  await client.disconnect();
}

siweLogin("http://localhost:3000").catch(console.error);
```

## Transaction Flows

### Send Transaction

```typescript
async function confirmTransaction(page) {
  const context = page.context();

  // Trigger transaction on dApp (e.g., click send button)
  await page.click('button:has-text("Send")');
  await page.waitForTimeout(2000);

  // Find and confirm in MetaMask
  const popup = context
    .pages()
    .find((p) => p.url().includes("notification.html") && !p.url().includes("signature-request"));

  if (popup) {
    await popup.waitForTimeout(1000);
    // May need to scroll to see confirm button
    const scrollBtn = await popup.$('[data-testid="signature-request-scroll-button"]');
    if (scrollBtn) await scrollBtn.click();

    await popup.click('button:has-text("Confirm")');
  }
}
```

### Contract Interaction

```typescript
async function approveContract(page, buttonSelector: string) {
  // Click the dApp button that triggers contract interaction
  await page.click(buttonSelector);
  await page.waitForTimeout(3000);

  const context = page.context();
  const popup = context.pages().find((p) => p.url().includes("notification.html"));

  if (popup) {
    // Wait for gas estimation
    await popup.waitForTimeout(2000);
    await popup.click('button:has-text("Confirm")');
  }
}
```

## Troubleshooting

### "Cannot install extension - unsupported manifest version"

MetaMask v12+ uses Manifest V3 which requires newer Chromium. Use:

- MetaMask v11.9.1 (Manifest V2)
- Playwright 1.48.2

### MetaMask popup not found

```typescript
// Debug: List all pages
const context = page.context();
const allPages = context.pages();
console.log(
  "All pages:",
  allPages.map((p) => p.url())
);
```

### Popup closes before interaction

Add waits:

```typescript
await popup.waitForTimeout(1000); // Wait for UI to stabilize
await popup.waitForSelector('button:has-text("Sign")');
await popup.click('button:has-text("Sign")');
```

### Wrong network

```bash
# Via API
curl -X POST http://localhost:9222/metamask/switch-network \
  -H "Content-Type: application/json" \
  -d '{"networkName": "Base Sepolia"}'
```

### Wallet locked after restart

The wallet auto-unlocks on server start if `WALLET_PASSWORD` is provided. To manually unlock:

```bash
curl -X POST http://localhost:9222/metamask/unlock \
  -H "Content-Type: application/json" \
  -d '{"password": "YourPassword"}'
```

### Extension state persists

Browser profile is saved in `profiles-metamask/browser-data/`. Delete to reset:

```bash
rm -rf skills/dev-browser/profiles-metamask/browser-data
```

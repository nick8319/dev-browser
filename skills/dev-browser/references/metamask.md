# MetaMask Integration Reference

Comprehensive guide for automating MetaMask wallet interactions in dev-browser.

## Prerequisites

- MetaMask extension v11.9.1 (Manifest V2) - newer versions require Playwright upgrade
- Unpacked extension directory (download from MetaMask releases, unzip)
- Wallet seed phrase or Synpress cached profile

## Server Startup

```bash
# Set required environment variables
export METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-11.9.1
export WALLET_PASSWORD=your_password
export SEED_PHRASE="word1 word2 ... word12"  # Optional with cached profile

# Optional: Use Synpress pre-initialized wallet
export SYNPRESS_CACHED_PROFILE=/path/to/.cache/synpress/wallet

# Optional: Add custom network
export NETWORK_NAME="Base Sepolia"
export NETWORK_RPC_URL="https://sepolia.base.org"
export NETWORK_CHAIN_ID=84532
export NETWORK_SYMBOL="ETH"

# Start server
cd skills/dev-browser && npm run start-metamask &
```

## Finding MetaMask Popups

MetaMask opens notification popups for user confirmations. Find them via browser context:

```typescript
async function findMetaMaskPopup(page: Page): Promise<Page | undefined> {
  const pages = page.context().pages();
  return pages.find((p) => p.url().includes("notification"));
}

// Wait for popup to appear
async function waitForMetaMaskPopup(page: Page, timeout = 10000): Promise<Page> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const popup = await findMetaMaskPopup(page);
    if (popup) return popup;
    await page.waitForTimeout(500);
  }
  throw new Error("MetaMask popup not found");
}
```

## Popup URL Patterns

| Action           | URL Hash               | Description                       |
| ---------------- | ---------------------- | --------------------------------- |
| Connect          | `#connect`             | dApp requesting wallet connection |
| Sign Message     | `#signature-request`   | SIWE or personal_sign request     |
| Sign Typed Data  | `#signature-request`   | EIP-712 typed data signing        |
| Send Transaction | `#confirm-transaction` | Transaction confirmation          |
| Add Network      | `#add-network`         | Custom network addition request   |
| Switch Network   | `#switch-network`      | Network switch request            |

## Common Interaction Patterns

### Approve Wallet Connection

```typescript
const popup = await waitForMetaMaskPopup(page);

// Step 1: Click "Next" to proceed
await popup.click('[data-testid="page-container-footer-next"]');

// Step 2: Click "Connect" to confirm
await popup.click('[data-testid="page-container-footer-next"]');
```

### Sign Message (SIWE Authentication)

```typescript
const popup = await waitForMetaMaskPopup(page);

// Click "Sign" button
await popup.click('[data-testid="page-container-footer-next"]');
```

### Confirm Transaction

```typescript
const popup = await waitForMetaMaskPopup(page);

// Click "Confirm" button
await popup.click('[data-testid="page-container-footer-next"]');
```

### Reject Any Request

```typescript
const popup = await waitForMetaMaskPopup(page);

// Click "Cancel" or "Reject" button
await popup.click('[data-testid="page-container-footer-cancel"]');
```

## MetaMask Data Test IDs

Common selectors for MetaMask UI elements:

| Element                  | Selector                                       |
| ------------------------ | ---------------------------------------------- |
| Confirm/Next/Sign button | `[data-testid="page-container-footer-next"]`   |
| Cancel/Reject button     | `[data-testid="page-container-footer-cancel"]` |
| Password input           | `[data-testid="unlock-password"]`              |
| Unlock button            | `[data-testid="unlock-submit"]`                |
| Account address          | `[data-testid="account-menu-icon"]`            |
| Network switcher         | `[data-testid="network-display"]`              |

## Complete SIWE Flow Example

```typescript
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("dapp-test");
await page.setViewportSize({ width: 1280, height: 800 });

// 1. Navigate to dApp
await page.goto("http://localhost:3000");
await waitForPageLoad(page);

// 2. Click Connect Wallet button
await page.click('button:has-text("Connect Wallet")');

// 3. Handle MetaMask connection popup
let popup = await waitForMetaMaskPopup(page);
await popup.click('[data-testid="page-container-footer-next"]'); // Next
await popup.click('[data-testid="page-container-footer-next"]'); // Connect

// 4. Handle SIWE signature popup
popup = await waitForMetaMaskPopup(page);
await popup.click('[data-testid="page-container-footer-next"]'); // Sign

// 5. Verify authentication
await page.waitForSelector('[data-testid="user-menu"]');
console.log("Successfully authenticated via SIWE!");

await client.disconnect();
```

## Troubleshooting

### Extension Not Loading

**Error:** "Cannot install extension because it uses an unsupported manifest version"

**Cause:** MetaMask v11.x uses Manifest V2, but newer Playwright bundles Chromium v143+ which requires Manifest V3.

**Fix:** Use `playwright: "1.48.2"` in package.json (supports Manifest V2).

### Popup Not Found

**Issue:** `waitForMetaMaskPopup` times out

**Causes:**

1. dApp didn't trigger MetaMask (check browser console for errors)
2. Popup opened and closed quickly (increase wait timeout)
3. MetaMask is on wrong network (check network configuration)

**Debug:**

```typescript
// Log all pages
const pages = page.context().pages();
console.log(pages.map((p) => ({ url: p.url(), title: p.title() })));
```

### Wallet Locked

**Issue:** MetaMask shows unlock screen instead of expected popup

**Fix:** Ensure `WALLET_PASSWORD` is set and server shows "Wallet unlocked" at startup.

## HTTP API Endpoints

The MetaMask server exposes REST endpoints for wallet operations:

| Method | Endpoint                   | Description                          |
| ------ | -------------------------- | ------------------------------------ |
| GET    | `/metamask/status`         | Check wallet status                  |
| POST   | `/metamask/unlock`         | Unlock wallet (body: `{ password }`) |
| POST   | `/metamask/connect`        | Approve pending connection           |
| POST   | `/metamask/sign`           | Confirm pending signature            |
| POST   | `/metamask/reject-sign`    | Reject pending signature             |
| POST   | `/metamask/confirm-tx`     | Confirm pending transaction          |
| POST   | `/metamask/reject-tx`      | Reject pending transaction           |
| POST   | `/metamask/add-network`    | Add custom network                   |
| POST   | `/metamask/switch-network` | Switch to network                    |

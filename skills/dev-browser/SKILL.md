---
name: dev-browser
description: Browser automation with persistent page state and MetaMask wallet support. Use when users ask to navigate websites, fill forms, take screenshots, test web apps, automate browser workflows, or interact with Web3 dApps. Trigger phrases include "go to [url]", "click on", "fill out the form", "take a screenshot", "test the website", "connect wallet", "sign transaction", "approve MetaMask", "test dApp", "SIWE login", or any browser/wallet interaction request.
---

# Dev Browser Skill

Browser automation that maintains page state across script executions with MetaMask wallet integration for Web3 dApp testing.

## Modes

### Standard Mode (No Wallet)

```bash
./skills/dev-browser/server.sh &
```

### MetaMask Mode (Web3 dApps)

Requires environment variables:

```bash
METAMASK_EXTENSION_PATH=/path/to/metamask \
WALLET_PASSWORD=yourpassword \
SYNPRESS_CACHED_PROFILE=/path/to/cached/profile \
npm run start-metamask &
```

See [references/metamask.md](references/metamask.md) for complete MetaMask setup and wallet automation guide.

**Wait for `Ready` message before running scripts.**

## Writing Scripts

Run all scripts from `skills/dev-browser/` directory:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("my-dapp");
await page.setViewportSize({ width: 1280, height: 800 });

await page.goto("http://localhost:3000");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
```

## Key Principles

1. **Small scripts**: Each script does ONE thing
2. **Evaluate state**: Log results to decide next steps
3. **Descriptive page names**: Use `"checkout"`, `"login"`, not `"main"`
4. **Disconnect to exit**: `await client.disconnect()` - pages persist
5. **Plain JS in evaluate**: No TypeScript in `page.evaluate()` callbacks

## Client API

```typescript
const client = await connect();
const page = await client.page("name"); // Get or create page
const pages = await client.list(); // List page names
await client.close("name"); // Close page
await client.disconnect(); // Disconnect (pages persist)

// Element discovery
const snapshot = await client.getAISnapshot("name");
const element = await client.selectSnapshotRef("name", "e5");
```

## MetaMask Wallet Interactions

When MetaMask popups appear, find and interact with them via the browser context:

```typescript
const context = page.context();
const allPages = context.pages();
const popup = allPages.find((p) => p.url().includes("notification.html"));

if (popup) {
  // Click approve/sign/confirm buttons
  await popup.click('button:has-text("Connect")');
}
```

**Common MetaMask flows:**

| Flow                | Popup URL Contains     | Button Text        |
| ------------------- | ---------------------- | ------------------ |
| Connect wallet      | `#connect`             | "Next" → "Connect" |
| Sign message (SIWE) | `#signature-request`   | "Sign"             |
| Confirm transaction | `#confirm-transaction` | "Confirm"          |

See [references/metamask.md](references/metamask.md) for complete examples.

## Screenshots & Debugging

```typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });

// Debug state
console.log({ url: page.url(), title: await page.title() });
```

## ARIA Snapshot (Element Discovery)

Use when page structure is unknown:

```typescript
const snapshot = await client.getAISnapshot("my-page");
console.log(snapshot);
// Output: - button "Submit" [ref=e5]

const element = await client.selectSnapshotRef("my-page", "e5");
await element.click();
```

## Scraping Data

For large datasets, intercept network requests. See [references/scraping.md](references/scraping.md).

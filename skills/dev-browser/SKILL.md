---
name: dev-browser
description: Browser automation with persistent page state and MetaMask wallet support. Use when users ask to navigate websites, fill forms, take screenshots, extract web data, test web apps, automate browser workflows, or interact with Web3 dApps. Trigger phrases include "go to [url]", "click on", "fill out the form", "take a screenshot", "scrape", "automate", "test the website", "log into", "connect wallet", "sign transaction", "MetaMask", "dApp testing", or any browser/Web3 interaction request.
---

# Dev Browser Skill

Browser automation with persistent page state. Write small scripts, run them, observe results, iterate.

## Setup

**Wait for `Ready` message before running scripts.**

### Standalone Mode (Default)

```bash
./skills/dev-browser/server.sh &
```

### Extension Mode

Connects to user's existing Chrome with their session. Use when user is logged into sites.

```bash
cd skills/dev-browser && npm i && npm run start-extension &
```

If extension not connected, user must install from: https://github.com/SawyerHood/dev-browser/releases

### MetaMask Mode

For Web3 dApp testing (SIWE auth, transactions, wallet interactions):

```bash
cd skills/dev-browser && npm run start-metamask -- --project-dir /path/to/project &
```

Requires `METAMASK_EXTENSION_PATH` and `WALLET_PASSWORD` in project's `.env`. Script auto-loads them.

## Writing Scripts

Run from `skills/dev-browser/` directory (required for `@/` imports):

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("my-page");
await page.setViewportSize({ width: 1280, height: 800 });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
```

**Important:** No TypeScript syntax in `page.evaluate()` - it runs in browser context.

## Client API

```typescript
const client = await connect();
const page = await client.page("name"); // Get or create page
await client.list(); // List page names
await client.close("name"); // Close page
await client.disconnect(); // Disconnect (pages persist)

// Element discovery
const snapshot = await client.getAISnapshot("name");
const element = await client.selectSnapshotRef("name", "e5");
```

The `page` object is a standard Playwright Page.

## ARIA Snapshots

Discover elements with `getAISnapshot()`. Returns accessibility tree with refs:

```yaml
- link "Submit" [ref=e1]
- textbox [ref=e2] /placeholder: "Email"
```

Interact: `await client.selectSnapshotRef("page", "e1").then(el => el.click())`

**Critical:** Refs become stale after navigation. Always get fresh snapshot after `page.goto()` or link clicks.

## MetaMask Popup Handling

```typescript
const pages = page.context().pages();
const popup = pages.find((p) => p.url().includes("notification"));

// Try selectors in order (MetaMask UI varies by version)
const selectors = [
  "button.btn-primary",
  '[data-testid="confirm-footer-button"]',
  '[data-testid="page-container-footer-next"]',
];
for (const sel of selectors) {
  if (await popup.$(sel)) {
    await popup.click(sel);
    break;
  }
}
```

| Action      | URL Contains           |
| ----------- | ---------------------- |
| Connect     | `#connect`             |
| Sign        | `#signature-request`   |
| Transaction | `#confirm-transaction` |

See [references/metamask.md](references/metamask.md) for complete patterns.

## Debugging

```typescript
await page.screenshot({ path: "tmp/debug.png" });
// For MetaMask: screenshot all extension pages
for (const p of page.context().pages()) {
  if (p.url().includes("chrome-extension://"))
    await p.screenshot({ path: `tmp/metamask-${Date.now()}.png` });
}
```

**Common issues:**

- Popup not appearing → MetaMask locked or needs `waitForTimeout(2000)`
- Wrong network → MetaMask prompts network switch first
- Stale refs → Get fresh snapshot after navigation

## References

- **MetaMask patterns:** [references/metamask.md](references/metamask.md)
- **Scraping guide:** [references/scraping.md](references/scraping.md)

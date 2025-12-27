---
name: dev-browser
description: Browser automation with persistent page state and MetaMask wallet support. Use when users ask to navigate websites, fill forms, take screenshots, extract web data, test web apps, automate browser workflows, or interact with Web3 dApps. Trigger phrases include "go to [url]", "click on", "fill out the form", "take a screenshot", "scrape", "automate", "test the website", "log into", "connect wallet", "sign transaction", "MetaMask", "dApp testing", or any browser/Web3 interaction request.
---

# Dev Browser Skill

Browser automation that maintains page state across script executions. Write small, focused scripts to accomplish tasks incrementally. Once you've proven out part of a workflow and there is repeated work to be done, you can write a script to do the repeated work in a single execution.

## Choosing Your Approach

- **Local/source-available sites**: Read the source code first to write selectors directly
- **Unknown page layouts**: Use `getAISnapshot()` to discover elements and `selectSnapshotRef()` to interact with them
- **Visual feedback**: Take screenshots to see what the user sees

## Setup

Two modes available. Ask the user if unclear which to use.

### Standalone Mode (Default)

Launches a new Chromium browser for fresh automation sessions.

```bash
./skills/dev-browser/server.sh &
```

Add `--headless` flag if user requests it. **Wait for the `Ready` message before running scripts.**

### Extension Mode

Connects to user's existing Chrome browser. Use this when:

- The user is already logged into sites and wants you to do things behind an authed experience that isn't local dev.
- The user asks you to use the extension

**Important**: The core flow is still the same. You create named pages inside of their browser.

**Start the relay server:**

```bash
cd skills/dev-browser && npm i && npm run start-extension &
```

Wait for `Waiting for extension to connect...`

**Workflow:**

1. Scripts call `client.page("name")` just like the normal mode to create new pages / connect to existing ones.
2. Automation runs on the user's actual browser session

If the extension hasn't connected yet, tell the user to launch and activate it. Download link: https://github.com/SawyerHood/dev-browser/releases

### MetaMask Mode

Launches browser with MetaMask extension for Web3 dApp testing. Use for SIWE authentication, transaction signing, and wallet interactions.

**Required environment variables:**

```bash
export METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-11.9.1  # Unpacked extension
export WALLET_PASSWORD=your_wallet_password
export SEED_PHRASE="your twelve word seed phrase here"  # Optional if using cached profile
export SYNPRESS_CACHED_PROFILE=/path/to/synpress/cache  # Optional: pre-initialized wallet
```

**Getting MetaMask extension:** If your project uses Synpress for E2E testing, the cached extension is typically at:

```
packages/e2e/.cache-synpress/metamask-chrome-*/
```

**Auth persistence:** The cached browser profile preserves login state across sessions. To test unauthenticated flows (login page, wallet connection):

```typescript
await page.evaluate(() => localStorage.clear());
await page.reload();
```

**Start the server:**

```bash
cd skills/dev-browser && npm run start-metamask &
```

Wait for `Ready` message. The wallet will be automatically unlocked.

**MetaMask popup handling:** See [references/metamask.md](references/metamask.md) for detailed patterns on handling connection requests, signature popups, and transaction confirmations.

## Writing Scripts

> **Run all scripts from `skills/dev-browser/` directory.** The `@/` import alias requires this directory's config.

Execute scripts inline using heredocs:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("example"); // descriptive name like "cnn-homepage"
await page.setViewportSize({ width: 1280, height: 800 });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
```

**Write to `tmp/` files only when** the script needs reuse, is complex, or user explicitly requests it.

### Key Principles

1. **Small scripts**: Each script does ONE thing (navigate, click, fill, check)
2. **Evaluate state**: Log/return state at the end to decide next steps
3. **Descriptive page names**: Use `"checkout"`, `"login"`, not `"main"`
4. **Disconnect to exit**: `await client.disconnect()` - pages persist on server
5. **Plain JS in evaluate**: `page.evaluate()` runs in browser - no TypeScript syntax

## Workflow Loop

Follow this pattern for complex tasks:

1. **Write a script** to perform one action
2. **Run it** and observe the output
3. **Evaluate** - did it work? What's the current state?
4. **Decide** - is the task complete or do we need another script?
5. **Repeat** until task is done

### No TypeScript in Browser Context

Code passed to `page.evaluate()` runs in the browser, which doesn't understand TypeScript:

```typescript
// ✅ Correct: plain JavaScript
const text = await page.evaluate(() => {
  return document.body.innerText;
});

// ❌ Wrong: TypeScript syntax will fail at runtime
const text = await page.evaluate(() => {
  const el: HTMLElement = document.body; // Type annotation breaks in browser!
  return el.innerText;
});
```

## Scraping Data

For scraping large datasets, intercept and replay network requests rather than scrolling the DOM. See [references/scraping.md](references/scraping.md) for the complete guide covering request capture, schema discovery, and paginated API replay.

## Client API

```typescript
const client = await connect();
const page = await client.page("name"); // Get or create named page
const pages = await client.list(); // List all page names
await client.close("name"); // Close a page
await client.disconnect(); // Disconnect (pages persist)

// ARIA Snapshot methods
const snapshot = await client.getAISnapshot("name"); // Get accessibility tree
const element = await client.selectSnapshotRef("name", "e5"); // Get element by ref
```

The `page` object is a standard Playwright Page.

## Waiting

```typescript
import { waitForPageLoad } from "@/client.js";

await waitForPageLoad(page); // After navigation
await page.waitForSelector(".results"); // For specific elements
await page.waitForURL("**/success"); // For specific URL
```

## Inspecting Page State

### Screenshots

```typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });
```

**Important:** Keep viewport under 2000px to avoid API errors when sending multiple screenshots:

```typescript
await page.setViewportSize({ width: 1280, height: 800 }); // Safe dimensions
```

### ARIA Snapshot (Element Discovery)

Use `getAISnapshot()` to discover page elements. Returns YAML-formatted accessibility tree:

```yaml
- banner:
  - link "Hacker News" [ref=e1]
  - navigation:
    - link "new" [ref=e2]
- main:
  - list:
    - listitem:
      - link "Article Title" [ref=e8]
      - link "328 comments" [ref=e9]
- contentinfo:
  - textbox [ref=e10]
    - /placeholder: "Search"
```

**Interpreting refs:**

- `[ref=eN]` - Element reference for interaction (visible, clickable elements only)
- `[checked]`, `[disabled]`, `[expanded]` - Element states
- `[level=N]` - Heading level
- `/url:`, `/placeholder:` - Element properties

**Interacting with refs:**

```typescript
const snapshot = await client.getAISnapshot("hackernews");
console.log(snapshot); // Find the ref you need

const element = await client.selectSnapshotRef("hackernews", "e2");
await element.click();
```

> **Important:** Element refs (`e1`, `e2`, etc.) become stale after navigation. Always get a fresh snapshot after `page.goto()` or clicking links before interacting with elements.

## MetaMask Wallet Interactions

When automating Web3 dApps, MetaMask popups appear for connections, signatures, and transactions. Handle them via browser context:

```typescript
// Find MetaMask popup in browser context
const pages = page.context().pages();
const metamaskPopup = pages.find((p) => p.url().includes("notification"));

if (metamaskPopup) {
  // Connection request: click Next → Connect
  await metamaskPopup.click('[data-testid="page-container-footer-next"]');
  await metamaskPopup.click('[data-testid="page-container-footer-next"]');

  // Signature request: click Sign
  await metamaskPopup.click('[data-testid="page-container-footer-next"]');
}
```

**Button selectors (in order of reliability):**

```typescript
// Try multiple selectors for robustness - MetaMask UI varies by version
const selectors = [
  "button.btn-primary", // Most reliable for confirm/sign
  '[data-testid="confirm-footer-button"]', // Newer MetaMask versions
  '[data-testid="page-container-footer-next"]', // Older MetaMask versions
];

for (const selector of selectors) {
  const btn = await metamaskPopup.$(selector);
  if (btn) {
    await btn.click();
    break;
  }
}
```

**Popup URL patterns:**
| Action | URL Contains |
|--------|-------------|
| Connect | `#connect` |
| Sign message | `#signature-request` |
| Transaction | `#confirm-transaction` |

For complete patterns including network switching and error handling, see [references/metamask.md](references/metamask.md).

## Error Recovery

Page state persists after failures. Debug with:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect } from "@/client.js";

const client = await connect();
const page = await client.page("my-page");

await page.screenshot({ path: "tmp/debug.png" });
console.log({
  url: page.url(),
  title: await page.title(),
  bodyText: await page.textContent("body").then((t) => t?.slice(0, 200)),
});

await client.disconnect();
EOF
```

### MetaMask Popup Debugging

When MetaMask interactions fail or behave unexpectedly, capture both the dApp page and any MetaMask popups:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect } from "@/client.js";

const client = await connect();
const page = await client.page("my-page");

// Screenshot main page
await page.screenshot({ path: "tmp/debug-page.png" });

// Find and screenshot all MetaMask popups
const allPages = page.context().pages();
for (let i = 0; i < allPages.length; i++) {
  const p = allPages[i];
  const url = p.url();
  if (url.includes('chrome-extension://') || url.includes('notification')) {
    await p.screenshot({ path: `tmp/debug-metamask-${i}.png` });
    console.log(`MetaMask popup ${i}: ${url}`);
  }
}

console.log(`Total pages in context: ${allPages.length}`);
await client.disconnect();
EOF
```

**Common MetaMask issues:**

- Popup not appearing → Check if MetaMask is unlocked, try `page.waitForTimeout(2000)`
- Wrong network → MetaMask may prompt for network switch before transaction
- Popup closed unexpectedly → User or timeout closed it, re-trigger the action

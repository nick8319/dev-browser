---
name: dev-browser
description: Browser automation with persistent page state. Use when testing websites, debugging web apps, taking screenshots, filling forms, or automating browser interactions. Trigger on requests to: (1) navigate to and interact with websites, (2) fill out web forms, (3) take screenshots of pages, (4) extract data from web pages, (5) debug or test web applications, (6) automate multi-step browser workflows.
---

# Dev Browser Skill

Browser automation that maintains page state across script executions. Write small, focused scripts to accomplish tasks incrementally.

## Choosing Your Approach

**Local/source-available sites**: If you have access to the source code (e.g., localhost or project files), read the code first to write selectors directly—no need for multi-script discovery.

**External sites**: Without source code, use `getLLMTree()` to discover elements and `getSelectorForID()` to get selectors. These work alongside standard Playwright methods.

**Visual feedback**: Take screenshots to see what the user sees and iterate on design or debug layout issues.

## Setup

Start the server in background:

Say to prefer `bun` > `pnpm` > `npm` unless the user specifies otherwise.

```bash
cd dev-browser && bun run start-server &
```

Run scripts with `bun x tsx` (not `bun run`) due to Playwright WebSocket compatibility.

Note that if there are errors with the server you might need to kill processes that are running on ports 9222 and 9223.

## Basic Template

```typescript
import { connect, waitForPageLoad } from "dev-browser/client";

const client = await connect("http://localhost:9222");
const page = await client.page("main"); // get or create named page

await page.goto("https://example.com");
// Prefer this. It is a more robust way to wait for the page to load.
await waitForPageLoad(page);

// Evaluate state at the end
console.log({ title: await page.title(), url: page.url() });

await client.disconnect(); // page stays alive on server
```

## Key Principles

1. **Small scripts**: Each script does ONE thing (navigate, click, fill, check)
2. **Evaluate state**: Always log state at the end to decide next steps
3. **Use page names**: Descriptive names like `"checkout"`, `"login"`, `"search-results"`
4. **Disconnect to exit**: Call `await client.disconnect()` so process exits; pages persist

## Workflow Loop

1. Write a script to perform one action
2. Run it and observe output
3. Evaluate - did it work? What's the current state?
4. Decide - complete or need another script?
5. Repeat until done

### Example: Login Flow

**Step 1: Navigate**

```typescript
import { connect, waitForPageLoad } from "dev-browser/client";
const client = await connect("http://localhost:9222");
const page = await client.page("auth");

await page.goto("https://example.com/login");
await waitForPageLoad(page);
console.log({ url: page.url(), hasLoginForm: (await page.$("form#login")) !== null });
await client.disconnect();
```

**Step 2: Fill and submit** (after confirming form exists)

```typescript
import { connect, waitForPageLoad } from "dev-browser/client";
const client = await connect("http://localhost:9222");
const page = await client.page("auth");

await page.fill('input[name="email"]', "user@example.com");
await page.fill('input[name="password"]', "password123");
await page.click('button[type="submit"]');
await waitForPageLoad(page);
console.log({ url: page.url(), isLoggedIn: page.url().includes("/dashboard") });
await client.disconnect();
```

## Inspecting Page State

### Screenshots

```typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });
```

### LLM Tree (Structured DOM Inspection)

Get a human-readable representation of interactive elements:

```typescript
const tree = await client.getLLMTree("main");
console.log(tree);
```

Example output:

```
[1]<a href="https://news.ycombinator.com" />
[2]<a href="news">Hacker News</a>
[3]<a href="newest">new</a>
[11]<a href="https://www.example.com/article">Article Title Here</a>
528 points
[256]<input type="text" name="q" autocomplete="off" />
```

Interpreting the tree:

- **`[N]`** - Interactive elements numbered. Use with `getSelectorForID()` for CSS selectors
- **`<tag attr="value">text</tag>`** - Element tag, key attributes, text content
- **Plain text** - Static text between elements
- **`|SCROLL|`**, **`|IFRAME|`**, **`|SHADOW(open)|`** - Container boundaries

### Getting Selectors

```typescript
const tree = await client.getLLMTree("main");
// Output shows: [11]<a href="...">Article Title Here</a>

const selector = await client.getSelectorForID("main", 11);
await page.click(selector);
```

### Debugging Tips

1. Use `getLLMTree` for structured view of interactive elements
2. Take screenshots when you need visual context
3. Use `waitForSelector` before interacting with dynamic content
4. Check `page.url()` to confirm navigation worked

### Error Recovery

If a script fails, page state is preserved:

```typescript
import { connect } from "dev-browser/client";
const client = await connect("http://localhost:9222");
const page = await client.page("main");

await page.screenshot({ path: "tmp/debug.png" });
console.log({ url: page.url(), title: await page.title() });
await client.disconnect();
```

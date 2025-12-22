# Change Walkthrough: Chrome Extension Support for Dev-Browser

**Date:** 2025-12-22
**Branch:** `feature/chrome-extension-support`
**Total Files:** 31 files changed (+8,764/-8 lines)

## Summary

This branch adds a major new mode to dev-browser: **Extension Mode**. Instead of launching a new Chromium instance, dev-browser can now connect to the user's existing Chrome browser via a custom extension. This enables automation of tabs where the user is already logged in, allows them to see and interact with captchas, and provides a more seamless automation experience.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Playwright    │────▶│  Relay Server   │◀────│ Chrome Extension│
│    Scripts      │ CDP │  (port 9222)    │ WS  │  (in browser)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Key components:**

1. **Relay Server** (`src/relay.ts`) - Bridges Playwright and the extension
2. **Chrome Extension** (`extension/`) - Attaches debugger to tabs and forwards CDP
3. **Updated Client** (`src/client.ts`) - Detects mode and handles extension-specific behavior

---

## Files Changed

| File                                      | Changes | Description                       |
| ----------------------------------------- | ------- | --------------------------------- |
| `extension/entrypoints/background.ts`     | +150    | Extension service worker          |
| `extension/services/CDPRouter.ts`         | +211    | Routes CDP commands to tabs       |
| `extension/services/ConnectionManager.ts` | +214    | WebSocket connection to relay     |
| `extension/services/TabManager.ts`        | +218    | Tab state and debugger attachment |
| `extension/services/StateManager.ts`      | +28     | Persist active/inactive state     |
| `extension/entrypoints/popup/*`           | +171    | Popup UI for toggle               |
| `extension/__tests__/*.ts`                | +550    | Unit tests for services           |
| `skills/dev-browser/src/relay.ts`         | +731    | CDP relay server                  |
| `skills/dev-browser/src/client.ts`        | +66/-0  | Extension mode support            |
| `skills/dev-browser/SKILL.md`             | +71/-8  | Documentation updates             |

---

## Detailed Walkthrough

### 1. CDP Relay Server

#### `skills/dev-browser/src/relay.ts:1-731`

**What changed:** New file implementing a CDP relay server that acts as a bridge between Playwright and the Chrome extension.

The relay maintains three types of WebSocket connections:

- `/cdp` - Playwright clients connect here
- `/extension` - Chrome extension connects here
- HTTP API (`/pages`) - Same REST API as launch mode

**Key data structures:**

```typescript
// Track connected browser tabs
const connectedTargets = new Map<string, ConnectedTarget>(); // sessionId -> target
const namedPages = new Map<string, string>(); // name -> sessionId

// Track Playwright clients with deduplication
const playwrightClients = new Map<string, PlaywrightClient>();
```

**CDP command routing (`routeCdpCommand`):**

Some commands are handled locally (like `Browser.getVersion`, `Target.setAutoAttach`), while others are forwarded to the extension:

```typescript
case "Target.attachToTarget": {
  const targetId = params?.targetId as string;
  for (const target of connectedTargets.values()) {
    if (target.targetId === targetId) {
      return { sessionId: target.sessionId };
    }
  }
  throw new Error(`Target ${targetId} not found`);
}
```

**Why:** Playwright expects a full CDP endpoint. The relay emulates browser-level CDP while delegating tab-level commands to the extension.

---

### 2. Chrome Extension Background Script

#### `extension/entrypoints/background.ts:1-150`

**What changed:** Service worker that coordinates extension behavior using a modular architecture.

```typescript
// Create services with dependency injection
const logger = createLogger((msg) => connectionManager?.send(msg));
const stateManager = new StateManager();
const tabManager = new TabManager({ logger, sendMessage: (msg) => connectionManager.send(msg) });
const cdpRouter = new CDPRouter({ logger, tabManager });
connectionManager = new ConnectionManager({
  logger,
  onMessage: (msg) => cdpRouter.handleCommand(msg),
  onDisconnect: () => tabManager.detachAll(),
});
```

**State management with popup:**

```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getState") {
    const state = await stateManager.getState();
    const isConnected = await connectionManager.checkConnection();
    sendResponse({ isActive: state.isActive, isConnected });
    return true; // Async response
  }
});
```

**Why:** Separating concerns into distinct services makes the code testable and maintainable.

---

### 3. CDP Router

#### `extension/services/CDPRouter.ts:54-160`

**What changed:** Routes incoming CDP commands to the correct Chrome tab.

**Session ID resolution:**

```typescript
// Find target tab by sessionId
if (msg.params.sessionId) {
  const found = this.tabManager.getBySessionId(msg.params.sessionId);
  if (found) {
    targetTabId = found.tabId;
    targetTab = found.tab;
  }
}

// Check child sessions (iframes, workers)
if (!targetTab && msg.params.sessionId) {
  const parentTabId = this.tabManager.getParentTabId(msg.params.sessionId);
  if (parentTabId) {
    targetTabId = parentTabId;
    targetTab = this.tabManager.get(parentTabId);
  }
}
```

**Special command handling:**

```typescript
case "Target.createTarget": {
  const url = (msg.params.params?.url as string) || "about:blank";
  const tab = await chrome.tabs.create({ url, active: false });

  // Add tab to "Dev Browser" group for organization
  await this.getOrCreateDevBrowserGroup(tab.id);

  const targetInfo = await this.tabManager.attach(tab.id);
  return { targetId: targetInfo.targetId };
}
```

**Why:** The router translates between Playwright's CDP protocol and Chrome's debugger API, handling edge cases like iframe sessions.

---

### 4. Tab Manager

#### `extension/services/TabManager.ts:93-130`

**What changed:** Manages tab state, debugger attachment, and CDP session lifecycle.

**Attaching to a tab:**

```typescript
async attach(tabId: number): Promise<TargetInfo> {
  await chrome.debugger.attach({ tabId }, "1.3");

  const result = await chrome.debugger.sendCommand(
    { tabId }, "Target.getTargetInfo"
  ) as { targetInfo: TargetInfo };

  const sessionId = `pw-tab-${this.nextSessionId++}`;
  this.tabs.set(tabId, {
    sessionId,
    targetId: result.targetInfo.targetId,
    state: "connected",
  });

  // Notify relay of new target
  this.sendMessage({
    method: "forwardCDPEvent",
    params: {
      method: "Target.attachedToTarget",
      params: { sessionId, targetInfo: result.targetInfo },
    },
  });
}
```

**Why:** Chrome's debugger API requires explicit attachment. The TabManager abstracts this and generates CDP-compatible session IDs.

---

### 5. Connection Manager

#### `extension/services/ConnectionManager.ts:69-110`

**What changed:** Manages WebSocket connection to the relay server with auto-reconnect.

```typescript
startMaintaining(): void {
  this.shouldMaintain = true;
  this.tryConnect().catch(() => {});
  this.reconnectTimer = setTimeout(
    () => this.startMaintaining(),
    RECONNECT_INTERVAL  // 3000ms
  );
}

async checkConnection(): Promise<boolean> {
  if (!this.isConnected()) return false;

  // Verify server is actually reachable (detects server crashes)
  try {
    const response = await fetch("http://localhost:9222", {
      method: "HEAD",
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    this.ws?.close();
    return false;
  }
}
```

**Why:** The extension needs to maintain connection as the relay server may restart. Health checks detect stale WebSocket connections.

---

### 6. Client Updates

#### `skills/dev-browser/src/client.ts:319-360`

**What changed:** The client detects extension mode and handles page lookup differently.

```typescript
// Check if we're in extension mode
const infoRes = await fetch(serverUrl);
const info = await infoRes.json();
const isExtensionMode = info.mode === "extension";

if (isExtensionMode) {
  // In extension mode, DON'T use findPageByTargetId as it corrupts page state
  // Instead, find page by URL or use the only available page
  const allPages = b.contexts().flatMap((ctx) => ctx.pages());

  if (allPages.length === 1) {
    return allPages[0]!;
  }

  // Multiple pages - try to match by URL
  if (pageInfo.url) {
    const matchingPage = allPages.find((p) => p.url() === pageInfo.url);
    if (matchingPage) return matchingPage;
  }

  return allPages[0]!;
}
```

**New API method:**

```typescript
async getServerInfo(): Promise<ServerInfo> {
  const res = await fetch(serverUrl);
  const info = await res.json();
  return {
    wsEndpoint: info.wsEndpoint,
    mode: info.mode ?? "launch",
    extensionConnected: info.extensionConnected,
  };
}
```

**Why:** Extension mode has different CDP semantics. Using `findPageByTargetId` corrupts page state because the target IDs are managed differently.

---

### 7. Popup UI

#### `extension/entrypoints/popup/main.ts:1-52`

**What changed:** Simple toggle UI for activating/deactivating the extension.

```typescript
toggle.addEventListener("change", () => {
  const isActive = toggle.checked;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", isActive },
    (response) => {
      if (response) updateUI(response);
    }
  );
});

// Poll for state updates while popup is open
const pollInterval = setInterval(refreshState, 1000);
```

**Why:** Users need a simple way to enable/disable extension mode. Polling ensures the UI reflects the actual connection state.

---

### 8. Tab Grouping

#### `extension/services/CDPRouter.ts:24-50`

**What changed:** Tabs created by dev-browser are automatically grouped together.

```typescript
private async getOrCreateDevBrowserGroup(tabId: number): Promise<number> {
  if (this.devBrowserGroupId !== null) {
    try {
      await chrome.tabGroups.get(this.devBrowserGroupId);
      await chrome.tabs.group({ tabIds: [tabId], groupId: this.devBrowserGroupId });
      return this.devBrowserGroupId;
    } catch {
      this.devBrowserGroupId = null;
    }
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, { title: "Dev Browser", color: "blue" });
  this.devBrowserGroupId = groupId;
  return groupId;
}
```

**Why:** Visual organization helps users distinguish automation-created tabs from their normal browsing.

---

## Testing Notes

- **Unit tests** added for `CDPRouter`, `TabManager`, `StateManager`, and `logger`
- Run tests: `cd extension && npm test`
- Test coverage focuses on:
  - CDP command routing
  - Session ID resolution (parent/child)
  - Tab attachment/detachment lifecycle
  - Connection state management

**Manual testing checklist:**

- [ ] Start relay with `npm run start-extension`
- [ ] Load extension in Chrome and enable it
- [ ] Verify connection status in popup
- [ ] Run Playwright script and confirm tab automation works
- [ ] Test tab grouping for newly created tabs
- [ ] Test reconnection after relay restart

---

_Generated by change-walkthrough skill_

# Dev Browser + MetaMask

Fork of [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) with **MetaMask extension support** for Web3 dApp development.

## What's Added

- **MetaMask Mode** - Browser automation with MetaMask wallet for SIWE auth, transaction signing, and dApp testing
- **Auto-config** - `--project-dir` flag loads wallet credentials from your project's `.env`
- **Popup handling** - Patterns for connection requests, signatures, and transaction confirmations

## Quick Start

### 1. Install as Claude Code Plugin

```bash
/plugin add nick8319/dev-browser
/plugin install dev-browser@nick8319/dev-browser
```

### 2. Configure Your Project

Add to your project's `.env`:

```bash
METAMASK_EXTENSION_PATH=/path/to/metamask-chrome-extension
WALLET_PASSWORD=your_wallet_password
# Optional:
SEED_PHRASE="your twelve word seed phrase"
SYNPRESS_CACHED_PROFILE=/path/to/cached/profile
```

**Synpress users:** Extension is at `packages/e2e/.cache-synpress/metamask-chrome-*/`

### 3. Use It

Ask Claude to test your Web3 app:

> "Open localhost:3000, connect wallet, and test the swap flow"

> "Sign in with MetaMask and verify the dashboard loads correctly"

## All Modes

| Mode         | Command                                           | Use Case                     |
| ------------ | ------------------------------------------------- | ---------------------------- |
| Standalone   | `./server.sh &`                                   | Fresh browser, no extensions |
| Extension    | `npm run start-extension &`                       | Your existing Chrome session |
| **MetaMask** | `npm run start-metamask -- --project-dir /path &` | Web3 dApp testing            |

## Credits

Original [dev-browser](https://github.com/SawyerHood/dev-browser) by [Sawyer Hood](https://github.com/sawyerhood) - persistent page state, LLM-friendly snapshots, and agentic script execution.

## License

MIT

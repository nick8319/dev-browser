#!/usr/bin/env npx tsx
/**
 * Add a custom network to MetaMask
 *
 * Usage:
 *   npx tsx scripts/add-network.ts --name "Ink Sepolia" --rpc "https://rpc-gel-sepolia.inkonchain.com" --chain-id 763373 --symbol ETH --explorer "https://explorer-sepolia.inkonchain.com/"
 *
 * Required: --name, --rpc, --chain-id, --symbol
 * Optional: --explorer
 */

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
}

const network = {
  name: getArg("name"),
  rpcUrl: getArg("rpc"),
  chainId: getArg("chain-id") ? parseInt(getArg("chain-id")!, 10) : undefined,
  symbol: getArg("symbol"),
  blockExplorerUrl: getArg("explorer"),
};

// Validate required fields
const missing = [];
if (!network.name) missing.push("--name");
if (!network.rpcUrl) missing.push("--rpc");
if (!network.chainId) missing.push("--chain-id");
if (!network.symbol) missing.push("--symbol");

if (missing.length > 0) {
  console.error("Missing required arguments:", missing.join(", "));
  console.error(`
Usage:
  npx tsx scripts/add-network.ts --name "Network Name" --rpc "https://rpc.example.com" --chain-id 12345 --symbol ETH [--explorer "https://explorer.example.com"]

Example:
  npx tsx scripts/add-network.ts --name "Ink Sepolia" --rpc "https://rpc-gel-sepolia.inkonchain.com" --chain-id 763373 --symbol ETH --explorer "https://explorer-sepolia.inkonchain.com/"
`);
  process.exit(1);
}

// Call the server API
const serverUrl = "http://localhost:9222";

try {
  const res = await fetch(`${serverUrl}/metamask/add-network`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(network),
  });

  const result = await res.json();

  if (result.success) {
    console.log(`✅ Network "${network.name}" added successfully!`);
  } else {
    console.error(`❌ Failed to add network: ${result.error}`);
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Error connecting to dev-browser server. Is it running?");
  console.error("   Start it with: npm run start-metamask -- --project-dir /path/to/project");
  process.exit(1);
}

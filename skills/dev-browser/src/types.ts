// API request/response types - shared between client and server

export interface NetworkConfig {
  name: string;
  rpcUrl: string;
  chainId: number;
  symbol: string;
  blockExplorerUrl?: string;
}

export interface ServeOptions {
  port?: number;
  headless?: boolean;
  cdpPort?: number;
  /** Directory to store persistent browser profiles (cookies, localStorage, etc.) */
  profileDir?: string;
  /** Path to browser extension (e.g., MetaMask) */
  extensionPath?: string;
  /** Password for wallet unlock */
  walletPassword?: string;
  /** Seed phrase for first-run wallet import */
  seedPhrase?: string;
  /** Network to add on first run */
  networkConfig?: NetworkConfig;
}

export interface GetPageRequest {
  name: string;
}

export interface GetPageResponse {
  wsEndpoint: string;
  name: string;
  targetId: string; // CDP target ID for reliable page matching
}

export interface ListPagesResponse {
  pages: string[];
}

export interface ServerInfoResponse {
  wsEndpoint: string;
  metamaskExtensionId?: string;
  metamaskInitialized?: boolean;
}

// MetaMask API types

export interface MetaMaskStatusResponse {
  extensionId: string | null;
  isLocked: boolean;
  walletInitialized: boolean;
}

export interface MetaMaskUnlockRequest {
  password: string;
}

export interface MetaMaskConnectResponse {
  success: boolean;
  error?: string;
}

export interface MetaMaskSignResponse {
  success: boolean;
  error?: string;
}

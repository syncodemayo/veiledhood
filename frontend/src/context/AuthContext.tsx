import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserProvider } from "ethers";
import { api, setAuthToken } from "../lib/api";
import {
  connectWallet,
  disconnectWalletConnect,
  ensureRobinhoodTestnet,
  getInjectedProvider,
  signMessage,
  ROBINHOOD_TESTNET_CHAIN_ID,
  type Eip1193Provider,
  type WalletKind,
} from "../lib/wallet";
import { DataCrypto } from "../lib/crypto";
import { errorMessage } from "../lib/errors";
import type { AuthValidateResponse, AuthVerifyResponse } from "../types/api";

interface AuthState {
  address: string | null;
  token: string | null;
  provider: BrowserProvider | null;
  chainId: number | null;
  dataCrypto: DataCrypto | null;
  connecting: boolean;
  error: string | null;
  connect: (kind?: WalletKind) => Promise<void>;
  unlock: (kind?: WalletKind) => Promise<void>;
  disconnect: () => void;
  switchToRobinhoodTestnet: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "vh.token";
const ADDR_KEY = "vh.address";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem(ADDR_KEY));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [dataCrypto, setDataCrypto] = useState<DataCrypto | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rawRef = useRef<Eip1193Provider | null>(null);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .get<AuthValidateResponse>("/auth/validate")
      .then((r) => {
        if (!r.valid) disconnect();
      })
      .catch(() => disconnect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On reload, the JWT session persists but the live wallet `provider` doesn't
  // (it can't be serialized). Silently re-bind to the injected wallet if it's
  // still connected to the same address, using eth_accounts — no popup, since
  // the site is already authorized. Never attempted for WalletConnect sessions.
  useEffect(() => {
    if (!address || provider) return;
    const injected = getInjectedProvider();
    if (!injected) return;
    injected
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const list = accounts as string[];
        if (list[0]?.toLowerCase() !== address) return;
        const prov = new BrowserProvider(injected as never);
        return bindWallet(prov, injected);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    const raw = rawRef.current;
    if (!raw?.on) return;
    const onChainChanged = (id: unknown) => {
      const n = typeof id === "string" ? parseInt(id, 16) : Number(id);
      setChainId(n);
    };
    raw.on("chainChanged", onChainChanged);
    return () => raw.removeListener?.("chainChanged", onChainChanged);
  }, [provider]);

  async function bindWallet(prov: BrowserProvider, raw: Eip1193Provider) {
    rawRef.current = raw;
    setProvider(prov);
    const net = await prov.getNetwork();
    setChainId(Number(net.chainId));
  }

  async function connect(kind: WalletKind = "injected") {
    setConnecting(true);
    setError(null);
    try {
      const { provider: prov, raw } = await connectWallet(kind);
      const { message } = await api.get<{ message: string }>("/auth/message");
      const signature = await signMessage(prov, message);
      const verified = await api.post<AuthVerifyResponse>("/auth/verify", { message, signature });
      setAuthToken(verified.token);
      localStorage.setItem(TOKEN_KEY, verified.token);
      localStorage.setItem(ADDR_KEY, verified.address);
      setToken(verified.token);
      setAddress(verified.address);
      await bindWallet(prov, raw);
      setDataCrypto(await DataCrypto.fromSignature(signature));
    } catch (e) {
      setError(errorMessage(e, "Failed to connect wallet"));
      throw e;
    } finally {
      setConnecting(false);
    }
  }

  async function unlock(kind: WalletKind = "injected") {
    setConnecting(true);
    setError(null);
    try {
      const { address: connectedAddr, provider: prov, raw } = await connectWallet(kind);
      if (address && connectedAddr !== address) throw new Error("Connected wallet doesn't match the signed-in address");
      const { message } = await api.get<{ message: string }>("/auth/message");
      const signature = await signMessage(prov, message);
      await bindWallet(prov, raw);
      setDataCrypto(await DataCrypto.fromSignature(signature));
    } catch (e) {
      setError(errorMessage(e, "Failed to unlock"));
      throw e;
    } finally {
      setConnecting(false);
    }
  }

  async function switchToRobinhoodTestnet() {
    if (!rawRef.current) throw new Error("No wallet connected");
    await ensureRobinhoodTestnet(rawRef.current);
    if (provider) {
      const net = await provider.getNetwork();
      setChainId(Number(net.chainId));
    }
  }

  function disconnect() {
    void disconnectWalletConnect();
    rawRef.current = null;
    setAuthToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDR_KEY);
    setToken(null);
    setAddress(null);
    setProvider(null);
    setChainId(null);
    setDataCrypto(null);
  }

  const value = useMemo<AuthState>(
    () => ({ address, token, provider, chainId, dataCrypto, connecting, error, connect, unlock, disconnect, switchToRobinhoodTestnet }),
    [address, token, provider, chainId, dataCrypto, connecting, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ROBINHOOD_TESTNET_CHAIN_ID };

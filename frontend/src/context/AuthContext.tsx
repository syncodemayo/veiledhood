import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { api, setAuthToken } from "../lib/api";
import { DataCrypto } from "../lib/crypto";
import { errorMessage } from "../lib/errors";
import type { AuthValidateResponse, AuthVerifyResponse } from "../types/api";

interface AuthState {
  address: string | null;
  token: string | null;
  dataCrypto: DataCrypto | null;
  connecting: boolean;
  error: string | null;
  login: () => Promise<void>;
  unlock: () => Promise<void>;
  disconnect: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "vh.token";
const ADDR_KEY = "vh.address";

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address: wagmiAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  const [address, setAddress] = useState<string | null>(() => localStorage.getItem(ADDR_KEY));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [dataCrypto, setDataCrypto] = useState<DataCrypto | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginAttempted = useRef<string | null>(null);

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

  async function login() {
    if (!wagmiAddress) throw new Error("No wallet connected");
    setConnecting(true);
    setError(null);
    try {
      const { message } = await api.get<{ message: string }>("/auth/message");
      const signature = await signMessageAsync({ message });
      const verified = await api.post<AuthVerifyResponse>("/auth/verify", { message, signature });
      setAuthToken(verified.token);
      localStorage.setItem(TOKEN_KEY, verified.token);
      localStorage.setItem(ADDR_KEY, verified.address);
      setToken(verified.token);
      setAddress(verified.address);
      setDataCrypto(await DataCrypto.fromSignature(signature));
    } catch (e) {
      setError(errorMessage(e, "Failed to sign in"));
      throw e;
    } finally {
      setConnecting(false);
    }
  }

  // Session continuity: if the connected wallet doesn't match the last signed-in
  // address (fresh connect, or wallet switched accounts), sign in automatically.
  useEffect(() => {
    if (!isConnected || !wagmiAddress) return;
    const lower = wagmiAddress.toLowerCase();
    if (address === lower && token) return;
    if (loginAttempted.current === lower) return;
    loginAttempted.current = lower;
    login().catch(() => {
      loginAttempted.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, wagmiAddress]);

  useEffect(() => {
    if (!isConnected) {
      loginAttempted.current = null;
      if (address) disconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  /** Re-derive the client-side encryption key after a page reload (wagmi restores
   * the connection automatically, but a fresh signature is needed for dataCrypto). */
  async function unlock() {
    if (!wagmiAddress) throw new Error("No wallet connected");
    setConnecting(true);
    setError(null);
    try {
      const { message } = await api.get<{ message: string }>("/auth/message");
      const signature = await signMessageAsync({ message });
      setDataCrypto(await DataCrypto.fromSignature(signature));
    } catch (e) {
      setError(errorMessage(e, "Failed to unlock"));
      throw e;
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    wagmiDisconnect();
    setAuthToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADDR_KEY);
    setToken(null);
    setAddress(null);
    setDataCrypto(null);
  }

  const value = useMemo<AuthState>(
    () => ({ address, token, dataCrypto, connecting, error, login, unlock, disconnect }),
    [address, token, dataCrypto, connecting, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

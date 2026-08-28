import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/extra.css";
import { wagmiConfig } from "./config/wagmi";
import { AuthProvider } from "./context/AuthContext";
import { PrivacyProvider } from "./context/PrivacyContext";
import { ToastProvider } from "./context/ToastContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import App from "./App";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={darkTheme({ accentColor: "#8257FF", accentColorForeground: "#fff", borderRadius: "medium" })}>
            <AuthProvider>
              <PrivacyProvider>
                <ToastProvider>
                  <ConfirmProvider>
                    <App />
                  </ConfirmProvider>
                </ToastProvider>
              </PrivacyProvider>
            </AuthProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </BrowserRouter>
  </StrictMode>,
);

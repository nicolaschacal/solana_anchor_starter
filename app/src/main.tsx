import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "./lib/rebyters/config";
import AdminApp from "./routes/admin/App";
import { PlayerGame } from "./routes/player/PlayerGame";
import { Navigate, Route, Routes } from "react-router-dom";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./atlas.css";
import "./theme.css";
import "./rules.css";
import { initializeTheme } from "./lib/theme";
import { RpcMeter } from "./components/RpcMeter";
import { rpcFetch } from "./lib/rebyters/rpc-fetch";
import { RebytersAuthProvider } from "./lib/rebyters/auth";
import { AppErrorBoundary, reloadOnce } from "./components/AppErrorBoundary";
initializeTheme();
window.addEventListener("vite:preloadError", (event) => { if (reloadOnce()) event.preventDefault(); });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <ConnectionProvider
      endpoint={RPC_URL}
      config={{
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 30000,
        disableRetryOnRateLimit: true,
        fetch: rpcFetch,
      }}
    >
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <RebytersAuthProvider>
          <BrowserRouter>
            <RpcMeter />
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="/acquire" element={<Navigate to="/" replace />} />
              <Route path="/*" element={<PlayerGame />} />
            </Routes>
          </BrowserRouter>
          </RebytersAuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
// A page that stayed up for a while is healthy: allow one more automatic reload after a future deploy.
setTimeout(() => { try { sessionStorage.removeItem("rebyters-chunk-reload"); } catch { /* ignore */ } }, 15000);

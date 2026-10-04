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
import { PlayerAccount, PlayerAtlas, PlayerHome, PlayerLab } from "./routes/player/App";
import { Navigate, Route, Routes } from "react-router-dom";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./atlas.css";
import "./theme.css";
import "./rules.css";
import { initializeTheme } from "./lib/theme";
import { RebytersAuthProvider } from "./lib/rebyters/auth";
initializeTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider
      endpoint={RPC_URL}
      config={{
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 30000,
        disableRetryOnRateLimit: true,
      }}
    >
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <RebytersAuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/admin/*" element={<AdminApp />} />
              <Route path="/account" element={<PlayerAccount />} />
              <Route path="/acquire" element={<Navigate to="/" replace />} />
              <Route path="/lab" element={<PlayerLab />} />
              <Route path="/atlas" element={<PlayerAtlas />} />
              <Route path="/*" element={<PlayerHome />} />
            </Routes>
          </BrowserRouter>
          </RebytersAuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
);

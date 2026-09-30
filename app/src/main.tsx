import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "./lib/rebyters/config";
import App from "./routes/admin/App";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./atlas.css";
import "./theme.css";
import "./rules.css";
import { initializeTheme } from "./lib/theme";
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
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
);

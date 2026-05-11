import React from "react";
import ReactDOM from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import App from "./App";
import "./styles.css";

const wallets = [new PhantomWalletAdapter()];
const LocalConnectionProvider = ConnectionProvider as React.ComponentType<
  React.PropsWithChildren<{ endpoint: string }>
>;
const LocalWalletProvider = WalletProvider as React.ComponentType<
  React.PropsWithChildren<{ wallets: typeof wallets; autoConnect?: boolean }>
>;
const LocalWalletModalProvider = WalletModalProvider as React.ComponentType<React.PropsWithChildren>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalConnectionProvider endpoint="https://api.devnet.solana.com">
      <LocalWalletProvider wallets={wallets} autoConnect>
        <LocalWalletModalProvider>
          <App />
        </LocalWalletModalProvider>
      </LocalWalletProvider>
    </LocalConnectionProvider>
  </React.StrictMode>
);

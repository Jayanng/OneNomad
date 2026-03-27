import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@onelabs/dapp-kit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@onelabs/dapp-kit/dist/index.css'

const { networkConfig } = createNetworkConfig({
  testnet: { url: "/api/rpc" },
})

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect={false} preferredWallets={["OneWallet", "One Wallet"]}>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>
)

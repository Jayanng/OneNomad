# OneNomad — Autonomous AI Yield Optimizer on OneChain

> An always-on AI agent that monitors DeFi liquidity pools, makes intelligent rebalancing decisions, and executes on-chain transactions automatically — so you don't have to.

**Live Demo:** https://onenomad.onrender.com
**GitHub:** https://github.com/Jayanng/OneNomad
**Network:** OneChain Testnet

---

## The Problem

DeFi yield opportunities are time-sensitive. APY rates across liquidity pools shift constantly — sometimes by several percentage points within minutes. Staying optimally allocated requires round-the-clock monitoring, fast decision-making, and reliable transaction execution. This is practically impossible for a regular user to do manually.

Most people either leave their funds in one pool and miss better opportunities, or they manually rebalance too slowly and too infrequently to make a real difference. OneNomad solves this by replacing the human with an always-on AI agent that never sleeps, never panics, and always follows clear, auditable rules.

---
## Project Overview

OneNomad is a fully autonomous AI-powered DeFi agent deployed on OneChain testnet. It monitors liquidity pool yields in real time, uses large language models to make intelligent rebalancing decisions, and executes on-chain transactions automatically — without any human intervention. Every decision is logged, every transaction is verifiable on-chain, and a live WebSocket
dashboard gives users full visibility into what the agent is doing and why.


## How It Works

OneNomad runs a continuous cycle every 15 seconds:

1. **Fetch** — Pull current APY data from all tracked liquidity pools
2. **Decide** — Send pool data and current positions to an LLM for a rebalance/hold recommendation
3. **Validate** — A safety gate verifies the AI's decision meets gain thresholds and risk rules
4. **Execute** — Build and broadcast a Programmable Transaction Block (PTB) on OneChain
5. **Sync** — Read the updated on-chain Position object to confirm the new allocation
6. **Broadcast** — Push all results live to the dashboard via WebSocket

---

## Smart Contracts

The entire protocol is deployed as a single Move package on OneChain testnet.

**Package Address:**
```
0x72fa7314e418257f60f0c3a98625b95369f58fa2733f08e30ba0610fb6276f55
```

### Modules

| Module | Purpose |
|---|---|
| `onenomad::pool` | Generic pool contract used by both OneDEX and OneVault pools. Handles deposits, withdrawals, APY tracking, and liquidity seeding. Emits `DepositEvent` and `WithdrawEvent` on every action. |
| `onenomad::position` | Shared on-chain position tracker. Stores each wallet's deposit balance per pool as a `VecMap<ID, u64>`. Updated atomically with every PTB. |
| `onenomad::swap` | Swap routing module for moving between pools with different base tokens. |
| `onenomad::usdc` | Mock USDC token used for pool pairs on testnet. |
| `onenomad::usdt` | Mock USDT token used for pool pairs on testnet. |

### Deployed Pool Objects

| Pool | Object ID |
|---|---|
| OneDEX OCT/USDC | `0x07767a89b74296a6957e81597111e550571a38390a12b8ae9f9d2f7daa41bbfb` |
| OneDEX OCT/USDT | `0x7188ae52448cf3a66f9316e1bcc98a6d59d34b2eeb95477271f6cd0b92403d13` |
| OneDEX USDC/USDT | `0x7e29654c92d5c2945b5fd214a8a5a88eee692c206a8975977c31dfa3b880dd69` |
| OneVault Stable Yield | `0xa58c0ab1dff12474034f58027a43ddc9c0a37fb4e225a254a036071b02656e31` |
| OneVault High Yield | `0xbb527d642620b2e680515f04065674d45dd4bf8de2d1d3caf096a9e0b0526857` |
| Position Object | `0x21162b3e805f2229d383cd81564382ff8a9a5eea80e204d3510f697457be7e5c` |

> **Note:** OneDEX and OneVault are simulated protocol labels representing two DeFi protocol types (a DEX and a vault) within the same deployed package. In production, these would be separate protocol integrations. Mock APY data demonstrates realistic yield variation across pool types.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    OneChain Testnet                   │
│  Pool<OCT,USDC>  Pool<OCT,USDT>  Pool<USDC,USDT>     │
│  Pool<OCT,USDT> (Vault)  Pool<USDC,USDT> (Vault)     │
│                  Position Object                      │
└──────────────────┬───────────────────────────────────┘
                   │ PTB (deposit / withdraw)
┌──────────────────▼───────────────────────────────────┐
│                  Backend (Node.js / TypeScript)        │
│                                                        │
│  agent.ts        — cron loop, position tracking       │
│  aiDecision.ts   — Groq + Mistral + safety override   │
│  txBuilder.ts    — PTB construction & execution       │
│  apyFetcher.ts   — pool APY data provider             │
│  safety.ts       — validation gate                    │
│  dashboard.ts    — Express REST + WebSocket server    │
│  db.ts           — JSON persistence layer             │
└──────────────────┬───────────────────────────────────┘
                   │ WebSocket (ws://)
┌──────────────────▼───────────────────────────────────┐
│              Frontend (React + Vite)                   │
│                                                        │
│  Dashboard.tsx   — Agent Brain terminal, pool list    │
│  HunterStats.tsx — Transaction history, rebalances    │
│  Security.tsx    — Safety gate log, risk controls     │
│  Liquidity.tsx   — Pool allocation visualization      │
│  Landing.tsx     — Public landing page                │
└──────────────────────────────────────────────────────┘
```

---

## AI Decision Pipeline

```
Pool APY data + current positions
          │
          ▼
   Groq llama-3.3-70b  ──fail──▶  Mistral mistral-small  ──fail──▶  Safe Hold
          │
          ▼
     Parse & validate JSON decision
          │
          ▼
  Step 4: Gain check
  if (target APY - source APY) < threshold → override to hold
          │
          ▼
  Step 5: Forced rebalance check
  if agent holds but better pool exists above threshold → force rebalance
          │
          ▼
     Safety gate (validateDecision)
     ✓ gain ≥ threshold
     ✓ source pool has active funds
     ✓ target APY ≤ 50% honeypot cap
          │
          ▼
     Execute PTB on OneChain
```

---

## Tech Stack

### Smart Contracts
- **Language:** Move (2024 edition)
- **Network:** OneChain Testnet
- **RPC:** `https://rpc-testnet.onelabs.cc`
- **SDK:** `@onelabs/sui v1.26.2`

### Backend
- **Runtime:** Node.js + TypeScript
- **Web server:** Express.js
- **Real-time:** WebSocket (`ws`)
- **Scheduler:** `node-cron` (15-second cycles)
- **AI providers:** Groq (Llama 3.3-70B), Mistral AI (mistral-small)
- **Persistence:** JSON file-based DB
- **Hosting:** Render (free tier)

### Frontend
- **Framework:** React 18 + TypeScript
- **Build tool:** Vite
- **Styling:** Tailwind CSS
- **Wallet:** `@onelabs/dapp-kit`
- **Routing:** React Router v6
- **Data fetching:** TanStack Query

---

## Key Design Decisions

- **Atomic PTBs** — Each rebalance is a single Programmable Transaction Block that withdraws, optionally routes between token types, and deposits atomically. If any step fails, the entire transaction rolls back — funds are never lost mid-rebalance.

- **On-chain position sync** — After every successful rebalance, the agent re-reads the Position object directly from chain to confirm the actual allocation. No reliance on in-memory math for live decisions.

- **Dual AI + programmatic override** — LLMs provide reasoning and adaptability; the programmatic layer ensures correctness. Neither can cause a bad trade on its own.

- **No fund custody** — The agent uses the user's own private key. There is no intermediary holding funds.

- **Resilient loop** — RPC failures, AI timeouts, and PTB errors are all handled gracefully. The agent skips the cycle and retries on the next tick without crashing.

---

## Project Structure

```
OneNomad/
├── move/                    # Move smart contracts
│   ├── sources/
│   │   ├── pool.move        # Pool deposit/withdraw logic
│   │   ├── position.move    # On-chain position tracker
│   │   ├── swap.move        # Token swap routing
│   │   ├── usdc.move        # Mock USDC token
│   │   └── usdt.move        # Mock USDT token
│   └── Move.toml
├── src/                     # Backend (Node.js / TypeScript)
│   ├── agent.ts             # Main agent loop
│   ├── aiDecision.ts        # AI + programmatic decision engine
│   ├── txBuilder.ts         # PTB builder & executor
│   ├── apyFetcher.ts        # Pool APY data fetcher
│   ├── safety.ts            # Safety gate validation
│   ├── dashboard.ts         # Express + WebSocket server
│   ├── db.ts                # JSON persistence layer
│   ├── eventMonitor.ts      # On-chain event listener
│   └── types.ts             # Shared TypeScript types
├── client/                  # Frontend (React + Vite)
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── HunterStats.tsx
│       │   ├── Security.tsx
│       │   ├── Liquidity.tsx
│       │   └── Landing.tsx
│       └── hooks/
│           ├── useAgentWS.ts
│           ├── useOneWallet.ts
│           └── useOneID.ts
└── data/                    # Runtime DB (gitignored)
```

---

## Environment Variables

```env
PRIVATE_KEY=                  # Agent wallet private key
ONECHAIN_RPC_URL=             # OneChain RPC endpoint
ONENOMAD_PACKAGE_ID=          # Deployed Move package ID
POSITION_OBJECT_ID=           # On-chain Position object ID
POOL_OCT_USDC_ID=             # Pool object IDs
POOL_OCT_USDT_ID=
POOL_VAULT_STABLE_ID=
POOL_VAULT_HIGH_ID=
POOL_USDC_USDT_ID=
GROQ_API_KEY=                 # Groq AI API key
MISTRAL_API_KEY=              # Mistral AI API key
CRON_INTERVAL_SEC=15          # Agent cycle interval (seconds)
GAS_BUDGET_MIST=10000000      # Max gas per transaction
PORT=3000
```

---

## Running Locally

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Build frontend
cd client && npm run build && cd ..

# Start backend (serves frontend from /public)
npm run dev
```

---

## Sample On-Chain Transactions

| Time | Digest | Status |
|---|---|---|
| Latest | `6dBPfZwEfb1KvkXkKgwHfFGrTQx2L2D953cv4ntjKCzU` | ✅ success |
| | `1UATgZyLtNKLGDg2wJcPzG8Q6NEdXyF1VVAHaDZRqKP` | ✅ success |
| | `FimfYsNPni21wMb3ko7ja9edoKeH5SQZtX2ixtVbboQ` | ✅ success |
| | `HG7Doi84PLuPQxwhhFuDrqNtrmJGizzSDeBMdRMm6KrJ` | ✅ success |

View on explorer: `https://onescan.cc/testnet/tx/<digest>`

---

## Vision

OneNomad is a proof of concept for the future of personal finance on-chain: intelligent agents that manage your assets better than you could manually, while keeping you fully informed and in control. Today it optimizes yield across DeFi pools. Tomorrow, the same framework can power lending optimization, cross-chain rebalancing, risk-adjusted portfolio management, and more.

**DeFi should work for everyone — not just the people who never sleep.**

---

*Built for the OneChain Hackathon.*

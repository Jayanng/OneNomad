// FILE: client/src/pages/Docs.tsx
import { useState } from "react";
import { Link } from "react-router-dom";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "safety", label: "Safety Parameters" },
  { id: "contracts", label: "Smart Contracts" },
  { id: "faq", label: "FAQ" },
];

export default function Docs() {
  const [activeSection, setActiveSection] = useState("overview");

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] font-body selection:bg-primary-container selection:text-on-primary-container">
      <style>{`
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
      `}</style>

      {/* Standalone Docs Navbar */}
      <header className="fixed top-0 w-full z-50 backdrop-blur-xl border-b border-white/[0.06]" style={{ background: "rgba(10,12,20,0.75)" }}>
        <div className="flex justify-between items-center px-8 py-3.5 max-w-5xl mx-auto">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center border border-cyan-500/30" style={{ background: "linear-gradient(135deg, rgba(0,243,255,0.15), rgba(0,243,255,0.04))" }}>
              <span className="material-symbols-outlined text-cyan-400 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>deployed_code</span>
            </div>
            <span className="text-lg font-bold tracking-tight font-headline" style={{ background: "linear-gradient(90deg,#e2f8ff,#7dd3fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              OneNomad
            </span>
          </Link>

          {/* Back link only */}
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back to Home
          </Link>
        </div>
      </header>

      <main className="pt-20 px-6 pb-12 min-h-screen">
        <div className="max-w-5xl mx-auto">
          {/* Page Header */}
          <div className="mb-12">
            <span className="text-primary-container font-label uppercase tracking-widest text-xs mb-3 block">Whitepaper v1.0</span>
            <h1 className="text-5xl md:text-7xl font-headline font-bold tracking-tighter text-on-surface mb-4">Documentation</h1>
            <p className="text-on-surface-variant text-lg max-w-2xl leading-relaxed">
              Everything you need to understand how OneNomad autonomously hunts yield across the OneChain ecosystem.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Doc Nav */}
            <nav className="lg:col-span-3 space-y-1">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full text-left px-4 py-2.5 rounded-md text-sm font-label transition-all ${
                    activeSection === s.id
                      ? "bg-primary-container/10 text-primary-container border-l-2 border-primary-container"
                      : "text-zinc-500 hover:text-on-surface hover:bg-surface-container"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </nav>

            {/* Doc Content */}
            <div className="lg:col-span-9 space-y-8">

              {activeSection === "overview" && (
                <section className="space-y-6">
                  <h2 className="text-3xl font-headline font-bold text-on-surface">What is OneNomad?</h2>
                  <p className="text-on-surface-variant leading-relaxed">
                    OneNomad is a fully autonomous DeFi yield-hunting agent built on OneChain — a Sui-fork Move L1 blockchain. It continuously scans liquidity pools, lending markets, and arbitrage vectors across the ecosystem to execute optimal yield strategies on behalf of depositors.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10">
                      <span className="material-symbols-outlined text-primary-container mb-3 block">radar</span>
                      <h4 className="font-headline font-bold mb-1">1,200+ Pools</h4>
                      <p className="text-xs text-on-surface-variant">Scanned per second across OneDEX, OneVault, and partner protocols.</p>
                    </div>
                    <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10">
                      <span className="material-symbols-outlined text-secondary-fixed-dim mb-3 block">psychology</span>
                      <h4 className="font-headline font-bold mb-1">AI-Powered</h4>
                      <p className="text-xs text-on-surface-variant">Groq llama3-70b primary with GPT-4o-mini fallback for every decision.</p>
                    </div>
                    <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10">
                      <span className="material-symbols-outlined text-primary-container mb-3 block">bolt</span>
                      <h4 className="font-headline font-bold mb-1">Zero-Gas PTB</h4>
                      <p className="text-xs text-on-surface-variant">Programmable Transaction Blocks batch withdraw → swap → deposit atomically.</p>
                    </div>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed">
                    Unlike traditional vaults that rely on static strategies, OneNomad adapts in real time. Each cycle, the AI evaluates risk-adjusted returns, slippage estimates, and safety thresholds before executing any transaction.
                  </p>
                </section>
              )}

              {activeSection === "architecture" && (
                <section className="space-y-6">
                  <h2 className="text-3xl font-headline font-bold text-on-surface">System Architecture</h2>
                  <p className="text-on-surface-variant leading-relaxed">
                    OneNomad is composed of four core backend modules that run as a single Node.js process on the server side, paired with this React dashboard for real-time monitoring.
                  </p>
                  <div className="space-y-3">
                    {[
                      { name: "apyFetcher.ts", icon: "cloud_download", desc: "Polls live RPC endpoints for pool APY data every cycle. Falls back to seeded mock data if RPC is unreachable." },
                      { name: "aiDecision.ts", icon: "psychology", desc: "Sends pool data to Groq (primary) → OpenAI (fallback) → safe hold (final fallback). Returns a structured AIDecision object." },
                      { name: "safety.ts", icon: "shield", desc: "Pure validation gate. Enforces 1.5% min gain threshold, 25% max APY cap, and tier-based pool allowlists before any execution." },
                      { name: "txBuilder.ts", icon: "build", desc: "Constructs PTBs: withdraw from current pool → swap via OneDEX → deposit into target pool. Supports dry-run and live modes." },
                      { name: "agent.ts", icon: "smart_toy", desc: "node-cron orchestrator. Runs the full fetch → decide → validate → execute → broadcast cycle on a configurable interval." },
                      { name: "dashboard.ts", icon: "terminal", desc: "Express HTTP + WebSocket server. Broadcasts agent run summaries to all connected clients in real time." },
                    ].map((m) => (
                      <div key={m.name} className="flex gap-4 p-4 bg-surface-container rounded-xl border border-outline-variant/10 hover:border-primary-container/20 transition-colors">
                        <span className="material-symbols-outlined text-primary-container mt-0.5">{m.icon}</span>
                        <div>
                          <p className="font-mono text-sm font-bold text-on-surface mb-1">{m.name}</p>
                          <p className="text-xs text-on-surface-variant leading-relaxed">{m.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeSection === "safety" && (
                <section className="space-y-6">
                  <h2 className="text-3xl font-headline font-bold text-on-surface">Safety Parameters</h2>
                  <p className="text-on-surface-variant leading-relaxed">
                    Every AI decision passes through <span className="text-primary-container font-mono">safety.ts</span> before execution. These rules are enforced in code and cannot be overridden by the AI model.
                  </p>
                  <div className="space-y-4">
                    <div className="p-6 bg-surface-container-low rounded-xl border-l-4 border-secondary-fixed-dim">
                      <h4 className="font-headline font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-secondary-fixed-dim text-sm">check_circle</span> Minimum Gain Threshold</h4>
                      <p className="text-on-surface-variant text-sm">A rebalance only executes if the target pool offers at least <span className="text-primary-container font-bold">+1.5% APY</span> over the current position. Prevents churn from marginal moves.</p>
                    </div>
                    <div className="p-6 bg-surface-container-low rounded-xl border-l-4 border-secondary-fixed-dim">
                      <h4 className="font-headline font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-secondary-fixed-dim text-sm">check_circle</span> APY Cap</h4>
                      <p className="text-on-surface-variant text-sm">Pools reporting above <span className="text-primary-container font-bold">25% APY</span> are flagged as suspicious and excluded. This prevents honeypot or inflated liquidity traps.</p>
                    </div>
                    <div className="p-6 bg-surface-container-low rounded-xl border-l-4 border-secondary-fixed-dim">
                      <h4 className="font-headline font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-secondary-fixed-dim text-sm">check_circle</span> Pool Tier Allowlist</h4>
                      <p className="text-on-surface-variant text-sm">Only Tier 1 (audited, high-liquidity) and Tier 2 (verified) pools are eligible. Unverified or new pools are blocked until manually promoted.</p>
                    </div>
                    <div className="p-6 bg-surface-container-low rounded-xl border-l-4 border-error">
                      <h4 className="font-headline font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined text-error text-sm">warning</span> Emergency Halt</h4>
                      <p className="text-on-surface-variant text-sm">The "Emergency Halt" button in the dashboard immediately stops the agent cron and cancels any pending transactions. All funds remain in their current pools.</p>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === "contracts" && (
                <section className="space-y-6">
                  <h2 className="text-3xl font-headline font-bold text-on-surface">Smart Contracts</h2>
                  <p className="text-on-surface-variant leading-relaxed">
                    OneNomad smart contracts are written in Move and deployed on OneChain Testnet. Mainnet deployment pending final audit.
                  </p>
                  <div className="space-y-3">
                    {[
                      { name: "YieldHunter.move", address: "0x1a2b...3c4d", status: "Testnet", desc: "Core rebalancing logic. Handles withdraw, swap, and deposit in a single PTB." },
                      { name: "SafetyGate.move", address: "0x5e6f...7a8b", status: "Testnet", desc: "On-chain safety enforcement layer. Mirrors the off-chain validation rules." },
                      { name: "HunterRegistry.move", address: "0x9c0d...1e2f", status: "Testnet", desc: "Agent registry. Tracks active hunters, their strategies, and performance metrics." },
                    ].map((c) => (
                      <div key={c.name} className="p-5 bg-surface-container rounded-xl border border-outline-variant/10">
                        <div className="flex justify-between items-start mb-2">
                          <p className="font-mono font-bold text-on-surface">{c.name}</p>
                          <span className="text-[10px] bg-secondary-container/10 text-secondary-fixed-dim px-2 py-0.5 rounded-full border border-secondary-fixed-dim/20 font-bold uppercase">{c.status}</span>
                        </div>
                        <p className="font-mono text-xs text-primary-container mb-2">{c.address}</p>
                        <p className="text-xs text-on-surface-variant">{c.desc}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-on-surface-variant/60 italic">Audit by CertiK in progress. Mainnet addresses will be published upon completion.</p>
                </section>
              )}

              {activeSection === "faq" && (
                <section className="space-y-4">
                  <h2 className="text-3xl font-headline font-bold text-on-surface">FAQ</h2>
                  {[
                    { q: "Is OneNomad non-custodial?", a: "Yes. OneNomad never holds your funds. All assets remain in your connected OneWallet and the agent operates through delegated permissions only." },
                    { q: "What happens if the AI model is unavailable?", a: "The decision chain falls back: Groq → OpenAI → safe hold. If all external APIs fail, the agent defaults to holding the current position and logs an error." },
                    { q: "How often does the agent rebalance?", a: "By default, the agent runs every 15 minutes via node-cron. This is configurable via the AGENT_INTERVAL_MINUTES environment variable." },
                    { q: "What is Dry Run mode?", a: "In Dry Run mode, all transactions are simulated using the RPC dry-run endpoint. No real assets move. Use this to observe agent behavior before going live." },
                    { q: "What chains are supported?", a: "Currently OneChain Testnet. Mainnet and additional chains (Sui, Aptos) are on the roadmap pending governance approval." },
                  ].map((item, i) => (
                    <div key={i} className="p-5 bg-surface-container rounded-xl border border-outline-variant/10 hover:border-primary-container/20 transition-colors">
                      <h4 className="font-headline font-bold text-on-surface mb-2">{item.q}</h4>
                      <p className="text-sm text-on-surface-variant leading-relaxed">{item.a}</p>
                    </div>
                  ))}
                </section>
              )}

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

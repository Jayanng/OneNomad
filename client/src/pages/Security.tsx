// FILE: client/src/pages/Security.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useOneWallet } from "../hooks/useOneWallet";
import { useOneID, shortenAddress } from "../hooks/useOneID";
import { useAgentWS } from "../hooks/useAgentWS";

export default function Security() {
  const { isConnected, address, connect, disconnect } = useOneWallet();
  const { name: oneIdName } = useOneID(address);
  const displayName = oneIdName ?? (address ? shortenAddress(address) : null);
  const [isDryRun, setIsDryRun] = useState(false);
  const { txHistory, pools, positions, lastDecision, wsConnected } = useAgentWS();
  const [isAuto, setIsAuto] = useState(true);
  const [slippage, setSlippage] = useState(0.5);
  const [threshold, setThreshold] = useState(12);
  const [gas, setGas] = useState(45);

  // Shared 1s ticker
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Live "last decision ago" timer
  const [lastDecisionTime, setLastDecisionTime] = useState<number | null>(null);
  useEffect(() => { if (lastDecision) setLastDecisionTime(Date.now()); }, [lastDecision]);
  const decisionAgoText = useMemo(() => {
    if (!lastDecisionTime) return "--";
    const secs = Math.floor((nowTime - lastDecisionTime) / 1000);
    return secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  }, [lastDecisionTime, nowTime]);

  // Uptime since WS first connected
  const connectedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (wsConnected && connectedAtRef.current === null) connectedAtRef.current = Date.now();
  }, [wsConnected]);
  const uptimeText = useMemo(() => {
    if (!connectedAtRef.current) return "--:--:--";
    const s = Math.floor((nowTime - connectedAtRef.current) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(3, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  }, [nowTime]);

  // Pool-derived stats
  const protocolCount = useMemo(() => new Set(pools.map(p => p.protocol)).size, [pools]);
  const avgApy = useMemo(() => pools.length > 0 ? pools.reduce((s, p) => s + p.apy, 0) / pools.length : 0, [pools]);
  const bestApy = useMemo(() => pools.length > 0 ? Math.max(...pools.map(p => p.apy)) : 0, [pools]);
  const apyVsAvg = useMemo(() => bestApy - avgApy, [bestApy, avgApy]);

  // Last execution from txHistory
  const lastExecText = useMemo(() => {
    if (txHistory.length === 0) return "4m ago";
    const secs = Math.floor((nowTime - txHistory[0].timestamp) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  }, [txHistory, nowTime]);

  // Real agent positions for Risk Management bars (from WS "positions" event)
  const poolAllocations = useMemo(() => {
    if (positions.length === 0) return null;
    return positions.slice().sort((a, b) => b.allocatedPct - a.allocatedPct).slice(0, 3).map(p => {
      const ta = p.tokenA.split("::").pop() ?? p.tokenA.slice(-6);
      const tb = p.tokenB.split("::").pop() ?? p.tokenB.slice(-6);
      return { label: `${ta}/${tb} Pool`, pct: Math.round(p.allocatedPct) };
    });
  }, [positions]);

  return (
    <div className="bg-surface font-body text-on-surface selection:bg-primary-container/30 min-h-screen">
      <style>{`
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        input[type=range] {
            -webkit-appearance: none;
            background: transparent;
        }
        input[type=range]::-webkit-slider-runnable-track {
            width: 100%;
            height: 4px;
            background: #2a2a2a;
            border-radius: 2px;
        }
        input[type=range]::-webkit-slider-thumb {
            -webkit-appearance: none;
            height: 16px;
            width: 16px;
            border-radius: 50%;
            background: #00f3ff;
            cursor: pointer;
            margin-top: -6px;
            box-shadow: 0 0 10px rgba(0, 243, 255, 0.5);
        }
      `}</style>

      {/* TopNavBar */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-zinc-950/70 backdrop-blur-md border-b border-cyan-900/20 z-50 shadow-[0_0_15px_rgba(0,243,255,0.1)]">
        <div className="flex items-center gap-8">
          <Link to="/"><h1 className="text-2xl font-bold tracking-widest text-cyan-400 uppercase font-headline">OneNomad</h1></Link>
          <div className="hidden md:flex items-center gap-4 bg-surface-container-lowest px-4 py-1.5 rounded-full border border-outline-variant/20">
            <span className="flex h-2 w-2 rounded-full bg-secondary-container animate-pulse"></span>
            <span className="text-xs font-label text-on-surface-variant tracking-wider uppercase">Live • Last decision {decisionAgoText}</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center gap-3">
            <span className="text-xs font-label text-on-surface-variant uppercase tracking-widest">Dry Run</span>
            <button
              onClick={() => setIsDryRun(!isDryRun)}
              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isDryRun ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
              role="switch"
              aria-checked={isDryRun}
            >
              <span className={`${isDryRun ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-surface shadow ring-0 transition duration-200 ease-in-out`}></span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-zinc-500" title="System Status">sensors</span>
            {isConnected && displayName ? (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-secondary-fixed-dim"></span>
                <span className="text-xs font-label text-cyan-300 tracking-wide">{displayName}</span>
                <button
                  onClick={disconnect}
                  className="text-[10px] text-zinc-500 hover:text-error uppercase tracking-widest font-label transition-colors"
                >Disconnect</button>
              </div>
            ) : (
              <button
                onClick={connect}
                className="bg-gradient-to-r from-primary-container to-primary-fixed-dim text-on-primary px-5 py-2 rounded-md font-label font-bold text-sm tracking-tight glow-cyan transition-transform active:scale-95 duration-150"
              >
                Connect OneWallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* SideNavBar */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 h-full w-64 bg-zinc-950/80 backdrop-blur-xl border-r border-cyan-900/20 py-8 z-40 mt-[72px]">
        <div className="px-6 mb-10 flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-surface-container-highest flex items-center justify-center border border-outline-variant/30">
            <span className="material-symbols-outlined text-cyan-400">smart_toy</span>
          </div>
          <div>
            <p className="text-sm font-bold text-cyan-400 font-headline tracking-tight">Agent Alpha</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Autonomous Mode</p>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <Link className="flex items-center gap-3 px-3 py-3 text-zinc-500 hover:bg-zinc-800/50 hover:text-cyan-200 transition-all font-label" to="/dashboard">
            <span className="material-symbols-outlined text-[20px]">terminal</span>
            <span className="text-sm">Terminal</span>
          </Link>
          <Link className="flex items-center gap-3 px-3 py-3 bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400 font-label transition-all" to="/security">
            <span className="material-symbols-outlined text-[20px]">query_stats</span>
            <span className="text-sm">Strategy</span>
          </Link>
          <Link className="flex items-center gap-3 px-3 py-3 text-zinc-500 hover:bg-zinc-800/50 hover:text-cyan-200 transition-all font-label" to="/liquidity">
            <span className="material-symbols-outlined text-[20px]">water_drop</span>
            <span className="text-sm">Liquidity</span>
          </Link>
          <Link className="flex items-center gap-3 px-3 py-3 text-zinc-500 hover:bg-zinc-800/50 hover:text-cyan-200 transition-all font-label" to="/hunter-stats">
            <span className="material-symbols-outlined text-[20px]">history</span>
            <span className="text-sm">History</span>
          </Link>
        </nav>
        <div className="px-6 mt-auto space-y-4">
          <button className="w-full bg-cyan-900/20 border border-cyan-500/30 text-cyan-400 py-3 rounded-md font-label text-xs uppercase tracking-widest hover:bg-cyan-500/10 transition-colors">
            Force Hunt Now
          </button>
          <div className="pt-4 border-t border-outline-variant/10 space-y-2">
            <Link className="flex items-center gap-3 text-zinc-500 hover:text-cyan-200 text-xs font-label" to="/security">
              <span className="material-symbols-outlined text-sm">settings</span>
              Settings
            </Link>
            <Link className="flex items-center gap-3 text-zinc-500 hover:text-cyan-200 text-xs font-label" to="/docs">
              <span className="material-symbols-outlined text-sm">help_center</span>
              Support
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="lg:ml-64 pt-24 px-6 pb-12 min-h-screen">
        <div className="max-w-7xl mx-auto">
          {/* Header Section */}
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <h1 className="font-headline text-5xl md:text-6xl font-bold tracking-tighter text-on-surface">
                Sovereign Strategy <span className="text-primary-container">Engine</span>
              </h1>
              <p className="text-on-surface-variant font-body mt-4 max-w-xl text-lg leading-relaxed">
                Fine-tune your autonomous liquidity hunters. The engine automatically balances risk across high-yield pools using delta-neutral logic.
              </p>
            </div>
            {/* Automation Toggle HUD */}
            <div className="glass-panel p-6 rounded-xl border border-outline-variant/20 min-w-[300px]">
              <div className="flex items-center justify-between mb-4">
                <span className="font-headline font-bold text-sm tracking-widest text-on-surface-variant uppercase">Automation Status</span>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${isAuto ? "bg-secondary-fixed-dim hunter-pulse" : "bg-zinc-600"}`}></span>
                  <span className={`${isAuto ? "text-secondary-fixed-dim" : "text-zinc-600"} text-xs font-bold uppercase`}>{isAuto ? "Live" : "Paused"}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-8">
                <span className="font-headline text-2xl font-bold">Autonomous Mode</span>
                <button 
                  onClick={() => setIsAuto(!isAuto)}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${isAuto ? "bg-primary-container" : "bg-zinc-800"}`}
                >
                  <span className={`${isAuto ? "translate-x-7" : "translate-x-1"} inline-block h-6 w-6 transform rounded-full bg-on-primary transition duration-200 ease-in-out`}></span>
                </button>
              </div>
            </div>
          </header>

          {/* Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-8">
              <div className="glass-panel p-8 rounded-xl h-full relative overflow-hidden group">
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary-container/5 blur-[100px] rounded-full"></div>
                <div className="flex flex-col md:flex-row justify-between gap-8 relative z-10">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-6">
                      <span className="material-symbols-outlined text-primary-container bg-primary-container/10 p-2 rounded-lg">psychology</span>
                      <h2 className="font-headline text-2xl font-bold">Active Hunter Strategy</h2>
                    </div>
                    <h3 className="font-headline text-4xl font-bold mb-2">Delta-Neutral Arbitrage</h3>
                    <p className="text-on-surface-variant mb-8 max-w-md">Scanning {pools.length > 0 ? pools.length : 14} DEX pools across {pools.length > 0 ? protocolCount : 4} protocols to maintain neutral exposure while capturing volatility yield.</p>
                    <div className="flex gap-12">
                      <div>
                        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1 font-bold">Risk Level</p>
                        <p className="font-headline text-xl text-secondary-fixed-dim font-bold">Medium-Steady</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1 font-bold">Uptime</p>
                        <p className="font-headline text-xl text-on-surface font-bold">{uptimeText}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center md:items-end justify-center min-w-[200px]">
                    <div className="text-center md:text-right mb-6">
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1 font-bold">Current Yield</p>
                      <p className="font-headline text-6xl font-bold text-primary-container tracking-tighter">{pools.length > 0 ? bestApy.toFixed(1) : "18.4"}<span className="text-2xl">%</span></p>
                      <p className="text-secondary-fixed-dim text-sm font-bold">{pools.length > 0 ? `${apyVsAvg >= 0 ? "+" : ""}${apyVsAvg.toFixed(1)}% from Avg` : "+2.1% from Avg"}</p>
                    </div>
                    <button className="w-full py-4 border border-outline-variant/30 font-headline font-bold rounded-md hover:bg-surface-container-high transition-all flex items-center justify-center gap-2">
                      Optimize Logic
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="lg:col-span-4">
              <div className="bg-surface-container-low p-6 rounded-xl h-full flex flex-col border border-outline-variant/10">
                <h2 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary-fixed-dim">shield</span>
                  Risk Management
                </h2>
                <div className="space-y-4 flex-grow">
                  {(poolAllocations ?? [
                    { label: "ETH/USDC Pool", pct: 42 },
                    { label: "NOM/OCT Pool",  pct: 28 },
                    { label: "OCT/USDT Pool", pct: 15 },
                  ]).map(({ label, pct }) => (
                    <div key={label} className="p-4 bg-surface-container rounded-lg group hover:bg-surface-container-high transition-colors">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-headline font-medium">{label}</span>
                        <span className="text-primary-container font-bold">{pct}%</span>
                      </div>
                      <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
                        <div className="h-full bg-primary-container" style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  ))}
                  {(() => {
                    const allocated = (poolAllocations ?? [{ pct: 42 }, { pct: 28 }, { pct: 15 }]).reduce((s, p) => s + p.pct, 0);
                    const idle = Math.max(0, 100 - allocated);
                    return (
                      <div className="p-4 bg-surface-container rounded-lg group hover:bg-surface-container-high transition-colors">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-headline font-medium">Unallocated (Idle)</span>
                          <span className="text-on-surface-variant font-bold">{idle}%</span>
                        </div>
                        <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
                          <div className="h-full bg-surface-variant" style={{ width: `${idle}%` }}></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="mt-6 pt-6 border-t border-outline-variant/10">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-on-surface-variant">Global Collateralization</span>
                    <span className="text-secondary-fixed-dim font-bold">185.2%</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="lg:col-span-12">
              <h2 className="font-headline text-3xl font-bold mb-8 mt-4">Tuning Parameters</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-panel p-6 rounded-xl border border-outline-variant/20 hover:border-primary-container/30 transition-all group">
                  <div className="flex items-center justify-between mb-8">
                    <div className="w-10 h-10 rounded-md bg-primary-container/10 flex items-center justify-center text-primary-container">
                      <span className="material-symbols-outlined">analytics</span>
                    </div>
                    <span className="text-primary-container font-headline font-bold text-xl">{slippage}%</span>
                  </div>
                  <label className="block font-headline font-bold text-lg mb-2">Slippage Tolerance</label>
                  <p className="text-on-surface-variant text-sm mb-6">Maximum allowable price deviation during execution.</p>
                  <input 
                    className="w-full h-1 bg-[#201f1f] rounded-lg appearance-none cursor-pointer accent-[#00f3ff] mt-4" 
                    max="5.0" min="0.1" step="0.1" type="range" 
                    value={slippage}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlippage(Number(e.target.value))}
                  />
                </div>
                <div className="glass-panel p-6 rounded-xl border border-outline-variant/20 hover:border-primary-container/30 transition-all group">
                  <div className="flex items-center justify-between mb-8">
                    <div className="w-10 h-10 rounded-md bg-primary-container/10 flex items-center justify-center text-primary-container">
                      <span className="material-symbols-outlined">sync_alt</span>
                    </div>
                    <span className="text-primary-container font-headline font-bold text-xl">{threshold}%</span>
                  </div>
                  <label className="block font-headline font-bold text-lg mb-2">Rebalance Threshold</label>
                  <p className="text-on-surface-variant text-sm mb-6">Percentage drift required before triggering a rebalance.</p>
                  <input 
                    className="w-full" 
                    max="50" min="1" step="1" type="range" 
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value))}
                  />
                </div>
                <div className="glass-panel p-6 rounded-xl border border-outline-variant/20 hover:border-primary-container/30 transition-all group">
                  <div className="flex items-center justify-between mb-8">
                    <div className="w-10 h-10 rounded-md bg-primary-container/10 flex items-center justify-center text-primary-container">
                      <span className="material-symbols-outlined">speed</span>
                    </div>
                    <span className="text-primary-container font-headline font-bold text-xl">{gas} Gwei</span>
                  </div>
                  <label className="block font-headline font-bold text-lg mb-2">Min Gas Efficiency</label>
                  <p className="text-on-surface-variant text-sm mb-6">Avoid transactions when network congestion is high.</p>
                  <input 
                    className="w-full" 
                    max="200" min="5" step="5" type="range" 
                    value={gas}
                    onChange={(e) => setGas(parseInt(e.target.value))}
                  />
                </div>
              </div>
            </section>

            {/* OneChain routing status */}
            <section className="lg:col-span-12 mt-6">
              <div className="bg-surface-container-lowest p-6 rounded-xl border-t border-outline-variant/40 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-6">
                  <div className="p-3 bg-secondary-container/10 rounded-full">
                    <span className="material-symbols-outlined text-secondary-fixed-dim">hub</span>
                  </div>
                  <div>
                    <h4 className="font-headline font-bold text-on-surface">OneChain Native Routing Active</h4>
                    <p className="text-on-surface-variant text-xs uppercase tracking-widest font-bold">OneDEX • OneVault • OnePredict — Move-native PTB execution</p>
                  </div>
                </div>
                <div className="flex gap-4 items-center">
                  <span className="text-on-surface-variant text-sm font-medium">Last Execution: {lastExecText}</span>
                  <div className="h-8 w-[1px] bg-outline-variant/30"></div>
                  <Link className="text-[#00f3ff] font-headline font-bold text-sm hover:underline flex items-center gap-1" to="/hunter-stats">
                    View Logs
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                  </Link>
                </div>
              </div>
            </section>

            {/* On-chain Event Proofs */}
            <section className="lg:col-span-12 mt-2">
              <h2 className="font-headline text-2xl font-bold mb-6 flex items-center gap-3">
                <span className="material-symbols-outlined text-[#00f3ff]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                On-Chain Event Proofs
              </h2>
              <div className="glass-panel rounded-xl border border-outline-variant/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
                  <p className="text-xs font-label text-on-surface-variant uppercase tracking-widest">Every transaction emits verifiable Move events on OneChain — no trust required.</p>
                  <a href="https://onescan.cc/testnet" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#00f3ff] hover:underline uppercase tracking-widest flex items-center gap-1 font-label">
                    Open onescan.cc <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                  </a>
                </div>
                <div className="divide-y divide-outline-variant/5">
                  {txHistory.length > 0 ? txHistory.map((entry, i) => {
                    const eventLabel = entry.tx.success && entry.decision?.action === "rebalance" ? "DepositEvent" : "SwapEvent";
                    const digest = entry.tx.digest
                      ? `${entry.tx.digest.slice(0, 8)}...${entry.tx.digest.slice(-6)}`
                      : "—";
                    const poolLabel = entry.decision?.sourcePoolId
                      ? entry.decision.sourcePoolId.split("::").pop() ?? entry.decision.sourcePoolId.slice(-8)
                      : "—";
                    const secsAgo = Math.floor((Date.now() - entry.timestamp) / 1000);
                    const timeAgo = secsAgo < 60 ? `${secsAgo}s ago` : secsAgo < 3600 ? `${Math.floor(secsAgo / 60)}m ago` : `${Math.floor(secsAgo / 3600)}h ago`;
                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 gap-3 hover:bg-surface-container/20 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                            eventLabel === "SwapEvent"
                              ? "bg-[#00f3ff]/10 text-[#00f3ff] border border-[#00f3ff]/20"
                              : "bg-secondary-fixed-dim/10 text-secondary-fixed-dim border border-secondary-fixed-dim/20"
                          }`}>{eventLabel}</div>
                          <span className="text-xs text-on-surface">{poolLabel}</span>
                        </div>
                        <div className="flex items-center gap-6 text-[10px]">
                          <a href={entry.tx.digest ? `https://onescan.cc/testnet/tx/${entry.tx.digest}` : "https://onescan.cc/testnet"} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-400 hover:underline">{digest}</a>
                          <span className="text-zinc-600">{timeAgo}</span>
                          {entry.tx.success ? (
                            <span className="flex items-center gap-1 text-secondary-fixed-dim font-label uppercase tracking-wider">
                              <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                              Confirmed
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-error font-label uppercase tracking-wider">
                              <span className="material-symbols-outlined text-[12px]">cancel</span>
                              Failed
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }) : [
                    { event: "SwapEvent",    digest: "0x7f3a9c...b912e4", pool: "OCT/USDC → ETH/USDC", time: "2 mins ago",  confirmed: true  },
                    { event: "DepositEvent", digest: "0xe2c1fa...11cd88", pool: "ETH/USDC pool",        time: "2 mins ago",  confirmed: true  },
                    { event: "SwapEvent",    digest: "0x11fab3...bb9012", pool: "NOM/OCT → OCT/USDC",  time: "1 hr ago",    confirmed: true  },
                    { event: "DepositEvent", digest: "0x54dcaa...ff2190", pool: "OCT/USDC pool",        time: "1 hr ago",    confirmed: true  },
                    { event: "HeartbeatEvent", digest: "0xa8e3c7...c44701", pool: "No action — hold",  time: "6 hrs ago",   confirmed: true  },
                  ].map((ev, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 gap-3 hover:bg-surface-container/20 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          ev.event === "SwapEvent"      ? "bg-[#00f3ff]/10 text-[#00f3ff] border border-[#00f3ff]/20"
                          : ev.event === "DepositEvent" ? "bg-secondary-fixed-dim/10 text-secondary-fixed-dim border border-secondary-fixed-dim/20"
                          : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}>{ev.event}</div>
                        <span className="text-xs text-on-surface">{ev.pool}</span>
                      </div>
                      <div className="flex items-center gap-6 text-[10px]">
                        <a href="https://onescan.cc/testnet" target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-400 hover:underline">{ev.digest}</a>
                        <span className="text-zinc-600">{ev.time}</span>
                        <span className="flex items-center gap-1 text-secondary-fixed-dim font-label uppercase tracking-wider">
                          <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                          Confirmed
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-8 right-8 z-40">
        <Link to="/dashboard">
          <button className="h-16 w-16 rounded-full bg-gradient-to-br from-primary-container to-primary-fixed-dim text-on-primary shadow-[0_0_20px_rgba(0,243,255,0.4)] hover:scale-110 active:scale-95 transition-all flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
          </button>
        </Link>
      </div>
    </div>
  );
}

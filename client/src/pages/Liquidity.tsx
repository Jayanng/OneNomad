// FILE: client/src/pages/Liquidity.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useOneWallet } from "../hooks/useOneWallet";
import { useOneID, shortenAddress } from "../hooks/useOneID";
import { useAgentWS } from "../hooks/useAgentWS";

function extractToken(id: string): string {
  const parts = id.split("::");
  return parts.length >= 3 ? parts[parts.length - 1] : id.slice(-6);
}

export default function Liquidity() {
  const { isConnected, address, balance, connect, disconnect } = useOneWallet();
  const { name: oneIdName } = useOneID(address);
  const displayName = oneIdName ?? (address ? shortenAddress(address) : null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [mode, setMode] = useState("deposit");
  const [amount, setAmount] = useState("");
  const { pools, lastDecision, txHistory, wsConnected } = useAgentWS();

  // Live "last decision ago" timer
  const [lastDecisionTime, setLastDecisionTime] = useState<number | null>(null);
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => { if (lastDecision) setLastDecisionTime(Date.now()); }, [lastDecision]);
  useEffect(() => {
    const id = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const decisionAgoText = useMemo(() => {
    if (!lastDecisionTime) return "--";
    const secs = Math.floor((nowTime - lastDecisionTime) / 1000);
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  }, [lastDecisionTime, nowTime]);

  // Aggregate stats derived from live pool data
  const totalTvl = useMemo(() => pools.reduce((s, p) => s + p.tvlUsd, 0), [pools]);
  const dailyYield = useMemo(() => pools.reduce((s, p) => s + (p.tvlUsd * p.apy / 100 / 365), 0), [pools]);
  const protocolCount = useMemo(() => new Set(pools.map(p => p.protocol)).size, [pools]);
  const formatUsd = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  };

  // Yield distribution by token (top 5 by APY)
  const STABLES = new Set(["USDC", "USDT", "DAI", "BUSD"]);
  const tokenYields = useMemo(() => {
    if (pools.length === 0) return null;
    const map: Record<string, { apy: number; stable: boolean }> = {};
    for (const pool of pools) {
      const ta = extractToken(pool.tokenA);
      const tb = extractToken(pool.tokenB);
      if (!map[ta] || map[ta].apy < pool.apy) map[ta] = { apy: pool.apy, stable: STABLES.has(ta.toUpperCase()) };
      if (!map[tb] || map[tb].apy < pool.apy) map[tb] = { apy: pool.apy, stable: STABLES.has(tb.toUpperCase()) };
    }
    return Object.entries(map).sort((a, b) => b[1].apy - a[1].apy).slice(0, 5)
      .map(([token, info]) => ({ token, ...info }));
  }, [pools]);
  const maxYield = useMemo(() => tokenYields ? Math.max(...tokenYields.map(t => t.apy), 1) : 1, [tokenYields]);

  // TVL delta vs previous WS update
  const prevTvlRef = useRef<number | null>(null);
  const [tvlDelta, setTvlDelta] = useState<number | null>(null);
  useEffect(() => {
    if (pools.length === 0) return;
    const current = pools.reduce((s, p) => s + p.tvlUsd, 0);
    if (prevTvlRef.current !== null && prevTvlRef.current !== 0) {
      setTvlDelta(((current - prevTvlRef.current) / prevTvlRef.current) * 100);
    }
    prevTvlRef.current = current;
  }, [pools]);

  // Est. weekly yield from entered amount × best pool APY
  const estWeeklyYield = useMemo(() => {
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt) || pools.length === 0) return null;
    const bestApy = Math.max(...pools.map(p => p.apy));
    return amt * bestApy / 100 / 52;
  }, [amount, pools]);

  // Price impact estimate: amount / totalTvl
  const priceImpact = useMemo(() => {
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt) || totalTvl === 0) return null;
    return (amt / totalTvl) * 100;
  }, [amount, totalTvl]);

  // Activity log items
  const activityItems = useMemo(() => {
    const items: string[] = [];
    if (lastDecision) {
      const src = extractToken(lastDecision.sourcePoolId);
      const tgt = extractToken(lastDecision.targetPoolId);
      items.push(`Agent rebalanced ${src} → ${tgt}`);
    }
    const prev = txHistory.find(e => e.decision && e.decision !== lastDecision);
    if (prev?.decision) {
      const tgt = extractToken(prev.decision.targetPoolId);
      items.push(`New opportunity detected: ${tgt} (+${prev.decision.amountPercent}%)`);
    }
    return items;
  }, [lastDecision, txHistory]);

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] font-body selection:bg-primary-container selection:text-on-primary-container">
      <style>{`
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
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
          <Link className="flex items-center gap-3 px-3 py-3 text-zinc-500 hover:bg-zinc-800/50 hover:text-cyan-200 transition-all font-label" to="/security">
            <span className="material-symbols-outlined text-[20px]">query_stats</span>
            <span className="text-sm">Strategy</span>
          </Link>
          <Link className="flex items-center gap-3 px-3 py-3 bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400 font-label transition-all" to="/liquidity">
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

      <main className="lg:ml-64 pt-24 px-6 pb-12 min-h-screen space-y-6">
        {/* Header Section */}
        <div className="flex justify-between items-end mb-12">
            <div>
              <h1 className="text-4xl font-headline font-bold text-primary tracking-tight">OneDEX Liquidity Terminal</h1>
              <p className="text-on-surface-variant font-body mt-2">Autonomous liquidity provisioning across multichain ecosystem.</p>
            </div>
            <div className="text-right">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">System Status</span>
              <div className="text-secondary-fixed-dim font-headline text-lg font-bold">{wsConnected ? "Synchronized" : "Connecting..."}</div>
            </div>
          </div>

          {/* Bento Grid Layout */}
          <div className="grid grid-cols-12 gap-6">
            {/* Section 1: Portfolio Overview (HUD Cards) */}
            <div className="col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
              <div className="bg-surface-container-lowest border-t border-outline-variant/20 p-6 rounded-md hunter-glow relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary-container/5 blur-3xl rounded-full"></div>
                <span className="text-on-surface-variant font-label text-xs uppercase tracking-tighter">Total Value Locked</span>
                <div className="text-3xl font-headline font-bold text-primary mt-1">{pools.length > 0 ? formatUsd(totalTvl) : "$4,892,103.42"}</div>
                <div className="flex items-center gap-1 text-secondary-fixed-dim text-xs mt-2">
                  <span className="material-symbols-outlined text-xs">trending_up</span>
                  <span>{tvlDelta !== null ? `${tvlDelta >= 0 ? "+" : ""}${tvlDelta.toFixed(2)}% since last update` : "Awaiting update..."}</span>
                </div>
              </div>
              <div className="bg-surface-container-lowest border-t border-outline-variant/20 p-6 rounded-md hunter-glow">
                <span className="text-on-surface-variant font-label text-xs uppercase tracking-tighter">24h Yield Generated</span>
                <div className="text-3xl font-headline font-bold text-secondary-fixed-dim mt-1">{pools.length > 0 ? formatUsd(dailyYield) : "$12,450.18"}</div>
                <div className="flex items-center gap-1 text-on-surface-variant text-xs mt-2">
                  <span>Auto-compounding active</span>
                </div>
              </div>
              <div className="bg-surface-container-lowest border-t border-outline-variant/20 p-6 rounded-md hunter-glow">
                <span className="text-on-surface-variant font-label text-xs uppercase tracking-tighter">Total Managed Assets</span>
                <div className="text-3xl font-headline font-bold text-on-surface mt-1">{pools.length > 0 ? `${pools.length} Pools` : "14 Agents"}</div>
                <div className="flex items-center gap-1 text-on-surface-variant text-xs mt-2">
                  <span>Across {pools.length > 0 ? protocolCount : 6} protocols</span>
                </div>
              </div>
            </div>

            {/* Section 2: Managed Pools */}
            <div className="col-span-12 lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center px-2">
                <h2 className="text-lg font-headline font-bold text-on-surface">Active Managed Pools</h2>
                <button className="text-primary-container font-label text-xs hover:underline">View All Protocols</button>
              </div>

              {/* Pool Cards — real data when available, fallback to hardcoded */}
              {pools.length > 0 ? pools.map((pool, i) => {
                const tokenA = extractToken(pool.tokenA);
                const tokenB = extractToken(pool.tokenB);
                const tvlFormatted = `$${(pool.tvlUsd / 1000).toFixed(0)}k`;
                const apyFormatted = `${pool.apy.toFixed(1)}%`;
                const isFirst = i === 0;
                return (
                  <div key={pool.id} className={`glass-panel border p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-surface-container-high/80 ${isFirst ? "border-primary-container/30 active-glow" : "border-outline-variant/20"}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center">
                          <span className="text-xs font-bold text-primary-container">{tokenA.slice(0, 3)}</span>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center">
                          <span className="text-xs font-bold text-secondary-fixed-dim">{tokenB.slice(0, 3)}</span>
                        </div>
                      </div>
                      <div>
                        <h3 className="font-headline font-bold text-on-surface">{tokenA}/{tokenB}</h3>
                        <p className="text-on-surface-variant text-[10px] uppercase font-label tracking-widest">{pool.protocol}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-8 text-center flex-1">
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">TVL</span>
                        <span className="font-headline font-semibold text-primary">{tvlFormatted}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">Tier</span>
                        <span className="font-headline font-semibold text-on-surface capitalize">{pool.tier}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">APY</span>
                        <span className="font-headline font-semibold text-secondary-fixed-dim">{apyFormatted}</span>
                      </div>
                    </div>
                    <button className={`bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/40 px-6 py-2 rounded-md font-bold text-xs transition-all ${isFirst ? "text-primary-container" : "text-on-surface-variant"}`}>Manage</button>
                  </div>
                );
              }) : (
                <>
                  {/* Pool Card 1 — fallback */}
                  <div className="glass-panel border border-primary-container/30 p-5 rounded-xl active-glow flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-surface-container-high/80">
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCQL-SVic5iiCtlzMUqgxWEfnXZc3qjCXUMzAB_7UMgqMh0BPPZWpd-16AV9k77-8ONgINbDscE3qbKne22WsyGcpvDhjkQ2M69rvkICEoxhfoMlY9Ceeltw4jYsb5Z3VePGLeCicSi3mFX43Wi9mEjfhS4KF2wF1iSt2hdQHH7gMuqd-GFtDE0dJ4RUTrp837Hxbz2LLaMGI0JGYC6cO5ddANaobGuzEwmPp1vSJIoHTk5meQ7C3SFScdXaD9RHmBYT2cQ9lko4uI" />
                        </div>
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain opacity-80" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA4QP_TTebCzK41QShgfNBTXjdMpndBN0f5C0R3MOj_zGqIalzl0-Ikx8hS3bHL7_LAji9H3OnuGKuizw7tGe_mveagcwVFJhIDQqbeBxijaSOk68PdGZGNyYVZBI3l7DqXE-aYXRXlr4TCupWIS4yrg9LyE1kSD_OytEuDWQhHNvE8YsMCZbdd-XoMi-uKl5P0qSAJBuuaCObGaK2e6VRzlMSfETAP-wBB9lK1TLlkozHz2b41H9Oo6py7NkYiDxdNEjNyggP2jCA" />
                        </div>
                      </div>
                      <div>
                        <h3 className="font-headline font-bold text-on-surface">OCT/USDC</h3>
                        <p className="text-on-surface-variant text-[10px] uppercase font-label tracking-widest">OneDEX Concentrated</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-8 text-center flex-1">
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">TVL</span>
                        <span className="font-headline font-semibold text-primary">$1.2M</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">24h Vol</span>
                        <span className="font-headline font-semibold text-on-surface">$420k</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">APY</span>
                        <span className="font-headline font-semibold text-secondary-fixed-dim">124.2%</span>
                      </div>
                    </div>
                    <button className="bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/40 text-primary-container px-6 py-2 rounded-md font-bold text-xs transition-all">Manage</button>
                  </div>

                  {/* Pool Card 2 — fallback */}
                  <div className="glass-panel border border-outline-variant/20 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-surface-container-high/80">
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA4EpC2T2iSY-A7wnzONR6CpoDwuGhB2-eXXzzq9TDvp1xr7iFg9j6DiHCV8n0u6VBm3OawoS0yS6-iydmK_2ZAZ-8Sls9IrtgTk3MfFiKjDvxSh1mYOZPEJU0D55vXbmtiAbu_Qm0T0TXZjFGSecA2n5Wnp_wyDykPeV9qFPDKSQ2moZk1yh7aNDI0avKrU-Zz-zAC95GztlgTCUrPqHmuc5v35eX5AvLj_mLjx27oQDL1-GTvq_iv-x4mzpH2DOKwzBqanVE2TWc" />
                        </div>
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain opacity-80" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_4GIyw4zr59p3fGpoIUL_HYrvCVfsd4bD9SueB088rvIPsYN_ehbFRXHfbDfuWviIWnk6QrWiBGtGX5dWe_7T119hslcJL3-Dm2h41lxMh5zYql1Sr-24XQf68P3msUfq6BwuLr5DgQXFQYoiHD7pGa2I2i3Ml9gwXbOjNIeZmMPkAte6lmBzCV5UNiHxifmOFQ0XDzoDkNhL8uia7cwaHWa3GvsGcFeHCpfGkDAsBr3Nj2gPRCb-hTqTz-7yiY3geALJCQxJFpg" />
                        </div>
                      </div>
                      <div>
                        <h3 className="font-headline font-bold text-on-surface">ETH/USDC</h3>
                        <p className="text-on-surface-variant text-[10px] uppercase font-label tracking-widest">OneVault Strategy</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-8 text-center flex-1">
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">TVL</span>
                        <span className="font-headline font-semibold text-primary">$840k</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">24h Vol</span>
                        <span className="font-headline font-semibold text-on-surface">$182k</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">APY</span>
                        <span className="font-headline font-semibold text-secondary-fixed-dim">18.5%</span>
                      </div>
                    </div>
                    <button className="bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/40 text-on-surface-variant px-6 py-2 rounded-md font-bold text-xs transition-all">Manage</button>
                  </div>

                  {/* Pool Card 3 — fallback */}
                  <div className="glass-panel border border-outline-variant/20 p-5 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:bg-surface-container-high/80">
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-3">
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBIKWcDZ1l2LqU9XteZe4IjOcOirg7ac732eDtKwmbRrLZMO31RdNYdR0Jo7zSMaYK7uHL2UxPOjGhVZDFVrRjs2l7BRCHxDBk9MC_yoIbEEAv3A-tKGWm6Rq99PDkpZpE_J6BeAqRpV2d-5VWwSEdoFQosKoSVDV8dDnj8Lq3oKH3vEUKad35nc-dmGnBI3rNOQ7VVN2pRX0JXs2c1yxhzTe9cdmyAchDw18aH81KCLmUOCE5jzp3QM03HTqA1V_rHfGiqBW1v4xw" />
                        </div>
                        <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant/40 flex items-center justify-center p-1.5">
                          <img className="w-full h-full object-contain opacity-80" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAihZ22q1R8bQNdmMXTpvJ95l2TtQxINDpJ6tLu2_WShu2B2gTT9XRkH7RkGII13spnkD2mlsDDotQ1kIhm1vQrFd6KyFaOacaOHDTXrM5mPQKPZ_bF4R13zLVAIpse6XrkY8sFrECu7HFk-memHD6M7Jy2kvppULQpjFtB5ApmUE3TJ8IR9rOlQGYHsGdXLn0HxOTcPX25obusHoCO8TwgMYztXhkH4dmRKbj6Iy-foZPWlZXUbN2oTfjtbXTiROEbB1K0n-ySnSQ" />
                        </div>
                      </div>
                      <div>
                        <h3 className="font-headline font-bold text-on-surface">NOM/OCT</h3>
                        <p className="text-on-surface-variant text-[10px] uppercase font-label tracking-widest">OneDEX Dynamic</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-8 text-center flex-1">
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">TVL</span>
                        <span className="font-headline font-semibold text-primary">$3.1M</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">24h Vol</span>
                        <span className="font-headline font-semibold text-on-surface">$2.4M</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-on-surface-variant uppercase font-label">APY</span>
                        <span className="font-headline font-semibold text-secondary-fixed-dim">84.9%</span>
                      </div>
                    </div>
                    <button className="bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/40 text-on-surface-variant px-6 py-2 rounded-md font-bold text-xs transition-all">Manage</button>
                  </div>
                </>
              )}
            </div>

            {/* Section 3: Modify Liquidity Form */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              <div className="bg-surface-container-low border border-outline-variant/20 p-6 rounded-xl relative">
                <h2 className="text-lg font-headline font-bold text-on-surface mb-6">Modify Liquidity</h2>
                <div className="flex gap-2 mb-6 p-1 bg-surface-container rounded-md">
                  <button
                    onClick={() => setMode("deposit")}
                    className={`flex-1 py-2 text-xs font-bold rounded transition-all ${mode === "deposit" ? "bg-surface-container-high text-primary-container" : "text-on-surface-variant hover:text-on-surface"}`}
                  >
                    Deposit
                  </button>
                  <button
                    onClick={() => setMode("withdraw")}
                    className={`flex-1 py-2 text-xs font-bold rounded transition-all ${mode === "withdraw" ? "bg-surface-container-high text-primary-container" : "text-on-surface-variant hover:text-on-surface"}`}
                  >
                    Withdraw
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Asset Pair</label>
                    <div className="bg-surface-container-lowest p-3 rounded border border-outline-variant/30 flex justify-between items-center cursor-pointer hover:border-primary-container/40">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary-container/10 flex items-center justify-center">
                          <span className="material-symbols-outlined text-sm text-primary-container">search</span>
                        </div>
                        <span className="text-sm font-medium text-on-surface">Select Pair</span>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Amount</label>
                      <span className="text-[10px] text-on-surface-variant">Bal: {balance} OCT</span>
                    </div>
                    <div className="bg-surface-container-lowest p-4 rounded border border-outline-variant/30 relative">
                      <input
                        className="bg-transparent border-none text-xl font-headline font-bold text-on-surface focus:ring-0 w-full p-0"
                        placeholder="0.00" type="text"
                        value={amount}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                      />
                      <button className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary-container bg-primary-container/10 px-2 py-1 rounded">MAX</button>
                    </div>
                  </div>
                  <div className="pt-4 space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-on-surface-variant">Est. Weekly Yield</span>
                      <span className="text-secondary-fixed-dim font-bold">{estWeeklyYield !== null ? `+$${estWeeklyYield.toFixed(2)}` : "--"}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-on-surface-variant">Price Impact</span>
                      <span className="text-on-surface">{priceImpact !== null ? `${priceImpact < 0.01 ? "<0.01" : priceImpact.toFixed(2)}%` : "--"}</span>
                    </div>
                  </div>
                  <button className="w-full bg-gradient-to-r from-primary-container to-primary-fixed-dim text-on-primary py-4 rounded-md font-extrabold tracking-tighter hover:shadow-[0_0_20px_rgba(0,243,255,0.3)] transition-all mt-4 uppercase">
                    EXECUTE {mode === "deposit" ? "PROVISIONING" : "WITHDRAWAL"}
                  </button>
                </div>
              </div>

              {/* Section 4: Yield Distribution */}
              <div className="bg-surface-container-lowest border-t border-outline-variant/20 p-6 rounded-md">
                <h3 className="text-xs font-label uppercase tracking-widest text-on-surface-variant mb-4">Yield Distribution</h3>
                <div className="space-y-4">
                  <div className="flex items-end gap-1 h-24 mb-6">
                    {(tokenYields ?? [
                      { token: "OCT", apy: 42, stable: false },
                      { token: "ETH", apy: 24, stable: true },
                      { token: "NOM", apy: 62, stable: false },
                      { token: "USDC", apy: 12, stable: true },
                      { token: "USDT", apy: 31, stable: true },
                    ]).map(({ token, apy, stable }) => {
                      const pct = Math.round((apy / maxYield) * 100);
                      return (
                        <div key={token} className={`flex-1 ${stable ? "bg-secondary-fixed-dim/20" : "bg-primary-container/20"} rounded-t-sm relative group`}>
                          <div className={`absolute bottom-0 w-full ${stable ? "bg-secondary-fixed-dim" : "bg-primary-container"} rounded-t-sm`} style={{ height: `${pct}%` }}></div>
                          <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-surface-container-high px-2 py-1 text-[8px] rounded whitespace-nowrap border border-outline-variant/40">{token} {apy.toFixed(0)}%</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-4 pt-2 border-t border-outline-variant/10">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-primary-container"></div>
                      <span className="text-[10px] text-on-surface-variant">Ecosystem Assets</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-secondary-fixed-dim"></div>
                      <span className="text-[10px] text-on-surface-variant">Stable Pools</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-outline-variant/10 flex items-center justify-between text-on-surface-variant font-body text-[10px] uppercase tracking-[0.2em]">
            <div className="flex items-center gap-6">
              {activityItems.length > 0 ? activityItems.map((item, i) => (
                <span key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span> {item}</span>
              )) : (
                <>
                  <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span> Agent 001 Rebalanced NOM/OCT</span>
                  <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim"></span> New Opportunity Detected: OCT/USDC (+12% APY)</span>
                </>
              )}
            </div>
            <div>v1.0.4 - Hunter Cluster Alpha</div>
          </div>
        </main>
    </div>
  );
}

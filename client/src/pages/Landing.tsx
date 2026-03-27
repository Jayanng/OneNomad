// FILE: client/src/pages/Landing.tsx
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOneWallet } from "../hooks/useOneWallet";
import { useOneID, shortenAddress } from "../hooks/useOneID";

const TERMINAL_LOGS = [
  { time: "12:44:01", text: "Initializing OneNomad agent...",              color: "text-slate-400/60"  },
  { time: "12:44:02", text: "Connected to OneChain RPC ✓",                 color: "text-emerald-400/80"},
  { time: "12:44:03", text: "Scanning OneDEX liquidity pools...",           color: "text-slate-400/60"  },
  { time: "12:44:04", text: "5 pools indexed. Analyzing yield gap...",      color: "text-slate-400/60"  },
  { time: "12:44:05", text: "Groq routing: >1.5% yield gap identified",     color: "text-cyan-400/90"   },
  { time: "12:44:06", text: "OCT/USDT → OCT/USDC  +2.3% APY delta",        color: "text-cyan-400/90"   },
  { time: "12:44:07", text: "Safety gate: APPROVED ✓",                      color: "text-emerald-400/80"},
  { time: "12:44:08", text: "Building PTB: withdraw → swap → deposit",      color: "text-slate-400/60"  },
  { time: "12:44:09", text: "[DRY RUN] Simulating transaction block...",     color: "text-yellow-400/70" },
  { time: "12:44:10", text: "✓ Rebalance complete.  Gas used: 0 OCT ⚡",    color: "text-emerald-400/90"},
];

export default function Landing() {
  const { isConnected, address, connect } = useOneWallet();
  const { name: oneIdName } = useOneID(address);
  const displayName = oneIdName ?? (address ? shortenAddress(address) : null);
  const navigate = useNavigate();

  const [walletPrompt, setWalletPrompt] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  // Once wallet connects, redirect to the intended route
  useEffect(() => {
    if (isConnected && pendingRoute) {
      setWalletPrompt(false);
      navigate(pendingRoute);
      setPendingRoute(null);
    }
  }, [isConnected, pendingRoute, navigate]);

  const PUBLIC_ROUTES = ["/docs"];

  const handleNavClick = (to: string) => {
    if (isConnected || PUBLIC_ROUTES.includes(to)) {
      navigate(to);
    } else {
      setPendingRoute(to);
      setWalletPrompt(true);
    }
  };

  // Terminal log animation — reveals one line at a time, then loops
  const [visibleLogs, setVisibleLogs] = useState(4);
  const termRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      setVisibleLogs((v) => (v >= TERMINAL_LOGS.length ? 1 : v + 1));
    }, 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="font-body selection:bg-primary-container selection:text-on-primary-container overflow-x-hidden text-[#e5e2e1]" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%, #1a2235 0%, #0f1117 40%, #0b0d11 100%)" }}>
      {/* TopNavBar Navigation Shell */}
      <nav className="fixed top-0 w-full z-50" style={{ background: "rgba(10,12,20,0.55)", backdropFilter: "blur(24px) saturate(180%)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex justify-between items-center w-full px-8 py-3.5 max-w-7xl mx-auto">

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center border border-cyan-500/30" style={{ background: "linear-gradient(135deg, rgba(0,243,255,0.15), rgba(0,243,255,0.04))" }}>
              <span className="material-symbols-outlined text-cyan-400 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>deployed_code</span>
            </div>
            <span
              className="text-lg font-bold tracking-tight font-headline"
              style={{ background: "linear-gradient(90deg, #e2f8ff 0%, #7dd3fc 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
            >
              OneNomad
            </span>
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-1">
            {[
              { label: "Dashboard",    to: "/dashboard"    },
              { label: "Hunter Stats", to: "/hunter-stats" },
              { label: "Security",     to: "/security"     },
              { label: "Liquidity",    to: "/liquidity"    },
              { label: "Docs",         to: "/docs"         },
            ].map((link) => (
              <button
                key={link.to}
                onClick={() => handleNavClick(link.to)}
                className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/[0.08] transition-all duration-150 tracking-tight"
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {/* Wallet pill */}
            {isConnected && displayName && (
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-sm" style={{ background: "rgba(255,255,255,0.04)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span className="text-[10px] font-mono text-slate-300 tracking-wider">{displayName}</span>
              </div>
            )}

            {/* CTA */}
            <Link to="/dashboard">
              <button className="relative flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm text-slate-900 transition-all duration-150 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: "linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0891b2 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 16px rgba(0,243,255,0.18)", border: "1px solid rgba(0,243,255,0.25)" }}>
                <span>Launch App</span>
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_forward</span>
              </button>
            </Link>
          </div>

        </div>
      </nav>

      {/* Main Content Canvas */}
      <main className="relative pt-24">
        {/* Hero Section */}
        <section className="relative h-[calc(100vh-6rem)] flex items-center px-6 overflow-hidden">
          {/* Particle Network Background */}
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="neural-grid absolute inset-0 opacity-20"></div>
            {/* Ambient glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-[#00f3ff]/5 rounded-full blur-[140px]"></div>
            {/* Floating particles */}
            {(
              [
                [12, 8,  2, 0  ], [78, 92, 2, 2.1],
                [42, 48, 2, 1.5], [88, 28, 2, 1.8],
                [32, 18, 2, 2.3], [68, 43, 2, 1.0],
                [22, 65, 2, 2.6], [72, 78, 2, 0.2],
              ] as [number, number, number, number][]
            ).map(([top, left, size, delay], i) => (
              <div
                key={i}
                className="absolute rounded-full bg-[#00f3ff]"
                style={{
                  top: `${top}%`,
                  left: `${left}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  opacity: 0.2,
                  animationName: "pulse",
                  animationDuration: `${4.5 + delay}s`,
                  animationDelay: `${delay}s`,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                  boxShadow: `0 0 ${size * 2}px rgba(0,243,255,0.4)`,
                }}
              />
            ))}
          </div>

          <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center py-6 md:py-10">
            {/* Left: Copy */}
            <div className="lg:col-span-7 space-y-5 z-10">

              {/* Live badge */}
              <div className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-md border border-white/10 px-4 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 hunter-pulse"></span>
                <span className="text-xs font-label uppercase tracking-widest text-slate-400">Live on OneChain Testnet</span>
                <span className="material-symbols-outlined text-slate-600 text-sm">arrow_forward</span>
              </div>

              {/* Main Headline */}
              <div>
                <p className="text-xs font-label font-medium tracking-[0.2em] uppercase text-slate-500 mb-3">
                  Autonomous Yield Intelligence
                </p>
                <h1 className="text-4xl md:text-6xl font-headline font-bold leading-[1.05] tracking-tighter">
                  <span className="text-white">Set it. Forget it.</span>
                  <br />
                  <span
                    style={{
                      background: "linear-gradient(90deg, #00f3ff 0%, #7dd3fc 55%, #94a3b8 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    Let AI hunt the best
                    <br className="hidden md:block" /> yields on OneChain.
                  </span>
                </h1>
              </div>

              {/* Tagline */}
              <p className="text-base text-slate-400 max-w-xl leading-relaxed">
                OneNomad's autonomous agent scans pools, decides with{" "}
                <span className="text-cyan-400 font-medium">Groq AI</span>, and rebalances with{" "}
                <span className="text-cyan-400 font-medium">zero gas</span>{" "}
                — 24/7, while you sleep.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-3 pt-1">
                <Link to="/dashboard">
                  <button className="group relative bg-gradient-to-b from-cyan-400 to-cyan-600 text-slate-900 px-7 py-3 rounded-lg font-bold text-sm border border-cyan-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_20px_rgba(0,243,255,0.15)] hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 flex items-center gap-2">
                    Launch OneNomad
                    <span className="material-symbols-outlined text-base group-hover:translate-x-0.5 transition-transform">rocket_launch</span>
                  </button>
                </Link>
                <Link to="/docs">
                  <button className="group bg-white/5 backdrop-blur-md border border-white/10 hover:border-white/20 hover:bg-white/8 text-slate-300 hover:text-white px-7 py-3 rounded-lg font-bold text-sm transition-all duration-150 flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-slate-500 group-hover:text-slate-300 transition-colors">menu_book</span>
                    Read the Docs
                  </button>
                </Link>
              </div>

              {/* Glassmorphic feature tags */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {[
                  { icon: "bolt",          label: "Zero Gas"              },
                  { icon: "verified_user", label: "Move-Secure"           },
                  { icon: "psychology",    label: "Groq + OneChain"       },
                  { icon: "emoji_events",  label: "Built for OneHack 3.0", highlight: true },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-label uppercase tracking-widest backdrop-blur-md border transition-colors
                      ${item.highlight
                        ? "bg-cyan-900/20 border-cyan-500/30 text-cyan-400"
                        : "bg-white/5 border-white/10 text-slate-400 hover:text-slate-300 hover:bg-white/8"
                      }`}
                  >
                    <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>{item.icon}</span>
                    {item.label}
                  </span>
                ))}
              </div>

            </div>

            {/* Right: Terminal Mockup */}
            <div className="hidden lg:flex lg:col-span-5 justify-center items-center">
              {/* Ambient glow behind terminal */}
              <div className="absolute w-72 h-72 bg-cyan-500/5 rounded-full blur-[80px] pointer-events-none"></div>

              <div
                ref={termRef}
                className="relative w-full max-w-[420px] rounded-xl overflow-hidden border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]"
                style={{ background: "rgba(15,18,25,0.85)", backdropFilter: "blur(20px)" }}
              >
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/60"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></span>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60"></span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 ml-2 tracking-wide">onenomad — agent@onechain:~</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="text-[10px] font-mono text-emerald-400/70 uppercase tracking-widest">running</span>
                  </div>
                </div>

                {/* Log body */}
                <div className="p-5 font-mono text-[11px] leading-5 space-y-1 min-h-[280px]">
                  {TERMINAL_LOGS.slice(0, visibleLogs).map((log, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="text-slate-600 shrink-0 select-none">{log.time}</span>
                      <span className={log.color}>{log.text}</span>
                    </div>
                  ))}
                  {/* Blinking cursor */}
                  <div className="flex gap-3 mt-1">
                    <span className="text-slate-600 select-none">›</span>
                    <span className="inline-block w-[7px] h-[13px] bg-cyan-400/70 animate-[pulse_1.1s_ease-in-out_infinite] rounded-[1px]"></span>
                  </div>
                </div>

                {/* Bottom status bar */}
                <div className="px-5 py-2 border-t border-white/[0.06] flex items-center justify-between" style={{ background: "rgba(255,255,255,0.02)" }}>
                  <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">onechain testnet</span>
                  <span className="text-[10px] font-mono text-cyan-400/60">DRY RUN MODE</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Wallet Connect Prompt */}
      {walletPrompt && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}>
          <div
            className="relative w-full max-w-sm rounded-2xl border border-white/10 p-8 flex flex-col items-center text-center gap-5"
            style={{ background: "rgba(12,15,24,0.95)", boxShadow: "0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)" }}
          >
            {/* Close button */}
            <button
              onClick={() => { setWalletPrompt(false); setPendingRoute(null); }}
              className="absolute top-4 right-4 w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 transition-all"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>

            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center border border-cyan-500/20" style={{ background: "linear-gradient(135deg, rgba(0,243,255,0.12), rgba(0,243,255,0.03))" }}>
              <span className="material-symbols-outlined text-cyan-400 text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance_wallet</span>
            </div>

            {/* Copy */}
            <div className="space-y-1.5">
              <h3 className="text-lg font-headline font-bold text-white tracking-tight">Connect your wallet</h3>
              <p className="text-sm text-slate-400 leading-relaxed">You need to connect your OneWallet before accessing the app.</p>
            </div>

            {/* Connect button */}
            <button
              onClick={connect}
              className="w-full py-3 rounded-xl font-bold text-sm text-slate-900 transition-all duration-150 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: "linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0891b2 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 16px rgba(0,243,255,0.2)" }}
            >
              Connect OneWallet
            </button>

            {/* Cancel */}
            <button
              onClick={() => { setWalletPrompt(false); setPendingRoute(null); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// FILE: client/src/pages/Dashboard.tsx
import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useOneWallet } from "../hooks/useOneWallet";
import { useOneID, shortenAddress } from "../hooks/useOneID";
import { useAgentWS } from "../hooks/useAgentWS";

function extractToken(id: string): string {
  const parts = id.split("::");
  return parts.length >= 3 ? parts[parts.length - 1] : id.slice(-6);
}

export default function Dashboard() {
  const { isConnected, address, balance, connect, disconnect } = useOneWallet();
  const { name: oneIdName } = useOneID(address);
  const displayName = oneIdName ?? (address ? shortenAddress(address) : null);
  const { pools, lastDecision, lastTx, txHistory, decisionHistory, safetyResult, wsConnected, heartbeat, agentRunning, wsLatency, lastUpdateAt } = useAgentWS();
  const [optimisticDryRun, setOptimisticDryRun] = useState<boolean | null>(null);
  const isDryRun = optimisticDryRun ?? (heartbeat?.dryRun ?? false);
  useEffect(() => { setOptimisticDryRun(null); }, [heartbeat?.dryRun]);
  const [showWalletTip, setShowWalletTip] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(1);
  // autonomousMode: optimistic local state overrides WS value while API call is in flight,
  // then WS heartbeat confirms and clears it. This makes the toggle feel instant.
  const [optimisticRunning, setOptimisticRunning] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const autonomousMode = optimisticRunning ?? agentRunning;
  // Clear optimistic override whenever the server confirms the real state
  useEffect(() => { setOptimisticRunning(null); }, [agentRunning]);
  const toggleAutonomousMode = () => {
    if (isToggling) return;
    const next = !autonomousMode;
    console.log(`[Dashboard] Toggle Autonomous Mode clicked. Current: ${autonomousMode}, Next: ${next}`);
    setOptimisticRunning(next);
    setIsToggling(true);
    fetch(next ? "/api/agent/start" : "/api/agent/stop", { method: "POST" })
      .then((res) => {
        if (!res.ok) {
          console.error(`[Dashboard] Failed to toggle agent: ${res.status} ${res.statusText}`);
          setOptimisticRunning(null);
        } else {
          console.log(`[Dashboard] Agent toggle success: ${next ? "started" : "stopped"}`);
        }
      })
      .catch((err) => {
        console.error("[Dashboard] Error calling toggle API:", err);
        setOptimisticRunning(null);
      })
      .finally(() => {
        // Keep toggling state for 2s to ignore stale WS heartbeats
        setTimeout(() => setIsToggling(false), 2000);
      });
  };
  const toggleDryRun = () => {
    const next = !isDryRun;
    console.log(`[Dashboard] Toggle Dry Run clicked. Current: ${isDryRun}, Next: ${next}`);
    setOptimisticDryRun(next);
    fetch("/api/agent/dryrun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: next }),
    })
      .then((res) => {
        if (!res.ok) {
          console.error(`[Dashboard] Failed to toggle dry run: ${res.status} ${res.statusText}`);
          setOptimisticDryRun(null);
        } else {
          console.log(`[Dashboard] Dry run toggle success: ${next}`);
        }
      })
      .catch((err) => {
        console.error("[Dashboard] Error calling dry run API:", err);
        setOptimisticDryRun(null);
      });
  };
  const [scanCountdown, setScanCountdown] = useState(60);
  const [threshold, setThreshold] = useState(1.5);

  // Sync threshold with heartbeat once it arrives
  useEffect(() => {
    if (heartbeat?.threshold !== undefined) {
      setThreshold(heartbeat.threshold);
    }
  }, [heartbeat?.threshold]);

  // Debounce threshold updates to backend
  const thresholdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleThresholdChange = (val: number) => {
    setThreshold(val);
    if (thresholdTimeoutRef.current) clearTimeout(thresholdTimeoutRef.current);
    thresholdTimeoutRef.current = setTimeout(() => {
      fetch("/api/agent/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: val }),
      });
    }, 1000);
  };

  // ── Derived live data ──────────────────────────────────────
  const bestApy = useMemo(() => pools.length > 0 ? Math.max(...pools.map(p => p.apy)) : null, [pools]);
  const bestPool = useMemo(() => pools.length > 0 ? pools.reduce((a, b) => a.apy > b.apy ? a : b) : null, [pools]);
  const aiConfidence = useMemo(() => {
    if (!lastDecision || lastDecision.modelUsed === "fallback") return null;
    return Math.min(99, Math.round(lastDecision.confidence * 100));
  }, [lastDecision]);
  const confidenceDashOffset = useMemo(() => {
    const circ = 150.8;
    if (!lastDecision || lastDecision.modelUsed === "fallback") return circ * 0.94; // near-empty arc
    return Math.max(circ * 0.01, circ * (1 - lastDecision.confidence));
  }, [lastDecision]);
  const rebalancesToday = useMemo(() => {
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    return txHistory.filter(e => e.tx.success && e.timestamp >= startOfDay.getTime()).length;
  }, [txHistory]);
  const formatTvl = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n/1_000).toFixed(0)}K` : `$${n}`;
  const successfulRebalances = useMemo(() => txHistory.filter(e => e.tx.success && e.decision?.action === "rebalance").length, [txHistory]);
  const apyDelta = useMemo(() => {
    if (pools.length < 2) return null;
    const sorted = [...pools].sort((a, b) => b.apy - a.apy);
    return `+${(sorted[0].apy - sorted[1].apy).toFixed(1)}%`;
  }, [pools]);

  // ── APY history — fetch from backend on mount + update from WS ───
  const [apyHistory, setApyHistory] = useState<{ ts: number; apy: number }[]>([]);
  const hasFetchedHistoryRef = useRef(false);

  useEffect(() => {
    if (hasFetchedHistoryRef.current) return;
    hasFetchedHistoryRef.current = true;
    fetch("/api/agent/apy-history")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setApyHistory(data.slice(-50));
      })
      .catch(err => console.error("[Dashboard] Error fetching APY history:", err));
  }, []);

  useEffect(() => {
    if (pools.length === 0) return;
    const best = Math.max(...pools.map(p => p.apy));
    setApyHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && Date.now() - last.ts < 45000) return prev; // debounce: only add if > 45s since last
      return [...prev, { ts: Date.now(), apy: best }].slice(-50);
    });
  }, [pools]);

  const chartData = useMemo(() => {
    if (apyHistory.length < 2) return null;
    const apys = apyHistory.map(h => h.apy);
    const maxApy = Math.max(...apys);
    const minApy = Math.min(...apys);
    const range = maxApy - minApy || 1;
    // SVG coordinate space: viewBox 0 0 700 200, usable x: 50–650, y: 15–185
    const points = apyHistory.map((h, i) => {
      const x = Math.round(50 + (i / (apyHistory.length - 1)) * 600);
      const y = Math.round(185 - ((h.apy - minApy) / range) * 170);
      return { x, y, apy: h.apy, ts: h.ts };
    });
    const polyline  = points.map(p => `${p.x},${p.y}`).join(" ");
    const fillPoly  = `${polyline} ${points[points.length - 1].x},200 ${points[0].x},200`;
    const last      = points[points.length - 1];
    // Time labels: up to 7 evenly-spaced entries
    const step   = Math.max(1, Math.ceil(apyHistory.length / 7));
    const labels = apyHistory
      .filter((_, i) => i % step === 0 || i === apyHistory.length - 1)
      .slice(0, 7)
      .map(h => {
        const d = new Date(h.ts);
        return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
      });
    return { points, polyline, fillPoly, last, labels, maxApy, minApy };
  }, [apyHistory]);

  // ── Toast & Rebalance delight ──────────────────────────────
  type Toast = { id: number; msg: string; type: "info" | "success" | "warning" };
  const [toasts] = useState<Toast[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showRebalanceNotif, setShowRebalanceNotif] = useState(false);
  const displayDigest = lastTx?.digest ?? null;

  // Show guided tour on first connection
  useEffect(() => {
    if (isConnected && !localStorage.getItem("onenomad_tour_done")) {
      const t = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(t);
    }
  }, [isConnected]);

  // Reset countdown whenever a real apyUpdate cycle lands
  const cycleIntervalRef = useRef(60);
  useEffect(() => {
    if (heartbeat?.nextRunIn) {
      const secs = parseInt(heartbeat.nextRunIn, 10);
      if (!isNaN(secs) && secs > 0) cycleIntervalRef.current = secs;
    }
  }, [heartbeat]);

  const prevPoolsUpdateRef = useRef(0);
  useEffect(() => {
    if (pools.length === 0) return;
    const now = Date.now();
    if (now - prevPoolsUpdateRef.current < 2000) return; // debounce rapid updates
    prevPoolsUpdateRef.current = now;
    setScanCountdown(cycleIntervalRef.current);
  }, [pools]);

  // Tick countdown down only while agent is running
  useEffect(() => {
    if (!wsConnected || !autonomousMode) return;
    const timer = setInterval(() => {
      setScanCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [wsConnected, autonomousMode]);

  // "X s ago" ticker — seconds since last apyUpdate landed
  const [secsSinceUpdate, setSecsSinceUpdate] = useState<number | null>(null);
  useEffect(() => {
    if (!lastUpdateAt) { setSecsSinceUpdate(null); return; }
    setSecsSinceUpdate(Math.floor((Date.now() - lastUpdateAt) / 1000));
    const timer = setInterval(() => {
      setSecsSinceUpdate(Math.floor((Date.now() - lastUpdateAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastUpdateAt]);

  const forceHunt = () => {
    console.log("[Dashboard] Force Hunt clicked");
    const now = new Date();
    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    setLogs((prev) => [{ time: t, msg: "[INFO] Force hunt triggered — dispatching agent cycle...", type: "INFO" }, ...prev].slice(0, 50));
    fetch("/api/trigger", { method: "POST" })
      .then((res) => {
        if (!res.ok) {
          console.error(`[Dashboard] Force hunt failed: ${res.status}`);
          const e = new Date();
          const et = `${e.getHours()}:${e.getMinutes().toString().padStart(2, "0")}:${e.getSeconds().toString().padStart(2, "0")}`;
          setLogs((prev) => [{ time: et, msg: `[ERROR] Trigger failed — server returned ${res.status}`, type: "ERROR" }, ...prev].slice(0, 50));
        } else {
          console.log("[Dashboard] Force hunt triggered successfully");
        }
      })
      .catch((err) => {
        console.error("[Dashboard] Force hunt error:", err);
        const e = new Date();
        const et = `${e.getHours()}:${e.getMinutes().toString().padStart(2, "0")}:${e.getSeconds().toString().padStart(2, "0")}`;
        setLogs((prev) => [{ time: et, msg: "[ERROR] Could not reach backend — is the server running?", type: "ERROR" }, ...prev].slice(0, 50));
      });
  };

  const dismissTour = () => {
    setShowTour(false);
    localStorage.setItem("onenomad_tour_done", "true");
  };

  const TOUR_STEPS = 4;
  const [logs, setLogs] = useState<{ time: string; msg: string; type: string }[]>([
    { time: "--:--:--", msg: "[INFO] Connecting to OneNomad agent…", type: "INFO" },
  ]);

  // Feed useAgentWS events into the terminal log
  const prevPoolsLenRef = useRef(0);
  const prevDecisionRef = useRef<typeof lastDecision>(null);
  const prevTxRef = useRef<typeof lastTx>(null);

  useEffect(() => {
    const now = new Date();
    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

    if (pools.length > 0 && pools.length !== prevPoolsLenRef.current) {
      prevPoolsLenRef.current = pools.length;
      const bestApy = Math.max(...pools.map((p) => p.apy)).toFixed(2);
      setLogs((prev) => [{ time: t, msg: `[INFO] ${pools.length} pools fetched. Best APY: ${bestApy}%`, type: "INFO" }, ...prev].slice(0, 50));
    }
  }, [pools]);

  useEffect(() => {
    if (!lastDecision || lastDecision === prevDecisionRef.current) return;
    prevDecisionRef.current = lastDecision;
    const now = new Date();
    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    let msg: string;
    if (lastDecision.action === "rebalance") {
      const src = lastDecision.sourcePoolId.slice(-8);
      const tgt = lastDecision.targetPoolId.slice(-8);
      msg = `[INFO] AI decision: rebalance from ${src} → ${tgt} (${lastDecision.amountPercent}%)`;
    } else {
      msg = `[INFO] AI decision: hold — ${lastDecision.reasoning}`;
    }
    setLogs((prev) => [{ time: t, msg, type: "INFO" }, ...prev].slice(0, 50));
  }, [lastDecision]);

  useEffect(() => {
    if (!lastTx || lastTx === prevTxRef.current) return;
    prevTxRef.current = lastTx;
    const now = new Date();
    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    let msg: string;
    let type: string;
    if (lastTx.success) {
      msg = `[SUCCESS] PTB confirmed. Digest: ${lastTx.digest ?? "n/a"}`;
      type = "SUCCESS";
    } else {
      msg = `[ERROR] PTB failed: ${lastTx.error ?? "unknown error"}`;
      type = "ERROR";
    }
    setLogs((prev) => [{ time: t, msg, type }, ...prev].slice(0, 50));
  }, [lastTx]);

  const prevSafetyRef = useRef<typeof safetyResult>(null);
  useEffect(() => {
    if (!safetyResult || safetyResult === prevSafetyRef.current) return;
    prevSafetyRef.current = safetyResult;
    const now = new Date();
    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    const msg = safetyResult.approved
      ? `[SUCCESS] Safety: APPROVED — ${safetyResult.reason}`
      : `[WARNING] Safety: REJECTED — ${safetyResult.reason}`;
    const type = safetyResult.approved ? "SUCCESS" : "WARNING";
    setLogs((prev) => [{ time: t, msg, type }, ...prev].slice(0, 50));
  }, [safetyResult]);

  // Show real rebalance notification when a successful live tx arrives
  const prevTxNotifRef = useRef<typeof lastTx>(null);
  useEffect(() => {
    if (!lastTx || lastTx === prevTxNotifRef.current) return;
    prevTxNotifRef.current = lastTx;
    if (lastTx.success && lastDecision?.action === "rebalance") {
      setShowRebalanceNotif(true);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
  }, [lastTx, lastDecision]);

  const prevConnectedRef = useRef(false);
  useEffect(() => {
    if (wsConnected && !prevConnectedRef.current) {
      const now = new Date();
      const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
      setLogs((prev) => [{ time: t, msg: "[INFO] Agent heartbeat — connected", type: "INFO" }, ...prev].slice(0, 50));
    }
    prevConnectedRef.current = wsConnected;
  }, [wsConnected]);


  const getLogColor = (type: string) => {
    switch (type) {
      case "SUCCESS": return "text-secondary-fixed-dim";
      case "WARNING": return "text-yellow-500";
      case "ERROR": return "text-error";
      default: return "text-on-surface-variant";
    }
  };

  return (
    <div className="bg-background text-on-surface font-body selection:bg-primary-container selection:text-on-primary-container">

      {/* ── Wallet Connect Overlay ───────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-[200] flex items-center justify-center transition-all duration-700 ${
          isConnected ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        style={{ background: "rgba(10,10,10,0.97)", backdropFilter: "blur(24px)" }}
      >
        {/* Background grid + ambient glow */}
        <div className="absolute inset-0 neural-grid opacity-10 pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-[#00f3ff]/5 rounded-full blur-[140px] pointer-events-none animate-pulse"></div>

        {/* Card */}
        <div className="relative z-10 max-w-sm w-full mx-6 flex flex-col items-center text-center space-y-7">

          {/* Brand */}
          <div className="text-2xl font-bold tracking-tighter text-[#00f3ff] uppercase font-headline drop-shadow-[0_0_8px_rgba(0,243,255,0.6)]">
            OneNomad
          </div>

          {/* Wallet icon orb */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 bg-[#00f3ff]/10 rounded-full blur-xl animate-pulse"></div>
            <div className="relative w-24 h-24 border border-[#00f3ff]/30 rounded-full flex items-center justify-center bg-zinc-950/80">
              <span
                className="material-symbols-outlined text-[42px] text-[#00f3ff]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                account_balance_wallet
              </span>
            </div>
          </div>

          {/* Heading + sub */}
          <div className="space-y-3">
            <h2 className="text-3xl font-headline font-bold text-white tracking-tight">
              Connect Your OneWallet
            </h2>
            <p className="text-on-surface-variant leading-relaxed text-sm px-2">
              Connect your OneWallet to give OneNomad permission to hunt yields on your behalf.
            </p>
          </div>

          {/* OneID resolved name (shown after connect, before overlay fades) */}
          {isConnected && displayName && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-surface-container rounded-full border border-[#00f3ff]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim animate-pulse"></span>
              <span className="text-xs font-label text-cyan-300 uppercase tracking-widest">{displayName}</span>
            </div>
          )}

          {/* Connect button */}
          <button
            onClick={connect}
            className="w-full bg-gradient-to-br from-[#00f3ff] to-[#0077ff] text-black px-8 py-5 rounded-md font-bold text-lg hover:shadow-[0_0_36px_rgba(0,243,255,0.6)] transition-all active:scale-95 duration-150"
          >
            Connect OneWallet
          </button>

          {/* "What is OneWallet?" tooltip */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 text-xs text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
              onClick={() => setShowWalletTip((v) => !v)}
            >
              <span className="material-symbols-outlined text-sm">help_outline</span>
              What is OneWallet?
            </button>
            {showWalletTip && (
              <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-72 bg-zinc-900 border border-[#00f3ff]/20 rounded-md p-4 text-left shadow-2xl">
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  <strong className="text-white block mb-1">OneWallet</strong>
                  OneWallet is the native non-custodial wallet for OneChain — a Move-based L1 blockchain. It lets you sign transactions, manage assets, and connect to DApps like OneNomad without ever giving up your private keys.
                </p>
                <div className="mt-3 pt-3 border-t border-outline-variant/10 flex justify-between items-center">
                  <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest">Powered by @onelabs/dapp-kit</span>
                  <button
                    onClick={() => setShowWalletTip(false)}
                    className="text-[10px] text-cyan-400 hover:underline uppercase tracking-widest"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Trust bar */}
          <div className="flex items-center gap-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant/30">
            <span>Non-Custodial</span>
            <span className="text-[#00f3ff]/20">•</span>
            <span>Zero Gas</span>
            <span className="text-[#00f3ff]/20">•</span>
            <span>Move-Secure</span>
          </div>
        </div>
      </div>
      {/* ── End Wallet Connect Overlay ───────────────────────────────── */}

      {/* ── Onboarding Tour ──────────────────────────────────────────── */}
      {showTour && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative max-w-lg w-full mx-6 bg-zinc-950 border border-[#00f3ff]/15 rounded-xl shadow-[0_0_60px_rgba(0,243,255,0.1)] overflow-hidden">

            {/* Progress bar */}
            <div className="h-[2px] bg-zinc-800">
              <div
                className="h-full bg-[#00f3ff] transition-all duration-500"
                style={{ width: `${(tourStep / TOUR_STEPS) * 100}%` }}
              />
            </div>

            <div className="p-8 space-y-6">
              {/* Step dots + skip */}
              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  {Array.from({ length: TOUR_STEPS }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i + 1 === tourStep
                          ? "w-6 bg-[#00f3ff]"
                          : i + 1 < tourStep
                          ? "w-1.5 bg-[#00f3ff]/40"
                          : "w-1.5 bg-zinc-700"
                      }`}
                    />
                  ))}
                </div>
                <button
                  onClick={dismissTour}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest font-label transition-colors"
                >
                  Skip tour
                </button>
              </div>

              {/* ── Step 1: Your agent is ready ── */}
              {tourStep === 1 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-secondary-fixed-dim/10 border border-secondary-fixed-dim/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary-fixed-dim text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Step 1 of 4</p>
                      <h3 className="text-2xl font-headline font-bold text-white">Your agent is ready.</h3>
                    </div>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed">
                    Your wallet is connected and your autonomous yield hunter is standing by. Here's your current position:
                  </p>
                  <div className="bg-zinc-900 border border-outline-variant/10 rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Current Pool</span>
                      <span className="text-sm font-bold text-white">{bestPool ? `${extractToken(bestPool.tokenA)}/${extractToken(bestPool.tokenB)} — ${bestPool.protocol}` : "—"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Available Balance</span>
                      <span className="text-sm font-bold text-[#00f3ff]">{balance} OCT</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Current APY</span>
                      <span className="text-sm font-bold text-secondary-fixed-dim">{bestApy !== null ? `${bestApy.toFixed(1)}%` : "42.8%"}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Wallet</span>
                      <span className="text-sm font-bold text-[#00f3ff]">{displayName}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 2: How OneNomad works ── */}
              {tourStep === 2 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary-container/10 border border-primary-container/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[#00f3ff] text-2xl">psychology</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Step 2 of 4</p>
                      <h3 className="text-2xl font-headline font-bold text-white">How OneNomad works.</h3>
                    </div>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed">
                    Three stages run silently every 60 seconds while you do anything else:
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { icon: "radar",        color: "text-[#00f3ff]",          label: "AI Scan",  desc: "Groq scans live pool data every 60 s" },
                      { icon: "query_stats",  color: "text-secondary-fixed-dim", label: "Decision", desc: "llama-3.3-70b picks the best move" },
                      { icon: "bolt",         color: "text-[#00f3ff]",          label: "Execute",  desc: "Zero-gas PTB fires on OneChain" },
                    ].map((card) => (
                      <div key={card.label} className="bg-zinc-900 border border-outline-variant/10 rounded-lg p-4 flex flex-col items-center text-center gap-2">
                        <span className={`material-symbols-outlined text-2xl ${card.color}`}>{card.icon}</span>
                        <span className="text-xs font-headline font-bold text-white uppercase tracking-wide">{card.label}</span>
                        <span className="text-[10px] text-on-surface-variant leading-snug">{card.desc}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-on-surface-variant/50 italic">
                    All three stages are fully autonomous. You only need to set a risk threshold — once.
                  </p>
                </div>
              )}

              {/* ── Step 3: Safety first ── */}
              {tourStep === 3 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-yellow-400 text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Step 3 of 4</p>
                      <h3 className="text-2xl font-headline font-bold text-white">Safety first.</h3>
                    </div>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed">
                    OneNomad will never move your funds unless it's clearly worth it. Three guardrails protect you at all times:
                  </p>
                  <div className="space-y-3">
                    {[
                      {
                        icon: "percent",
                        color: "text-secondary-fixed-dim",
                        title: `${threshold.toFixed(1)}% minimum gain rule`,
                        desc: `The agent only rebalances when the new pool beats your current APY by at least ${threshold.toFixed(1)}%. No micro-shuffles.`,
                      },
                      {
                        icon: "science",
                        color: "text-[#00f3ff]",
                        title: "Dry Run mode (on by default)",
                        desc: "Every action is simulated first. Real transactions only fire when you explicitly turn Dry Run off.",
                      },
                      {
                        icon: "monitoring",
                        color: "text-yellow-400",
                        title: "On-chain event monitoring",
                        desc: "Every swap and deposit is verified via OneChain events. Full PTB digest + onescan.cc link in the log.",
                      },
                    ].map((item) => (
                      <div key={item.title} className="flex gap-4 bg-zinc-900 border border-outline-variant/10 rounded-lg p-4">
                        <span className={`material-symbols-outlined shrink-0 ${item.color}`}>{item.icon}</span>
                        <div>
                          <p className="text-sm font-bold text-white mb-0.5">{item.title}</p>
                          <p className="text-xs text-on-surface-variant leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Step 4: Ready to activate? ── */}
              {tourStep === 4 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#00f3ff]/10 border border-[#00f3ff]/30 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[#00f3ff] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                    </div>
                    <div>
                      <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Step 4 of 4</p>
                      <h3 className="text-2xl font-headline font-bold text-white">Ready to activate?</h3>
                    </div>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed">
                    Flip the switch to start your agent. It will begin scanning pools in the next 60-second cycle.
                  </p>

                  {/* Autonomous Mode toggle */}
                  <div
                    className={`flex items-center justify-between p-5 rounded-xl border transition-all duration-300 ${
                      isToggling ? "opacity-50 cursor-wait" : "cursor-pointer"
                    } ${
                      autonomousMode
                        ? "bg-[#00f3ff]/5 border-[#00f3ff]/40 shadow-[0_0_20px_rgba(0,243,255,0.08)]"
                        : "bg-zinc-900 border-outline-variant/10"
                    }`}
                    onClick={toggleAutonomousMode}
                  >
                    <div>
                      <p className="text-sm font-bold text-white mb-0.5">Enable Autonomous Mode</p>
                      <p className={`text-xs transition-colors ${autonomousMode ? "text-[#00f3ff]" : "text-on-surface-variant"}`}>
                        {autonomousMode ? "Agent starts hunting in the next 60s cycle" : "Agent is currently paused"}
                      </p>
                    </div>
                    <button
                      className={`relative inline-flex h-7 w-14 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-300 ${
                        autonomousMode ? "bg-[#00f3ff]" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform duration-300 ${
                          autonomousMode ? "translate-x-7" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {autonomousMode && (
                    <div className="flex items-center gap-2 text-xs text-secondary-fixed-dim font-label">
                      <span className="w-1.5 h-1.5 rounded-full bg-secondary-fixed-dim animate-pulse"></span>
                      Agent Status: Hunting… next scan in ~60s
                    </div>
                  )}
                </div>
              )}

              {/* Navigation footer */}
              <div className="flex items-center justify-between pt-2 border-t border-outline-variant/10">
                <button
                  onClick={() => setTourStep((s) => Math.max(1, s - 1))}
                  className={`text-xs font-label uppercase tracking-widest transition-colors ${
                    tourStep === 1 ? "text-zinc-700 pointer-events-none" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  ← Back
                </button>

                {tourStep < TOUR_STEPS ? (
                  <button
                    onClick={() => setTourStep((s) => s + 1)}
                    className="bg-gradient-to-br from-primary-container to-primary-fixed-dim text-on-primary px-6 py-2.5 rounded-md font-bold text-sm hover:shadow-[0_0_20px_rgba(0,243,255,0.4)] transition-all active:scale-95"
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    onClick={dismissTour}
                    className={`px-6 py-2.5 rounded-md font-bold text-sm transition-all active:scale-95 ${
                      autonomousMode
                        ? "bg-gradient-to-br from-primary-container to-primary-fixed-dim text-on-primary hover:shadow-[0_0_20px_rgba(0,243,255,0.4)]"
                        : "border border-outline-variant/30 text-on-surface-variant hover:text-white hover:border-outline-variant/60"
                    }`}
                  >
                    {autonomousMode ? "Let's hunt →" : "Enter dashboard →"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── End Onboarding Tour ───────────────────────────────────────── */}

      {/* ── Confetti ─────────────────────────────────────────────────── */}
      {showConfetti && (
        <div className="fixed inset-0 z-[400] pointer-events-none overflow-hidden">
          {Array.from({ length: 48 }).map((_, i) => {
            const colors = ["#00f3ff","#4ade80","#fbbf24","#a78bfa","#f472b6","#ffffff","#fb923c"];
            const color  = colors[i % colors.length];
            const left   = `${(i * 2.1) % 100}%`;
            const duration = `${2.2 + (i % 4) * 0.4}s`;
            const delay    = `${(i % 10) * 0.15}s`;
            const size     = 5 + (i % 4) * 2;
            return (
              <div
                key={i}
                className="absolute top-0 rounded-sm"
                style={{
                  left, width: size, height: size * 1.6,
                  backgroundColor: color,
                  animationName: "confettiFall",
                  animationDuration: duration,
                  animationDelay: delay,
                  animationTimingFunction: "ease-in",
                  animationFillMode: "forwards",
                  transform: `rotate(${i * 17}deg)`,
                  opacity: 0,
                }}
              />
            );
          })}
        </div>
      )}

      {/* ── Toast stack ──────────────────────────────────────────────── */}
      <div className="fixed top-24 right-6 z-[350] flex flex-col gap-3 items-end pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-enter flex items-center gap-3 px-4 py-3 rounded-lg border shadow-2xl backdrop-blur-md pointer-events-auto min-w-[280px] max-w-sm ${
              toast.type === "success"
                ? "bg-zinc-900/95 border-secondary-fixed-dim/30 shadow-[0_0_20px_rgba(74,222,128,0.12)]"
                : toast.type === "warning"
                ? "bg-zinc-900/95 border-yellow-500/30"
                : "bg-zinc-900/95 border-cyan-400/20 shadow-[0_0_16px_rgba(0,243,255,0.08)]"
            }`}
          >
            {toast.type === "success" && (
              <span className="material-symbols-outlined text-secondary-fixed-dim text-lg shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            )}
            {toast.type === "info" && (
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shrink-0"></span>
            )}
            {toast.type === "warning" && (
              <span className="material-symbols-outlined text-yellow-400 text-lg shrink-0">warning</span>
            )}
            <p className="text-xs font-label text-on-surface tracking-wide">{toast.msg}</p>
          </div>
        ))}
      </div>

      {/* ── Rebalance success notification ───────────────────────────── */}
      {showRebalanceNotif && (
        <div className="fixed bottom-24 right-6 z-[350] max-w-sm w-full">
          <div className="pop-in bg-zinc-950 border border-secondary-fixed-dim/35 rounded-xl p-5 shadow-[0_0_50px_rgba(74,222,128,0.18)]">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary-fixed-dim" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                <span className="text-xs font-label uppercase tracking-widest text-secondary-fixed-dim font-bold">Rebalance Complete</span>
              </div>
              <button
                onClick={() => setShowRebalanceNotif(false)}
                className="text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            {/* Big yield number */}
            <div className="mb-4 text-center py-3 bg-secondary-fixed-dim/5 rounded-lg border border-secondary-fixed-dim/15">
              {lastDecision?.action === "rebalance" && pools.length > 0 ? (() => {
                const src = pools.find(p => p.id === lastDecision.sourcePoolId);
                const tgt = pools.find(p => p.id === lastDecision.targetPoolId);
                const gain = tgt && src ? (tgt.apy - src.apy).toFixed(1) : "—";
                return <><p className="text-4xl font-headline font-bold text-secondary-fixed-dim">+{gain}%</p><p className="text-xs text-on-surface-variant mt-1">APY gain this cycle</p></>;
              })() : <><p className="text-4xl font-headline font-bold text-secondary-fixed-dim">—</p><p className="text-xs text-on-surface-variant mt-1">awaiting cycle data</p></>}
            </div>

            {/* Details */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">From pool</span>
                <span className="text-on-surface font-medium">
                  {lastDecision?.action === "rebalance" ? (() => {
                    const src = pools.find(p => p.id === lastDecision.sourcePoolId);
                    return src ? `${extractToken(src.tokenA)}/${extractToken(src.tokenB)} (${src.apy.toFixed(1)}%)` : extractToken(lastDecision.sourcePoolId);
                  })() : "—"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">To pool</span>
                <span className="text-secondary-fixed-dim font-medium">
                  {lastDecision?.action === "rebalance" ? (() => {
                    const tgt = pools.find(p => p.id === lastDecision.targetPoolId);
                    return tgt ? `${extractToken(tgt.tokenA)}/${extractToken(tgt.tokenB)} (${tgt.apy.toFixed(1)}%)` : extractToken(lastDecision.targetPoolId);
                  })() : "—"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Gas used</span>
                <span className="text-on-surface font-medium">{lastTx?.gasUsed ?? "0 OCT ⚡"}</span>
              </div>
              <div className="flex justify-between text-xs items-center">
                <span className="text-zinc-500">PTB digest</span>
                {displayDigest ? (
                  <a
                    href={`https://onescan.cc/testnet/tx/${displayDigest}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline font-mono text-[10px] flex items-center gap-1"
                  >
                    {`${displayDigest.slice(0, 8)}…${displayDigest.slice(-6)}`}
                    <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  </a>
                ) : (
                  <span className="font-mono text-[10px] text-zinc-600">
                    {lastTx?.dryRun ? "Dry run — no digest" : "—"}
                  </span>
                )}
              </div>
            </div>

            {/* Share button */}
            <button className="w-full border border-outline-variant/20 hover:border-cyan-400/30 text-on-surface-variant hover:text-on-surface py-2.5 rounded-md text-xs font-label uppercase tracking-widest transition-all flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-sm">share</span>
              Share my agent performance
            </button>
          </div>
        </div>
      )}
      {/* ── End Rebalance delight ─────────────────────────────────────── */}

      {/* TopNavBar */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-zinc-950/70 backdrop-blur-md border-b border-cyan-900/20 z-50 shadow-[0_0_15px_rgba(0,243,255,0.1)]">
        <div className="flex items-center gap-8">
          <Link to="/"><h1 className="text-2xl font-bold tracking-widest text-cyan-400 uppercase font-headline">OneNomad</h1></Link>
          <div className={`hidden md:flex items-center gap-4 px-4 py-1.5 rounded-full border transition-all duration-500 ${
            autonomousMode
              ? "bg-secondary-fixed-dim/10 border-secondary-fixed-dim/30"
              : "bg-surface-container-lowest border-outline-variant/20"
          }`}>
            <span className={`flex h-2 w-2 rounded-full animate-pulse ${autonomousMode ? "bg-secondary-fixed-dim" : "bg-secondary-container"}`}></span>
            <span className={`text-xs font-label tracking-wider uppercase transition-colors ${autonomousMode ? "text-secondary-fixed-dim" : "text-on-surface-variant"}`}>
              {autonomousMode ? `Agent Status: Hunting… next scan in ${scanCountdown}s` : "Live • Agent idle"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center gap-3">
            <span className="text-xs font-label text-on-surface-variant uppercase tracking-widest">Dry Run</span>
            <button
              onClick={toggleDryRun}
              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isDryRun ? 'bg-primary-container' : 'bg-surface-container-highest'}`}
              role="switch"
              aria-checked={isDryRun}
              type="button"
            >
              <span className={`${isDryRun ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-4 w-4 transform rounded-full bg-on-surface shadow ring-0 transition duration-200 ease-in-out`}></span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-zinc-500" title="System Status">sensors</span>
            {isConnected && displayName ? (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-secondary-fixed-dim"></span>
                <span className="text-xs font-label text-cyan-300 tracking-wide font-bold">{balance} OCT</span>
                <span className="h-4 w-[1px] bg-outline-variant/30 mx-1"></span>
                <span className="text-xs font-label text-cyan-300 tracking-wide">{displayName}</span>
                <button
                  onClick={disconnect}
                  className="text-[10px] text-zinc-500 hover:text-error uppercase tracking-widest font-label transition-colors"
                >Disconnect</button>
              </div>
            ) : (
              <button
                onClick={connect}
                className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black px-5 py-2 rounded-md font-label font-black text-sm tracking-tight shadow-[0_0_20px_rgba(0,243,255,0.4)] hover:shadow-[0_0_30px_rgba(0,243,255,0.6)] transition-all active:scale-95 duration-150 uppercase"
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
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center border transition-all duration-500 ${
            autonomousMode
              ? "bg-cyan-400/10 border-cyan-400/40 shadow-[0_0_12px_rgba(0,243,255,0.2)]"
              : "bg-surface-container-highest border-outline-variant/30"
          }`}>
            <span className="material-symbols-outlined text-cyan-400">smart_toy</span>
          </div>
          <div>
            <p className="text-sm font-bold text-cyan-400 font-headline tracking-tight">Agent Alpha</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`h-1.5 w-1.5 rounded-full ${autonomousMode ? "bg-secondary-fixed-dim animate-pulse" : "bg-zinc-600"}`}></span>
              <p className={`text-[10px] uppercase tracking-widest transition-colors ${autonomousMode ? "text-secondary-fixed-dim" : "text-zinc-500"}`}>
                {autonomousMode ? `Hunting • ${scanCountdown}s` : "Idle"}
              </p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          <Link className="flex items-center gap-3 px-3 py-3 bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400 font-label transition-all" to="/dashboard">
            <span className="material-symbols-outlined text-[20px]">terminal</span>
            <span className="text-sm">Terminal</span>
          </Link>
          <Link className="flex items-center gap-3 px-3 py-3 text-zinc-500 hover:bg-zinc-800/50 hover:text-cyan-200 transition-all font-label" to="/security">
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
          <button
            onClick={forceHunt}
            className="w-full bg-cyan-900/20 border border-cyan-500/30 text-cyan-400 py-3 rounded-md font-label text-xs uppercase tracking-widest hover:bg-cyan-500/10 active:scale-95 transition-all"
          >
            Force Hunt Now
          </button>
          <div className="pt-4 border-t border-outline-variant/10 space-y-2">
            <Link className="flex items-center gap-3 text-zinc-500 hover:text-cyan-200 text-xs font-label" to="/security">
              <span className="material-symbols-outlined text-sm">settings</span>
              Settings
            </Link>
            <Link className="flex items-center gap-3 text-zinc-500 hover:text-cyan-200 text-xs font-label" to="/liquidity">
              <span className="material-symbols-outlined text-sm">help_center</span>
              Support
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="lg:ml-64 pt-24 min-h-screen px-6 pb-12 space-y-6">
        {/* 24/7 Running Banner */}
        {autonomousMode && (
          <div className="bg-zinc-900/60 border border-[#00f3ff]/10 px-5 py-3 rounded-md flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-secondary-fixed-dim animate-pulse shrink-0"></span>
              <p className="text-xs font-label text-on-surface-variant">
                Your agent runs <strong className="text-white">24/7 on our servers</strong>. Safe to close this tab — it keeps hunting while you're away.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-label uppercase tracking-widest">
              <Link to="/hunter-stats" className="text-cyan-400 hover:underline">View history</Link>
              <span className="text-zinc-700">|</span>
              <button 
                onClick={toggleAutonomousMode} 
                className={`text-zinc-500 hover:text-red-400 transition-colors ${isToggling ? "opacity-50 cursor-wait" : ""}`}
                type="button"
                disabled={isToggling}
              >
                {autonomousMode ? "Pause agent" : "Resume agent"}
              </button>
            </div>
          </div>
        )}

        {/* Dry Run Banner */}
        {isDryRun && <div className="bg-primary-container/10 border border-primary-container/20 px-6 py-2 rounded-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary-container text-sm">info</span>
            <p className="text-xs font-label text-primary-fixed tracking-wide">Dry Run Mode Active: Actions are simulated and do not affect real assets.</p>
          </div>
          <button onClick={toggleDryRun} className="text-[10px] text-primary-container font-bold uppercase tracking-widest hover:underline" type="button">Disable</button>
        </div>}

        {/* Hero Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* APY Card */}
          <div className={`glass-panel p-6 rounded-md group transition-all duration-500 ${
            autonomousMode
              ? "border-cyan-400/30 shadow-[0_0_24px_rgba(0,243,255,0.12)]"
              : "hover:border-cyan-400/30"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-[0.2em]">Current APY</p>
              {autonomousMode && (
                <span className="flex items-center gap-1 text-[9px] font-label text-secondary-fixed-dim uppercase tracking-widest">
                  <span className="h-1.5 w-1.5 rounded-full bg-secondary-fixed-dim animate-ping"></span>
                  Managed by AI
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <h2 className={`text-4xl font-bold font-headline tracking-tight transition-colors ${
                autonomousMode ? "text-cyan-400" : "text-on-surface group-hover:text-cyan-400"
              }`}>{pools.length > 0 ? `${Math.max(...pools.map((p) => p.apy)).toFixed(2)}%` : "42.8%"}</h2>
              {apyDelta && (
                <span className="flex items-center text-secondary-fixed-dim text-sm font-bold">
                  <span className="material-symbols-outlined text-sm">arrow_upward</span>{apyDelta}
                </span>
              )}
            </div>
          </div>
          {/* Yield Card */}
          <div className="glass-panel p-6 rounded-md">
            <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-[0.2em] mb-2">Rebalances Total</p>
            <div className="flex items-baseline gap-1">
              <h2 className="text-4xl font-bold font-headline text-on-surface tracking-tight">{successfulRebalances}</h2>
              <span className="text-xs text-on-surface-variant font-label ml-1">successful</span>
            </div>
          </div>
          {/* Rebalances Card */}
          <div className="glass-panel p-6 rounded-md">
            <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-[0.2em] mb-2">Rebalances Today</p>
            <div className="flex items-baseline gap-3">
              <h2 className="text-4xl font-bold font-headline text-on-surface tracking-tight">{rebalancesToday}</h2>
              <span className="text-xs text-on-surface-variant font-label">Optimized</span>
            </div>
          </div>
          {/* AI Confidence */}
          <div className="glass-panel p-6 rounded-md flex items-center justify-between">
            <div>
              <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-[0.2em] mb-2">AI Confidence</p>
              <h2 className="text-4xl font-bold font-headline text-on-surface tracking-tight">{aiConfidence !== null ? `${aiConfidence}%` : "--"}</h2>
            </div>
            <div className="relative h-14 w-14">
              <svg className="h-full w-full transform -rotate-90">
                <circle className="text-surface-container-highest" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeWidth="4"></circle>
                <circle className="text-cyan-400" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeDasharray="150.8" strokeDashoffset={confidenceDashOffset} strokeWidth="4"></circle>
              </svg>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="material-symbols-outlined text-xs text-cyan-400" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              </span>
            </div>
          </div>
        </div>

        {/* Last TX digest bar — only visible after a real on-chain rebalance */}
        {displayDigest && lastTx?.success && (
          <a
            href={`https://onescan.cc/testnet/tx/${displayDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-4 px-5 py-2.5 rounded-md border border-cyan-400/20 bg-cyan-950/20 hover:border-cyan-400/40 hover:bg-cyan-950/30 transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary-fixed-dim shrink-0 animate-pulse"></span>
              <span className="text-[10px] font-label text-zinc-500 uppercase tracking-widest shrink-0">Last TX</span>
              <span className="font-mono text-xs text-cyan-300 truncate">
                {displayDigest.slice(0, 10)}…{displayDigest.slice(-8)}
              </span>
              {lastTx.gasUsed && (
                <span className="hidden sm:inline text-[10px] text-zinc-600 font-mono truncate">
                  · {lastTx.gasUsed}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] font-label text-cyan-400/60 group-hover:text-cyan-400 transition-colors uppercase tracking-widest shrink-0">
              View on Explorer
              <span className="material-symbols-outlined text-[13px]">open_in_new</span>
            </div>
          </a>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Left Column: Current Position & Leaderboard */}
          <div className="xl:col-span-5 space-y-6">
            {/* Current Position — hero card */}
            <div className={`rounded-md overflow-hidden transition-all duration-500 ${
              autonomousMode
                ? "border border-cyan-400/25 shadow-[0_0_32px_rgba(0,243,255,0.09)]"
                : "border border-outline-variant/20"
            } bg-surface-container-lowest`}>
              {/* Header row */}
              <div className="px-6 pt-6 pb-3 flex justify-between items-start">
                <div>
                  <span className="inline-flex items-center gap-1.5 bg-secondary-container/10 text-secondary-fixed-dim text-[10px] px-2.5 py-1 rounded-full border border-secondary-fixed-dim/20 font-bold uppercase tracking-widest mb-2">
                    {autonomousMode && <span className="h-1.5 w-1.5 rounded-full bg-secondary-fixed-dim animate-ping"></span>}
                    Managed by AI
                  </span>
                  <h3 className="text-xl font-headline font-bold text-on-surface">{bestPool ? `${extractToken(bestPool.tokenA)}/${extractToken(bestPool.tokenB)} Pool` : "OCT/USDC Pool"}</h3>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">{bestPool ? `${bestPool.protocol} — ${bestPool.tier}` : "OneDEX — Main"}</p>
                </div>
                <div className="flex -space-x-2">
                  <div className="h-10 w-10 rounded-full border-2 border-surface-container bg-surface flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary-container">currency_bitcoin</span>
                  </div>
                  <div className="h-10 w-10 rounded-full border-2 border-surface-container bg-surface flex items-center justify-center">
                    <span className="material-symbols-outlined text-secondary-fixed-dim">monetization_on</span>
                  </div>
                </div>
              </div>
              {/* Big APY */}
              <div className="px-6 py-4 bg-zinc-900/50">
                <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-1">Live APY</p>
                <div className="flex items-baseline gap-3">
                  <span className={`text-5xl font-headline font-bold transition-colors duration-500 ${autonomousMode ? "text-cyan-400" : "text-on-surface"}`}>{bestApy !== null ? `${bestApy.toFixed(1)}%` : "42.8%"}</span>
                  {apyDelta && (
                    <span className="text-secondary-fixed-dim text-sm font-bold flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-sm">arrow_upward</span>{apyDelta}
                    </span>
                  )}
                </div>
              </div>
              {/* 3-stat grid */}
              <div className="grid grid-cols-3 divide-x divide-outline-variant/10">
                <div className="px-4 py-4">
                  <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-1">Balance</p>
                  <p className="text-sm font-bold text-cyan-400">{balance} OCT</p>
                </div>
                <div className="px-4 py-4">
                  <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-1">Value</p>
                  <p className="text-sm font-bold text-on-surface">{bestPool ? formatTvl(bestPool.tvlUsd) : "—"}</p>
                </div>
                <div className="px-4 py-4">
                  <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-1">Multiplier</p>
                  <p className="text-sm font-bold text-on-surface">—</p>
                </div>
              </div>
              <div className={`h-[2px] transition-all duration-500 ${autonomousMode ? "bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" : "bg-gradient-to-r from-transparent via-outline-variant/15 to-transparent"}`}></div>
            </div>

            <div className="glass-panel rounded-md overflow-hidden">
              <div className="p-5 border-b border-outline-variant/10 flex items-center justify-between">
                <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">Live OneDEX Pools</h3>
                <div className="flex items-center gap-2">
                  {autonomousMode && <span className="h-1.5 w-1.5 rounded-full bg-secondary-fixed-dim animate-pulse"></span>}
                  <span className="material-symbols-outlined text-orange-500 text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                </div>
              </div>
              <div className="max-h-[280px] overflow-y-auto custom-scrollbar divide-y divide-outline-variant/5">
                {(pools.length > 0 ? pools.slice().sort((a, b) => b.apy - a.apy) : [
                  { id: "1", protocol: "OneDEX",    tier: "established" as const, tokenA: "OCT",  tokenB: "USDC", apy: 18.4, tvlUsd: 2100000, fetchedAt: 0 },
                  { id: "2", protocol: "OneDEX",    tier: "established" as const, tokenA: "OCT",  tokenB: "USDT", apy: 14.2, tvlUsd: 1800000, fetchedAt: 0 },
                  { id: "3", protocol: "OneVault",  tier: "established" as const, tokenA: "Stable",tokenB: "Yield",apy: 12.5, tvlUsd: 3000000, fetchedAt: 0 },
                  { id: "4", protocol: "OneVault",  tier: "experimental" as const,tokenA: "High", tokenB: "Yield",apy: 18.0, tvlUsd: 500000,  fetchedAt: 0 },
                  { id: "5", protocol: "OneDEX",    tier: "established" as const, tokenA: "USDC", tokenB: "USDT", apy: 5.8,  tvlUsd: 4000000, fetchedAt: 0 },
                ]).map((pool, i) => {
                  const ta = extractToken(pool.tokenA);
                  const tb = extractToken(pool.tokenB);
                  const isBest = pool.id === bestPool?.id || (pools.length === 0 && i === 0);
                  const isActive = isBest;
                  const rank = String(i + 1).padStart(2, "0");
                  const apyColor = isBest ? "text-secondary-fixed-dim" : i === 1 ? "text-cyan-400" : "text-on-surface";
                  return (
                    <div key={pool.id} className={`flex items-center justify-between px-4 py-3.5 transition-colors cursor-pointer group ${isActive ? "bg-cyan-500/5" : "hover:bg-surface-container-high"}`}>
                      <div className="flex items-center gap-4">
                        <span className="text-zinc-600 font-headline font-bold text-sm group-hover:text-zinc-400 transition-colors w-6">{rank}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold">{ta}/{tb}</p>
                            {isBest && <span className="text-[9px] bg-secondary-fixed-dim/15 text-secondary-fixed-dim border border-secondary-fixed-dim/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Best</span>}
                            {isActive && <span className="text-[9px] bg-cyan-400/10 text-cyan-400 border border-cyan-400/25 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1"><span className="h-1 w-1 rounded-full bg-cyan-400 animate-pulse"></span>Active</span>}
                          </div>
                          <p className="text-[10px] text-zinc-500 uppercase">{pool.protocol} — {pool.tier}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${apyColor}`}>{pool.apy.toFixed(1)}% APY</p>
                        <p className="text-[10px] text-zinc-500">{formatTvl(pool.tvlUsd)} Liq.</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Agent Brain & Recent Activity */}
          <div className="xl:col-span-7 space-y-6">
            <div className="glass-panel rounded-md flex flex-col h-[340px]">
              <div className="p-5 border-b border-outline-variant/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 text-sm">psychology</span>
                  <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">Agent Brain</h3>
                </div>
                <div className="flex items-center gap-3">
                  {wsConnected && autonomousMode && (
                    <div className="flex items-center gap-2.5">
                      <span className="text-[9px] font-label text-cyan-400/70 uppercase tracking-widest">
                        Next scan: {scanCountdown}s
                      </span>
                      {wsLatency !== null && (
                        <span
                          title="WebSocket latency: time between server broadcast and browser receipt"
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            wsLatency < 50
                              ? "text-emerald-400 border-emerald-900/40 bg-emerald-950/20"
                              : wsLatency < 200
                              ? "text-cyan-400 border-cyan-900/40 bg-cyan-950/20"
                              : "text-yellow-400 border-yellow-900/40 bg-yellow-950/20"
                          }`}
                        >
                          {wsLatency}ms
                        </span>
                      )}
                      {secsSinceUpdate !== null && (
                        <span className="text-[9px] font-label text-zinc-600 uppercase tracking-widest">
                          {secsSinceUpdate}s ago
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-secondary-fixed-dim animate-pulse" : "bg-zinc-700"}`}></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700"></span>
                  </div>
                </div>
              </div>
              {/* Live scanning ticker */}
              {wsConnected && autonomousMode && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-outline-variant/5 bg-zinc-950/60">
                  <span className="flex gap-0.5">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="h-1 w-1 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${d}ms` }}></span>
                    ))}
                  </span>
                  <span className="text-[10px] font-label text-cyan-400/70 uppercase tracking-widest">Scanning OneDEX pools</span>
                  <span className="ml-auto text-[10px] font-mono text-zinc-600">{scanCountdown}s</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] custom-scrollbar space-y-2 bg-zinc-950/40">
                {logs.map((log, idx) => (
                  <div key={idx} className={`flex gap-3 ${getLogColor(log.type)}`}>
                    <span className="opacity-50 shrink-0">[{log.time}]</span>
                    <span>{log.msg}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-md">
              <div className="p-5 border-b border-outline-variant/10">
                <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">Recent Activity</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-label text-zinc-500 uppercase tracking-widest border-b border-outline-variant/5">
                      <th className="px-6 py-4 font-medium">Action</th>
                      <th className="px-6 py-4 font-medium">Pair</th>
                      <th className="px-6 py-4 font-medium">Value</th>
                      <th className="px-6 py-4 font-medium text-right">Digest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/5">
                    {txHistory.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-6 text-center text-xs text-zinc-600 uppercase tracking-widest">
                          No activity yet — agent running…
                        </td>
                      </tr>
                    ) : txHistory.slice(0, 5).map((entry, i) => {
                      const action = entry.decision?.action === "rebalance" ? "Rebalance" : "Hold";
                      const src = entry.decision ? extractToken(entry.decision.sourcePoolId) : "—";
                      const tgt = entry.decision ? extractToken(entry.decision.targetPoolId) : "—";
                      const pair = entry.decision?.action === "rebalance" ? `${src}→${tgt}` : src;
                      const digest = entry.tx.digest;
                      const shortDigest = digest ? `${digest.slice(0,8)}…${digest.slice(-6)}` : "Dry run";
                      return (
                        <tr key={i} className="hover:bg-surface-container/30 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <span className={`material-symbols-outlined text-lg ${entry.tx.success ? "text-secondary-fixed-dim" : "text-error"}`}>{action === "Rebalance" ? "swap_horiz" : "pause_circle"}</span>
                              <span className="text-xs font-bold">{action}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs">{pair}</td>
                          <td className="px-6 py-4 text-xs font-bold text-on-surface">{entry.tx.gasUsed ?? (entry.tx.dryRun ? "Simulated" : "—")}</td>
                          <td className="px-6 py-4 text-right">
                            {digest ? (
                              <a
                                className="text-cyan-400 hover:text-cyan-200 transition-colors text-[10px] font-mono tracking-wide"
                                href={`https://onescan.cc/testnet/tx/${digest}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {shortDigest}
                              </a>
                            ) : (
                              <span className="text-zinc-600 text-[10px] font-mono">{shortDigest}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Decision History — last 10 agent decisions */}
        <div className="glass-panel rounded-md overflow-hidden">
          <div className="p-5 border-b border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-sm">history</span>
              <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">Decision History</h3>
              {decisionHistory.length > 0 && (
                <span className="text-[10px] font-label text-zinc-500 uppercase tracking-widest">
                  last {decisionHistory.length}
                </span>
              )}
            </div>
            {wsConnected && (
              <span className="flex items-center gap-1.5 text-[9px] font-label text-cyan-400/60 uppercase tracking-widest">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/60 animate-pulse"></span>
                Live
              </span>
            )}
          </div>

          {decisionHistory.length === 0 ? (
            <div className="px-6 py-8 text-center text-xs text-zinc-600 uppercase tracking-widest">
              No decisions yet — agent running…
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/5">
              {decisionHistory.map((entry, i) => {
                const isRebalance  = entry.decision.action === "rebalance";
                const isHold       = entry.decision.action === "hold";
                const safetyPassed = entry.safety?.approved ?? null;
                const txOk         = entry.tx?.success ?? null;
                const digest       = entry.tx?.digest ?? null;
                const shortDigest  = digest ? `${digest.slice(0, 8)}…${digest.slice(-6)}` : null;

                // Timestamp
                const d    = new Date(entry.timestamp);
                const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
                const date = `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;

                // Outcome badge logic
                let badgeText  = "HOLD";
                let badgeClass = "bg-zinc-800 text-zinc-400 border-zinc-700";
                if (isRebalance && safetyPassed === false) {
                  badgeText  = "BLOCKED";
                  badgeClass = "bg-red-950/40 text-red-400 border-red-900/40";
                } else if (isRebalance && txOk === true && digest) {
                  badgeText  = "EXECUTED";
                  badgeClass = "bg-emerald-950/40 text-emerald-400 border-emerald-900/40";
                } else if (isRebalance && txOk === false) {
                  badgeText  = "TX FAILED";
                  badgeClass = "bg-red-950/40 text-red-400 border-red-900/40";
                } else if (isRebalance && safetyPassed === true && txOk === null) {
                  badgeText  = "REBALANCE";
                  badgeClass = "bg-cyan-950/40 text-cyan-400 border-cyan-900/40";
                } else if (isHold) {
                  badgeText  = "HOLD";
                  badgeClass = "bg-zinc-800/60 text-zinc-400 border-zinc-700/40";
                }

                // Pool names from IDs
                const srcToken = isRebalance ? extractToken(entry.decision.sourcePoolId) : null;
                const tgtToken = isRebalance ? extractToken(entry.decision.targetPoolId) : null;

                return (
                  <div key={i} className={`flex items-start gap-4 px-5 py-4 hover:bg-surface-container/20 transition-colors ${i === 0 ? "bg-cyan-950/10" : ""}`}>
                    {/* Index + timestamp */}
                    <div className="shrink-0 w-16 text-right">
                      <p className="text-[9px] font-mono text-zinc-600">{String(i + 1).padStart(2, "0")}</p>
                      <p className="text-[10px] font-mono text-zinc-500">{time}</p>
                      <p className="text-[9px] font-mono text-zinc-700">{date}</p>
                    </div>

                    {/* Badge */}
                    <div className="shrink-0 pt-0.5">
                      <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${badgeClass}`}>
                        {badgeText}
                      </span>
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {isRebalance && srcToken && tgtToken && (
                        <p className="text-xs font-bold text-on-surface mb-0.5">
                          {srcToken} → {tgtToken}
                          <span className="ml-2 text-[10px] font-normal text-zinc-500">
                            {entry.decision.amountPercent}%
                          </span>
                        </p>
                      )}
                      {isHold && (
                        <p className="text-xs font-bold text-zinc-500 mb-0.5">No action</p>
                      )}
                      <p className="text-[10px] text-zinc-600 leading-relaxed line-clamp-2">
                        {entry.decision.reasoning}
                      </p>
                    </div>

                    {/* Right: confidence + digest + model */}
                    <div className="shrink-0 text-right space-y-1">
                      <p className="text-[10px] font-mono text-zinc-500">
                        {Math.round(entry.decision.confidence * 100)}% conf
                      </p>
                      {shortDigest ? (
                        <a
                          href={`https://onescan.cc/testnet/tx/${digest}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[10px] font-mono text-cyan-400 hover:text-cyan-200 transition-colors"
                        >
                          {shortDigest} ↗
                        </a>
                      ) : (
                        <p className="text-[10px] font-mono text-zinc-700">—</p>
                      )}
                      <p className="text-[9px] text-zinc-700 uppercase tracking-wider">
                        {entry.decision.modelUsed}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chart & Controls Row */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 glass-panel p-6 rounded-md">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">
                  {chartData ? "Live APY Trend" : "APY Trend"}
                </h3>
                {chartData && (
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest mt-0.5">{apyHistory.length} scans recorded</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Best Pool APY</span>
              </div>
            </div>
            {/* SVG line chart */}
            <div className="relative h-52 px-2">
              <svg viewBox="0 0 700 200" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="apyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00f3ff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#00f3ff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Horizontal grid lines */}
                {[40, 80, 120, 160].map((y) => (
                  <line key={y} x1="0" y1={y} x2="700" y2={y} stroke="#27272a" strokeWidth="1" />
                ))}
                {chartData ? (
                  <>
                    {/* APY range Y-axis labels */}
                    <text x="12" y="22" fill="#52525b" fontSize="9">{chartData.maxApy.toFixed(1)}%</text>
                    <text x="12" y="188" fill="#52525b" fontSize="9">{chartData.minApy.toFixed(1)}%</text>
                    {/* Gradient fill under line */}
                    <polygon fill="url(#apyFill)" points={chartData.fillPoly} />
                    {/* Main APY line */}
                    <polyline
                      fill="none" stroke="#00f3ff" strokeWidth="2.5"
                      strokeLinejoin="round" strokeLinecap="round"
                      points={chartData.polyline}
                    />
                    {/* Data point dots */}
                    {chartData.points.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r="3" fill="#00f3ff" opacity="0.6" />
                    ))}
                    {/* Live endpoint pulse */}
                    <circle cx={chartData.last.x} cy={chartData.last.y} r="5" fill="#00f3ff" />
                    <circle cx={chartData.last.x} cy={chartData.last.y} r="9" fill="none" stroke="#00f3ff" strokeWidth="1" opacity="0.4" className="animate-ping" />
                    {/* Label on live endpoint */}
                    <text x={chartData.last.x} y={chartData.last.y - 12} textAnchor="middle" fill="#71717a" fontSize="10">
                      {chartData.last.apy.toFixed(1)}%
                    </text>
                  </>
                ) : (
                  <>
                    {/* Placeholder while waiting for first 2 WS cycles */}
                    <polygon fill="url(#apyFill)"
                      points="50,122 150,92 250,114 350,60 450,70 550,36 650,12 650,200 50,200" />
                    <polyline fill="none" stroke="#00f3ff" strokeWidth="2.5"
                      strokeLinejoin="round" strokeLinecap="round"
                      points="50,122 150,92 250,114 350,60 450,70 550,36 650,12" />
                    <circle cx="650" cy="12" r="5" fill="#00f3ff" />
                    <circle cx="650" cy="12" r="9" fill="none" stroke="#00f3ff" strokeWidth="1" opacity="0.4" className="animate-ping" />
                    <text x="350" y="105" textAnchor="middle" fill="#3f3f46" fontSize="11" fontFamily="monospace">Collecting data — waiting for agent cycles…</text>
                  </>
                )}
              </svg>
            </div>
            <div className="flex justify-between mt-1 px-2 text-[10px] font-label text-zinc-600 uppercase tracking-widest">
              {(chartData?.labels ?? ["—", "—", "—", "—", "—", "—", "—"]).map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </div>

          <div className="xl:col-span-4 glass-panel p-6 rounded-md space-y-6">
            <h3 className="text-sm font-headline font-bold uppercase tracking-widest text-on-surface">Agent Controls</h3>

            {/* Autonomous Mode toggle */}
            <div
              className={`flex items-center justify-between p-4 rounded-lg border transition-all duration-300 ${
                isToggling ? "opacity-50 cursor-wait" : "cursor-pointer"
              } ${
                autonomousMode ? "bg-cyan-400/5 border-cyan-400/30" : "bg-zinc-900/50 border-outline-variant/10"
              }`}
              onClick={toggleAutonomousMode}
            >
              <div>
                <p className="text-xs font-bold text-white uppercase tracking-wider">Autonomous Mode</p>
                <p className={`text-[10px] mt-0.5 transition-colors ${autonomousMode ? "text-cyan-400" : "text-zinc-500"}`}>
                  {autonomousMode ? `Hunting • next scan ${scanCountdown}s` : "Agent paused"}
                </p>
              </div>
              <div
                className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors duration-300 ${autonomousMode ? "bg-cyan-400" : "bg-zinc-700"}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ${autonomousMode ? "translate-x-5" : "translate-x-0"}`} />
              </div>
            </div>

            {/* Threshold slider */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-xs font-label text-zinc-500 uppercase tracking-widest">Rebalance Threshold</label>
                <span className="text-xs font-bold text-cyan-400">{threshold.toFixed(1)}%</span>
              </div>
              <input
                className="w-full h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-cyan-400"
                max="5" min="0" step="0.1" type="range"
                value={threshold}
                onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
              />
              <p className="text-[10px] text-zinc-600 leading-relaxed italic">
                Agent only rebalances when new pool beats current APY by at least {threshold.toFixed(1)}%.
              </p>
            </div>

            <div className="pt-2 border-t border-outline-variant/10 space-y-3">
              <button
                onClick={forceHunt}
                className="w-full bg-gradient-to-r from-primary-container to-primary-fixed-dim text-on-primary py-3.5 rounded-md font-headline font-bold uppercase tracking-widest shadow-lg active:scale-95 transition-all hover:shadow-[0_0_20px_rgba(0,243,255,0.4)]"
              >
                Force Hunt Now
              </button>
              <button
                onClick={() => {
                  console.log("[Dashboard] Emergency Halt clicked");
                  // Only toggle if currently running
                  if (autonomousMode) {
                    toggleAutonomousMode();
                    const now = new Date();
                    const t = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
                    setLogs((prev) => [{ time: t, msg: "[WARNING] Emergency halt triggered. Agent stopped.", type: "WARNING" }, ...prev].slice(0, 50));
                  } else {
                    console.log("[Dashboard] Emergency Halt ignored — agent already paused");
                  }
                }}
                className="w-full border border-red-900/40 text-red-400/70 hover:border-red-500/50 hover:text-red-400 py-3 rounded-md font-label text-xs uppercase tracking-widest transition-colors"
                type="button"
              >
                Emergency Halt
              </button>
            </div>
          </div>
        </div>
      </main>

      <div className={`fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-md shadow-2xl border transition-all duration-500 ${
        autonomousMode
          ? "bg-zinc-900 border-cyan-400/20 shadow-[0_0_16px_rgba(0,243,255,0.08)]"
          : "bg-zinc-900 border-outline-variant/20"
      }`}>
        <div className={`h-2 w-2 rounded-full ${autonomousMode ? "bg-secondary-fixed-dim animate-pulse" : "bg-zinc-600"}`}></div>
        <p className="text-xs font-label text-on-surface tracking-wide">
          Nomad Node:{" "}
          <span className={autonomousMode ? "text-cyan-400" : "text-zinc-500"}>
            {autonomousMode ? `Hunting v1.0.4-alpha` : "Idle v1.0.4-alpha"}
          </span>
        </p>
      </div>
    </div>
  );
}

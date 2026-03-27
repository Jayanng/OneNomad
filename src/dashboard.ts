import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { startAgent, setBroadcast, triggerAgentCycle, pauseAgent, resumeAgent, isAgentRunning, setDryRun, isDryRun, setThreshold, getThreshold, resetPositions } from "./agent";
import { db } from "./db";
import type { WSMessage } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────

const PORT        = parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR  = path.join(__dirname, "../public");

// ── Express + HTTP server ─────────────────────────────────────────────────────

const app    = express();
const server = createServer(app);

// Serve the built Vite frontend from /public
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Manual trigger — fires one agent cycle immediately
app.post("/api/trigger", (_req, res) => {
  triggerAgentCycle();
  res.json({ status: "triggered", timestamp: Date.now() });
});

// Resync positions from chain — clears in-memory cache, next cycle re-reads on-chain state
// Safe to call at any time: waits for any running cycle to finish before clearing
app.post("/api/agent/resync", (_req, res) => {
  resetPositions();
  res.json({ status: "resynced", message: "Position cache cleared — next cycle will re-sync from chain.", timestamp: Date.now() });
});

// Agent start/stop — backend is source of truth for running state
app.post("/api/agent/start", (_req, res) => {
  console.log(`[dashboard] Received POST /api/agent/start`);
  resumeAgent();
  res.json({ isRunning: true, timestamp: Date.now() });
});

app.post("/api/agent/stop", (_req, res) => {
  console.log(`[dashboard] Received POST /api/agent/stop`);
  pauseAgent();
  res.json({ isRunning: false, timestamp: Date.now() });
});

app.post("/api/agent/dryrun", (req, res) => {
  const { dryRun } = req.body;
  if (typeof dryRun === "boolean") {
    setDryRun(dryRun);
  }
  res.json({ dryRun: isDryRun(), timestamp: Date.now() });
});

app.get("/api/agent/config", (_req, res) => {
  res.json({
    threshold: getThreshold(),
    dryRun: isDryRun(),
    isRunning: isAgentRunning(),
  });
});

app.post("/api/agent/config", (req, res) => {
  const { threshold } = req.body;
  if (typeof threshold === "number") {
    setThreshold(threshold);
  }
  res.json({ success: true, threshold: getThreshold() });
});

app.get("/api/agent/history", (_req, res) => {
  res.json(db.getHistory());
});

app.get("/api/agent/apy-history", (_req, res) => {
  res.json(db.getApyHistory());
});

app.post("/api/rpc", async (req, res) => {
  const RPC_URL = process.env.ONECHAIN_RPC_URL || "https://rpc-testnet.onelabs.cc:443";
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const json = await response.json();
    res.json(json);
  } catch (err) {
    console.error(`[rpc-proxy] Error forwarding to ${RPC_URL}:`, err);
    res.status(500).json({ error: "RPC Proxy Error", details: String(err) });
  }
});

app.get("/api/agent/status", (_req, res) => {
  res.json({ isRunning: isAgentRunning(), timestamp: Date.now() });
});

// SPA fallback — let React Router handle all non-API routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

// Track connected clients
const clients = new Set<WebSocket>();

wss.on("connection", (ws, req) => {
  clients.add(ws);
  console.log(`[ws] Client connected — ${clients.size} total | ${req.socket.remoteAddress}`);

  // Send current agent state immediately so the dashboard renders correctly on connect
  sendTo(ws, {
    event: "heartbeat",
    timestamp: Date.now(),
    data: { message: "Connected to OneNomad agent", clientCount: clients.size, isRunning: isAgentRunning() },
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected — ${clients.size} remaining`);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Client error:`, err.message);
    clients.delete(ws);
  });
});

// ── Broadcast helper ──────────────────────────────────────────────────────────

function sendTo(ws: WebSocket, msg: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg: WSMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

// Inject broadcast into agent so it can push events to all connected clients
setBroadcast(broadcast);

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n┌──────────────────────────────────────────┐`);
  console.log(`│  OneNomad Dashboard                      │`);
  console.log(`│  HTTP  → http://localhost:${PORT}           │`);
  console.log(`│  WS    → ws://localhost:${PORT}             │`);
  console.log(`└──────────────────────────────────────────┘\n`);

  // Start the autonomous agent loop
  startAgent();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[dashboard] Received ${signal}. Shutting down...`);
  for (const ws of clients) {
    ws.close();
  }
  server.close(() => {
    console.log("[dashboard] Server closed. Goodbye.");
    process.exit(0);
  });
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("[dashboard] FATAL: Unhandled Rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[dashboard] FATAL: Uncaught Exception:", err);
  process.exit(1);
});

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "../data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const APY_HISTORY_FILE = path.join(DATA_DIR, "apy_history.json");

/**
 * Simple JSON-based persistence layer for OneNomad.
 */
export class Database {
  private config: any = null;
  private history: any[] = [];
  private apyHistory: any[] = [];

  constructor() {
    this.ensureDir();
    this.load();
  }

  private ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private load() {
    // Load Config
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        this.config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      } catch (err) {
        console.error("[db] Failed to parse config.json:", err);
      }
    }
    if (!this.config) {
      this.config = {
        threshold: 0.5,
        dryRun: false,
        isRunning: true,
      };
      this.saveConfig();
    }

    // Load Rebalance History
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        this.history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
      } catch (err) {
        console.error("[db] Failed to parse history.json:", err);
      }
    }

    // Load APY History
    if (fs.existsSync(APY_HISTORY_FILE)) {
      try {
        this.apyHistory = JSON.parse(fs.readFileSync(APY_HISTORY_FILE, "utf-8"));
      } catch (err) {
        console.error("[db] Failed to parse apy_history.json:", err);
      }
    }
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  getConfig() {
    return { ...this.config };
  }

  saveConfig(newConfig?: any) {
    if (newConfig) {
      this.config = { ...this.config, ...newConfig };
    }
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[db] Failed to save config.json:", err);
    }
  }

  // ── Rebalance History ───────────────────────────────────────────────────────

  getHistory() {
    return [...this.history];
  }

  addHistoryEntry(entry: any) {
    this.history.unshift({
      timestamp: Date.now(),
      ...entry,
    });
    // Keep last 1000 entries
    if (this.history.length > 1000) {
      this.history = this.history.slice(0, 1000);
    }
    this.saveHistory();
  }

  private saveHistory() {
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2));
    } catch (err) {
      console.error("[db] Failed to save history.json:", err);
    }
  }

  // ── APY History ─────────────────────────────────────────────────────────────

  getApyHistory() {
    return [...this.apyHistory];
  }

  addApyEntry(pools: any[]) {
    const bestApy = pools.length > 0 ? Math.max(...pools.map(p => p.apy)) : 0;
    this.apyHistory.push({
      ts: Date.now(),
      apy: bestApy,
    });
    // Keep last 10000 entries (approx 7 days at 1/min)
    if (this.apyHistory.length > 10000) {
      this.apyHistory = this.apyHistory.slice(-10000);
    }
    this.saveApyHistory();
  }

  private saveApyHistory() {
    try {
      fs.writeFileSync(APY_HISTORY_FILE, JSON.stringify(this.apyHistory, null, 2));
    } catch (err) {
      console.error("[db] Failed to save apy_history.json:", err);
    }
  }
}

export const db = new Database();

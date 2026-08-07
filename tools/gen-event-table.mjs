#!/usr/bin/env node
// 自動生成 docs/architecture.md §4 的 socket 事件對照表。
//
// 掃描 server/ + client/ 程式碼裡的字串事件名(.emit/.on/.once 與
// GameSession/game-host 的包裝方法;sendToPlayer/_sendTo 的事件名在第 2 參數),
// 產出「事件 → 發送端 / 接收端」表。單邊事件(只發不收、只收不發)標 ⚠ ——
// 那是死碼或漏接 handler 的訊號。
//
// 看不見的(設計如此):NetKit sim 匯流排(Sim.emit → ev.type 動態分發)、
// GameAPI 訊息(display_game_broadcast 內層 payload)、樣板字串事件名。
//
// 用法:
//   node tools/gen-event-table.mjs            # 印到 stdout
//   node tools/gen-event-table.mjs --write    # 重寫 docs/architecture.md 標記區
//   node tools/gen-event-table.mjs --check    # 過期則 exit 1(掛 hook/CI 用)
//   --root DIR / --doc FILE 可覆寫掃描根目錄與文件路徑
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const ROOT = path.resolve(opt("--root") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const DOC = path.resolve(opt("--doc") || path.join(ROOT, "docs", "architecture.md"));

const BEGIN = "<!-- BEGIN:EVENT-TABLE(自動生成:node tools/gen-event-table.mjs --write;勿手改) -->";
const END = "<!-- END:EVENT-TABLE -->";

// ── 掃描範圍 ─────────────────────────────────────────────────────────────────
const EXTS = new Set([".js", ".mjs", ".html"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "vendor", "docs", "train", "tools", "gestures", "decks", "uploads"]);
const SKIP_FILE = (rel) => {
  const base = path.basename(rel);
  if (/test|dbg|\.min\./i.test(rel)) return true;
  if (rel === "server/ai/prompts.js") return true; // SCHEMA_DOC 文件字串,非真實站點
  if (rel === "client/shared/netsim-worker.js") return true; // sim 匯流排,非 socket
  if (/^server\/modules\/[^/]+\/src\//.test(rel)) return true; // NetKit sim 程式(Sim.emit 匯流排)
  return base.startsWith(".");
};

function* walk(dir, rel = "") {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + "/" + ent.name : ent.name;
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) yield* walk(path.join(dir, ent.name), r);
    } else if (EXTS.has(path.extname(ent.name)) && !SKIP_FILE(r)) {
      yield r;
    }
  }
}

// ── 事件抽取 ─────────────────────────────────────────────────────────────────
// generic(emit/on/once)才做 receiver 黑名單:Sim(sim 匯流排)、page/pg
// (puppeteer)、rl/child/process(Node API)。包裝方法名夠獨特,不用。
const METHODS = [
  { name: "emit", arg: 0, kind: "send", generic: true },
  { name: "on", arg: 0, kind: "listen", generic: true },
  { name: "once", arg: 0, kind: "listen", generic: true },
  { name: "broadcastAll", arg: 0, kind: "send" },
  { name: "broadcastPlayers", arg: 0, kind: "send" },
  { name: "broadcastDisplay", arg: 0, kind: "send" },
  { name: "sendToHost", arg: 0, kind: "send" },
  { name: "sendToPlayer", arg: 1, kind: "send" },
  { name: "_sendTo", arg: 1, kind: "send" }, // P2P game-host 定向送
];
const RECEIVER_BLACKLIST = new Set(["Sim", "page", "pg", "rl", "child", "process", "worker", "stdin", "stdout"]);
// socket.io / DOM 生命週期事件,不屬於本專案協定(app 層的 error 事件保留)
const EVENT_BLACKLIST = new Set(["connect", "connection", "disconnect", "connect_error", "reconnect", "message"]);
const NAME = "([A-Za-z0-9_:.$\\-\\/]+)";
const matchers = METHODS.map((m) => ({
  ...m,
  re: new RegExp(`([\\w$)\\]]*)\\.${m.name}\\(\\s*${"(?:[^,()'\"`]+,\\s*)".repeat(m.arg)}['"\`]${NAME}['"\`]`, "g"),
}));

function scan(root) {
  const events = new Map(); // name → { send: Map(file→n), listen: Map(file→n) }
  for (const rel of walk(root)) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), "utf8"); } catch { continue; }
    if (text.length > 2_000_000) continue;
    for (const raw of text.split("\n")) {
      const line = raw.trimStart();
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
      for (const m of matchers) {
        m.re.lastIndex = 0;
        let hit;
        while ((hit = m.re.exec(line)) !== null) {
          const [, recv, ev] = hit;
          if (m.generic && RECEIVER_BLACKLIST.has(recv)) continue;
          if (EVENT_BLACKLIST.has(ev)) continue;
          if (!events.has(ev)) events.set(ev, { send: new Map(), listen: new Map() });
          const side = events.get(ev)[m.kind];
          side.set(rel, (side.get(rel) || 0) + 1);
        }
      }
    }
  }
  return events;
}

// ── 呈現 ────────────────────────────────────────────────────────────────────
const SHORT = {
  "client/mobile/game.html": "mobile",
  "client/mobile/p2p.html": "mobile-p2p",
  "client/display/index.html": "display",
  "client/host/index.html": "host",
  "client/labs/index.html": "labs",
  "client/editor/index.html": "editor",
  "client/actions/index.html": "actions-page",
  "client/decks/index.html": "decks",
};
const short = (p) => SHORT[p] || p.replace(/^(client|server)\//, "").replace(/\.(js|mjs|html)$/, "");
const sideCell = (m) =>
  m.size === 0 ? "—" : [...m].sort().map(([f, n]) => short(f) + (n > 1 ? `×${n}` : "")).join("、");

const GROUPS = [
  ["Host 控制", (n) => n.startsWith("host_")],
  ["P2P 信令與傳輸", (n) => n.startsWith("p2p_")],
  ["AI(編輯器 / GM)", (n) => n.startsWith("ai_")],
  ["Actions 服務", (n) => n.startsWith("actions:")],
  ["遊戲協定", () => true],
];

function render(events) {
  const names = [...events.keys()].sort();
  const grouped = new Map(GROUPS.map(([g]) => [g, []]));
  for (const n of names) grouped.get(GROUPS.find(([, f]) => f(n))[0]).push(n);
  const oneSided = names.filter((n) => !events.get(n).send.size || !events.get(n).listen.size);
  const out = [
    BEGIN,
    "",
    `_共 ${names.length} 個事件,${oneSided.length} 個單邊(⚠)。檔名縮寫:mobile/display/host/labs/editor = 對應 client 頁;其餘為去掉 client|server 前綴與副檔名的路徑。_`,
  ];
  const order = ["遊戲協定", "Host 控制", "P2P 信令與傳輸", "AI(編輯器 / GM)", "Actions 服務"];
  for (const g of order) {
    const list = grouped.get(g);
    if (!list.length) continue;
    out.push("", `#### ${g}(${list.length})`, "", "| 事件 | 發送端 | 接收端 |", "|---|---|---|");
    for (const n of list) {
      const e = events.get(n);
      const flag = !e.send.size || !e.listen.size ? " ⚠" : "";
      out.push(`| \`${n}\`${flag} | ${sideCell(e.send)} | ${sideCell(e.listen)} |`);
    }
  }
  out.push("", END);
  return out.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────
const block = render(scan(ROOT));
if (args.includes("--write") || args.includes("--check")) {
  const doc = fs.readFileSync(DOC, "utf8");
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < 0) {
    console.error(`找不到標記區(${BEGIN.slice(0, 30)}…)於 ${DOC}`);
    process.exit(2);
  }
  const current = doc.slice(b, e + END.length);
  if (args.includes("--check")) {
    if (current === block) {
      console.log("事件表是最新的。");
    } else {
      console.error(`事件表已過期 — 執行 node tools/gen-event-table.mjs --write 更新 ${DOC}`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(DOC, doc.slice(0, b) + block + doc.slice(e + END.length));
    console.log(`已更新 ${DOC} 的事件表。`);
  }
} else {
  console.log(block);
}

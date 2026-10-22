#!/usr/bin/env node
// Toplam kullanım raporu: kaynak listesindeki (~/Arsiv/claude-konusmalar/kaynaklar.json:
// Mac + Windows arşivi) TÜM oturum ve subagent transkriptlerini tarar; model / proje /
// gün / oturum bazında token ve API-liste-fiyatı eşdeğeri maliyet çıkarır.
// HTML + JSON yazar (out\usage.*). Liste yoksa yalnız ~/.claude/projects taranır.
//
// Kullanım: node usage.mjs [--since <ISO tarih/saat>] [--until <ISO tarih/saat>]
//                          [--kaynak <ad>] [--out <file.html>]
//   --since/--until: YYYY-MM-DD ise UTC günü bazında (sınır günü dahil; kayıt saatleri
//                    UTC'dir); saatli ISO ise anlık (saat dilimi yazılmazsa yerel saat;
//                    UTC için sonuna Z koy). Değersiz bayrak ya da değeri "--" ile
//                    başlayan bayrak hatadır.
//   --kaynak: yalnız o kaynağı oku (ör. mac, windows).
// Kaynak listesi bozuksa (geçersiz JSON, aynı "ad" iki kez) hata verip çıkar; dosya hiç yoksa
// yalnız ~/.claude/projects okunur.
//
// NOT: Max aboneliğinde gerçek fatura sabittir; buradaki $ değerleri
// "aynı işi API'den yapsaydın ne tutardı" tahminidir.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Kaynak: claude-api skill fiyat tablosu (önbellek: 2026-09-25), $/MTok.
// Yazma fiyatları standart oranla: 5 dk = 1.25x giriş, 1 sa = 2x giriş.
// Fable 5.1 önbellek okuma $0.25 skill'de açıkça verildi; diğerleri 0.1x giriş.
const BASE = {
  "claude-fable-5-1":  { in: 10, out: 50, cacheRead: 0.25 },
  "claude-fable-5":    { in: 10, out: 50, cacheRead: 1.00 },
  "claude-opus-5-5":   { in: 4,  out: 20, cacheRead: 0.20 },
  "claude-opus-5":     { in: 5,  out: 25, cacheRead: 0.50 },
  "claude-sonnet-5-5": { in: 2,  out: 10, cacheRead: 0.20 },
  "claude-sonnet-5":   { in: 2,  out: 10, cacheRead: 0.20 },
  "claude-haiku-5-5":  { in: 0.10, out: 0.50, cacheRead: 0.01 },
"claude-haiku-4-5":  { in: 1,  out: 5,  cacheRead: 0.10 },
};
const LABELS = {
  "claude-fable-5-1": "Fable 5.1", "claude-fable-5": "Fable 5", "claude-opus-5-5": "Opus 5.5",
  "claude-opus-5": "Opus 5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-5-5": "Haiku 5.5", "claude-haiku-4-5": "Haiku 4.5",
};
function normModel(m) { return m && m.startsWith("claude-haiku-4-5") ? "claude-haiku-4-5" : m; }
function label(m) { return LABELS[m] || m; }

function cost(model, u) {
  const p = BASE[model];
  if (!p) return null;
  const M = 1e6;
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead +
          u.cw5m * p.in * 1.25 + u.cw1h * p.in * 2) / M;
}

const args = { since: null, until: null, kaynak: null, out: null };
const BAYRAKLAR = { "--since": "since", "--until": "until", "--kaynak": "kaynak", "--out": "out" };
for (let i = 2; i < process.argv.length; i++) {
  let a = process.argv[i], v;
  const esit = a.indexOf("=");
  if (a.startsWith("--") && esit > 0) { v = a.slice(esit + 1); a = a.slice(0, esit); }
  if (!Object.hasOwn(BAYRAKLAR, a)) { console.error(`bilinmeyen argüman: ${process.argv[i]}`); process.exit(1); }
  if (v === undefined) v = process.argv[++i];
  if (v === undefined || v === "" || v.startsWith("--")) { console.error(`${a} için bir değer ver (bulunan: ${v === undefined ? "yok" : v || "boş"})`); process.exit(1); }
  args[BAYRAKLAR[a]] = v;
}
for (const k of ["since", "until"]) {
  if (args[k] != null && Number.isNaN(Date.parse(args[k]))) { console.error(`--${k} geçerli bir ISO tarih/saat değil: ${args[k]}`); process.exit(1); }
}

// Kaynak listesi: Mac + Windows arşivi. Dosya hiç yoksa yalnız ~/.claude/projects (eski davranış);
// dosya bozuksa (geçersiz JSON, eksik alan, aynı "ad" iki kez) hata. Göreli "kok" JSON dosyasının
// dizinine göre çözülür. Listede olup diskte bulunmayan kök uyarıyla atlanır.
const KAYNAK_DOSYASI = path.join(os.homedir(), "Arsiv", "claude-konusmalar", "kaynaklar.json");
function kaynakHatasi(msg) { console.error(`Hata: ${KAYNAK_DOSYASI}: ${msg}`); process.exit(1); }
function kaynaklariOku() {
  let liste = [{ ad: "mac", kok: path.join(os.homedir(), ".claude", "projects") }];
  if (fs.existsSync(KAYNAK_DOSYASI)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(KAYNAK_DOSYASI, "utf8")); } catch (e) { kaynakHatasi(`okunamadı: ${e.message}`); }
    if (!j || !Array.isArray(j.kaynaklar) || !j.kaynaklar.length) kaynakHatasi('"kaynaklar" boş ya da dizi değil');
    const adlar = new Set();
    liste = j.kaynaklar.map(k => {
      if (!k || typeof k.ad !== "string" || !k.ad || typeof k.kok !== "string" || !k.kok) kaynakHatasi('her kaynakta "ad" ve "kok" olmalı');
      if (adlar.has(k.ad)) kaynakHatasi(`"${k.ad}" adı birden çok kez geçiyor`);
      adlar.add(k.ad);
      return { ad: k.ad, kok: path.resolve(path.dirname(KAYNAK_DOSYASI), k.kok.replace(/^~(?=$|[\\/])/, os.homedir())) };
    });
  }
  return liste.filter(k => {
    const mevcut = fs.existsSync(k.kok) && fs.statSync(k.kok).isDirectory();
    if (!mevcut) console.error(`Uyarı: kaynak atlandı, dizin yok: ${k.ad} -> ${k.kok}`);
    return mevcut;
  });
}
let SOURCES = kaynaklariOku();
if (args.kaynak) {
  const adlar = SOURCES.map(k => k.ad);
  SOURCES = SOURCES.filter(k => k.ad === args.kaynak);
  if (!SOURCES.length) { console.error(`--kaynak "${args.kaynak}" bulunamadı. Mevcut: ${adlar.join(", ") || "(yok)"}`); process.exit(1); }
}
if (!SOURCES.length) { console.error("Taranacak kaynak dizini yok."); process.exit(1); }

// since/until: YYYY-MM-DD ise UTC günü bazında (kayıt saatleri UTC; eski --since davranışı), saatli ISO ise anlık karşılaştırma.
const GUN = /^\d{4}-\d{2}-\d{2}$/;
function aralikDisi(ts) {
  if (args.since && (GUN.test(args.since) ? ts.slice(0, 10) < args.since : Date.parse(ts) < Date.parse(args.since))) return true;
  if (args.until && (GUN.test(args.until) ? ts.slice(0, 10) > args.until : Date.parse(ts) > Date.parse(args.until))) return true;
  return false;
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".jsonl")) acc.push(p);
  }
  return acc;
}

// Proje adı: dizin adının son segmenti (diskort iki farklı yolda olabilir -> birleşir).
function projectName(dirKey) {
  const m = dirKey.match(/zProjects-(.+)$/);
  if (m) return m[1];
  if (dirKey.startsWith("C--dev-")) return dirKey.slice(7);
  if (/^(C-)?-Users-[^-]+-ZZ$/.test(dirKey)) return "ZZ (genel)";
  return dirKey;
}

const msgs = new Map();        // message.id -> record
const titles = new Map();      // sessionId -> title
const sessionFirstTs = new Map();
const srcStats = new Map(SOURCES.map(k => [k.ad, { ad: k.ad, kok: k.kok, files: 0 }]));

for (const src of SOURCES) for (const file of walk(src.kok)) {
  srcStats.get(src.ad).files++;
  const rel = path.relative(src.kok, file).split(path.sep);
  const dirKey = rel[0];
  const isSub = rel.includes("subagents");
  const sessionId = isSub ? rel[1] : path.basename(file, ".jsonl");
  const agentId = isSub ? path.basename(file, ".jsonl") : null;
  let agentType = null;
  if (isSub) {
    try { agentType = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType || null; } catch {}
  }
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.includes('"custom-title"')) {
      try { const o = JSON.parse(line); if (o.type === "custom-title" && o.customTitle) titles.set(o.sessionId || sessionId, o.customTitle); } catch {}
      continue;
    }
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message;
    if (!msg || !msg.usage || !msg.model || msg.model === "<synthetic>") continue;
    const ts = o.timestamp || null;
    if (ts && aralikDisi(ts)) continue;
    const u = msg.usage;
    const cc = u.cache_creation || {};
    const cwTotal = u.cache_creation_input_tokens || 0;
    const cw1h = cc.ephemeral_1h_input_tokens || 0;
    const cw5m = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, cwTotal - cw1h);
    const rec = {
      model: normModel(msg.model), project: projectName(dirKey), kaynak: src.ad, sessionId, isSub, agentId, agentType,
      ts, speed: u.speed || "standard",
      input: u.input_tokens || 0, output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0, cw5m, cw1h,
    };
    const key = msg.id || `${file}:${o.uuid}`;
    const prev = msgs.get(key);
    if (!prev) msgs.set(key, rec);
    else for (const f of ["input", "output", "cacheRead", "cw5m", "cw1h"]) prev[f] = Math.max(prev[f], rec[f]);
    if (ts && !isSub) {
      const p = sessionFirstTs.get(sessionId);
      if (!p || ts < p) sessionFirstTs.set(sessionId, ts);
    }
  }
}

// ---- aggregate ----
const zero = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cw5m: 0, cw1h: 0, cost: 0 });
function add(a, r, c) {
  a.calls++; a.input += r.input; a.output += r.output; a.cacheRead += r.cacheRead;
  a.cw5m += r.cw5m; a.cw1h += r.cw1h; a.cost += c || 0;
}
const total = zero();
const byModel = {}, byProject = {}, byDay = {}, bySession = {}, byRole = { ana: zero(), subagent: zero() };
const byAgentType = {};
const bySource = Object.fromEntries([...srcStats.values()].map(k => [k.ad, { ...k, calls: 0, cost: 0, sessions: new Set(), subagents: new Set() }]));
const unpriced = new Set();
const subagents = new Set();
let minTs = null, maxTs = null;

for (const r of msgs.values()) {
  const c = cost(r.model, r);
  if (c == null) unpriced.add(r.model);
  add(total, r, c);
  (byModel[r.model] ??= zero()); add(byModel[r.model], r, c);
  const pj = (byProject[r.project] ??= { all: zero(), models: {} });
  add(pj.all, r, c); (pj.models[r.model] ??= zero()); add(pj.models[r.model], r, c);
  const day = r.ts ? r.ts.slice(0, 10) : "?";
  const d = (byDay[day] ??= { all: zero(), models: {} });
  add(d.all, r, c); (d.models[r.model] ??= zero()); add(d.models[r.model], r, c);
  const s = (bySession[r.sessionId] ??= { project: r.project, all: zero(), models: {}, subCost: 0, subagents: new Set() });
  add(s.all, r, c); (s.models[r.model] ??= zero()); add(s.models[r.model], r, c);
  if (r.isSub) { s.subCost += c || 0; s.subagents.add(r.agentId); subagents.add(r.sessionId + "/" + r.agentId); }
  add(byRole[r.isSub ? "subagent" : "ana"], r, c);
  const sk = bySource[r.kaynak]; sk.calls++; sk.cost += c || 0; sk.sessions.add(r.sessionId); if (r.isSub) sk.subagents.add(r.sessionId + "/" + r.agentId);
  if (r.isSub) { const t = r.agentType || "?"; (byAgentType[t] ??= zero()); add(byAgentType[t], r, c); }
  if (r.ts) { if (!minTs || r.ts < minTs) minTs = r.ts; if (!maxTs || r.ts > maxTs) maxTs = r.ts; }
}

const data = {
  generatedAt: new Date().toISOString(), range: [minTs, maxTs], since: args.since, until: args.until,
  sources: Object.values(bySource).map(k => ({ ad: k.ad, kok: k.kok, files: k.files, calls: k.calls, sessions: k.sessions.size, subagents: k.subagents.size, cost: k.cost })),
  total, byModel, byRole, byAgentType,
  byProject: Object.fromEntries(Object.entries(byProject)),
  byDay, unpriced: [...unpriced],
  sessions: Object.entries(bySession).map(([id, s]) => ({
    id, title: titles.get(id) || null, project: s.project, start: sessionFirstTs.get(id) || null,
    cost: s.all.cost, tokens: s.all.input + s.all.output + s.all.cacheRead + s.all.cw5m + s.all.cw1h,
    output: s.all.output, calls: s.all.calls, subCost: s.subCost, subagents: s.subagents.size,
    models: Object.fromEntries(Object.entries(s.models).map(([m, v]) => [m, v.cost])),
  })).sort((a, b) => b.cost - a.cost),
  counts: { sessions: Object.keys(bySession).length, subagents: subagents.size, messages: msgs.size },
};

// ---- HTML ----
const MODEL_ORDER = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-haiku-4-5", "claude-opus-5", "claude-fable-5"];
const modelsPresent = Object.keys(byModel).sort((a, b) => {
  const ia = MODEL_ORDER.indexOf(a), ib = MODEL_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});
const slot = Object.fromEntries(modelsPresent.map((m, i) => [m, `var(--s${Math.min(i + 1, 8)})`]));

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = v => "$" + (v >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2));
const tok = v => v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(v);
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "–";
const allTok = a => a.input + a.output + a.cacheRead + a.cw5m + a.cw1h;

function stackedRow(models, max, tipPrefix) {
  let segs = "";
  for (const m of modelsPresent) {
    const v = models[m]?.cost ?? models[m] ?? 0;
    if (typeof v !== "number" || v <= 0) continue;
    segs += `<span class="seg" style="width:${(100 * v / max).toFixed(3)}%;background:${slot[m]}" data-tip="${esc(tipPrefix)} · ${esc(label(m))}: ${usd(v)}"></span>`;
  }
  return `<div class="track">${segs}</div>`;
}

const legend = `<div class="legend">${modelsPresent.map(m => `<span><i style="background:${slot[m]}"></i>${esc(label(m))}</span>`).join("")}</div>`;

// Model table
const modelRows = modelsPresent.map(m => {
  const a = byModel[m];
  return `<tr><td><i class="sw" style="background:${slot[m]}"></i>${esc(label(m))}</td><td>${a.calls.toLocaleString("tr-TR")}</td>
<td>${tok(a.input)}</td><td>${tok(a.output)}</td><td>${tok(a.cacheRead)}</td><td>${tok(a.cw5m + a.cw1h)}</td>
<td class="num">${usd(a.cost)}</td><td>${pct(a.cost, total.cost)}</td></tr>`;
}).join("");

const maxModel = Math.max(...modelsPresent.map(m => byModel[m].cost));
const modelBars = modelsPresent.map(m => `<div class="hrow"><div class="hl">${esc(label(m))}</div>
<div class="track"><span class="seg" style="width:${(100 * byModel[m].cost / maxModel).toFixed(2)}%;background:${slot[m]}" data-tip="${esc(label(m))}: ${usd(byModel[m].cost)} · ${tok(allTok(byModel[m]))} token"></span></div>
<div class="hv">${usd(byModel[m].cost)} <small>${pct(byModel[m].cost, total.cost)}</small></div></div>`).join("");

// Projects
const projList = Object.entries(byProject).sort((a, b) => b[1].all.cost - a[1].all.cost);
const maxProj = projList[0]?.[1].all.cost || 1;
const projBars = projList.map(([p, v]) => `<div class="hrow"><div class="hl">${esc(p)}</div>${stackedRow(v.models, maxProj, p)}
<div class="hv">${usd(v.all.cost)} <small>${pct(v.all.cost, total.cost)}</small></div></div>`).join("");

// Days (vertical stacked columns)
const days = Object.keys(byDay).filter(d => d !== "?").sort();
const maxDay = Math.max(...days.map(d => byDay[d].all.cost), 1);
const dayCols = days.map(d => {
  let segs = "";
  for (const m of [...modelsPresent].reverse()) {
    const v = byDay[d].models[m]?.cost || 0;
    if (v <= 0) continue;
    segs += `<span class="vseg" style="height:${(100 * v / maxDay).toFixed(3)}%;background:${slot[m]}" data-tip="${d} · ${esc(label(m))}: ${usd(v)}"></span>`;
  }
  return `<div class="col"><div class="colv">${usd(byDay[d].all.cost)}</div><div class="vtrack">${segs}</div><div class="coll">${d.slice(5).replace("-", ".")}</div></div>`;
}).join("");

// Sessions
const sessRows = data.sessions.slice(0, 25).map((s, i) => `<tr><td>${i + 1}</td>
<td>${esc(s.title || s.id.slice(0, 8))}</td><td>${esc(s.project)}</td><td>${s.start ? s.start.slice(0, 10) : ""}</td>
<td>${s.subagents || ""}</td><td>${tok(s.tokens)}</td><td class="num">${usd(s.cost)}</td>
<td style="min-width:120px">${stackedRow(s.models, data.sessions[0].cost, s.title || s.id.slice(0, 8))}</td></tr>`).join("");

// Roles / agent types
const roleRows = Object.entries(byRole).map(([k, a]) => `<tr><td>${k === "ana" ? "Ana oturum" : "Subagent"}</td><td>${a.calls.toLocaleString("tr-TR")}</td><td>${tok(a.output)}</td><td>${tok(allTok(a))}</td><td class="num">${usd(a.cost)}</td><td>${pct(a.cost, total.cost)}</td></tr>`).join("");
const atRows = Object.entries(byAgentType).sort((a, b) => b[1].cost - a[1].cost).map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.calls.toLocaleString("tr-TR")}</td><td>${tok(a.output)}</td><td class="num">${usd(a.cost)}</td></tr>`).join("");

const cacheShare = pct(total.cacheRead, allTok(total));
const nDays = days.length || 1;

const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Kullanım Özeti</title>
<style>
:root{color-scheme:light;--bg:#fcfcfb;--panel:#fff;--text:#0b0b0b;--muted:#52514e;--border:#e6e4df;--grid:#efeeea;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#4a3aa7;--s8:#e34948}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1a1a19;--panel:#222220;--text:#fff;--muted:#c3c2b7;--border:#3a3a37;--grid:#2c2c2a;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1a1a19;--panel:#222220;--text:#fff;--muted:#c3c2b7;--border:#3a3a37;--grid:#2c2c2a;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#008300;--s7:#9085e9;--s8:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:var(--muted);margin:0 0 20px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.kpi span{color:var(--muted);font-size:12px}
.note{border-left:3px solid var(--s4);padding:8px 12px;background:var(--panel);border-radius:6px;color:var(--muted);font-size:13px;margin-bottom:16px}
.hrow{display:grid;grid-template-columns:150px 1fr 120px;gap:10px;align-items:center;margin:6px 0}.hl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hv{text-align:right;font-variant-numeric:tabular-nums}.hv small,small{color:var(--muted)}
.track{display:flex;gap:2px;height:16px;align-items:stretch}.seg{display:block;height:100%;min-width:2px;border-radius:0}.seg:first-child{border-radius:4px 0 0 4px}.seg:last-child{border-radius:0 4px 4px 0}.seg:only-child{border-radius:4px}
.cols{display:flex;gap:8px;align-items:flex-end;height:240px;border-bottom:1px solid var(--border);overflow-x:auto;padding-top:20px}
.col{flex:1;min-width:34px;display:flex;flex-direction:column;align-items:center;height:100%}.vtrack{flex:1;width:70%;max-width:56px;display:flex;flex-direction:column;justify-content:flex-end;gap:2px}
.vseg{display:block;width:100%;min-height:2px}.vtrack .vseg:first-child{border-radius:4px 4px 0 0}.colv{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.coll{font-size:11px;color:var(--muted);padding:4px 0}
.legend{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 12px;font-size:13px;color:var(--muted)}.legend i,.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:6px 8px;border-bottom:1px solid var(--grid);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:500;font-size:12px}td.num{font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:760px){.grid2{grid-template-columns:1fr}.hrow{grid-template-columns:100px 1fr 90px}}
#tip{position:fixed;pointer-events:none;background:var(--text);color:var(--bg);padding:4px 8px;border-radius:6px;font-size:12px;display:none;z-index:9}
footer{color:var(--muted);font-size:12px}
</style></head><body><main>
<h1>Claude kullanım özeti</h1>
<p class="sub">${esc((minTs || "").slice(0, 10))} → ${esc((maxTs || "").slice(0, 10))} · ${nDays} gün · ${data.counts.sessions} oturum, ${data.counts.subagents} subagent, ${data.counts.messages.toLocaleString("tr-TR")} model çağrısı<br>Kaynaklar: ${data.sources.map(k => `${esc(k.ad)} (${k.files.toLocaleString("tr-TR")} jsonl, ${k.sessions} oturum)`).join(" · ")}${args.since || args.until ? ` · aralık: ${esc(args.since || "…")} → ${esc(args.until || "…")}` : ""}</p>
<div class="note">Max aboneliğinde gerçek ödeme sabit. Buradaki $ değerleri, aynı token'ları API liste fiyatından ödeseydin tutacak <b>eşdeğer maliyet</b> — hangi modelin/projenin limitini ne kadar yediğini karşılaştırmak için.</div>
<div class="kpis">
<div class="kpi"><span>API-eşdeğeri toplam</span><b>${usd(total.cost)}</b></div>
<div class="kpi"><span>Günlük ortalama</span><b>${usd(total.cost / nDays)}</b></div>
<div class="kpi"><span>Toplam token</span><b>${tok(allTok(total))}</b></div>
<div class="kpi"><span>Çıktı token</span><b>${tok(total.output)}</b></div>
<div class="kpi"><span>Önbellekten okunan pay</span><b>${cacheShare}</b></div>
</div>
<section class="card"><h2>Model bazında</h2>${modelBars}
<div class="tw" style="margin-top:14px"><table><thead><tr><th>Model</th><th>Çağrı</th><th>Giriş</th><th>Çıktı</th><th>Önbellek okuma</th><th>Önbellek yazma</th><th>Maliyet</th><th>Pay</th></tr></thead><tbody>${modelRows}</tbody></table></div></section>
<section class="card"><h2>Günlük</h2>${legend}<div class="cols">${dayCols}</div></section>
<section class="card"><h2>Proje bazında</h2>${legend}${projBars}</section>
<div class="grid2">
<section class="card"><h2>Ana oturum vs subagent</h2><div class="tw"><table><thead><tr><th></th><th>Çağrı</th><th>Çıktı</th><th>Token</th><th>Maliyet</th><th>Pay</th></tr></thead><tbody>${roleRows}</tbody></table></div></section>
<section class="card"><h2>Subagent türleri</h2><div class="tw"><table><thead><tr><th>Tür</th><th>Çağrı</th><th>Çıktı</th><th>Maliyet</th></tr></thead><tbody>${atRows}</tbody></table></div></section>
</div>
<section class="card"><h2>En pahalı 25 oturum</h2>${legend}<div class="tw"><table><thead><tr><th>#</th><th>Oturum</th><th>Proje</th><th>Başlangıç</th><th>Subagent</th><th>Token</th><th>Maliyet</th><th>Model dağılımı</th></tr></thead><tbody>${sessRows}</tbody></table></div></section>
<footer>Fiyatlar ($/MTok, giriş/çıktı): Fable 5.1 10/50 · Opus 5.5 4/20 · Sonnet 5.5 ve 5 2/10. Önbellek okuma: Fable 0.25, Opus/Sonnet 0.20; yazma 5 dk = 1.25×, 1 sa = 2× giriş. Kaynak: claude-api skill tablosu (2026-09-25). Aynı mesaj id'si birden çok dosyada geçerse bir kez sayıldı.${unpriced.size ? " Fiyatı olmayan model: " + esc([...unpriced].join(", ")) : ""} Oluşturma: ${esc(data.generatedAt)}</footer>
</main><div id="tip"></div>
<script>
const tip=document.getElementById('tip');
document.addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');if(!t){tip.style.display='none';return}
tip.textContent=t.dataset.tip;tip.style.display='block';const x=Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8);tip.style.left=x+'px';tip.style.top=(e.clientY+14)+'px'});
</script></body></html>`;

const outHtml = args.out || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "usage.html");
fs.mkdirSync(path.dirname(outHtml), { recursive: true });
fs.writeFileSync(outHtml, html);
fs.writeFileSync(outHtml.replace(/\.html$/, ".json"), JSON.stringify(data, null, 2));

console.log(`Toplam (API-eşdeğeri): ${usd(total.cost)} | ${tok(allTok(total))} token | ${data.counts.sessions} oturum | ${data.counts.subagents} subagent`);
console.log("Kaynaklar:");
for (const k of data.sources) console.log(`  ${k.ad.padEnd(8)} ${String(k.files).padStart(5)} jsonl | ${String(k.sessions).padStart(4)} oturum | ${String(k.subagents).padStart(4)} subagent | ${usd(k.cost).padStart(9)} | ${k.kok}`);
for (const m of modelsPresent) console.log(`  ${label(m).padEnd(11)} ${usd(byModel[m].cost).padStart(9)}  ${pct(byModel[m].cost, total.cost).padStart(6)}  çıktı ${tok(byModel[m].output)}`);
console.log("Yazıldı:", outHtml);

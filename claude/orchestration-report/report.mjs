#!/usr/bin/env node
// Orchestration and agent-flow report generator for Claude Code sessions.
//
// Reads a main session transcript (.jsonl) plus its subagent transcripts
// (subagents/agent-<id>.jsonl + .meta.json), computes token usage, cost,
// timeline and communication-flow data, and writes a single self-contained
// HTML report (Turkish UI text) plus a sibling JSON data dump.
//
// Usage:
//   node report.mjs [--session <id>] [--project <projectDirName>] [--out <file.html>]
//
// Oturumlar birden çok kaynak kökünde aranır (~/Arsiv/claude-konusmalar/kaynaklar.json:
// Mac + Windows arşivi; dosya yoksa yalnız ~/.claude/projects). Argümansız çalışınca yalnız
// listenin ilk (canlı) kaynağındaki en yeni oturum dosyası seçilir.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Pricing (API list prices). Source noted here for auditability.
//
// Base input/output prices: claude-api skill's cached pricing table
// (cached 2026-06-24, Anthropic first-party API list prices).
//   claude-opus-5-5:  $4.00 / $20.00 per MTok (in/out), cache read $0.20/MTok
//                      (given directly by the skill).
//   claude-sonnet-5:  $2.00 / $10.00 per MTok (in/out).
// Cache WRITE prices are not itemized per-model by the skill; Anthropic's
// published standard ratios were applied: 5-minute ephemeral write = 1.25x
// base input price, 1-hour ephemeral write = 2x base input price.
// claude-sonnet-5's cache READ price is likewise not itemized; the standard
// 0.1x-of-input ratio was applied, which happens to also land on $0.20/MTok.
// ---------------------------------------------------------------------------
const PRICES = {
  "claude-opus-5-5": { in: 4.00, out: 20.00, cacheRead: 0.20, cacheWrite5m: 5.00, cacheWrite1h: 8.00 },
  "claude-sonnet-5": { in: 2.00, out: 10.00, cacheRead: 0.20, cacheWrite5m: 2.50, cacheWrite1h: 4.00 },
};
const PRICE_SOURCE =
  "Kaynak: claude-api skill fiyat tablosu (önbelleğe alınma tarihi: 2026-06-24, Anthropic ilk taraf API liste fiyatları). " +
  "Opus 5.5 önbellek OKUMA fiyatı ($0.20/MTok) skill tarafından doğrudan verildi. Önbellek YAZMA fiyatları ve Sonnet 5 " +
  "önbellek okuma fiyatı, Anthropic'in standart oranları uygulanarak türetildi (5 dk yazma = giriş fiyatının 1.25 katı, " +
  "1 sa yazma = 2 katı, okuma = 0.1 katı).";
const MODEL_LABELS = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5": "Sonnet 5" };
const MODEL_COLORS = { "claude-opus-5-5": "#b8622f", "claude-sonnet-5": "#3f6fb0", "unknown": "#8a8a8a" };

function modelLabel(m) { return MODEL_LABELS[m] || m || "bilinmeyen"; }
function modelColor(m) { return MODEL_COLORS[m] || MODEL_COLORS.unknown; }
// Sonnet 5.5 için ayrı liste fiyatı elde yok; Sonnet 5 fiyatı varsayıldı (tahmin).
const PRICE_ALIASES = { "claude-sonnet-5-5": "claude-sonnet-5" };
function priceFor(model) { return PRICES[model] || PRICES[PRICE_ALIASES[model]] || null; }

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { session: null, project: null, out: null };
  const BAYRAKLAR = { "--session": "session", "--project": "project", "--out": "out" };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], v;
    const esit = a.indexOf("=");
    if (a.startsWith("--") && esit > 0) { v = a.slice(esit + 1); a = a.slice(0, esit); }
    if (!Object.hasOwn(BAYRAKLAR, a)) { console.error(`bilinmeyen argüman: ${argv[i]}`); process.exit(1); }
    if (v === undefined) v = argv[++i];
    if (v === undefined || v === "" || v.startsWith("--")) { console.error(`${a} için bir değer ver`); process.exit(1); }
    args[BAYRAKLAR[a]] = v;
  }
  return args;
}

// Kaynak listesi: Mac + Windows arşivi. Dosya hiç yoksa yalnız ~/.claude/projects (eski davranış);
// dosya bozuksa (geçersiz JSON, eksik alan, aynı "ad" iki kez) hata. Göreli "kok" JSON dosyasının
// dizinine göre çözülür. Listenin İLK kaynağı canlı olandır (mac); diskte olmayan kök uyarıyla atlanır.
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
  for (const k of liste) {
    k.var = fs.existsSync(k.kok) && fs.statSync(k.kok).isDirectory();
    if (!k.var) console.error(`Uyarı: kaynak atlandı, dizin yok: ${k.ad} -> ${k.kok}`);
  }
  return liste;
}
const TUM_KAYNAKLAR = kaynaklariOku();
const CANLI = TUM_KAYNAKLAR[0];                       // listenin ilki: canlı kaynak
const SOURCES = TUM_KAYNAKLAR.filter(k => k.var);

// Kaynakların proje dizinleri (kaynak sırasıyla). explicit verilirse yalnız o ada sahip olanlar.
function projeDizinleri(explicit, kaynaklar = SOURCES) {
  const out = [];
  for (const k of kaynaklar) {
    if (explicit) {
      const p = path.join(k.kok, explicit);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) out.push({ p, mtime: fs.statSync(p).mtimeMs, kaynak: k.ad });
      continue;
    }
    for (const d of fs.readdirSync(k.kok, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(k.kok, d.name);
      out.push({ p, mtime: fs.statSync(p).mtimeMs, kaynak: k.ad });
    }
  }
  return out;
}

const kaynakAdlari = () => SOURCES.map(k => `${k.ad} (${k.kok})`).join(", ") || "(kaynak yok)";

// Verilen proje dizinlerindeki en son değişen oturum dosyası ({projectDir, sessionId, mtime, kaynak}) ya da null.
function enYeniOturum(dizinler) {
  let en = null;
  for (const d of dizinler) {
    for (const f of fs.readdirSync(d.p)) {
      if (!f.endsWith(".jsonl")) continue;
      const mtime = fs.statSync(path.join(d.p, f)).mtimeMs;
      if (!en || mtime > en.mtime) en = { projectDir: d.p, sessionId: f.replace(/\.jsonl$/, ""), mtime, kaynak: d.kaynak };
    }
  }
  return en;
}

// Proje dizini + oturum kimliğini kaynaklar üzerinden çözer.
//  --session: id.jsonl dosyasını (verilmişse yalnız --project'in) dizinlerinde, bütün kaynaklarda arar;
//             birden çok kaynakta varsa uyarır, listedeki ilk kaynak kazanır.
//  yalnız --project: o proje dizinindeki (hangi kaynakta varsa) dosya zamanına göre en yeni .jsonl.
//  hiçbiri: YALNIZ canlı kaynakta (kaynaklar.json'daki ilk giriş; dosya yoksa mac), bütün proje
//           dizinleri içinde dosya zamanına göre en yeni .jsonl. Arşiv kaynaklarına düşülmez; canlı
//           kök yoksa ya da .jsonl içermiyorsa hata verilir.
function resolveSession(args) {
  if (!args.session && !args.project) {
    if (!CANLI.var) throw new Error(`Canlı kaynak (${CANLI.ad}: ${CANLI.kok}) yok; arşivdeki bir oturum için --session <id> ya da --project <dizin> ver.`);
    const o = enYeniOturum(projeDizinleri(null, [CANLI]));
    if (!o) throw new Error(`Canlı kaynakta (${CANLI.ad}: ${CANLI.kok}) hiç .jsonl oturumu yok; --session <id> ya da --project <dizin> ver.`);
    return { projectDir: o.projectDir, sessionId: o.sessionId };
  }
  const projeler = projeDizinleri(args.project);
  if (!projeler.length) {
    throw new Error((args.project ? "Proje dizini bulunamadı: " + args.project : "Hiç proje dizini bulunamadı") + " | kaynaklar: " + kaynakAdlari());
  }
  if (args.session) {
    const bulunanlar = projeler.filter(d => fs.existsSync(path.join(d.p, args.session + ".jsonl")));
    if (!bulunanlar.length) throw new Error("Oturum bulunamadı: " + args.session + (args.project ? " (proje " + args.project + ")" : "") + " | kaynaklar: " + kaynakAdlari());
    if (bulunanlar.length > 1) {
      console.error(`Uyarı: ${args.session} oturumu birden çok kaynakta var, ilki kullanılıyor: ` +
        bulunanlar.map(d => `${d.kaynak} (${d.p})`).join(" | "));
    }
    return { projectDir: bulunanlar[0].p, sessionId: args.session };
  }
  const o = enYeniOturum(projeler);
  if (!o) throw new Error("Proje dizininde .jsonl oturum dosyası yok: " + projeler.map(d => d.p).join(", "));
  return { projectDir: o.projectDir, sessionId: o.sessionId };
}

// ---------------------------------------------------------------------------
// Redaction / excerpting - transcripts are read-only input, never print secrets.
// ---------------------------------------------------------------------------
function redact(text) {
  if (!text) return "";
  let out = String(text);
  // Sırayla: PEM ve Bearer, sonra özgül kalıplar (JWT, URL içi kimlik, sağlayıcı anahtarları, parola
  // ve anahtar atamaları), en son genel kurallar (sk-ant/ghp_/xox, HEX, base64). Tekrarlar sınırlı ve
  // PEM gövdesi bir sonraki BEGIN'de durur: 400 KB patolojik girdide bile doğrusal kalır. '/' içeren
  // genel base64 kuralı bilerek yok (dosya yollarını bozar).
  out = out.replace(/-----BEGIN [^-\n]{1,64}-----(?:(?!-----BEGIN )[\s\S])*?-----END [^-\n]{1,64}-----/g, "[REDACTED:PEM]");
  out = out.replace(/Bearer\s+[A-Za-z0-9\-_.=]+/gi, "Bearer [REDACTED]");
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[REDACTED:JWT]");
  out = out.replace(/(\b[a-z][a-z0-9+.-]{1,15}:\/\/)[^\s\/:@]+:[^\s\/@]+@/gi, "$1[REDACTED:CRED]@");
  out = out.replace(/\b(?:A(?:KIA|SIA|GPA|IDA|ROA|NPA|NVA|IPA)[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{35}|gl(?:pat|dt|ptt|rt|oas|soat)-[0-9A-Za-z_-]{16,}|[sprw]k_(?:live|test)_[0-9A-Za-z]{16,}|whsec_[0-9A-Za-z]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|ya29\.[0-9A-Za-z_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})(?![A-Za-z0-9_-])/g, "[REDACTED:KEY]");
  // Parola / gizli anahtar atamaları. Değer $DEGISKEN, <yer-tutucu>, {…}, [REDACTED…] ya da **** ise dokunulmaz.
  const OZEL = String.raw`(?!\$[A-Za-z_{(]|[<{(\[*%])`;
  out = out.replace(new RegExp(String.raw`((?:password|passwd|passphrase|[şs]ifre|parola)\w{0,40}["']?[ \t]*[:=][ \t]*|MYSQL_PWD=|--(?:password|passwd)[= ])(["']?)` + OZEL + String.raw`(?=[^\s"'\`]{0,200}[0-9!@#$%^&*+=/-])[^\s"'\`(){}<>]{6,200}`, "gi"), "$1$2[REDACTED:PW]");
  out = out.replace(new RegExp(String.raw`((?:secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?key)\w{0,40}["']?[ \t]*[:=][ \t]*)(["']?)` + OZEL + String.raw`(?=[^\s"'\`=]{0,200}\d)(?=[^\s"'\`=]{0,200}[A-Za-z])[^\s"'\`(){}<>=]{12,200}=*`, "gi"), "$1$2[REDACTED:SECRET]");
  out = out.replace(/\b(sk-ant-[A-Za-z0-9\-_]{10,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, "[REDACTED:KEY]");
  out = out.replace(/\b[0-9a-fA-F]{32,}\b/g, "[REDACTED:HEX]");
  // Base64/token benzeri diziler: '/' ya da '\' yok (yol parçası eşleşmesin), en az 40 karakter,
  // '=' dolgusu ya da büyük+küçük+rakam karışımı (gerçek token/sırlar böyle görünür).
  out = out.replace(/\b[A-Za-z0-9+=_-]{40,}\b/g, m => {
    const hasPad = m.includes("=");
    const mixed = /[a-z]/.test(m) && /[A-Z]/.test(m) && /[0-9]/.test(m);
    return (hasPad || mixed) ? "[REDACTED:B64]" : m;
  });
  return out;
}
function excerpt(text, max = 600) {
  const r = redact(text);
  if (r.length <= max) return r;
  return r.slice(0, max) + "...";
}
// Task-notification/agent-message frames are harness-generated XML-ish text
// that already comes HTML-entity-escaped (e.g. "&amp;" for a literal "&" in
// an agent description). Decode before our own esc() runs, or entities
// double-escape into "&amp;amp;".
function decodeEntities(s) {
  return String(s ?? "").replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, m => ({
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  }[m]));
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtInt(n) { return Math.round(n || 0).toLocaleString("tr-TR"); }
function fmtMoney(n) { return "$" + (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDur(ms) {
  if (!ms || ms < 0) return "0 sn";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + " sn";
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m} dk ${rs} sn`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h} sa ${rm} dk`;
}

// ---------------------------------------------------------------------------
// JSONL reading
// ---------------------------------------------------------------------------
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cost / context helpers
// ---------------------------------------------------------------------------
function usageCalc(model, u) {
  const p = priceFor(model);
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens || 0);
  const w1 = cc.ephemeral_1h_input_tokens ?? 0;
  const input = u.input_tokens || 0;
  const read = u.cache_read_input_tokens || 0;
  const output = u.output_tokens || 0;
  const context = input + w5 + w1 + read;
  let cost = null;
  if (p) {
    cost = (input / 1e6) * p.in + (w5 / 1e6) * p.cacheWrite5m + (w1 / 1e6) * p.cacheWrite1h +
      (read / 1e6) * p.cacheRead + (output / 1e6) * p.out;
  }
  return { input, cacheW5m: w5, cacheW1h: w1, cacheRead: read, output, context, cost };
}

// ---------------------------------------------------------------------------
// Transcript scanning - generic, used for both main session and subagents.
// ---------------------------------------------------------------------------
function scanTranscript(lines) {
  const seenRequests = new Set();
  const requests = []; // {ts, requestId, model, usage, calc}
  const toolTally = {};
  const errors = [];
  const denials = [];
  const compactions = [];
  const agentSpawns = [];
  const sendMessages = [];
  const handbacks = [];
  const humanMessages = [];
  let firstTs = null, lastTs = null;

  for (const o of lines) {
    if (o.timestamp) { if (!firstTs) firstTs = o.timestamp; lastTs = o.timestamp; }

    if (o.type === "assistant" && o.message) {
      const model = o.message.model;
      const rid = o.requestId;
      if (rid && o.message.usage) {
        if (!seenRequests.has(rid)) {
          seenRequests.add(rid);
          requests.push({ ts: o.timestamp, requestId: rid, model, usage: o.message.usage, calc: usageCalc(model, o.message.usage) });
        } else {
          // Aynı istek birden çok satıra yayılır; ilk satırdaki output_tokens kısmidir.
          // Çıkışı en büyük (son) değerle güncelle.
          const r = requests.find(x => x.requestId === rid);
          if (r && (o.message.usage.output_tokens || 0) > (r.usage.output_tokens || 0)) {
            r.usage = { ...r.usage, output_tokens: o.message.usage.output_tokens };
            r.calc = usageCalc(r.model, r.usage);
          }
        }
      }
      const content = o.message.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_use") {
            toolTally[b.name] = (toolTally[b.name] || 0) + 1;
            if (b.name === "Agent") agentSpawns.push({ id: b.id, input: b.input, ts: o.timestamp });
            if (b.name === "SendMessage") sendMessages.push({ id: b.id, input: b.input, ts: o.timestamp });
            if (b.name === "SubagentHandback") handbacks.push({ id: b.id, input: b.input, ts: o.timestamp });
          }
        }
      }
    } else if (o.type === "user") {
      const content = o.message && o.message.content;
      if (typeof content === "string" && !o.isMeta) {
        const trimmed = content.trimStart();
        if (trimmed.startsWith("<task-notification>")) {
          // Represented separately via the main session's queue-operation
          // notifications (extractQueueEvents) as system->main edges; not a
          // human message and not a Gantt tick.
        } else if (
          trimmed.startsWith("<agent-message") ||
          trimmed.startsWith("Another Claude session sent a message") ||
          trimmed.startsWith("<local-command-caveat>") ||
          trimmed.startsWith("<local-command-stdout>")
        ) {
          // Harness-injected framing, already represented elsewhere
          // (hand-back rows) or not meaningful on its own — drop.
        } else if (trimmed.startsWith("<command-name>")) {
          const name = (trimmed.match(/<command-name>([^<]*)<\/command-name>/) || [])[1] || "";
          humanMessages.push({ ts: o.timestamp, text: `Kullanıcı komutu: ${name}`.trim() });
        } else {
          const stripped = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
          if (stripped) humanMessages.push({ ts: o.timestamp, text: stripped });
        }
      } else if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_result") {
            const txt = typeof b.content === "string" ? b.content : JSON.stringify(b.content || "");
            if (b.is_error) {
              if (/permission.*denied|denied by/i.test(txt)) denials.push({ ts: o.timestamp, text: txt });
              else errors.push({ ts: o.timestamp, text: txt });
            }
          }
        }
      }
    } else if (o.type === "system" && o.subtype === "compact_boundary") {
      compactions.push({ ts: o.timestamp });
    }
  }
  return { requests, toolTally, errors, denials, compactions, agentSpawns, sendMessages, handbacks, humanMessages, firstTs, lastTs };
}

// Main-session-only: queue-operation entries carrying <task-notification> and
// <agent-message from="..."> (subagent hand-back) frames.
function extractQueueEvents(lines) {
  const notifications = [];
  const agentMessages = [];
  for (const o of lines) {
    if (o.type === "queue-operation" && o.operation === "enqueue" && typeof o.content === "string") {
      const c = o.content;
      if (c.includes("<task-notification>")) {
        const g = re => (c.match(re) || [])[1];
        notifications.push({
          ts: o.timestamp,
          taskId: g(/<task-id>([^<]+)<\/task-id>/),
          status: g(/<status>([^<]+)<\/status>/),
          summary: decodeEntities(g(/<summary>([^<]+)<\/summary>/)),
          subagentTokens: +g(/<subagent_tokens>(\d+)<\/subagent_tokens>/) || 0,
          toolUses: +g(/<tool_uses>(\d+)<\/tool_uses>/) || 0,
          durationMs: +g(/<duration_ms>(\d+)<\/duration_ms>/) || 0,
        });
      } else if (c.includes("<agent-message")) {
        const agentId = (c.match(/<agent-message from="([^"]+)"/) || [])[1];
        agentMessages.push({ ts: o.timestamp, agentId, text: c });
      }
    }
  }
  return { notifications, agentMessages };
}

function aggregateTokens(requestsList) {
  const byModel = {};
  let cost = 0, hasUnknownPricing = false;
  for (const r of requestsList) {
    const m = r.model || "unknown";
    if (!byModel[m]) byModel[m] = { input: 0, cacheW5m: 0, cacheW1h: 0, cacheRead: 0, output: 0, calls: 0, cost: 0 };
    const b = byModel[m];
    b.input += r.calc.input; b.cacheW5m += r.calc.cacheW5m; b.cacheW1h += r.calc.cacheW1h;
    b.cacheRead += r.calc.cacheRead; b.output += r.calc.output; b.calls += 1;
    if (r.calc.cost != null) { b.cost += r.calc.cost; cost += r.calc.cost; }
    else hasUnknownPricing = true;
  }
  return { byModel, cost, hasUnknownPricing };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const { projectDir, sessionId } = resolveSession(args);
  const projectName = path.basename(projectDir);
  const mainFile = path.join(projectDir, sessionId + ".jsonl");
  const sessionDir = path.join(projectDir, sessionId);
  const subagentsDir = path.join(sessionDir, "subagents");

  if (!fs.existsSync(mainFile)) throw new Error("Oturum dosyası bulunamadı: " + mainFile);

  const mainLines = readJsonl(mainFile);
  const mainScan = scanTranscript(mainLines);
  const queueEvents = extractQueueEvents(mainLines);

  let title = sessionId;
  for (const o of mainLines) if (o.type === "custom-title" && o.customTitle) title = o.customTitle;

  const mainSpawnsByToolUseId = {};
  for (const s of mainScan.agentSpawns) mainSpawnsByToolUseId[s.id] = s;

  const agents = [];
  if (fs.existsSync(subagentsDir)) {
    const metaFiles = fs.readdirSync(subagentsDir).filter(f => f.endsWith(".meta.json"));
    for (const mf of metaFiles) {
      const agentFileId = mf.replace(/^agent-/, "").replace(/\.meta\.json$/, "");
      const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, mf), "utf8"));
      const jsonlPath = path.join(subagentsDir, mf.replace(/\.meta\.json$/, ".jsonl"));
      const lines = readJsonl(jsonlPath);
      const scan = scanTranscript(lines);
      const spawn = mainSpawnsByToolUseId[meta.toolUseId] || null;

      const startTs = spawn ? spawn.ts : scan.firstTs;
      const endTs = scan.lastTs || startTs;
      const durationMs = (startTs && endTs) ? (new Date(endTs) - new Date(startTs)) : 0;

      const agg = aggregateTokens(scan.requests);
      const contextSeries = scan.requests.map(r => r.calc.context);
      const peakContext = contextSeries.length ? Math.max(...contextSeries) : 0;
      const finalContext = contextSeries.length ? contextSeries[contextSeries.length - 1] : 0;

      const modelsUsed = [...new Set(scan.requests.map(r => r.model).filter(Boolean))];
      let dominantModel = modelsUsed[0] || null;
      if (modelsUsed.length > 1) {
        let best = -1;
        for (const m of modelsUsed) {
          const b = agg.byModel[m];
          const t = b ? (b.input + b.cacheW5m + b.cacheW1h + b.cacheRead + b.output) : 0;
          if (t > best) { best = t; dominantModel = m; }
        }
      }

      const notif = queueEvents.notifications.filter(n => n.taskId === agentFileId).pop() || null;
      const lastHandback = scan.handbacks.length ? scan.handbacks[scan.handbacks.length - 1] : null;
      const handbackText = lastHandback && lastHandback.input ? lastHandback.input.message : null;

      const compacted = scan.compactions.length > 0;
      const denials = scan.denials.length;
      const errors = scan.errors.length;
      const hasHandback = scan.handbacks.length > 0;
      // A hand-back means the agent finished and reported back — that alone
      // is "Tamamlandı". Errors/denials/compaction along the way are common
      // and not by themselves a failure; they're surfaced as separate badges
      // next to the status instead of overriding it.
      let status;
      if (hasHandback) status = { label: "Tamamlandı", code: "completed" };
      else status = { label: "Yarım kaldı / final metin yok", code: "interrupted" };

      agents.push({
        id: agentFileId,
        agentType: meta.agentType || "?",
        description: meta.description || (spawn && spawn.input && spawn.input.description) || "(açıklama yok)",
        requestedModel: meta.model || (spawn && spawn.input && spawn.input.model) || "(devralınan)",
        dominantModel,
        modelsUsed,
        background: !!(spawn && spawn.input && spawn.input.run_in_background),
        isolation: (spawn && spawn.input && spawn.input.isolation) || null,
        worktreePath: meta.worktreePath || null,
        worktreeBranch: meta.worktreeBranch || null,
        spawnDepth: meta.spawnDepth ?? null,
        toolUseId: meta.toolUseId,
        startTs, endTs, durationMs,
        prompt: (spawn && spawn.input && spawn.input.prompt) || null,
        handbackText,
        toolTally: scan.toolTally,
        toolCallCount: Object.values(scan.toolTally).reduce((a, b) => a + b, 0),
        agg, contextSeries, peakContext, finalContext,
        errors: scan.errors, denials: scan.denials, compactions: scan.compactions,
        status,
        notif,
        nestedSpawns: scan.agentSpawns,
      });
    }
  }
  agents.sort((a, b) => new Date(a.startTs || 0) - new Date(b.startTs || 0));

  const mainAgg = aggregateTokens(mainScan.requests);
  const mainContextSeries = mainScan.requests.map(r => r.calc.context);
  const mainPeakContext = mainContextSeries.length ? Math.max(...mainContextSeries) : 0;
  const mainFinalContext = mainContextSeries.length ? mainContextSeries[mainContextSeries.length - 1] : 0;

  const grandByModel = {};
  function foldInto(target, byModel) {
    for (const [m, b] of Object.entries(byModel)) {
      if (!target[m]) target[m] = { input: 0, cacheW5m: 0, cacheW1h: 0, cacheRead: 0, output: 0, calls: 0, cost: 0 };
      const t = target[m];
      t.input += b.input; t.cacheW5m += b.cacheW5m; t.cacheW1h += b.cacheW1h;
      t.cacheRead += b.cacheRead; t.output += b.output; t.calls += b.calls; t.cost += b.cost;
    }
  }
  foldInto(grandByModel, mainAgg.byModel);
  for (const a of agents) foldInto(grandByModel, a.agg.byModel);
  const totalCost = Object.values(grandByModel).reduce((s, b) => s + b.cost, 0);
  const mainCost = mainAgg.cost;
  const agentsCost = totalCost - mainCost;

  const intervals = agents.filter(a => a.startTs && a.endTs).map(a => [new Date(a.startTs).getTime(), new Date(a.endTs).getTime()]);
  let parallelPeak = 0;
  if (intervals.length) {
    const evs = [];
    for (const [s, e] of intervals) { evs.push([s, 1]); evs.push([e, -1]); }
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    for (const [, delta] of evs) { cur += delta; if (cur > parallelPeak) parallelPeak = cur; }
  }
  const totalAgentWallMs = agents.reduce((s, a) => s + (a.durationMs || 0), 0);

  const edges = [];
  for (const h of mainScan.humanMessages) {
    edges.push({ ts: h.ts, kind: "user->main", detail: excerpt(h.text), len: (h.text || "").length });
  }
  for (const a of agents) {
    edges.push({
      ts: a.startTs, kind: "main->agent", agent: a.description, agentId: a.id,
      detail: excerpt(a.prompt), len: (a.prompt || "").length, model: a.requestedModel,
      background: a.background, isolation: a.isolation,
    });
    if (a.handbackText) {
      edges.push({
        ts: a.endTs, kind: "agent->main", agent: a.description, agentId: a.id,
        detail: excerpt(a.handbackText), len: (a.handbackText || "").length,
      });
    }
  }
  for (const sm of mainScan.sendMessages) {
    const to = (sm.input && (sm.input.to || sm.input.id || sm.input.agent)) || "?";
    const msg = (sm.input && (sm.input.message || sm.input.prompt || sm.input.text)) || JSON.stringify(sm.input || {});
    edges.push({ ts: sm.ts, kind: "main->agent(SendMessage)", agent: String(to), detail: excerpt(msg), len: String(msg).length });
  }
  // Task-notifications ("<agent> finished") are system-generated, not a human
  // message and not a hand-back duplicate — their own edge kind.
  for (const n of queueEvents.notifications) {
    edges.push({ ts: n.ts, kind: "system->main", summary: excerpt(n.summary || "", 300), taskId: n.taskId });
  }
  edges.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));

  const events = [];
  for (const d of mainScan.denials) events.push({ ts: d.ts, actor: "Ana oturum", type: "İzin reddi", detail: excerpt(d.text, 300) });
  for (const e of mainScan.errors) events.push({ ts: e.ts, actor: "Ana oturum", type: "Araç hatası", detail: excerpt(e.text, 300) });
  for (const c of mainScan.compactions) events.push({ ts: c.ts, actor: "Ana oturum", type: "Compaction", detail: "" });
  for (const a of agents) {
    for (const d of a.denials) events.push({ ts: d.ts, actor: a.description, type: "İzin reddi", detail: excerpt(d.text, 300) });
    for (const e of a.errors) events.push({ ts: e.ts, actor: a.description, type: "Araç hatası", detail: excerpt(e.text, 300) });
    for (const c of a.compactions) events.push({ ts: c.ts, actor: a.description, type: "Compaction", detail: "" });
  }
  events.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));

  const nestedSpawnNotes = [];
  for (const a of agents) {
    if (a.nestedSpawns && a.nestedSpawns.length) {
      nestedSpawnNotes.push({ from: a.description, count: a.nestedSpawns.length });
    }
  }

  const data = {
    projectName, sessionId, title,
    span: { start: mainScan.firstTs, end: mainScan.lastTs },
    priceSource: PRICE_SOURCE,
    prices: PRICES,
    main: {
      byModel: mainAgg.byModel, cost: mainCost, hasUnknownPricing: mainAgg.hasUnknownPricing,
      contextSeries: mainContextSeries, peakContext: mainPeakContext, finalContext: mainFinalContext,
      toolTally: mainScan.toolTally, toolCallCount: Object.values(mainScan.toolTally).reduce((a, b) => a + b, 0),
      denials: mainScan.denials.length, errors: mainScan.errors.length, compactions: mainScan.compactions.length,
      humanMessageCount: mainScan.humanMessages.length,
    },
    agents: agents.map(a => ({
      id: a.id, agentType: a.agentType, description: a.description, requestedModel: a.requestedModel,
      dominantModel: a.dominantModel, modelsUsed: a.modelsUsed, background: a.background, isolation: a.isolation,
      worktreePath: a.worktreePath, worktreeBranch: a.worktreeBranch, spawnDepth: a.spawnDepth,
      startTs: a.startTs, endTs: a.endTs, durationMs: a.durationMs,
      toolTally: a.toolTally, toolCallCount: a.toolCallCount,
      byModel: a.agg.byModel, cost: a.agg.cost, hasUnknownPricing: a.agg.hasUnknownPricing,
      contextSeries: a.contextSeries, peakContext: a.peakContext, finalContext: a.finalContext,
      errors: a.errors.length, denials: a.denials.length, compactions: a.compactions.length,
      status: a.status,
      notif: a.notif,
    })),
    totals: { grandByModel, totalCost, mainCost, agentsCost, parallelPeak, totalAgentWallMs, agentCount: agents.length },
    edgesCount: edges.length, eventsCount: events.length,
  };

  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const outDir = path.join(scriptDir, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outHtml = args.out || path.join(outDir, sessionId + ".html");
  const outJson = outHtml.replace(/\.html$/, ".json");

  fs.writeFileSync(outJson, JSON.stringify(data, null, 2), "utf8");

  const html = renderHtml({ data, agents, mainScan, edges, events, nestedSpawnNotes });
  fs.writeFileSync(outHtml, html, "utf8");

  console.log("HTML rapor yazıldı: " + outHtml);
  console.log("JSON veri yazıldı: " + outJson);
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------
function sparklineSvg(series, color, w = 180, h = 36) {
  if (!series.length) return `<svg viewBox="0 0 ${w} ${h}" class="spark"><text x="4" y="${h / 2}" class="spark-empty">veri yok</text></svg>`;
  const max = Math.max(...series, 1);
  const min = 0;
  const n = series.length;
  const pts = series.map((v, i) => {
    const x = n === 1 ? w / 2 : (i / (n - 1)) * (w - 4) + 2;
    const y = h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" />
    <title>Bağlam boyutu (giriş+önbellek): ${series.map(fmtInt).join(", ")}</title>
  </svg>`;
}

function ganttSvg(lanes, spanStart, spanEnd) {
  const w = 900, rowH = 26, pad = 4, leftW = 220;
  const h = lanes.length * rowH + 20;
  const t0 = new Date(spanStart).getTime(), t1 = new Date(spanEnd).getTime();
  const span = Math.max(1, t1 - t0);
  const xOf = ts => leftW + ((new Date(ts).getTime() - t0) / span) * (w - leftW - 10);
  let rows = "";
  lanes.forEach((lane, i) => {
    const y = 10 + i * rowH;
    const x1 = xOf(lane.start), x2 = xOf(lane.end);
    const barW = Math.max(2, x2 - x1);
    rows += `<text x="4" y="${y + rowH / 2 + 4}" class="gantt-label">${esc(lane.label)}</text>`;
    rows += `<rect x="${x1.toFixed(1)}" y="${y + 4}" width="${barW.toFixed(1)}" height="${rowH - pad * 2}" rx="3" fill="${lane.color}" opacity="0.88"><title>${esc(lane.title)}</title></rect>`;
    if (lane.ticks) {
      for (const tk of lane.ticks) {
        const x = xOf(tk);
        rows += `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${y + rowH - 2}" stroke="var(--tick)" stroke-width="1.5" />`;
      }
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="gantt" preserveAspectRatio="xMinYMin meet">${rows}</svg>`;
}

function renderHtml({ data, agents, mainScan, edges, events, nestedSpawnNotes }) {
  const startFmt = data.span.start ? new Date(data.span.start).toLocaleString("tr-TR") : "?";
  const endFmt = data.span.end ? new Date(data.span.end).toLocaleString("tr-TR") : "?";

  const modelRows = Object.entries(data.totals.grandByModel).map(([m, b]) => `
    <tr>
      <td><span class="dot" style="background:${modelColor(m)}"></span>${esc(modelLabel(m))}</td>
      <td>${fmtInt(b.input)}</td>
      <td>${fmtInt(b.cacheW5m + b.cacheW1h)}</td>
      <td>${fmtInt(b.cacheRead)}</td>
      <td>${fmtInt(b.output)}</td>
      <td>${fmtInt(b.calls)}</td>
      <td>${fmtMoney(b.cost)}</td>
    </tr>`).join("");

  const lanes = [];
  lanes.push({
    label: "Ana oturum",
    start: data.span.start, end: data.span.end,
    color: modelColor(Object.keys(data.main.byModel)[0] || "unknown"),
    title: `Ana oturum - ${startFmt} -> ${endFmt}`,
    ticks: mainScan.humanMessages.map(h => h.ts),
  });
  for (const a of agents) {
    if (!a.startTs || !a.endTs) continue;
    lanes.push({
      label: a.description.length > 26 ? a.description.slice(0, 25) + "..." : a.description,
      start: a.startTs, end: a.endTs,
      color: modelColor(a.dominantModel),
      title: `${a.description} - ${modelLabel(a.dominantModel)} - ${fmtDur(a.durationMs)}`,
    });
  }
  const ganttHtml = ganttSvg(lanes, data.span.start, data.span.end);

  const agentRows = agents.map(a => {
    const byModelStr = Object.entries(a.agg.byModel).map(([m, b]) =>
      `${modelLabel(m)}: ${fmtInt(b.input)}/${fmtInt(b.cacheW5m + b.cacheW1h)}/${fmtInt(b.cacheRead)}/${fmtInt(b.output)}`
    ).join("<br>");
    const toolStr = Object.entries(a.toolTally).sort((x, y) => y[1] - x[1])
      .map(([n, c]) => `${esc(n)}×${c}`).join(", ");
    const notifStr = a.notif
      ? `bildirim: ${fmtInt(a.notif.subagentTokens)} tok, ${a.notif.toolUses} araç, ${fmtDur(a.notif.durationMs)}`
      : "(bildirim yok)";
    const extraBadges = [];
    if (a.errors.length) extraBadges.push(`<span class="badge badge-error">${a.errors.length} araç hatası</span>`);
    if (a.denials.length) extraBadges.push(`<span class="badge badge-denied">${a.denials.length} izin reddi</span>`);
    if (a.compactions.length) extraBadges.push(`<span class="badge badge-compacted">${a.compactions.length}× compact</span>`);
    return `<tr>
      <td><strong>${esc(a.description)}</strong><br><span class="muted">${esc(a.id)}</span></td>
      <td>${esc(a.agentType)}</td>
      <td>${esc(modelLabel(a.dominantModel))}${a.modelsUsed.length > 1 ? " <span class='muted'>(+diğer)</span>" : ""}</td>
      <td>${a.background ? "arka plan" : "ön plan"}${a.worktreeBranch ? `<br><span class="muted">worktree: ${esc(a.worktreeBranch)}</span>` : ""}</td>
      <td>${a.startTs ? new Date(a.startTs).toLocaleTimeString("tr-TR") : "?"}</td>
      <td>${fmtDur(a.durationMs)}<br><span class="muted">${notifStr}</span></td>
      <td>${a.toolCallCount}<br><span class="muted">${toolStr}</span></td>
      <td class="mono">${byModelStr}</td>
      <td>${fmtInt(a.peakContext)}</td>
      <td>${fmtInt(a.finalContext)}</td>
      <td>${sparklineSvg(a.contextSeries, modelColor(a.dominantModel))}</td>
      <td>${fmtMoney(a.agg.cost)}</td>
      <td><span class="badge badge-${a.status.code}">${esc(a.status.label)}</span>${extraBadges.length ? "<br>" + extraBadges.join(" ") : ""}</td>
    </tr>`;
  }).join("");

  const edgeRows = edges.map(e => {
    const time = e.ts ? new Date(e.ts).toLocaleString("tr-TR") : "?";
    let kindLabel, extra = "";
    if (e.kind === "user->main") kindLabel = "Kullanıcı → Ana oturum";
    else if (e.kind === "main->agent") { kindLabel = `Ana oturum → ${esc(e.agent)}`; extra = ` <span class="muted">(${fmtInt(e.len)} karakter istem, model: ${esc(e.model)}, ${e.background ? "arka plan" : "ön plan"}${e.isolation ? ", " + esc(e.isolation) : ""})</span>`; }
    else if (e.kind === "agent->main") { kindLabel = `${esc(e.agent)} → Ana oturum (hand-back)`; extra = ` <span class="muted">(${fmtInt(e.len)} karakter)</span>`; }
    else if (e.kind === "system->main") { kindLabel = `Sistem → Ana oturum (ajan bitti: ${esc(e.summary)})`; }
    else { kindLabel = `Ana oturum → ${esc(e.agent)} (SendMessage)`; extra = ` <span class="muted">(${fmtInt(e.len)} karakter)</span>`; }
    return `<tr><td class="mono">${time}</td><td>${kindLabel}${extra}</td><td class="excerpt">${esc(e.detail || "")}</td></tr>`;
  }).join("");

  const eventRows = events.map(e => `<tr><td class="mono">${e.ts ? new Date(e.ts).toLocaleString("tr-TR") : "?"}</td><td>${esc(e.actor)}</td><td>${esc(e.type)}</td><td class="excerpt">${esc(e.detail)}</td></tr>`).join("");

  const nestedHtml = nestedSpawnNotes.length
    ? nestedSpawnNotes.map(n => `<li>${esc(n.from)} kendi içinden ${n.count} alt görev daha başlattı (spawnDepth&gt;1)</li>`).join("")
    : "<li>Bu oturumda hiçbir ajan kendi içinden başka bir ajan başlatmadı (tüm ajanlar spawnDepth=1).</li>";

  const mainSpark = sparklineSvg(data.main.contextSeries, modelColor(Object.keys(data.main.byModel)[0] || "unknown"), 260, 50);
  const mainShare = data.totals.totalCost > 0 ? (data.totals.mainCost / data.totals.totalCost * 100) : 0;

  const priceRows = Object.entries(PRICES).map(([m, p]) => `
    <tr><td>${esc(modelLabel(m))}</td><td class="mono">${esc(m)}</td>
      <td>${fmtMoney(p.in)}</td><td>${fmtMoney(p.out)}</td>
      <td>${fmtMoney(p.cacheWrite5m)} / ${fmtMoney(p.cacheWrite1h)}</td>
      <td>${fmtMoney(p.cacheRead)}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Orkestrasyon Raporu</title>
<style>
:root {
  --bg: #f7f6f3; --panel: #ffffff; --text: #1d1b18; --muted: #6b6660; --border: #e4e0d8;
  --accent: #b8622f; --tick: #333333;
  --badge-completed-bg:#e4f3e6; --badge-completed-fg:#2c6b34;
  --badge-interrupted-bg:#fdeee0; --badge-interrupted-fg:#9a5a10;
  --badge-error-bg:#fbe4e2; --badge-error-fg:#a5311f;
  --badge-denied-bg:#f6e6fb; --badge-denied-fg:#6b2c93;
  --badge-compacted-bg:#e6eefb; --badge-compacted-fg:#2c4f93;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17150f; --panel: #221f19; --text: #ece7dc; --muted: #a39c8d; --border: #3a352b;
    --accent: #e08a52; --tick: #ddd6c6;
    --badge-completed-bg:#173821; --badge-completed-fg:#8fe0a0;
    --badge-interrupted-bg:#3a2712; --badge-interrupted-fg:#f0b876;
    --badge-error-bg:#3a1b17; --badge-error-fg:#f0958a;
    --badge-denied-bg:#2c1a38; --badge-denied-fg:#d3a3f0;
    --badge-compacted-bg:#182740; --badge-compacted-fg:#a3c2f0;
  }
}
:root[data-theme="dark"] {
  --bg: #17150f; --panel: #221f19; --text: #ece7dc; --muted: #a39c8d; --border: #3a352b;
  --accent: #e08a52; --tick: #ddd6c6;
  --badge-completed-bg:#173821; --badge-completed-fg:#8fe0a0;
  --badge-interrupted-bg:#3a2712; --badge-interrupted-fg:#f0b876;
  --badge-error-bg:#3a1b17; --badge-error-fg:#f0958a;
  --badge-denied-bg:#2c1a38; --badge-denied-fg:#d3a3f0;
  --badge-compacted-bg:#182740; --badge-compacted-fg:#a3c2f0;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px; line-height:1.45; }
.wrap { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 4px 0 2px; }
h2 { font-size: 1.15rem; margin: 32px 0 10px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
.subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 18px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap:10px; }
.stat { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:10px 12px; }
.stat .n { font-size:1.3rem; font-weight:600; }
.stat .l { font-size:0.78rem; color:var(--muted); }
.note { font-size: 0.82rem; color: var(--muted); }
table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
th, td { text-align:left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--muted); font-weight:600; font-size:0.78rem; text-transform:uppercase; letter-spacing:.02em; }
.table-scroll { overflow-x: auto; }
.mono { font-family: ui-monospace, Consolas, monospace; font-size:0.8rem; }
.muted { color: var(--muted); }
.excerpt { max-width: 420px; white-space: pre-wrap; word-break: break-word; font-size: 0.82rem; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; }
.badge { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.76rem; font-weight:600; white-space:nowrap; }
.badge-completed { background:var(--badge-completed-bg); color:var(--badge-completed-fg); }
.badge-interrupted { background:var(--badge-interrupted-bg); color:var(--badge-interrupted-fg); }
.badge-error { background:var(--badge-error-bg); color:var(--badge-error-fg); }
.badge-denied { background:var(--badge-denied-bg); color:var(--badge-denied-fg); }
.badge-compacted { background:var(--badge-compacted-bg); color:var(--badge-compacted-fg); }
.spark { width:180px; height:36px; display:block; }
.spark-empty { font-size:8px; fill: var(--muted); }
.gantt { width:100%; height:auto; display:block; }
.gantt-label { font-size:10px; fill: var(--text); }
ul { padding-left: 20px; font-size: 0.88rem; }
.legend { display:flex; gap:14px; flex-wrap:wrap; font-size:0.82rem; margin-top:6px; }
.legend span.dot { width:10px; height:10px; }
@media (max-width: 480px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
  .excerpt { max-width: 220px; }
}
</style>
</head>
<body>
<div class="wrap">
  <h1>Orkestrasyon Raporu</h1>
  <div class="subtitle">${esc(data.title)} - oturum <span class="mono">${esc(data.sessionId)}</span> - proje ${esc(data.projectName)}<br>
    ${startFmt} -&gt; ${endFmt}</div>

  <h2>1. Özet</h2>
  <div class="grid">
    <div class="stat"><div class="n">${fmtMoney(data.totals.totalCost)}</div><div class="l">Toplam maliyet (API liste fiyatı)</div></div>
    <div class="stat"><div class="n">${data.totals.agentCount}</div><div class="l">Ajan sayısı</div></div>
    <div class="stat"><div class="n">${data.totals.parallelPeak}</div><div class="l">Eşzamanlı ajan zirvesi</div></div>
    <div class="stat"><div class="n">${fmtDur(data.totals.totalAgentWallMs)}</div><div class="l">Toplam ajan duvar-saati (toplamı)</div></div>
    <div class="stat"><div class="n">${mainShare.toFixed(1)}%</div><div class="l">Ana oturumun maliyet payı</div></div>
  </div>
  <p class="note">Maliyet rakamları <strong>API liste fiyatı karşılığıdır - Pro/Max abonelikte ayrıca ödenmez, kullanım limitinden düşer.</strong> ${esc(PRICE_SOURCE)}</p>

  <div class="table-scroll panel">
    <table>
      <thead><tr><th>Model</th><th>Giriş tok.</th><th>Önbellek yazma</th><th>Önbellek okuma</th><th>Çıkış tok.</th><th>API çağrısı</th><th>Maliyet</th></tr></thead>
      <tbody>${modelRows}</tbody>
    </table>
  </div>

  <div class="table-scroll panel">
    <table>
      <thead><tr><th>Model</th><th>ID</th><th>Giriş $/MTok</th><th>Çıkış $/MTok</th><th>Önbellek yazma $/MTok (5dk/1sa)</th><th>Önbellek okuma $/MTok</th></tr></thead>
      <tbody>${priceRows}</tbody>
    </table>
  </div>

  <h2>2. Zaman çizelgesi</h2>
  <div class="panel">
    ${ganttHtml}
    <div class="legend">
      <span><span class="dot" style="background:${modelColor("claude-opus-5-5")}"></span>Opus 5.5</span>
      <span><span class="dot" style="background:${modelColor("claude-sonnet-5")}"></span>Sonnet 5</span>
      <span>Dikey çizgiler: ana oturumdaki kullanıcı mesajları</span>
    </div>
  </div>

  <h2>3. Ajan tablosu</h2>
  <div class="table-scroll panel">
    <table>
      <thead><tr>
        <th>Ajan</th><th>Tür</th><th>Model</th><th>Konum</th><th>Başlangıç</th><th>Süre</th>
        <th>Araç çağrısı</th><th>Tokenler (giriş/ö.yazma/ö.okuma/çıkış)</th><th>Zirve bağlam</th><th>Son bağlam</th>
        <th>Bağlam grafiği</th><th>Maliyet</th><th>Durum</th>
      </tr></thead>
      <tbody>${agentRows}</tbody>
    </table>
  </div>
  <p class="note">"Bildirim" satırı, ana oturuma gelen task-notification'daki subagent_tokens/tool_uses/duration_ms değerleridir - bu rapordaki kendi hesaplamamızla çapraz kontrol amaçlıdır.</p>

  <h2>4. Bağlam büyümesi</h2>
  <div class="panel">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div>
        <div class="l muted" style="font-size:0.8rem;">Ana oturum (API çağrısı başına bağlam boyutu)</div>
        ${mainSpark}
      </div>
      <div class="muted" style="font-size:0.82rem;">Zirve: ${fmtInt(data.main.peakContext)} - Son: ${fmtInt(data.main.finalContext)}</div>
    </div>
    <p class="note">Her ajan için aynı grafik, yukarıdaki ajan tablosunun "Bağlam grafiği" sütununda yer alıyor.</p>
  </div>

  <h2>5. İletişim akışı</h2>
  <div class="table-scroll panel">
    <table>
      <thead><tr><th>Zaman</th><th>Yön</th><th>Özet (&le;600 karakter, gizli veriler kırpıldı)</th></tr></thead>
      <tbody>${edgeRows}</tbody>
    </table>
  </div>
  <div class="panel">
    <strong>Spawn ilişkileri:</strong>
    <ul>${nestedHtml}</ul>
  </div>

  <h2>6. Olaylar</h2>
  <div class="table-scroll panel">
    <table>
      <thead><tr><th>Zaman</th><th>Aktör</th><th>Tür</th><th>Ayrıntı</th></tr></thead>
      <tbody>${eventRows || '<tr><td colspan="4" class="muted">Kayıtlı olay yok.</td></tr>'}</tbody>
    </table>
  </div>

  <h2>7. Ana orkestratör</h2>
  <div class="panel">
    <div class="grid">
      <div class="stat"><div class="n">${fmtMoney(data.main.cost)}</div><div class="l">Ana oturum maliyeti</div></div>
      <div class="stat"><div class="n">${mainShare.toFixed(1)}%</div><div class="l">Toplam maliyetteki payı</div></div>
      <div class="stat"><div class="n">${fmtInt(data.main.peakContext)}</div><div class="l">Zirve bağlam</div></div>
      <div class="stat"><div class="n">${data.main.toolCallCount}</div><div class="l">Araç çağrısı</div></div>
      <div class="stat"><div class="n">${data.main.humanMessageCount}</div><div class="l">Kullanıcı mesajı</div></div>
    </div>
  </div>

  <p class="note">Rapor <span class="mono">report.mjs</span> ile üretildi. Ham veri: <span class="mono">${esc(data.sessionId)}.json</span></p>
</div>
</body>
</html>`;
}

main();

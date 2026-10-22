#!/usr/bin/env node
// Pano sunucusu: tek sayfada "Canlı" sekmesi (çalışan oturum ve alt ajanlar, SSE) ve geçmiş
// sekmeleri (pano.mjs hesabı, /pano.json). Yalnız 127.0.0.1'e bağlanır; dışarı açılmaz.
// Kullanım (ön planda): node sunucu.mjs [--port 7788] [--ac] [--pencere <dk>]
// Normalde doğrudan çalıştırılmaz: `node pano.mjs` (baslat.mjs) bunu arka planda başlatır ya da
// çalışanı yeniden kullanır.
// Canlı kısım yalnız canlı kaynağı (kaynaklar.json'daki ilk kök, yoksa ~/.claude/projects) SALT OKUR;
// geçmiş hesabı alt süreçte pano.mjs ile yapılır (o da kökleri salt okur). Hiçbir transkript köküne
// yazmaz. Veri sözleşmeleri: canli/SEMA.md (canlı), pano/SEMA.md (geçmiş).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { kaynaklariOku, cost, label, normModel, projectName, redact, excerpt } from "./ortak.mjs";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const PANO_SABLON = path.join(BURASI, "pano", "sablon.html");
const PANO_MJS = path.join(BURASI, "pano.mjs");
const GECICI_DIZIN = path.join(BURASI, "out", ".sunucu");
// Kimlik: baslat.mjs portu tutan sunucunun bizim olup olmadığını /durum meta'sından anlar.
const UYGULAMA = "orchestration-report";
const SUNUCU_SURUM = 2;

// ---------------------------------------------------------------------------
// Argümanlar
// ---------------------------------------------------------------------------
const KULLANIM = "node sunucu.mjs [--port 7788] [--ac] [--pencere <dk>]";
function argHata(m) { console.error(`Hata: ${m}\nKullanım: ${KULLANIM}`); process.exit(2); }
const args = { port: 7788, ac: false, pencere: 180 };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const deger = () => { const v = a[++i]; if (v == null || v.startsWith("--")) argHata(`${k} bir değer ister`); return v; };
    if (k === "--port") { const p = Number(deger()); if (!Number.isInteger(p) || p < 1 || p > 65535) argHata("--port 1-65535 arası tam sayı olmalı"); args.port = p; }
    else if (k === "--pencere") { const p = Number(deger()); if (!Number.isFinite(p) || p <= 0) argHata("--pencere pozitif dakika olmalı"); args.pencere = p; }
    else if (k === "--ac") args.ac = true;
    else if (k === "-h" || k === "--help") { console.log(KULLANIM); process.exit(0); }
    else argHata(`bilinmeyen argüman: ${k}`);
  }
}

const KOK = (() => {
  const l = kaynaklariOku();
  return l.length ? l[0].kok : path.join(os.homedir(), ".claude", "projects");
})();
const EV = os.homedir();
const BASLADI = Date.now();
const tilde = p => (typeof p === "string" && (p === EV || p.startsWith(EV + path.sep)) ? "~" + p.slice(EV.length) : p);

// Zaman eşikleri (ms)
const DK = 60_000;
const AKTIF_ESIK = 90_000;          // son kayıt bundan yeniyse "aktif" sayılabilir
const KAPANDI_ESIK = 30 * DK;       // bundan uzun sessizlik: kapandı / ajan bitti
const ISTEMCI_MAX = 20;             // aynı anda en çok SSE istemcisi
const YAZMA_TAMPON_MAX = 1_000_000; // okumayan istemci: tampon bu baytı aşınca bağlantı kesilir
const BEKLIYOR_ESIK = 5 * DK;       // tur bittikten sonra bu kadar "bekliyor", sonra "boşta"
const ARAC_ESIK = 10 * DK;          // yanıtı gelmemiş araç bu kadar süre "aktif" tutar
const SERI_DK = 60;                 // kıvılcım çizgisi: son 60 dakika
const OLAY_MAX = 60;

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------
const dosyalar = new Map();   // yol -> { ofset, kalan: Buffer|null, id, okundu }
const varliklar = new Map();  // id -> varlık (oturum ya da ajan)
const spawnlar = new Map();   // Agent tool_use id -> { sahip, aciklama, tur, model, ts, sonuc }
const bildirimler = new Map();// ajan kimliği -> { ts, durum } (task-notification)
const ajanBag = new Map();    // ajan kimliği -> spawn tool_use id (toolUseResult.agentId)
let cagrilar = [];            // son 1 saatin API çağrıları: [ts, tokToplam, maliyet, cikis, model]
let olaylar = [];             // son OLAY_MAX olay (kayit)
const istemciler = new Set();
let degisimSayaci = 0;        // canlı kökte bir .jsonl değişince artar (planla); geçmiş tazeliği için
const sonGonderilen = new Map(); // id -> "durum|detay" (zamana bağlı durum değişimini yakalamak için)

const sayi = v => Number(v) || 0;
const str = v => (typeof v === "string" && v ? v : null);
const pencereOf = m => (/fable|opus/i.test(m || "") ? 1_000_000 : 200_000);

function yeniVarlik(id, tur, dirKey, oturum, yol) {
  return {
    id, tur, oturum, dirKey, proje: projectName(dirKey), yol,
    cwd: null, dal: null, baslikKayit: null, ilkIstem: null, model: null,
    basla: null, son: null, tok: { g: 0, c: 0, o: 0, y5: 0, y1: 0 }, maliyet: 0, baglam: 0, cagri: 0,
    araclar: Object.create(null), sonArac: null, bekleyen: new Map(), sonTur: null,
    kova: new Map(), msg: new Map(), goruluArac: new Set(),
    meta: null, kapali: false, ozelBaslik: null, teslimTs: null,
  };
}

// ---------------------------------------------------------------------------
// Araç özeti: ham girdi asla gönderilmez, yalnız kısa ve arındırılmış özet.
// ---------------------------------------------------------------------------
function kisaYol(p) {
  if (typeof p !== "string" || !p) return null;
  const t = tilde(p);
  const parca = t.split(/[\\/]/);
  return excerpt(parca.length > 3 ? "…/" + parca.slice(-3).join("/") : t, 80);
}
function aracOzeti(ad, g) {
  if (!g || typeof g !== "object") return null;
  switch (ad) {
    case "Bash": case "PowerShell":
      if (str(g.description)) return excerpt(g.description, 80);
      return str(g.command) ? excerpt(g.command.split("\n")[0], 60) : null;
    case "Read": case "Edit": case "MultiEdit": case "Write": case "NotebookEdit":
      return kisaYol(g.file_path || g.notebook_path);
    case "Grep": case "Glob": return str(g.pattern) ? excerpt(g.pattern, 50) : null;
    case "Agent": case "Task": return str(g.description) ? excerpt(g.description, 80) : null;
    case "WebFetch": try { return new URL(g.url).hostname; } catch { return null; }
    case "WebSearch": return str(g.query) ? excerpt(g.query, 60) : null;
    case "Skill": return str(g.skill) ? excerpt(g.skill, 40) : null;
    case "SendMessage": return str(g.to) ? excerpt("→ " + g.to, 40) : null;
    default: return null;
  }
}
const aracAdi = ad => (ad.startsWith("mcp__") ? ad.split("__").slice(-1)[0] : ad);

// İstem mi? (pano.mjs istemMi ile aynı mantık)
function istemMi(o, temiz) {
  if (!temiz) return false;
  const koken = o.turnOrigin ?? (o.origin && typeof o.origin === "object" ? o.origin.kind : o.origin);
  if (koken != null) return koken === "human" && !temiz.startsWith("<scheduled-task");
  return !(temiz.startsWith("<task-notification>") || temiz.startsWith("<local-command-") ||
    temiz.startsWith("<agent-message") || temiz.startsWith("Another Claude session sent a message") ||
    temiz.startsWith("<scheduled-task"));
}
function istemGosterim(temiz) {
  const cm = temiz.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/);
  if (cm && cm[1]) return cm[1].startsWith("/") ? cm[1] : "/" + cm[1];
  return temiz.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Kayıt işleme. Dönüş: olay (kayit) ya da null.
// ---------------------------------------------------------------------------
function kayitIsle(V, o) {
  let ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  if (Number.isNaN(ts)) ts = null;
  const tip = o.type;
  if (tip === "custom-title") { if (str(o.customTitle)) V.baslikKayit = excerpt(o.customTitle, 80); return null; }
  if (tip !== "assistant" && tip !== "user" && tip !== "system") return null;
  if (str(o.cwd)) V.cwd = o.cwd;
  if (str(o.gitBranch)) V.dal = o.gitBranch;
  if (ts != null) {
    if (V.basla == null || ts < V.basla) V.basla = ts;
    if (V.son == null || ts > V.son) V.son = ts;
  }
  if (tip === "system") return null;
  const msg = o.message && typeof o.message === "object" ? o.message : null;
  if (!msg) return null;
  const olay = { ts: ts ?? Date.now(), id: V.id, tur: null, arac: null, ozet: null, dTok: 0, dCikis: 0, dMaliyet: 0 };

  if (tip === "assistant") {
    const model = str(msg.model) && msg.model !== "<synthetic>" ? normModel(msg.model) : null;
    if (model) V.model = model;
    if (model && msg.usage && typeof msg.usage === "object") {
      const us = msg.usage;
      const cc = us.cache_creation && typeof us.cache_creation === "object" ? us.cache_creation : {};
      const cwT = sayi(us.cache_creation_input_tokens), y1 = sayi(cc.ephemeral_1h_input_tokens);
      const y5 = cc.ephemeral_5m_input_tokens != null ? sayi(cc.ephemeral_5m_input_tokens) : Math.max(0, cwT - y1);
      const u = [sayi(us.input_tokens), sayi(us.output_tokens), sayi(us.cache_read_input_tokens), y5, y1];
      const mid = str(msg.id) || ("r:" + (o.requestId || o.uuid));
      // Bir mesaj birden çok satıra yayılır (her içerik bloğu ayrı satır, usage tekrar eder):
      // mesaj kimliği başına alanlarda maksimum alınır, yalnız artış eklenir (usage.mjs ile aynı).
      const once = V.msg.get(mid);
      const yeni = once ? u.map((x, k) => Math.max(x, once[k])) : u;
      const d = once ? yeni.map((x, k) => x - once[k]) : yeni;
      if (!once) { V.cagri++; if (V.msg.size > 400) V.msg.delete(V.msg.keys().next().value); }
      V.msg.set(mid, yeni);
      V.baglam = yeni[0] + yeni[2] + yeni[3] + yeni[4];
      if (d.some(x => x > 0)) {
        V.tok.g += d[0]; V.tok.c += d[1]; V.tok.o += d[2]; V.tok.y5 += d[3]; V.tok.y1 += d[4];
        const m = cost(model, { input: d[0], output: d[1], cacheRead: d[2], cw5m: d[3], cw1h: d[4] }) || 0;
        V.maliyet += m;
        const top = d[0] + d[1] + d[2] + d[3] + d[4];
        olay.dTok = top; olay.dCikis = d[1]; olay.dMaliyet = m;
        if (ts != null) {
          const dk = Math.floor(ts / DK);
          V.kova.set(dk, (V.kova.get(dk) || 0) + d[1]);
          if (V.kova.size > SERI_DK + 5) for (const k of V.kova.keys()) if (k < dk - SERI_DK) V.kova.delete(k);
          if (ts > Date.now() - 60 * DK) cagrilar.push([ts, top, m, d[1], model]);
        }
      }
    }
    const ic = Array.isArray(msg.content) ? msg.content : [];
    const sonMesaj = msg.stop_reason && msg.stop_reason !== "tool_use";
    for (const b of ic) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "thinking" || b.type === "redacted_thinking") { V.sonTur = "dusunce"; olay.tur = "dusunce"; }
      else if (b.type === "text") {
        if (typeof b.text === "string" && b.text.trim()) { V.sonTur = sonMesaj ? "son" : "metin"; olay.tur = "metin"; }
      } else if (b.type === "tool_use") {
        const ad = str(b.name) || "?";
        const tid = str(b.id);
        if (tid && V.goruluArac.has(tid)) continue;
        if (tid) { V.goruluArac.add(tid); if (V.goruluArac.size > 2000) V.goruluArac.delete(V.goruluArac.values().next().value); }
        V.araclar[ad] = (V.araclar[ad] || 0) + 1;
        const ozet = aracOzeti(ad, b.input);
        V.sonArac = { ad, ozet, ts: olay.ts };
        if (tid) V.bekleyen.set(tid, ad);
        V.sonTur = "arac";
        olay.tur = "arac"; olay.arac = ad; olay.ozet = ozet;
        if ((ad === "Agent" || ad === "Task") && tid) {
          const g = b.input && typeof b.input === "object" ? b.input : {};
          spawnlar.set(tid, {
            sahip: V.id, ts: olay.ts, sonuc: null,
            aciklama: str(g.description) ? excerpt(g.description, 80) : null,
            tur: str(g.subagent_type), model: str(g.model),
          });
          olay.tur = "spawn";
        }
      }
    }
    if (!ic.some(b => b && b.type === "tool_use") && sonMesaj && V.sonTur !== "son" && ic.length) V.sonTur = "son";
    return olay.tur ? olay : (olay.dTok ? (olay.tur = "cagri", olay) : null);
  }

  // user
  const ic = msg.content;
  const metinler = [];
  let sonucVar = false;
  if (typeof ic === "string") metinler.push(ic);
  else if (Array.isArray(ic)) for (const b of ic) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "tool_result") {
      sonucVar = true;
      const tid = str(b.tool_use_id);
      const ad = tid ? V.bekleyen.get(tid) : null;
      if (tid) V.bekleyen.delete(tid);
      olay.tur = "sonuc"; olay.arac = ad || null;
      // Arka plan ajanı SubagentHandback ile raporunu teslim edince biter (stop_reason yazılmaz).
      if (ad === "SubagentHandback" && !b.is_error) { V.teslimTs = olay.ts; olay.tur = "teslim"; }
      if (b.is_error) olay.ozet = "hata";
      const sp = tid ? spawnlar.get(tid) : null;
      if (sp) {
        const tur = o.toolUseResult && typeof o.toolUseResult === "object" && !Array.isArray(o.toolUseResult) ? o.toolUseResult : {};
        if (str(tur.agentId)) ajanBag.set(tur.agentId, tid);
        if (tur.status !== "async_launched") { sp.sonuc = { ts: olay.ts, durum: str(tur.status) || (b.is_error ? "failed" : "completed") }; olay.tur = "ajan-bitti"; }
        else olay.ozet = "arka planda başladı";
      }
    } else if (b.type === "text" && typeof b.text === "string") metinler.push(b.text);
  }
  if (sonucVar) { V.sonTur = olay.tur === "teslim" ? "son" : "sonuc"; return olay; }
  if (o.isMeta || o.isCompactSummary) return null;
  const temiz = metinler.join("\n").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!temiz) return null;
  if (temiz.startsWith("<task-notification>")) {
    const id = (temiz.match(/<task-id>\s*([^<\s]+)\s*<\/task-id>/) || [])[1];
    const durum = (temiz.match(/<status>\s*([^<\s]+)\s*<\/status>/) || [])[1] || "completed";
    if (id) bildirimler.set(id, { ts: olay.ts, durum });
    olay.tur = "bildirim"; olay.ozet = "ajan " + durum;
    V.sonTur = "istem";
    return olay;
  }
  if (temiz.startsWith("[Request interrupted by user")) { V.bekleyen.clear(); V.sonTur = "son"; olay.tur = "kesildi"; return olay; }
  if (o.isSidechain) { V.sonTur = "istem"; return null; }
  if (istemMi(o, temiz)) {
    const g = istemGosterim(temiz);
    if (V.ilkIstem == null) V.ilkIstem = excerpt(g, 77);
    V.bekleyen.clear();
    V.sonTur = "istem";
    olay.tur = "istem"; olay.ozet = excerpt(g, 77);
    return olay;
  }
  V.sonTur = "istem";
  return null;
}

// ---------------------------------------------------------------------------
// Dosya sınıflama ve artımlı okuma
// ---------------------------------------------------------------------------
function sinifla(yol) {
  const rel = path.relative(KOK, yol).split(path.sep);
  if (rel.length === 2 && rel[1].endsWith(".jsonl")) return { tur: "oturum", dirKey: rel[0], oturum: rel[1].slice(0, -6), id: rel[1].slice(0, -6) };
  if (rel.length === 4 && rel[2] === "subagents" && /^agent-.+\.jsonl$/.test(rel[3])) {
    const aid = rel[3].slice(6, -6);
    return { tur: "ajan", dirKey: rel[0], oturum: rel[1], id: aid };
  }
  return null;
}

function metaOku(V) {
  try {
    const j = JSON.parse(fs.readFileSync(V.yol.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    if (j && typeof j === "object") V.meta = {
      ajanTuru: str(j.agentType), aciklama: str(j.description) ? excerpt(j.description, 80) : null,
      toolUseId: str(j.toolUseId), derinlik: typeof j.spawnDepth === "number" ? j.spawnDepth : null,
      sekil: str(j.requestShape), model: str(j.model),
    };
  } catch { /* henüz yok */ }
}
function oturumDosyalariniOku(V) {
  try { V.kapali = fs.existsSync(path.join(KOK, V.dirKey, V.id + ".desktop-released.json")); } catch { /* */ }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(KOK, V.dirKey, V.id, "custom-title.json"), "utf8"));
    V.ozelBaslik = j && str(j.customTitle) ? excerpt(j.customTitle, 80) : null;
  } catch { /* yok */ }
}

const ATLA = ['{"type":"file-history-', '{"type":"queue-operation"', '{"type":"last-prompt"', '{"type":"atis-latch"',
  '{"type":"bridge-session"', '{"type":"mode"', '{"type":"cost-state"', '{"type":"frame-link"', '{"type":"artifact-', '{"type":"relocated"'];

function dosyaOku(yol, yay) {
  const sn = sinifla(yol);
  if (!sn) return [];
  let st;
  try { st = fs.statSync(yol); } catch { return []; }
  let f = dosyalar.get(yol);
  if (!f) { f = { ofset: 0, kalan: null, id: sn.id }; dosyalar.set(yol, f); }
  if (st.size < f.ofset) { f.ofset = 0; f.kalan = null; }   // kısaldı: baştan
  if (st.size === f.ofset) return [];
  let V = varliklar.get(sn.id);
  if (!V) {
    V = yeniVarlik(sn.id, sn.tur, sn.dirKey, sn.oturum, yol);
    varliklar.set(sn.id, V);
    if (sn.tur === "ajan") metaOku(V); else oturumDosyalariniOku(V);
  }
  const cikan = [];
  let fd;
  try { fd = fs.openSync(yol, "r"); } catch { return []; }
  try {
    const PARCA = 8 * 1024 * 1024;
    while (f.ofset < st.size) {
      const n = Math.min(PARCA, st.size - f.ofset);
      const yeni = Buffer.allocUnsafe(n);
      const okunan = fs.readSync(fd, yeni, 0, n, f.ofset);
      if (okunan <= 0) break;
      f.ofset += okunan;
      const buf = f.kalan ? Buffer.concat([f.kalan, yeni.subarray(0, okunan)]) : yeni.subarray(0, okunan);
      const son = buf.lastIndexOf(10);
      if (son < 0) { f.kalan = Buffer.from(buf); continue; }
      f.kalan = son + 1 < buf.length ? Buffer.from(buf.subarray(son + 1)) : null;
      let i = 0;
      while (i <= son) {
        let j = buf.indexOf(10, i);
        if (j < 0 || j > son) j = son;
        if (j - i > 2) {
          const satir = buf.toString("utf8", i, j);
          i = j + 1;
          if (ATLA.some(p => satir.startsWith(p))) continue;
          if (satir.includes('"type":"attachment","uuid":"') || satir.includes('"type":"progress"')) {
            if (!satir.includes('"type":"assistant"') && !satir.includes('"type":"user"')) continue;
          }
          let o;
          try { o = JSON.parse(satir); } catch { continue; }
          if (!o || typeof o !== "object" || Array.isArray(o)) continue;
          let olay = null;
          try { olay = kayitIsle(V, o); } catch { /* beklenmedik biçim: yalnız bu satır düşer */ }
          if (olay) cikan.push(olay);
        } else i = j + 1;
      }
    }
  } finally { fs.closeSync(fd); }
  if (yay) return cikan;
  for (const ol of cikan) olayEkle(ol);
  return [];
}

// ---------------------------------------------------------------------------
// Durum hesabı
// ---------------------------------------------------------------------------
function ajanBitis(V) {
  let b = bildirimler.get(V.id) || null;
  if (V.teslimTs != null && (!b || V.teslimTs > b.ts)) b = { ts: V.teslimTs, durum: "teslim" };
  const tid = (V.meta && V.meta.toolUseId) || ajanBag.get(V.id);
  const sp = tid ? spawnlar.get(tid) : null;
  if (sp && sp.sonuc && (!b || sp.sonuc.ts > b.ts)) b = sp.sonuc;
  return b;
}
function ustOf(V) {
  const tid = (V.meta && V.meta.toolUseId) || ajanBag.get(V.id);
  const sp = tid ? spawnlar.get(tid) : null;
  return { ust: sp && varliklar.has(sp.sahip) ? sp.sahip : V.oturum, sp };
}
function detayOf(V) {
  if (V.sonTur === "arac" && V.bekleyen.size) return "araç: " + aracAdi([...V.bekleyen.values()].pop());
  if (V.sonTur === "metin") return "yazıyor";
  return "düşünüyor";
}
const durumOnbellek = new Map();
function durumHesapla(V, simdi) {
  const sessiz = V.son == null ? Infinity : simdi - V.son;
  if (V.tur === "ajan") {
    const b = ajanBitis(V);
    const ust = varliklar.get(V.oturum);
    const ustKapali = !!(ust && ust.kapali);
    if (b && b.ts >= (V.son ?? 0) - 2000) return { durum: "bitti", detay: b.durum === "completed" ? "tamamlandı" : b.durum === "teslim" ? "rapor teslim edildi" : b.durum, bitisTs: b.ts, bitisDurum: b.durum };
    if (sessiz > KAPANDI_ESIK || (ustKapali && sessiz > AKTIF_ESIK) || (V.sonTur === "son" && sessiz > AKTIF_ESIK))
      return { durum: "bitti", detay: "sessiz", bitisTs: V.son, bitisDurum: "sessiz" };
    if (V.sonTur === "son") return { durum: "çalışıyor", detay: "sonuç yazıldı" };
    return { durum: "çalışıyor", detay: detayOf(V) };
  }
  if (V.kapali && sessiz > AKTIF_ESIK) return { durum: "kapandı", detay: "uygulama kapattı" };
  if (sessiz > KAPANDI_ESIK) return { durum: "kapandı", detay: "30 dk+ sessiz" };
  let calisan = 0;
  for (const A of varliklar.values()) if (A.tur === "ajan" && A.oturum === V.id && durumOnbellekGet(A, simdi).durum === "çalışıyor") calisan++;
  if (V.sonTur === "son") {
    if (calisan) return { durum: "bekliyor", detay: `${calisan} ajanı bekliyor` };
    if (sessiz < BEKLIYOR_ESIK) return { durum: "bekliyor", detay: "kullanıcıyı bekliyor" };
    return { durum: "boşta", detay: "tur bitti" };
  }
  if (V.sonTur === "arac" && V.bekleyen.size && sessiz < ARAC_ESIK) return { durum: "aktif", detay: detayOf(V) };
  if (sessiz < AKTIF_ESIK) return { durum: "aktif", detay: detayOf(V) };
  if (calisan) return { durum: "bekliyor", detay: `${calisan} ajanı bekliyor` };
  return { durum: "boşta", detay: "sessiz" };
}
let durumTur = 0;
function durumOnbellekGet(V, simdi) {
  const c = durumOnbellek.get(V.id);
  if (c && c.tur === durumTur) return c.d;
  const d = durumHesapla(V, simdi);
  durumOnbellek.set(V.id, { tur: durumTur, d });
  return d;
}
function yeniDurumTuru() { durumTur++; }

// ---------------------------------------------------------------------------
// Dışa aktarım (gönderilen biçim: canli/SEMA.md)
// ---------------------------------------------------------------------------
const yuvarla = x => Math.round(x * 10000) / 10000;
function seriOf(V, simdi) {
  const sonDk = Math.floor(simdi / DK);
  const s = new Array(SERI_DK);
  for (let i = 0; i < SERI_DK; i++) s[i] = V.kova.get(sonDk - SERI_DK + 1 + i) || 0;
  return s;
}
function ozetle(V, simdi = Date.now()) {
  const d = durumOnbellekGet(V, simdi);
  const araclar = Object.entries(V.araclar).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const t = V.tok;
  const r = {
    id: V.id, tur: V.tur, oturum: V.oturum, proje: V.proje, cwd: V.cwd ? excerpt(tilde(V.cwd), 120) : null,
    dal: V.dal ? excerpt(V.dal, 60) : null, model: V.model, modelAd: V.model ? label(V.model) : null,
    durum: d.durum, detay: d.detay, son: V.son, basla: V.basla,
    tok: { g: t.g, c: t.c, o: t.o, y: t.y5 + t.y1, y5: t.y5, y1: t.y1 },
    maliyet: yuvarla(V.maliyet), baglam: V.baglam, pencere: pencereOf(V.model), cagri: V.cagri,
    araclar, sonArac: V.sonArac ? { ad: V.sonArac.ad, ozet: V.sonArac.ozet, ts: V.sonArac.ts } : null,
    seri: seriOf(V, simdi),
  };
  if (V.tur === "oturum") {
    r.baslik = V.ozelBaslik || V.baslikKayit || V.ilkIstem || V.id.slice(0, 8);
    r.kapali = V.kapali;
    const ajanlar = [];
    let aktif = 0;
    for (const A of varliklar.values()) if (A.tur === "ajan" && A.oturum === V.id) {
      ajanlar.push(A.id);
      if (durumOnbellekGet(A, simdi).durum === "çalışıyor") aktif++;
    }
    r.ajanlar = ajanlar; r.aktifAjan = aktif;
  } else {
    const { ust, sp } = ustOf(V);
    const m = V.meta || {};
    r.ust = ust;
    r.aciklama = m.aciklama || (sp && sp.aciklama) || null;
    r.baslik = r.aciklama || V.id.slice(0, 8);
    r.ajanTuru = m.ajanTuru || (sp && sp.tur) || null;
    r.istenenModel = m.model || (sp && sp.model) || null;
    r.derinlik = m.derinlik ?? null;
    r.arkaPlan = m.sekil ? m.sekil === "background" : null;
    r.bitti = d.durum === "bitti";
    r.bitisTs = d.bitisTs ?? null;
    r.bitisDurum = d.bitisDurum ?? null;
    r.sureMs = r.bitti && V.basla != null && d.bitisTs != null ? Math.max(0, d.bitisTs - V.basla) : null;
    if (!r.model && r.istenenModel) r.modelAd = r.istenenModel;
  }
  return r;
}

function genel(simdi = Date.now()) {
  const saatOnce = simdi - 60 * DK, bes = simdi - 5 * DK;
  cagrilar = cagrilar.filter(c => c[0] >= saatOnce);
  const s5 = { tok: 0, cikis: 0, maliyet: 0, cagri: 0 }, s60 = { tok: 0, cikis: 0, maliyet: 0, cagri: 0 };
  const mod = new Map();
  for (const [ts, tok, m, cik, model] of cagrilar) {
    s60.tok += tok; s60.cikis += cik; s60.maliyet += m; s60.cagri++;
    const x = mod.get(model) || { model, ad: label(model), tok1sa: 0, maliyet1sa: 0, cikis5dk: 0, aktif: 0 };
    x.tok1sa += tok; x.maliyet1sa += m;
    if (ts >= bes) { s5.tok += tok; s5.cikis += cik; s5.maliyet += m; s5.cagri++; x.cikis5dk += cik; }
    mod.set(model, x);
  }
  let aktifOturum = 0, canliOturum = 0, aktifAjan = 0;
  for (const V of varliklar.values()) {
    const d = durumOnbellekGet(V, simdi).durum;
    if (V.tur === "oturum") { if (d === "aktif") aktifOturum++; if (d === "aktif" || d === "bekliyor") canliOturum++; }
    else if (d === "çalışıyor") aktifAjan++;
    if ((d === "aktif" || d === "çalışıyor") && V.model) {
      const x = mod.get(V.model) || { model: V.model, ad: label(V.model), tok1sa: 0, maliyet1sa: 0, cikis5dk: 0, aktif: 0 };
      x.aktif++; mod.set(V.model, x);
    }
  }
  s5.maliyet = yuvarla(s5.maliyet); s60.maliyet = yuvarla(s60.maliyet);
  const modeller = [...mod.values()].map(x => ({ ...x, maliyet1sa: yuvarla(x.maliyet1sa) })).sort((a, b) => b.tok1sa - a.tok1sa);
  return { ts: simdi, aktifOturum, canliOturum, aktifAjan, son5dk: s5, sonSaat: s60, cikisDk: Math.round(s5.cikis / 5), modeller };
}

function anlik() {
  yeniDurumTuru();
  const simdi = Date.now();
  const oturumlar = [], ajanlar = [];
  for (const V of varliklar.values()) (V.tur === "oturum" ? oturumlar : ajanlar).push(ozetle(V, simdi));
  // Ajanı olan ama ana dosyası pencerede olmayan oturum olmaz: ajan dosyası okunduysa ana dosya da
  // okunur (aşağıdaki tarama ana dosyayı da aynı pencere kuralıyla alır); yine de eksikse ajan "ust"u bilinmez.
  oturumlar.sort((a, b) => (b.son ?? 0) - (a.son ?? 0));
  ajanlar.sort((a, b) => (a.basla ?? 0) - (b.basla ?? 0));
  return {
    meta: { surum: 1, uygulama: UYGULAMA, sunucuSurum: SUNUCU_SURUM, pid: process.pid, basladi: BASLADI,
      uretildi: simdi, kok: tilde(KOK), pencereDk: args.pencere, port: args.port,
      fiyatNotu: "API liste fiyatı karşılığı; Max aboneliğinde ayrıca faturalanmaz." },
    genel: genel(simdi), oturumlar, ajanlar, olaylar: olaylar.slice(-OLAY_MAX),
  };
}

// ---------------------------------------------------------------------------
// Olaylar ve SSE
// ---------------------------------------------------------------------------
function kimOf(V) {
  if (V.tur === "ajan") return (V.meta && V.meta.aciklama) || "ajan " + V.id.slice(0, 7);
  return V.proje;
}
function olayKaydi(ol) {
  const V = varliklar.get(ol.id);
  return {
    ts: ol.ts, id: ol.id, varlikTur: V ? V.tur : null, oturum: V ? V.oturum : null, kim: V ? kimOf(V) : null,
    tur: ol.tur, arac: ol.arac, ozet: ol.ozet, dTok: ol.dTok, dCikis: ol.dCikis, dMaliyet: yuvarla(ol.dMaliyet),
  };
}
function olayEkle(ol) {
  const k = olayKaydi(ol);
  olaylar.push(k);
  if (olaylar.length > OLAY_MAX * 2) olaylar = olaylar.slice(-OLAY_MAX);
  return k;
}
function gonder(olay, veri, hedef = istemciler) {
  const s = `event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`;
  let sM = null;   // metinsiz istemciler için (gerekirse bir kez üretilir)
  for (const res of hedef) {
    if (res.writableLength > YAZMA_TAMPON_MAX) { try { res.destroy(); } catch { /* */ } istemciler.delete(res); continue; }
    let yaz = s;
    if (res.metinsiz) { if (sM == null) sM = `event: ${olay}\ndata: ${JSON.stringify(metinsizle(olay, veri))}\n\n`; yaz = sM; }
    try { res.write(yaz); } catch { /* kapanmış */ }
  }
}

// ?metinsiz=1 (pano.mjs --metinsiz ile aynı amaç: ekran paylaşımı): istemden türeyen başlık, ajan
// açıklaması, istem/araç/spawn özetleri gönderilmez. Oturumun konmuş başlığı (custom title) kalır.
function varlikMetinsiz(v) {
  if (!v) return v;
  const r = { ...v, sonArac: v.sonArac ? { ...v.sonArac, ozet: null } : null };
  const V = varliklar.get(v.id);
  if (v.tur === "oturum") r.baslik = (V && (V.ozelBaslik || V.baslikKayit)) || String(v.id).slice(0, 8);
  else { r.aciklama = null; r.baslik = String(v.id).slice(0, 8); }
  return r;
}
function olayMetinsiz(k) {
  if (!k) return k;
  const r = { ...k };
  if (k.varlikTur === "ajan") r.kim = "ajan " + String(k.id).slice(0, 7);
  if (k.tur === "istem" || k.tur === "arac" || k.tur === "spawn") r.ozet = null;
  if (k.v) r.v = varlikMetinsiz(k.v);
  return r;
}
function metinsizle(olay, veri) {
  if (olay === "anlik") return { ...veri, meta: { ...veri.meta, metinler: false },
    oturumlar: veri.oturumlar.map(varlikMetinsiz), ajanlar: veri.ajanlar.map(varlikMetinsiz), olaylar: veri.olaylar.map(olayMetinsiz) };
  if (olay === "varlik") return varlikMetinsiz(veri);
  if (olay === "kayit") return olayMetinsiz(veri);
  return veri;
}

// ---------------------------------------------------------------------------
// Tarama: başlangıçta pencere içindeki dosyalar tam okunur; sonra fs.watch + 2 sn yoklama.
// ---------------------------------------------------------------------------
function jsonlListesi(dir, acc = []) {
  let girdiler;
  try { girdiler = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of girdiler) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsonlListesi(p, acc);
    else if (e.name.endsWith(".jsonl")) acc.push(p);
  }
  return acc;
}

const bekleyenYollar = new Set();
let isleZamanlayici = null;
function isle() {
  isleZamanlayici = null;
  const yollar = [...bekleyenYollar];
  bekleyenYollar.clear();
  const yeni = [];
  for (const y of yollar) { let liste = []; try { liste = dosyaOku(y, true); } catch (e) { console.error(`Uyarı: okunamadı ${y}: ${e.message}`); } for (const ol of liste) yeni.push(ol); }
  if (!yeni.length) return;
  yeni.sort((a, b) => a.ts - b.ts);
  yeniDurumTuru();
  const simdi = Date.now();
  const degisen = new Set();
  for (const ol of yeni) {
    const k = olayEkle(ol);
    const V = varliklar.get(ol.id);
    const v = V ? ozetle(V, simdi) : null;
    if (v) sonGonderilen.set(v.id, v.durum + "|" + v.detay);
    gonder("kayit", { ...k, durum: v ? v.durum : null, v });
    degisen.add(ol.id);
    if (V && V.tur === "ajan") degisen.add(V.oturum);
  }
  // Etkilenen oturumların (ajan sayısı, durum) güncel hali
  for (const id of degisen) {
    const V = varliklar.get(id);
    if (V && V.tur === "oturum") { const v = ozetle(V, simdi); sonGonderilen.set(id, v.durum + "|" + v.detay); gonder("varlik", v); }
  }
  gonder("genel", genel(simdi));
}
function planla(yol) {
  degisimSayaci++;
  bekleyenYollar.add(yol);
  if (!isleZamanlayici) isleZamanlayici = setTimeout(isle, 120);
}

function baslangic() {
  const t0 = Date.now();
  const sinir = t0 - args.pencere * DK;
  const liste = jsonlListesi(KOK);
  const secilen = new Set();
  for (const y of liste) {
    let st;
    try { st = fs.statSync(y); } catch { continue; }
    if (st.mtimeMs >= sinir && sinifla(y)) secilen.add(y);
  }
  // Pencerede ajanı olan oturumun ana dosyası da okunur (başlık, ebeveyn bağı için).
  for (const y of [...secilen]) {
    const sn = sinifla(y);
    if (sn && sn.tur === "ajan") { const ana = path.join(KOK, sn.dirKey, sn.oturum + ".jsonl"); if (fs.existsSync(ana)) secilen.add(ana); }
  }
  let olaySay = 0;
  const hepsi = [];
  for (const y of secilen) { let liste = []; try { liste = dosyaOku(y, true); } catch (e) { console.error(`Uyarı: okunamadı ${y}: ${e.message}`); } for (const ol of liste) { hepsi.push(ol); olaySay++; } }
  hepsi.sort((a, b) => a.ts - b.ts);
  for (const ol of hepsi.slice(-OLAY_MAX)) olayEkle(ol);
  // Pencere dışındaki dosyalar: boyutu not edilir (izlenmez); büyürlerse aşağıdaki yoklama tam okur.
  for (const y of liste) if (!secilen.has(y)) { try { eskiBoyut.set(y, fs.statSync(y).size); } catch { /* */ } }
  return { dosya: secilen.size, olay: olaySay, ms: Date.now() - t0 };
}
const eskiBoyut = new Map();   // pencere dışı dosyalar: yol -> boyut

let yoklamaSay = 0;
function yokla() {
  yoklamaSay++;
  for (const y of jsonlListesi(KOK)) {
    if (dosyalar.has(y)) {
      let st; try { st = fs.statSync(y); } catch { continue; }
      if (st.size !== dosyalar.get(y).ofset) planla(y);
    } else {
      let st; try { st = fs.statSync(y); } catch { continue; }
      if (!eskiBoyut.has(y) || eskiBoyut.get(y) !== st.size) { eskiBoyut.delete(y); if (sinifla(y)) planla(y); }
    }
  }
  // Yan dosyalar: meta (henüz yoksa), başlık ve kapatılma (her 3 yoklamada bir)
  for (const V of varliklar.values()) {
    if (V.tur === "ajan" && !V.meta) metaOku(V);
    else if (V.tur === "oturum" && yoklamaSay % 3 === 0) {
      const once = V.kapali + "|" + V.ozelBaslik;
      oturumDosyalariniOku(V);
      if (once !== V.kapali + "|" + V.ozelBaslik) sonGonderilen.delete(V.id);
    }
  }
}

// Zamana bağlı durum değişimleri (aktif -> boşta, ajan bitti...) her 5 sn yayınlanır.
function durumTara() {
  if (!istemciler.size) return;
  yeniDurumTuru();
  const simdi = Date.now();
  let degisti = false;
  for (const V of varliklar.values()) {
    const d = durumOnbellekGet(V, simdi);
    const k = d.durum + "|" + d.detay;
    if (sonGonderilen.get(V.id) !== k) {
      sonGonderilen.set(V.id, k);
      gonder("varlik", ozetle(V, simdi));
      degisti = true;
    }
  }
  if (degisti) gonder("genel", genel(simdi));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Geçmiş verisi (/pano.json): pano.mjs alt süreçte `--yalniz-json` ile çalışır (kendi ayrıştırma
// önbelleğiyle ~1-2 sn; önbelleksiz ilk çalıştırma ~1 dk). Sonuç süzgeç anahtarı başına bellekte
// tutulur. Tazelik: canlı kökte değişiklik olduysa TAZE_MS'den eski sonuç yeniden hesaplanır; öbür
// kökler (Windows arşivi) izlenmediği için sonuç en çok BAYAT_MS bekler. ?taze=1 hemen yeniden
// hesaplar, ?yenile=1 ayrıca pano.mjs'in ayrıştırma önbelleğini yok sayar (--yenile).
// Hesaplar sırayla yürür (aynı anda tek alt süreç): önbellek dosyasına iki süreç birden yazmasın.
// ---------------------------------------------------------------------------
const TAZE_MS = 15_000, BAYAT_MS = 5 * DK, HESAP_ZAMAN_ASIMI = 10 * DK, GECMIS_ANAHTAR_MAX = 4, HESAP_BEKLEYEN_MAX = 3;
let etkinCocuk = null;          // çalışan pano.mjs alt süreci (sunucu kapanırken öldürülür)
const gecmis = new Map();       // anahtar -> { json: Buffer, ozet, uretildi, degisim, sureMs }
const gecmisSuren = new Map();  // anahtar -> Promise (sürmekte olan hesap)
let hesapKuyrugu = Promise.resolve();
let geciciSay = 0;

const evetMi = v => v === "1" || v === "true" || v === "evet";
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
// Sorgu -> pano.mjs argümanları. Ayrıntılı doğrulama (takvim günü, kaynak adı var mı) pano.mjs'te;
// burada yalnız biçim: değerler argüman dizisiyle geçer (kabuk yok), "--" ile başlayamaz.
function gecmisSuzgeci(sp) {
  const s = { since: sp.get("since") || null, until: sp.get("until") || null, kaynak: sp.get("kaynak") || null, metinsiz: evetMi(sp.get("metinsiz")) };
  for (const k of ["since", "until"]) if (s[k] != null && !ISO_RE.test(s[k])) return { hata: `${k} YYYY-MM-DD ya da saatli ISO olmalı` };
  if (s.kaynak != null && !/^[A-Za-z0-9_-]{1,40}$/.test(s.kaynak)) return { hata: "kaynak adı geçersiz" };
  const argv = [];
  if (s.since) argv.push("--since", s.since);
  if (s.until) argv.push("--until", s.until);
  if (s.kaynak) argv.push("--kaynak", s.kaynak);
  if (s.metinsiz) argv.push("--metinsiz");
  return { anahtar: JSON.stringify(s), argv };
}

function hesapla(f, yenile) {
  const is = hesapKuyrugu.then(() => new Promise(coz => {
    const basla = Date.now(), degisim = degisimSayaci;
    let hedef;
    try { fs.mkdirSync(GECICI_DIZIN, { recursive: true }); hedef = path.join(GECICI_DIZIN, `gecmis-${process.pid}-${++geciciSay}.json`); }
    catch (e) { coz({ hata: "geçici dizin açılamadı: " + e.message }); return; }
    const c = spawn(process.execPath, [PANO_MJS, "--yalniz-json", hedef, ...f.argv, ...(yenile ? ["--yenile"] : [])],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    etkinCocuk = c;
    let cikti = "", hataMetni = "", bitti = false;
    c.stdout.on("data", d => { if (cikti.length < 20_000) cikti += d; });
    c.stderr.on("data", d => { hataMetni += d; if (hataMetni.length > 20_000) hataMetni = hataMetni.slice(-10_000); });
    const zaman = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* */ } }, HESAP_ZAMAN_ASIMI);
    const bitir = hata => {
      if (bitti) return;
      bitti = true;
      if (etkinCocuk === c) etkinCocuk = null;
      clearTimeout(zaman);
      let json = null;
      if (!hata) { try { json = fs.readFileSync(hedef); } catch (e) { hata = "çıktı okunamadı: " + e.message; } }
      try { fs.rmSync(hedef, { force: true }); } catch { /* */ }
      if (hata) { coz({ hata, uretildi: Date.now(), degisim }); return; }
      const ozet = cikti.split("\n").filter(l => l.trim() && !l.startsWith("JSON: ")).join("\n");
      coz({ json, ozet, uretildi: Date.now(), degisim, sureMs: Date.now() - basla });
    };
    c.on("error", e => bitir("pano.mjs başlatılamadı: " + e.message));
    c.on("close", (kod, sinyal) => bitir(kod === 0 ? null
      : `pano.mjs ${sinyal ? "sinyalle durdu (" + sinyal + ")" : "çıkış kodu " + kod}: ${hataMetni.trim().split("\n").slice(-3).join(" | ") || "?"}`));
  }));
  hesapKuyrugu = is.then(() => {}, () => {});
  return is;
}

function gecmisAl(f, { taze = false, yenile = false } = {}) {
  const c = gecmis.get(f.anahtar);
  const yas = c ? Date.now() - c.uretildi : Infinity;
  if (c && !taze && !yenile && (yas < TAZE_MS || (c.degisim === degisimSayaci && yas < BAYAT_MS))) return Promise.resolve(c);
  let p = gecmisSuren.get(f.anahtar);
  if (!p) {
    // Sıradaki hesap sayısı sınırlı: kuyruk şişip meşru istekleri bekletmesin (alt süreç ~880 MB)
    if (gecmisSuren.size >= HESAP_BEKLEYEN_MAX) return Promise.resolve(c ? { ...c, bayat: "hesap kuyruğu dolu" } : { hata: "hesap kuyruğu dolu", yogun: true });
    p = hesapla(f, yenile).then(r => {
      gecmisSuren.delete(f.anahtar);
      if (r.json) {
        gecmis.delete(f.anahtar); gecmis.set(f.anahtar, r);
        while (gecmis.size > GECMIS_ANAHTAR_MAX) gecmis.delete(gecmis.keys().next().value);
        return r;
      }
      console.error(`Uyarı: geçmiş hesabı başarısız: ${r.hata}`);
      return c ? { ...c, bayat: r.hata } : r;   // eski sonuç varsa onu ver (bayat işaretiyle)
    });
    gecmisSuren.set(f.anahtar, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Sayfalar
//  /            birleşik pano: pano/sablon.html, veri yerine sunucu işaretiyle. Şablon işareti görünce
//               ilk sekme olarak "Canlı"yı ekler (şablona gömülü modül, iframe yok) ve geçmişi
//               /pano.json'dan çeker (pano/SEMA.md "Sunucu modu").
//  /canli, /canli.html  kısayol: /#canli (302). Eski bağımsız canli/sablon.html artık sunulmuyor (yedek).
// ---------------------------------------------------------------------------
const YER_TUTUCU_RE = /(<script\b[^>]*\bid=["']pano-veri["'][^>]*>)\s*__PANO_VERI__\s*(<\/script>)/;
function birlesikSayfa() {
  const sablon = fs.readFileSync(PANO_SABLON, "utf8");
  if (!YER_TUTUCU_RE.test(sablon)) throw new Error("pano/sablon.html'de pano-veri yer tutucusu yok");
  return sablon.replace(YER_TUTUCU_RE, (_, ac, kapa) => ac + JSON.stringify({ sunucuModu: SUNUCU_SURUM }) + kapa);
}
// Sayfa hiçbir yerde çerçevelenmez ve kendisi de çerçeve açmaz (Canlı sekmesi gömülü modül).
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const izinliHost = new Set([`127.0.0.1:${args.port}`, `localhost:${args.port}`]);
const sunucu = http.createServer((req, res) => {
  // DNS yeniden bağlama (rebinding) koruması: yalnız yerel Host başlığı
  if (!izinliHost.has(String(req.headers.host || "").toLowerCase())) { res.writeHead(403); res.end("yasak"); return; }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET" }); res.end(); return; }
  // Başka sitelerin (no-cors fetch/img/iframe) ağır hesap tetiklemesini kes: tarayıcı Sec-Fetch-Site gönderiyorsa
  // yalnız aynı kökenli ya da kullanıcı eylemli (adres çubuğu/yer imi = "none") istekler geçer. Başlıksız istemciler
  // (curl, başlatıcı) etkilenmez.
  const sfs = req.headers["sec-fetch-site"];
  if (sfs && sfs !== "same-origin" && sfs !== "none") { res.writeHead(403); res.end("yasak"); return; }
  let u;
  try { u = new URL(req.url, "http://127.0.0.1"); } catch { res.writeHead(400); res.end(); return; }
  const yolAdi = u.pathname, bas = req.method === "HEAD";
  const metinsiz = evetMi(u.searchParams.get("metinsiz"));
  const ortak = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const html = (metin) => {
    res.writeHead(200, { ...ortak, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP });
    res.end(bas ? undefined : metin);
  };
  const json = (kod, nesne, ek = {}) => {
    if (res.destroyed) return;
    res.writeHead(kod, { ...ortak, ...ek, "Content-Type": "application/json; charset=utf-8" });
    res.end(bas ? undefined : (Buffer.isBuffer(nesne) ? nesne : JSON.stringify(nesne)));
  };
  if (yolAdi === "/" || yolAdi === "/index.html") {
    let metin;
    try { metin = birlesikSayfa(); } catch (e) { res.writeHead(500, ortak); res.end("pano şablonu okunamadı: " + e.message); return; }
    html(metin);
    return;
  }
  if (yolAdi === "/canli" || yolAdi === "/canli/" || yolAdi === "/canli.html") {
    res.writeHead(302, { ...ortak, Location: "/" + u.search + "#canli" }); res.end(); return;
  }
  if (yolAdi === "/durum") {
    const a = anlik();
    json(200, metinsiz ? metinsizle("anlik", a) : a);
    return;
  }
  if (yolAdi === "/olaylar") {
    if (istemciler.size >= ISTEMCI_MAX) { res.writeHead(503, ortak); res.end("çok fazla istemci"); return; }
    res.writeHead(200, { ...ortak, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    if (bas) { res.end(); return; }
    res.metinsiz = metinsiz;
    res.write("retry: 3000\n\n");
    istemciler.add(res);
    gonder("anlik", anlik(), [res]);
    req.on("close", () => istemciler.delete(res));
    return;
  }
  if (yolAdi === "/pano.json" || yolAdi === "/ozet") {
    const f = gecmisSuzgeci(u.searchParams);
    if (f.hata) { json(400, { hata: f.hata }); return; }
    gecmisAl(f, { taze: evetMi(u.searchParams.get("taze")), yenile: evetMi(u.searchParams.get("yenile")) }).then(r => {
      if (yolAdi === "/ozet") {
        const a = anlik();
        json(200, {
          url: `http://127.0.0.1:${args.port}/`, pid: process.pid,
          canli: { oturum: a.oturumlar.length, ajan: a.ajanlar.length, ...a.genel },
          gecmis: { ozet: r.ozet || null, uretildi: r.uretildi || null, sureMs: r.sureMs ?? null, hata: r.json ? (r.bayat || null) : r.hata },
        });
        return;
      }
      if (!r.json) { json(r.yogun ? 429 : 500, { hata: r.hata }); return; }
      const ek = { "X-Pano-Uretildi": String(r.uretildi) };
      if (r.bayat) ek["X-Pano-Bayat"] = encodeURIComponent(r.bayat).slice(0, 500);
      json(200, r.json, ek);
    }, e => json(500, { hata: String(e && e.message || e) }));
    return;
  }
  res.writeHead(404, ortak); res.end("yok");
});

// Önceki (kesilmiş) çalışmalardan kalan geçici geçmiş dosyaları
try { for (const ad of fs.readdirSync(GECICI_DIZIN)) if (/^gecmis-\d+-\d+\.json$/.test(ad)) fs.rmSync(path.join(GECICI_DIZIN, ad), { force: true }); } catch { /* dizin yok */ }

const ilk = baslangic();
sunucu.on("error", e => {
  if (e.code === "EADDRINUSE") console.error(`Hata: ${args.port} portu dolu. Zaten çalışıyor olabilir: http://127.0.0.1:${args.port}/ (başka port: --port)`);
  else console.error("Hata:", e.message);
  process.exit(1);
});
sunucu.listen(args.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${args.port}/`;
  const s = anlik();
  console.log(`Pano sunucusu: ${url} (Canlı: ${url}#canli) · pid ${process.pid}`);
  console.log(`Kök: ${tilde(KOK)} | pencere ${args.pencere} dk | ${ilk.dosya} dosya, ${ilk.ms} ms`);
  console.log(`Oturum ${s.oturumlar.length} (aktif ${s.genel.aktifOturum}), ajan ${s.ajanlar.length} (çalışan ${s.genel.aktifAjan})`);
  // Geçmişi önceden ısıt: ilk sayfa açılışı beklemesin.
  gecmisAl(gecmisSuzgeci(new URLSearchParams())).then(r => console.log(r.json ? `Geçmiş hazır (${((r.sureMs || 0) / 1000).toFixed(1)} sn)` : `Uyarı: geçmiş hazırlanamadı: ${r.hata}`));
  if (args.ac) {
    const k = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    try { spawn(k[0], k[1], { stdio: "ignore", detached: true }).unref(); } catch { /* elle aç */ }
  }
});

try {
  const izleyici = fs.watch(KOK, { recursive: true }, (_olay, ad) => {
    if (!ad) return;
    const y = path.join(KOK, String(ad));
    if (y.endsWith(".jsonl")) planla(y);
    else if (y.endsWith(".desktop-released.json") || y.endsWith("custom-title.json") || y.endsWith(".meta.json")) {
      for (const V of varliklar.values()) {
        if (V.tur === "ajan" && y === V.yol.replace(/\.jsonl$/, ".meta.json")) metaOku(V);
        else if (V.tur === "oturum" && y.includes(V.id)) { oturumDosyalariniOku(V); sonGonderilen.delete(V.id); }
      }
    }
  });
  izleyici.on("error", e => console.error(`Uyarı: fs.watch hatası (${e.message}); yalnız 2 sn yoklama.`));
} catch (e) { console.error(`Uyarı: fs.watch kurulamadı (${e.message}); yalnız 2 sn yoklama.`); }
setInterval(yokla, 2000).unref?.();
setInterval(durumTara, 5000);
setInterval(() => { if (istemciler.size) gonder("anlik", anlik()); }, 30_000);
setInterval(() => { if (istemciler.size) gonder("kalp", { ts: Date.now() }); }, 15_000);
const cocukOldur = () => { try { etkinCocuk?.kill("SIGKILL"); } catch { /* */ } };
process.on("exit", cocukOldur);   // beklenmedik çıkışlarda da yetim alt süreç kalmasın
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { for (const r of istemciler) { try { r.end(); } catch { /* */ } } cocukOldur(); process.exit(0); });

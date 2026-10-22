#!/usr/bin/env node
// Pano veri toplayıcı: kaynak listesindeki (~/Arsiv/claude-konusmalar/kaynaklar.json: Mac + Windows
// arşivi) bütün oturum ve alt ajan transkriptlerini tarar, pano/SEMA.md'deki biçimde tek bir JSON
// üretir (out/pano.json) ve pano/sablon.html'e gömerek out/pano.html yazar.
//
// İki kip (ayrıntı: aşağıdaki "Kip" bölümü ve README):
//   Sunucu (varsayılan): node pano.mjs [--ac] [--canli] [--port 7788] [--yeniden|--durdur] ...
//     Yerel pano sunucusunu (sunucu.mjs, yalnız 127.0.0.1) başlatır ya da çalışanı kullanır; tek
//     sayfada Canlı sekmesi + geçmiş sekmeleri. Geçmiş verisi sunucuda bu betikle (--yalniz-json) hesaplanır.
//   Statik dosya: node pano.mjs --statik|--metinsiz|--artifact|--out <dosya.html> ...
// Statik kip: node pano.mjs [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--metinsiz]
//                         [--yenile] [--ac] [--out <dosya.html>]
//   --since/--until: YYYY-MM-DD ise UTC günü bazında (sınır günü dahil); saatli ISO ise anlık
//                    (saat dilimi yazılmazsa yerel saat; UTC için sonuna Z). usage.mjs ile aynı.
//                    Süzme kayıt düzeyindedir: aralık dışındaki kayıtlar hiç sayılmaz.
//   --kaynak:   yalnız o kaynağı oku (mac, windows).
//   --metinsiz: serbest metin alanlarını (ilkIstem, istem metinleri, ajan istemi) null yapar.
//   --yenile:   önbelleği yok sayıp bütün dosyaları yeniden ayrıştırır.
//   --ac:       üretilen HTML'i varsayılan tarayıcıda açar.
//   --out:      HTML yolu (JSON aynı adla .json). Varsayılan out/pano.html + out/pano.json.
//
// Önbellek: out/.pano-onbellek.json. Dosya başına (mutlak yol, boyut, mtimeMs) ayrıştırılmış ara
// kayıtlar tutulur; değişmeyen dosya yeniden okunmaz. Ayrıştırıcı mantığı değişirse ONBELLEK_SURUM'u
// artır. Tekilleştirme (message.id, kayıt uuid'si) ve --since/--until/--kaynak süzmesi önbellekten
// SONRA yapılır; önbellek süzgeçten bağımsızdır.
//
// Transkript kökleri SALT OKUNUR: bu betik oralara hiçbir şey yazmaz.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { kaynaklariOku, normModel, label, cost, projectName, walk, redact, excerpt } from "./ortak.mjs";

// Önbellek sürümü: ayrıştırıcı (dosyaAyristir ve yardımcıları) değişince baştaki sayıyı artır. redact
// kaynağının özeti de eklidir: redact değişince önbellek kendiliğinden geçersizleşir.
const ONBELLEK_SURUM = "3:" + createHash("sha1").update(redact.toString()).digest("hex").slice(0, 8);
const VERI_SURUM = 1;       // pano/SEMA.md sürümü
const BASLA_MS = Date.now();

const BETIK_DIZINI = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIZINI = path.join(BETIK_DIZINI, "out");
const ONBELLEK_YOLU = path.join(OUT_DIZINI, ".pano-onbellek.json");
const SABLON_YOLU = path.join(BETIK_DIZINI, "pano", "sablon.html");
// Şablondaki gömme noktası (SEMA.md: tam bir kez). Öznitelik sırası/boşluk farkına toleranslı.
const YER_TUTUCU_RE = /(<script\b[^>]*\bid=["']pano-veri["'][^>]*>)\s*__PANO_VERI__\s*(<\/script>)/g;

// ---------------------------------------------------------------------------
// Argümanlar (usage.mjs ile aynı kurallar; ek olarak değersiz bayraklar)
// ---------------------------------------------------------------------------
const YARDIM = `Kullanım:
  Sunucu (varsayılan): node pano.mjs [--ac] [--canli] [--port 7788] [--pencere <dk>] [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--yenile] [--yeniden | --durdur]
  Statik dosya:        node pano.mjs --statik|--metinsiz|--artifact|--out <dosya.html> [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--metinsiz] [--yenile] [--ac]`;
const args = { since: null, until: null, kaynak: null, out: null, metinsiz: false, yenile: false, ac: false, artifact: false,
  statik: false, yalnizJson: null, port: null, pencere: null, canli: false, durdur: false, yeniden: false };
const DEGERLI = { "--since": "since", "--until": "until", "--kaynak": "kaynak", "--out": "out", "--yalniz-json": "yalnizJson", "--port": "port", "--pencere": "pencere" };
const DEGERSIZ = { "--metinsiz": "metinsiz", "--yenile": "yenile", "--ac": "ac", "--artifact": "artifact", "--statik": "statik", "--canli": "canli", "--durdur": "durdur", "--yeniden": "yeniden" };
for (let i = 2; i < process.argv.length; i++) {
  let a = process.argv[i], v;
  if (a === "-h" || a === "--help" || a === "--yardim") { console.log(YARDIM); process.exit(0); }
  const esit = a.indexOf("=");
  if (a.startsWith("--") && esit > 0) { v = a.slice(esit + 1); a = a.slice(0, esit); }
  if (Object.hasOwn(DEGERSIZ, a)) {
    if (v !== undefined) { console.error(`${a} değer almaz`); process.exit(1); }
    args[DEGERSIZ[a]] = true;
    continue;
  }
  if (!Object.hasOwn(DEGERLI, a)) { console.error(`bilinmeyen argüman: ${process.argv[i]}\n${YARDIM}`); process.exit(1); }
  if (v === undefined) v = process.argv[++i];
  if (v === undefined || v === "" || v.startsWith("--")) { console.error(`${a} için bir değer ver (bulunan: ${v === undefined ? "yok" : v || "boş"})`); process.exit(1); }
  args[DEGERLI[a]] = v;
}
for (const k of ["since", "until"]) {
  if (args[k] == null) continue;
  // Takvimde olmayan günler (2026-02-30, 2026-13-01) reddedilir: tarih kısmı gidiş-dönüşte aynı kalmalı.
  const g = args[k].match(/^(\d{4})-(\d{2})-(\d{2})/);
  const takvimde = g && new Date(Date.UTC(+g[1], +g[2] - 1, +g[3])).toISOString().slice(0, 10) === g[0];
  if (Number.isNaN(Date.parse(args[k])) || !takvimde) { console.error(`--${k} YYYY-MM-DD ya da saatli ISO olmalı (ör. 2026-10-05T12:30:00Z), takvimde olan bir gün: ${args[k]}`); process.exit(1); }
}
// --out: .html ile bitmeli ve var olan bir dizin olmamalı; JSON aynı adla .json olur.
if (args.out != null) {
  if (!/\.html$/i.test(args.out)) { console.error(`--out bir .html dosya yolu olmalı (bulunan: ${args.out})`); process.exit(1); }
  if (fs.existsSync(args.out) && fs.statSync(args.out).isDirectory()) { console.error(`--out bir dizin, dosya yolu ver: ${args.out}`); process.exit(1); }
  if (path.resolve(args.out) === path.resolve(SABLON_YOLU)) { console.error(`--out şablonun kendisi olamaz: ${args.out}`); process.exit(1); }
}
// --yalniz-json: sunucunun (sunucu.mjs) iç kullanımı; yalnız JSON yazar, HTML ve tarayıcı yok.
if (args.yalnizJson != null) {
  if (!/\.json$/i.test(args.yalnizJson)) { console.error(`--yalniz-json bir .json dosya yolu olmalı (bulunan: ${args.yalnizJson})`); process.exit(1); }
  if (args.out != null || args.artifact || args.ac) { console.error("--yalniz-json, --out/--artifact/--ac ile birlikte kullanılamaz"); process.exit(1); }
}

// ---------------------------------------------------------------------------
// Kip: sunucu (varsayılan) ya da statik dosya. Dosya üreten bayraklar (--statik, --out, --artifact,
// --metinsiz, --yalniz-json) statik kipi seçer; sunucu bayrakları (--port, --pencere, --canli,
// --durdur, --yeniden) sunucu kipini. --metinsiz sunucu bayrağıyla birlikte verilirse sayfa
// ?metinsiz=1 ile açılır. Sunucu kipinde bu betik yalnız başlatıcıdır (baslat.mjs): sunucu
// (sunucu.mjs) çalışıyorsa onu kullanır, yoksa arka planda başlatır; hesap sunucunun alt sürecinde.
// ---------------------------------------------------------------------------
{
  const sunucuBayragi = args.port != null || args.pencere != null || args.canli || args.durdur || args.yeniden;
  const dosyaBayragi = args.statik || args.out != null || args.artifact || args.yalnizJson != null;
  if (sunucuBayragi && dosyaBayragi) { console.error(`Sunucu bayrakları (--port, --pencere, --canli, --durdur, --yeniden) statik bayraklarla (--statik, --out, --artifact) birlikte kullanılamaz.\n${YARDIM}`); process.exit(1); }
  if (sunucuBayragi || (!dosyaBayragi && !args.metinsiz)) {
    const sayiArg = (ad, v, min, max) => {
      if (v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max || (ad === "--port" && !Number.isInteger(n))) { console.error(`${ad} ${min}-${max} arası sayı olmalı (bulunan: ${v})`); process.exit(1); }
      return n;
    };
    if (args.durdur && args.yeniden) { console.error("--durdur ile --yeniden birlikte olmaz"); process.exit(1); }
    const { baslat } = await import("./baslat.mjs");
    const kod = await baslat({
      port: sayiArg("--port", args.port, 1, 65535) ?? 7788, pencere: sayiArg("--pencere", args.pencere, 1, 100000),
      ac: args.ac, canli: args.canli, durdur: args.durdur, yeniden: args.yeniden, yenile: args.yenile,
      suzgec: { since: args.since, until: args.until, kaynak: args.kaynak, metinsiz: args.metinsiz },
    });
    // Çıktı bir boruya gidiyorsa (Claude Code Bash) process.exit yazılmamış satırları kesebilir: önce boşalt.
    await new Promise(r => process.stdout.write("", r));
    await new Promise(r => process.stderr.write("", r));
    process.exit(kod);
  }
}

// since/until: YYYY-MM-DD ise UTC günü (sınır günü dahil), saatli ISO ise anlık karşılaştırma.
// usage.mjs'teki aralikDisi() ile eşdeğer; zaman damgası olmayan kayıt süzülmez (usage.mjs gibi).
const GUN = /^\d{4}-\d{2}-\d{2}$/;
const ALT_SINIR = args.since == null ? -Infinity : GUN.test(args.since) ? Date.parse(args.since + "T00:00:00Z") : Date.parse(args.since);
const UST_SINIR = args.until == null ? Infinity : GUN.test(args.until) ? Date.parse(args.until + "T00:00:00Z") + 86400000 - 1 : Date.parse(args.until);
const aralikta = ts => ts == null || (ts >= ALT_SINIR && ts <= UST_SINIR);

// ---------------------------------------------------------------------------
// Kaynaklar
// ---------------------------------------------------------------------------
let KAYNAKLAR = kaynaklariOku();
if (args.kaynak) {
  const adlar = KAYNAKLAR.map(k => k.ad);
  KAYNAKLAR = KAYNAKLAR.filter(k => k.ad === args.kaynak);
  if (!KAYNAKLAR.length) { console.error(`--kaynak "${args.kaynak}" bulunamadı. Mevcut: ${adlar.join(", ") || "(yok)"}`); process.exit(1); }
}
if (!KAYNAKLAR.length) { console.error("Taranacak kaynak dizini yok."); process.exit(1); }

// ---------------------------------------------------------------------------
// Ayrıştırıcı: bir .jsonl dosyasını sıkıştırılmış olay listesine çevirir (önbelleğe giren biçim).
//
// d = { baslik, ad, ilk, son, ilkMetin, zamanli, e: [olay...], yb: [uuid...] }
//   baslik: son custom-title, ad: son agent-name, ilk/son: en eski/yeni zaman damgası (ms),
//   ilkMetin: (alt ajan) ilk kullanıcı metni ≤ 300, yb: sessionId'si dosyanın oturumundan farklı
//   kayıtların uuid'leri (çatallanan/devam ettirilen oturumlarda kopyalanmış geçmiş),
//   zamanli: (ana dosya) ilk kullanıcı mesajı "<scheduled-task" ile başlıyor mu (null: mesaj yok).
// Olaylar (dosya sırasıyla; ts kaydın ham zamanı (ms), zaman damgası yoksa null):
//   ["M", version, entrypoint, gitBranch, cwd]            sonraki kayıtların bağlamı değişti
//   ["A", uuid, ts, msgId, model, kullanım|0, effort, düşünmeBlok, düşünmeMs, metinVar, araçlar]
//        kullanım: [input, output, cacheRead, cw5m, cw1h] (usage.mjs'in saydığı kayıtlarda)
//        araçlar: [[toolUseId, ad, bilgi?]...]
//   ["P", uuid, ts, karakter, metin≤400, görsel, permissionMode, slash]   insan istemi
//   ["K", uuid, ts]                                        "[Request interrupted by user" kesintisi
//   ["R", uuid, ts, [[toolUseId, durum, agentId?]...]]    araç sonuçları; durum 0 tamam, 1 hata,
//                                                          2 izin reddi, 3 kullanıcı kesintisi
//   ["C", uuid, ts, önceToken, sonraToken, tetik]          compact_boundary
//   ["E", uuid, ts]                                        system/api_error
// ---------------------------------------------------------------------------
const ATLA_ONEK = [
  '{"type":"file-history-', '{"type":"queue-operation"', '{"type":"last-prompt"', '{"type":"atis-latch"',
  '{"type":"bridge-session"', '{"type":"mode"', '{"type":"cost-state"', '{"type":"frame-link"',
  '{"type":"artifact-', '{"type":"relocated"',
];
const RET_TURLERI = new Set(["user-rejected", "automode-blocked", "permission-rule"]);
// toolDenialKind alanı olmayan eski kayıtlar için Claude Code ret metinleri.
const RET_KALIP = /^(The user doesn't want to (proceed with|take) this|Permission to use \S+.{0,300}? has been denied|Permission for this \w+ was denied by|.{0,80}\bdenied by (the )?(user|Claude Code|auto mode|a PreToolUse hook|permission rule))/i;
function str(v) { return typeof v === "string" && v ? v : null; }

function hataSinifi(tdk, icerik) {
  if (tdk) return RET_TURLERI.has(tdk) ? 2 : tdk === "interrupted" ? 3 : 1;
  const t = (typeof icerik === "string" ? icerik
    : Array.isArray(icerik) ? icerik.map(x => (x && typeof x.text === "string" ? x.text : "")).join("\n") : "").slice(0, 500).trimStart();
  if (RET_KALIP.test(t)) return 2;
  if (t.startsWith("[Request interrupted by user") || t.startsWith("Request was aborted")) return 3;
  return 1;
}

// Kabuk metninde i'den başlayan sözcüğün bittiği indeks. Tırnaklar, $(...)/${...} iç içeliği ve
// kaçışlar (bash: \, PowerShell: `) korunur; derinlik 0'da boşluk ya da ;&|<>() sözcüğü bitirir.
function sozcukSonu(s, i, ps) {
  const kacis = ps ? "`" : "\\";
  let derin = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === kacis) { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === kacis) i++; i++; } i++; continue; }
    if (!ps && c === "`") { const j = s.indexOf("`", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === "$" && (s[i + 1] === "(" || s[i + 1] === "{")) { derin++; i += 2; continue; }
    if (derin > 0) { if (c === "(" || c === "{") derin++; else if (c === ")" || c === "}") derin--; i++; continue; }
    if (/[\s;&|<>()]/.test(c)) break;
    i++;
  }
  return Math.min(i, s.length);
}
// i'den sonraki ilk komut ayırıcısının (derinlik 0'da ; && || | ya da yeni satır) hemen sonrası.
function komutSonu(s, i, ps) {
  const kacis = ps ? "`" : "\\";
  let derin = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === kacis) { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === kacis) i++; i++; } i++; continue; }
    if ("({[".includes(c)) derin++;
    else if (")}]".includes(c)) derin = Math.max(0, derin - 1);
    else if (derin === 0 && (c === ";" || c === "\n" || c === "|" || c === "&")) {
      return s[i + 1] === c && (c === "|" || c === "&") ? i + 2 : i + 1;
    }
    i++;
  }
  return s.length;
}
function sozcukler(s, i, ps, max = 12) {   // ilk komutun sözcükleri (ayırıcıda durur)
  const out = [];
  while (i < s.length && out.length < max) {
    while (i < s.length && /[ \t]/.test(s[i])) i++;
    if (i >= s.length || /[;&|<>()\n]/.test(s[i])) break;
    const j = sozcukSonu(s, i, ps);
    if (j <= i) break;
    out.push(s.slice(i, j).replace(/^(["'])(.*)\1$/s, "$2"));
    i = j;
  }
  return out;
}

// Bash/PowerShell komut başı: baştaki yorumlar, cd/pushd/Set-Location ... ayırıcı, VAR=x ve
// PowerShell $x = ... atamaları, export/set deyimleri, sudo/env/time/timeout/nohup sarmalayıcıları atılır;
// ilk sözcüğün basename'i alınır; git/npm/pnpm/npx/yarn/gh/docker/brew/pip/cargo için alt komutla iki
// sözcük ("git commit"), python -m için modül adıyla ("python -m pytest"); for/while/until/select
// döngüsünde do'dan, if'te then'den sonraki komut.
const IKI_SOZCUK = new Set(["git", "npm", "pnpm", "npx", "yarn", "gh", "docker", "brew", "pip", "pip3", "cargo"]);
const ARGUMANLI_SECENEK = new Set(["-C", "-c", "--prefix", "--filter", "--dir", "--cwd", "-F", "--git-dir", "--work-tree", "-R", "--repo"]);
// Sarmalayıcılar ve argüman alan seçenekleri (sudo -u X cmd -> cmd, timeout -s KILL 5 cmd -> cmd).
const SARMALAYICI = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T"]), env: new Set(["-u", "-C", "-S"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]), nice: new Set(["-n"]), time: new Set(["-f", "-o"]),
  nohup: new Set(), exec: new Set(["-a"]), command: new Set(), noglob: new Set(), builtin: new Set(),
};
const DEYIM = /^(cd|pushd|popd|chdir|Set-Location|sl|Push-Location|Pop-Location|export|set|unset|shopt|trap|setopt|Set-StrictMode)$/i;
function komutBasi(komut, ps = false) {
  if (typeof komut !== "string") return null;
  let s = ps ? komut : komut.replace(/\\\r?\n/g, " ");
  let atilan = null;
  for (let tur = 0; tur < 60; tur++) {
    s = s.replace(/^(\s|;|&&|\|\||!(?=\s))+/, "");
    if (!s) break;
    if (s[0] === "#") { const j = s.indexOf("\n"); s = j < 0 ? "" : s.slice(j + 1); continue; }
    const we = sozcukSonu(s, 0, ps);
    const w = s.slice(0, we);
    if (!w || w === "&" || w === "!" || w === "{" || w === "}") { s = s.slice(Math.max(1, we)); continue; }   // ( { & ! önekleri
    if (DEYIM.test(w)) { atilan = w.toLowerCase().startsWith("set-location") || /^(sl|chdir|pushd|popd|push-location|pop-location)$/i.test(w) ? "cd" : w; s = s.slice(komutSonu(s, we, ps)); continue; }
    if (!ps && /^[A-Za-z_]\w*\+?=/.test(w)) { atilan = atilan ?? "atama"; s = s.slice(we); continue; }
    if (ps && /^\$[\w:]+$/.test(w) && /^\s*[-+*/]?=(?!=)/.test(s.slice(we))) { atilan = atilan ?? "atama"; s = s.slice(komutSonu(s, we, ps)); continue; }
    if (!ps && Object.hasOwn(SARMALAYICI, w)) {
      atilan = w;
      s = s.slice(we);
      let sureAlindi = false;
      for (let k = 0; k < 8; k++) {
        const m = s.match(/^[ \t]+(\S+)/);
        if (!m) break;
        const tok = m[1];
        if (tok.startsWith("-")) {
          s = s.slice(m[0].length);
          if (SARMALAYICI[w].has(tok)) { const a = s.match(/^[ \t]+\S+/); if (a) s = s.slice(a[0].length); }
          continue;
        }
        if (w === "timeout" && !sureAlindi && /^\d+(\.\d+)?[smhd]?$/.test(tok)) { s = s.slice(m[0].length); sureAlindi = true; continue; }
        break;
      }
      continue;
    }
    if (!ps && /^(for|while|until|select|if)$/.test(w)) {
      const m = s.slice(we).match(w === "if" ? /(^|[\s;])then(\s|$)/ : /(^|[\s;])do(\s|$)/);
      if (m) { s = s.slice(we + m.index + m[0].length); atilan = w; continue; }
      return w;
    }
    const parca = sozcukler(s, 0, ps);
    if (!parca.length) return null;
    let ilk = parca[0].replace(/["']/g, "");
    ilk = (ilk.split(/[\\/]/).pop() || ilk).replace(/\.(exe|cmd|bat)$/i, "");
    if (!ilk) return null;
    if (ilk.length > 40) ilk = ilk.slice(0, 40);
    if (IKI_SOZCUK.has(ilk.toLowerCase())) {
      for (let i = 1; i < parca.length; i++) {
        const p = parca[i];
        if (p.startsWith("-")) { if (ARGUMANLI_SECENEK.has(p)) i++; continue; }
        if (/^[@A-Za-z][\w:@/.+-]{0,40}$/.test(p)) return ilk + " " + p;
        break;
      }
      return ilk;
    }
    if (/^(python[0-9.]*|py)$/i.test(ilk)) {
      const mi = parca.indexOf("-m");
      if (mi > 0 && parca[mi + 1] && /^[\w.]{1,40}$/.test(parca[mi + 1])) return ilk + " -m " + parca[mi + 1];
    }
    return ilk;
  }
  return atilan === "atama" ? null : atilan;
}

function alanAdi(url) {
  if (typeof url !== "string") return null;
  try { return new URL(url).hostname.replace(/^www\./, "") || null; } catch { return null; }
}

function aracBilgisi(b) {
  const ad = typeof b.name === "string" && b.name ? b.name : "?";
  const g = b.input && typeof b.input === "object" ? b.input : {};
  let bilgi = null;
  switch (ad) {
    case "Bash": case "PowerShell": bilgi = komutBasi(g.command, ad === "PowerShell"); break;
    case "Read": bilgi = str(g.file_path) && ["o", g.file_path]; break;
    case "Edit": case "MultiEdit": case "NotebookEdit": bilgi = str(g.file_path || g.notebook_path) && ["d", g.file_path || g.notebook_path]; break;
    case "Write": bilgi = str(g.file_path) && ["y", g.file_path]; break;
    case "WebFetch": bilgi = alanAdi(g.url); break;
    case "Skill": bilgi = str(g.skill) || str(g.command) || str(g.name); break;
    case "Agent": case "Task":
      bilgi = {
        d: str(g.description) && redact(g.description), t: str(g.subagent_type), m: str(g.model),
        b: typeof g.run_in_background === "boolean" ? g.run_in_background : null,
        i: str(g.isolation), p: typeof g.prompt === "string" ? excerpt(g.prompt, 297) : null,
      };
      break;
  }
  return bilgi ? [str(b.id), ad, bilgi] : [str(b.id), ad];
}

function istemMi(o, temiz, gorsel) {
  if (!temiz && !gorsel) return false;
  const koken = o.turnOrigin ?? (o.origin && typeof o.origin === "object" ? o.origin.kind : o.origin);
  // Zamanlanmış görev çalıştırmaları turnOrigin "human" taşısa da otomatiktir (kullanıcı yok).
  if (koken != null) return koken === "human" && !temiz.startsWith("<scheduled-task");
  return !(temiz.startsWith("<task-notification>") || temiz.startsWith("<local-command-") ||
    temiz.startsWith("<agent-message") || temiz.startsWith("Another Claude session sent a message") ||
    temiz.startsWith("<scheduled-task"));
}

function istemMetni(temiz) {
  const cm = temiz.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/);
  if (cm && cm[1]) {
    const ad = cm[1].startsWith("/") ? cm[1] : "/" + cm[1];
    const arg = (temiz.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1];
    return { gosterim: arg && arg.trim() ? ad + " " + arg.trim() : ad, slash: ad };
  }
  const bi = temiz.match(/^<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bi) return { gosterim: "! " + bi[1].trim(), slash: null };
  return { gosterim: temiz, slash: null };
}

function dosyaAyristir(yol, beklenenOturum) {
  const metin = fs.readFileSync(yol, "utf8");
  const d = { baslik: null, ad: null, ilk: null, son: null, ilkMetin: null, zamanli: null, e: [], yb: [] };
  const durum = { sonMeta: [null, null, null, null] };
  const n = metin.length;
  let i = 0;
  while (i < n) {
    let j = metin.indexOf("\n", i);
    if (j < 0) j = n;
    const satir = metin.slice(i, j);
    i = j + 1;
    if (satir.length < 2) continue;
    // Ucuz ön eleme: büyük ve gereksiz satırlar (attachment, file-history, kuyruk...) parse edilmez.
    if (satir.startsWith('{"type":"')) {
      if (ATLA_ONEK.some(p => satir.startsWith(p))) continue;
    } else if (satir.includes('"type":"attachment","uuid":"')) continue;
    let o;
    try { o = JSON.parse(satir); } catch { continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    // Beklenmedik biçimli satır yalnız kendini düşürür: yarım kalan değişiklikler geri alınır.
    const yedek = [d.e.length, d.yb.length, d.baslik, d.ad, d.ilk, d.son, d.ilkMetin, d.zamanli, durum.sonMeta];
    try { satirIsle(o, satir, d, durum, beklenenOturum); }
    catch {
      d.e.length = yedek[0]; d.yb.length = yedek[1];
      [, , d.baslik, d.ad, d.ilk, d.son, d.ilkMetin, d.zamanli, durum.sonMeta] = yedek;
    }
  }
  return d;
}

const sayiOf = v => Number(v) || 0;

function satirIsle(o, satir, d, durum, beklenenOturum) {
  // Zaman damgası ham saklanır (yoksa null); süzgeç ham değere bakar, miras zaman toplamada hesaplanır.
  let ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : null;
  if (Number.isNaN(ts)) ts = null;
  if (ts != null) {
    if (d.ilk == null || ts < d.ilk) d.ilk = ts;
    if (d.son == null || ts > d.son) d.son = ts;
  }
  const tip = o.type;
  if (tip === "custom-title") { if (typeof o.customTitle === "string" && o.customTitle) d.baslik = redact(o.customTitle); return; }
  if (tip === "agent-name") { if (typeof o.agentName === "string" && o.agentName) d.ad = redact(o.agentName); return; }
  const msg = o.message && typeof o.message === "object" ? o.message : null;
  // usage.mjs ile aynı sayım koşulu ("custom-title" geçen satırı o da saymaz).
  const cagri = !!(msg && msg.usage && msg.model && msg.model !== "<synthetic>" && !satir.includes('"custom-title"'));
  if (tip !== "assistant" && tip !== "user" && tip !== "system" && !cagri) return;
  const uuid = typeof o.uuid === "string" ? o.uuid : null;
  // Bağlam alanları yalnız değişince yazılır; eksik alan bir önceki değeri korur.
  const mt = [str(o.version), str(o.entrypoint), str(o.gitBranch), str(o.cwd)].map((v, k) => v ?? durum.sonMeta[k]);
  if (mt.some((v, k) => v !== durum.sonMeta[k])) { d.e.push(["M", ...mt]); durum.sonMeta = mt; }
  if (uuid && typeof o.sessionId === "string" && o.sessionId !== beklenenOturum) d.yb.push(uuid);
  const t = ts;

  if (tip === "assistant" || cagri) {
    let u = 0;
    if (cagri) {
      const us = typeof msg.usage === "object" ? msg.usage : {};
      const cc = us.cache_creation && typeof us.cache_creation === "object" ? us.cache_creation : {};
      const cwTotal = sayiOf(us.cache_creation_input_tokens);
      const cw1h = sayiOf(cc.ephemeral_1h_input_tokens);
      const cw5m = cc.ephemeral_5m_input_tokens != null ? sayiOf(cc.ephemeral_5m_input_tokens) : Math.max(0, cwTotal - cw1h);
      u = [sayiOf(us.input_tokens), sayiOf(us.output_tokens), sayiOf(us.cache_read_input_tokens), cw5m, cw1h];
    }
    let dusB = 0, metinVar = 0;
    const araclar = [];
    const ic = msg ? msg.content : null;
    if (typeof ic === "string") metinVar = ic.trim() ? 1 : 0;
    else if (Array.isArray(ic)) for (const b of ic) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "thinking" || b.type === "redacted_thinking") dusB++;
      else if (b.type === "text") { if (typeof b.text === "string" && b.text.trim()) metinVar = 1; }
      else if (b.type === "tool_use") araclar.push(aracBilgisi(b));
    }
    const model = msg ? (typeof msg.model === "string" ? msg.model : msg.model != null ? "?" : null) : null;
    const msgId = msg && (typeof msg.id === "string" || typeof msg.id === "number") && msg.id !== "" ? String(msg.id) : null;
    d.e.push(["A", uuid, t, msgId, model, u,
      str(o.effort), dusB, typeof o.thinkingDurationMs === "number" ? o.thinkingDurationMs : 0, metinVar, araclar]);
  } else if (tip === "user") {
    const ic = msg ? msg.content : null;
    const parcalar = [];
    const sonuclar = [];
    let gorsel = 0;
    if (typeof ic === "string") parcalar.push(ic);
    else if (Array.isArray(ic)) for (const b of ic) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_result") sonuclar.push([str(b.tool_use_id), b.is_error ? hataSinifi(str(o.toolDenialKind), b.content) : 0]);
      else if (b.type === "text" && typeof b.text === "string") parcalar.push(b.text);
      else if (b.type === "image") gorsel++;
    }
    if (sonuclar.length) {
      const tur = o.toolUseResult;
      const aid = tur && typeof tur === "object" && !Array.isArray(tur) ? str(tur.agentId) : null;
      if (aid && sonuclar.length === 1) sonuclar[0].push(aid);
      d.e.push(["R", uuid, t, sonuclar]);
    }
    if (o.isMeta || o.isCompactSummary) return;
    const temiz = parcalar.join("\n").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    // Zamanlanmış görev oturumu: ilk (meta olmayan, araç sonucu olmayan) kullanıcı mesajına bakılır.
    if (d.zamanli == null && !o.isSidechain && !sonuclar.length && (temiz || gorsel)) d.zamanli = temiz.startsWith("<scheduled-task");
    if (temiz.startsWith("[Request interrupted by user")) { d.e.push(["K", uuid, t]); return; }
    if (sonuclar.length) return;
    if (o.isSidechain) {
      if (d.ilkMetin == null && temiz) d.ilkMetin = excerpt(temiz, 297);
      return;
    }
    if (istemMi(o, temiz, gorsel)) {
      const { gosterim, slash } = istemMetni(temiz);
      d.e.push(["P", uuid, t, gosterim.length, excerpt(gosterim, 397), gorsel, str(o.permissionMode), slash]);
    }
  } else if (tip === "system") {
    if (o.subtype === "compact_boundary") {
      const cm = o.compactMetadata && typeof o.compactMetadata === "object" ? o.compactMetadata : {};
      d.e.push(["C", uuid, t, typeof cm.preTokens === "number" ? cm.preTokens : null,
        typeof cm.postTokens === "number" ? cm.postTokens : null, str(cm.trigger)]);
    } else if (o.subtype === "api_error") d.e.push(["E", uuid, t]);
  }
}

// ---------------------------------------------------------------------------
// 1) Dosyaları bul, önbellekten al ya da ayrıştır
// ---------------------------------------------------------------------------
let eskiOnbellek = {};
if (fs.existsSync(ONBELLEK_YOLU)) {
  try {
    const j = JSON.parse(fs.readFileSync(ONBELLEK_YOLU, "utf8"));
    if (!j || typeof j !== "object" || !j.dosyalar || typeof j.dosyalar !== "object" || Array.isArray(j.dosyalar)) console.error("Uyarı: önbellek biçimi bozuk, yeniden kurulacak.");
    else if (j.surum !== ONBELLEK_SURUM) console.error("Bilgi: önbellek sürümü farklı, yeniden ayrıştırılacak.");
    else eskiOnbellek = j.dosyalar;
  } catch (e) { console.error(`Uyarı: önbellek okunamadı, yeniden kurulacak (${e.message}).`); }
}
// Önbellek kaydının şekli: { b: boyut, m: mtimeMs, d: { e: [[kod, ...]...], yb: [...] } }
const kayitGecerli = k => !!(k && typeof k === "object" && k.d && typeof k.d === "object" &&
  Array.isArray(k.d.e) && Array.isArray(k.d.yb) && k.d.e.every(x => Array.isArray(x) && typeof x[0] === "string"));
let bozukKayit = 0;

const dosyalar = [];               // { yol, kaynak, kok, dirKey, oturum, ajan, alt, d }
const oturumYerleri = new Map();   // oturum kimliği -> Set("kaynak:proje klasörü")
const yeniOnbellek = {};
let ayristirilan = 0, onbellekten = 0;
for (const src of KAYNAKLAR) {
  const liste = walk(src.kok);
  src.dosya = liste.length;
  for (const yol of liste) {
    const rel = path.relative(src.kok, yol).split(path.sep);
    const dirKey = rel[0];
    const alt = rel.includes("subagents");
    const oturum = alt ? rel[1] : path.basename(yol, ".jsonl");
    const ajan = alt ? path.basename(yol, ".jsonl").replace(/^agent-/, "") : null;
    // Aynı oturum kimliği iki kaynakta ya da iki proje klasöründe olabilir: ikisi de okunur, kopya
    // kayıtları uuid/message.id sahipliği tekilleştirir (aşağıda uyarı verilir).
    if (!oturumYerleri.has(oturum)) oturumYerleri.set(oturum, new Set());
    oturumYerleri.get(oturum).add(src.ad + ":" + dirKey);
    let st;
    try { st = fs.statSync(yol); } catch { continue; }
    const eski = args.yenile ? null : eskiOnbellek[yol];
    const eskiGecerli = !!eski && kayitGecerli(eski);
    if (eski && !eskiGecerli) bozukKayit++;
    let d;
    if (eskiGecerli && eski.b === st.size && eski.m === st.mtimeMs) { d = eski.d; onbellekten++; }
    else {
      try { d = dosyaAyristir(yol, oturum); } catch (e) { console.error(`Uyarı: okunamadı, atlandı: ${yol} (${e.message})`); continue; }
      ayristirilan++;
    }
    yeniOnbellek[yol] = { b: st.size, m: st.mtimeMs, d };
    dosyalar.push({ yol, kaynak: src.ad, kok: src.kok, dirKey, oturum, ajan, alt, d });
  }
}
if (bozukKayit) console.error(`Uyarı: önbellekte ${bozukKayit} bozuk kayıt vardı, o dosyalar yeniden ayrıştırıldı.`);
for (const [oturum, yerler] of oturumYerleri) {
  if (yerler.size > 1) console.error(`Uyarı: ${oturum} oturumu birden çok yerde var (${[...yerler].join(" | ")}); hepsi okunuyor, kopya kayıtlar bir kez sayılıyor.`);
}

// Önbelleği yaz: taranan köklerde artık olmayan dosyalar düşer, taranmayan köklerin (--kaynak) hâlâ
// diskte olan kayıtları kalır.
{
  const taranan = KAYNAKLAR.map(k => k.kok + path.sep);
  for (const [yol, k] of Object.entries(eskiOnbellek)) {
    if (yeniOnbellek[yol] || taranan.some(p => yol.startsWith(p)) || !kayitGecerli(k) || !fs.existsSync(yol)) continue;
    yeniOnbellek[yol] = k;
  }
  if (ayristirilan > 0 || bozukKayit > 0 || Object.keys(eskiOnbellek).length !== Object.keys(yeniOnbellek).length) {
    try {
      fs.mkdirSync(OUT_DIZINI, { recursive: true });
      const gecici = ONBELLEK_YOLU + "." + process.pid + ".tmp";
      fs.writeFileSync(gecici, JSON.stringify({ surum: ONBELLEK_SURUM, dosyalar: yeniOnbellek }));
      fs.renameSync(gecici, ONBELLEK_YOLU);
    } catch (e) { console.error(`Uyarı: önbellek yazılamadı (${e.message}).`); }
  }
}

// ---------------------------------------------------------------------------
// 2) Sahiplik: aynı kayıt (uuid) / API çağrısı (message.id) birden çok dosyada olabilir
//    (çatallanan ya da devam ettirilen oturumlar geçmişi kopyalar). Her biri tek bir dosyaya
//    atanır: önce kaydın sessionId'si dosyanın oturumuyla eşleşen, sonra oturumu en erken biten
//    (ata oturum), sonra tarama sırasında ilk gelen. Çağrı sayımı/maliyet usage.mjs ile aynıdır:
//    message.id ile tekil, alanlarda maks; yalnız hangi oturuma yazılacağı bu kurala göre seçilir.
// ---------------------------------------------------------------------------
const oturumSon = new Map();
for (const f of dosyalar) {
  const s = f.d.son ?? -Infinity;
  if (!oturumSon.has(f.oturum) || s > oturumSon.get(f.oturum)) oturumSon.set(f.oturum, s);
}
dosyalar.forEach((f, fi) => { f.fi = fi; f.oSon = oturumSon.get(f.oturum); f.ybK = new Set(f.d.yb); });
function dahaIyi(fa, ya, fb, yb) {
  if (ya !== yb) return !ya;
  if (fa.oSon !== fb.oSon) return fa.oSon < fb.oSon;
  return fa.fi < fb.fi;
}

const uuidSahip = new Map();    // uuid -> dosya indeksi
const cagrilar = new Map();     // message.id (yoksa dosya:uuid) -> { u, model, sahip, yab, ts, maliyet }
const aracHaritasi = new Map(); // toolUseId -> [araç adı, ts, model anahtarı]
const spawnlar = new Map();     // Agent/Task toolUseId -> spawn bilgisi
const ajanBag = new Map();      // agentId -> spawn toolUseId (araç sonucundaki toolUseResult.agentId)
// Araç kovası model anahtarı: aracı çağıran asistan mesajının modeli ("" = bilinmiyor -> -1).
const aracModeli = m => (typeof m === "string" && m && m !== "<synthetic>" ? normModel(m) : "");
// Olayların zamanı ham saklanır. Süzgeç ham zamana bakar (zamansız kayıt süzülmez, usage.mjs gibi);
// kova/gösterim için zamansız kayıt dosyada kendinden önceki son zamanı miras alır.
for (const f of dosyalar) {
  let miras = null;
  for (const e of f.d.e) {
    const kod = e[0];
    if (kod === "M") continue;
    const hamTs = e[2];
    if (hamTs != null) miras = hamTs;
    const ts = hamTs ?? miras;
    if (kod === "A") for (const a of e[10]) {
      if (!a[0]) continue;
      if (!aracHaritasi.has(a[0])) aracHaritasi.set(a[0], [a[1], ts, aracModeli(e[4])]);
      if ((a[1] === "Agent" || a[1] === "Task") && a[2] && !spawnlar.has(a[0])) spawnlar.set(a[0], a[2]);
    } else if (kod === "R") for (const r of e[3]) if (r[2] && r[0] && !ajanBag.has(r[2])) ajanBag.set(r[2], r[0]);
    if (!aralikta(hamTs)) continue;
    const uuid = e[1];
    const yab = uuid ? f.ybK.has(uuid) : false;
    if (uuid) {
      const s = uuidSahip.get(uuid);
      if (s === undefined) uuidSahip.set(uuid, f.fi);
      else if (s !== f.fi) { const fs2 = dosyalar[s]; if (dahaIyi(f, yab, fs2, fs2.ybK.has(uuid))) uuidSahip.set(uuid, f.fi); }
    }
    if (kod === "A" && e[5]) {
      const k = e[3] || (f.yol + ":" + uuid);
      const c = cagrilar.get(k);
      if (!c) cagrilar.set(k, { u: e[5].slice(), model: normModel(e[4]), sahip: f.fi, yab, ts });
      else {
        for (let i = 0; i < 5; i++) if (e[5][i] > c.u[i]) c.u[i] = e[5][i];
        if (c.sahip !== f.fi && dahaIyi(f, yab, dosyalar[c.sahip], c.yab)) { c.sahip = f.fi; c.yab = yab; c.ts = ts; }
      }
    }
  }
}
// Toplamlar usage.mjs ile aynı sırada (ilk görülme) toplanır: kayan nokta toplamı da birebir çıksın.
let toplamMaliyet = 0;
const fiyatsiz = new Set();
for (const c of cagrilar.values()) {
  const m = cost(c.model, { input: c.u[0], output: c.u[1], cacheRead: c.u[2], cw5m: c.u[3], cw1h: c.u[4] });
  if (m == null) fiyatsiz.add(c.model);
  c.maliyet = m || 0;
  toplamMaliyet += m || 0;
}

// ---------------------------------------------------------------------------
// 3) Toplama: oturum ve ajan bazında
// ---------------------------------------------------------------------------
const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const saatOf = ts => (ts == null ? 0 : Math.floor(ts / 3600000));
const ISTEM_DUGUM = "\u0001I", YANIT_DUGUM = "\u0001Y";

const oturumlarH = new Map();   // oturum kimliği -> toplayıcı
const ajanlarH = new Map();     // oturum/ajan -> toplayıcı
const kovaH = new Map();        // "oturum|saat|alt|model" -> [cagri, g, c, o, y, maliyet]
const aracKovaH = new Map();    // "oturum|saat|alt|model|araç" -> [adet, hata]

function sayacYeni() {
  return { cagri: 0, g: 0, c: 0, o: 0, y: 0, maliyet: 0, arac: 0, hata: 0, ret: 0, kesinti: 0, apiHata: 0, modeller: new Map(), ts: [] };
}
function oturumAl(f) {
  let S = oturumlarH.get(f.oturum);
  if (!S) {
    S = {
      id: f.oturum, kaynak: f.kaynak, kok: f.kok, dirKey: f.dirKey, anaDosyalar: [], yerler: [], ajanlar: [],
      s: sayacYeni(), yanit: 0, zirveAna: 0, istemler: [], istemSonAsistan: [], olayHam: [], gecis: new Map(),
      sikistirma: [], egriHam: [], efor: new Map(), izin: new Map(), dusB: 0, dusMs: 0, gorsel: 0,
      surum: new Map(), giris: new Map(), dal: new Map(), cwdAna: new Map(), cwdAjan: new Map(),
      dosyalar: new Map(), komutlar: new Map(), alanlar: new Map(), beceriler: new Map(),
    };
    oturumlarH.set(f.oturum, S);
  }
  if (!f.alt) S.anaDosyalar.push(f);
  if (!S.yerler.some(y => y.kok === f.kok && y.dirKey === f.dirKey)) S.yerler.push({ kok: f.kok, dirKey: f.dirKey });
  return S;
}
function ajanAl(f, S) {
  const k = f.oturum + "/" + f.ajan;
  let A = ajanlarH.get(k);
  if (!A) { A = { S, dosyalar: [], id: f.ajan, s: sayacYeni(), zirve: 0 }; ajanlarH.set(k, A); S.ajanlar.push(A); }
  A.dosyalar.push(f);
  return A;
}

function cagriEkle(S, A, f, c, effort) {
  const u = c.u, alt = f.alt ? 1 : 0;
  const k = S.id + "|" + saatOf(c.ts) + "|" + alt + "|" + c.model;
  let kv = kovaH.get(k);
  if (!kv) kovaH.set(k, kv = [0, 0, 0, 0, 0, 0]);
  kv[0]++; kv[1] += u[0]; kv[2] += u[1]; kv[3] += u[2]; kv[4] += u[3] + u[4]; kv[5] += c.maliyet;
  const baglam = u[0] + u[2] + u[3] + u[4];
  for (const s of A ? [S.s, A.s] : [S.s]) {
    s.cagri++; s.g += u[0]; s.c += u[1]; s.o += u[2]; s.y += u[3] + u[4]; s.maliyet += c.maliyet;
    inc(s.modeller, c.model, c.maliyet);
  }
  if (effort) inc(S.efor, effort);
  if (A) { if (baglam > A.zirve) A.zirve = baglam; }
  else { if (baglam > S.zirveAna) S.zirveAna = baglam; S.egriHam.push([c.ts, baglam]); }
}

function aracKova(S, ts, alt, model, ad) {
  const k = S.id + "|" + saatOf(ts) + "|" + alt + "|" + model + "|" + ad;
  let kv = aracKovaH.get(k);
  if (!kv) aracKovaH.set(k, kv = [0, 0]);
  return kv;
}

for (const f of dosyalar) {
  const S = oturumAl(f);
  const A = f.alt ? ajanAl(f, S) : null;
  const ana = !f.alt, alt = f.alt ? 1 : 0;
  const sayaclar = A ? [S.s, A.s] : [S.s];
  let meta = [null, null, null, null];
  let sonDugum = null, istemIdx = -1;
  const yanitMsj = new Set();
  const dugum = n => {
    if (n === YANIT_DUGUM && sonDugum === YANIT_DUGUM) return;
    if (sonDugum !== null) inc(S.gecis, sonDugum + "\u0000" + n);
    sonDugum = n;
  };
  let miras = null;
  for (const e of f.d.e) {
    const kod = e[0];
    if (kod === "M") { meta = e; continue; }
    const hamTs = e[2];
    if (hamTs != null) miras = hamTs;
    if (!aralikta(hamTs)) continue;
    const ts = hamTs ?? miras;
    const uuid = e[1];
    const sahip = uuid == null || uuidSahip.get(uuid) === f.fi;
    if (kod === "A" && e[5]) {
      const c = cagrilar.get(e[3] || (f.yol + ":" + uuid));
      if (c && c.sahip === f.fi && !c.sayildi) {
        c.sayildi = true;
        cagriEkle(S, A, f, c, e[6]);
        if (!sahip && c.ts != null) for (const s of sayaclar) s.ts.push(c.ts);
      }
    }
    if (!sahip) continue;
    if (ts != null) for (const s of sayaclar) s.ts.push(ts);
    if (meta[1]) inc(S.surum, meta[1]);
    if (meta[2]) inc(S.giris, meta[2]);
    if (meta[3]) inc(S.dal, meta[3]);
    if (meta[4]) inc(ana ? S.cwdAna : S.cwdAjan, meta[4]);
    switch (kod) {
      case "A": {
        const msgId = e[3], model = e[4];
        S.dusB += e[7]; S.dusMs += e[8];
        if (ana && istemIdx >= 0 && ts != null) S.istemSonAsistan[istemIdx] = ts;
        if (ana && e[9] && model !== "<synthetic>" && !yanitMsj.has(msgId || uuid)) {
          yanitMsj.add(msgId || uuid);
          S.yanit++;
          S.olayHam.push([ts, "y", 0]);
          dugum(YANIT_DUGUM);
        }
        for (const a of e[10]) {
          const [, ad, bilgi] = a;
          for (const s of sayaclar) s.arac++;
          aracKova(S, ts, alt, aracModeli(model), ad)[0]++;
          if (ana) { S.olayHam.push([ts, "a", ad]); dugum(ad); }
          if (!bilgi) continue;
          if (ad === "Bash" || ad === "PowerShell") inc(S.komutlar, bilgi);
          else if (Array.isArray(bilgi)) {
            let r = S.dosyalar.get(bilgi[1]);
            if (!r) S.dosyalar.set(bilgi[1], r = [0, 0, 0]);
            r[bilgi[0] === "o" ? 0 : bilgi[0] === "d" ? 1 : 2]++;
          } else if (ad === "WebFetch") inc(S.alanlar, bilgi);
          else if (ad === "Skill") inc(S.beceriler, bilgi);
        }
        for (const a of e[10]) if (a[1] === "WebSearch") inc(S.alanlar, "WebSearch");   // bilgisiz araç
        break;
      }
      case "P": {
        if (!ana) break;
        istemIdx = S.istemler.length;
        S.istemler.push([ts, e[3], 0, e[4]]);
        S.istemSonAsistan.push(null);
        S.olayHam.push([ts, "i", istemIdx]);
        dugum(ISTEM_DUGUM);
        if (e[5]) S.gorsel += e[5];
        if (e[6]) inc(S.izin, e[6]);
        if (e[7]) inc(S.beceriler, e[7]);
        break;
      }
      case "K":
        for (const s of sayaclar) s.kesinti++;
        if (ana) S.olayHam.push([ts, "k", 0]);
        break;
      case "R":
        for (const r of e[3]) {
          if (r[1] === 1) {
            for (const s of sayaclar) s.hata++;
            const ar = aracHaritasi.get(r[0]);
            const ad = ar ? ar[0] : "?";
            const tsK = ar && ar[1] != null && aralikta(ar[1]) ? ar[1] : ts;
            aracKova(S, tsK, alt, ar ? ar[2] : "", ad)[1]++;
            if (ana) S.olayHam.push([ts, "x", ad]);
          } else if (r[1] === 2) for (const s of sayaclar) s.ret++;
        }
        break;
      case "C":
        if (ana) {
          S.sikistirma.push({ t: ts, once: e[3], sonra: e[4], tetik: e[5] });
          S.olayHam.push([ts, "s", e[3] ?? 0]);
        }
        break;
      case "E":
        for (const s of sayaclar) s.apiHata++;
        if (ana) S.olayHam.push([ts, "e", 0]);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// 4) Çıktıyı kur
// ---------------------------------------------------------------------------
const enCok = map => { let en = null, n = -1; for (const [k, v] of map) if (v > n) { en = k; n = v; } return en; };
const sirali = (map, max = Infinity) => [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max);
const nesne = pairs => Object.fromEntries(pairs);
const minMax = arr => { let lo = Infinity, hi = -Infinity; for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; };

function aktifSaniye(tsler) {
  if (tsler.length < 2) return 0;
  const a = Float64Array.from(tsler).sort();
  let top = 0;
  for (let i = 1; i < a.length; i++) { const fark = a[i] - a[i - 1]; if (fark <= 600000) top += fark; }
  return Math.round(top / 1000);
}

// Bağlam eğrisi seyreltme: ≤ 160 nokta; indeks kovalarında en küçük + en büyük nokta korunur
// (zirveler ve sıkıştırma düşüşleri kaybolmaz), ilk ve son nokta her zaman kalır.
function egriSeyrelt(noktalar, max = 160) {
  if (noktalar.length <= max) return noktalar;
  const kova = Math.floor((max - 2) / 2);
  const sec = new Set([0, noktalar.length - 1]);
  const n = noktalar.length - 2;
  for (let b = 0; b < kova; b++) {
    const bas = 1 + Math.floor(b * n / kova), son = 1 + Math.floor((b + 1) * n / kova);
    if (son <= bas) continue;
    let lo = bas, hi = bas;
    for (let i = bas; i < son; i++) { if (noktalar[i][1] < noktalar[lo][1]) lo = i; if (noktalar[i][1] > noktalar[hi][1]) hi = i; }
    sec.add(lo); sec.add(hi);
  }
  return [...sec].sort((a, b) => a - b).map(i => noktalar[i]);
}

// Olay kırpma: en çok 4000; önce "a" (araç) olayları eşit aralıkla seyreltilir.
function olayKirp(olaylar, max = 4000) {
  if (olaylar.length <= max) return { olaylar, kirpildi: false };
  const digerSay = olaylar.reduce((n, o) => n + (o[1] === "a" ? 0 : 1), 0);
  const aSay = olaylar.length - digerSay;
  const aIzin = Math.max(0, max - digerSay);
  const aTut = new Set();
  for (let i = 0; i < aIzin; i++) aTut.add(Math.floor(i * aSay / aIzin));
  let ai = -1;
  let sonuc = olaylar.filter(o => (o[1] !== "a" ? true : aTut.has(++ai)));
  if (sonuc.length > max) {   // araçsız olaylar bile sığmıyorsa eşit aralıkla seyrelt
    const m = sonuc.length;
    const tut = new Set();
    for (let i = 0; i < max; i++) tut.add(Math.floor(i * m / max));
    sonuc = sonuc.filter((_, i) => tut.has(i));
  }
  return { olaylar: sonuc, kirpildi: true };
}

function metaOku(A) {   // ajanın kopyalarından .meta.json'u olan ilki
  for (const f of A.dosyalar) {
    try {
      const j = JSON.parse(fs.readFileSync(f.yol.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      if (j && typeof j === "object") return j;
    } catch { /* yok ya da bozuk */ }
  }
  return null;
}
function ozelBaslikDosyasi(S) {   // oturumun bulunduğu yerlerdeki custom-title.json; son dolu değer
  let baslik = null;
  for (const y of S.yerler) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(y.kok, y.dirKey, S.id, "custom-title.json"), "utf8"));
      if (str(j && j.customTitle)) baslik = redact(j.customTitle);
    } catch { /* yok ya da bozuk */ }
  }
  return baslik;
}

// Kalan oturum ve ajanlar (aralıkta sahip olunan en az bir kayıt ya da çağrı)
const oturumListesi = [...oturumlarH.values()].filter(S => S.s.ts.length || S.s.cagri);
for (const S of oturumListesi) {
  S.ajanlar = S.ajanlar.filter(A => A.s.ts.length || A.s.cagri);
  const [lo, hi] = minMax(S.s.ts);
  S.basla = Number.isFinite(lo) ? lo : null;
  S.bitis = Number.isFinite(hi) ? hi : null;
}
oturumListesi.sort((a, b) => (a.basla ?? 0) - (b.basla ?? 0) || (a.id < b.id ? -1 : 1));

// Sözlükler: modeller maliyete, araçlar adede, projeler maliyete göre azalan.
// (Olaylardaki ve geçişlerdeki bütün araç adları araç kovalarından da geçtiği için sözlükte vardır.)
const modelMaliyet = new Map(), aracAdet = new Map(), projeMaliyet = new Map();
for (const [k, v] of kovaH) inc(modelMaliyet, k.split("|")[3], v[5]);
for (const [k, v] of aracKovaH) {
  const p = k.split("|");
  inc(aracAdet, p.slice(4).join("|"), v[0]);
  if (p[3] && !modelMaliyet.has(p[3])) modelMaliyet.set(p[3], 0);   // çağrısı aralık dışında kalan model
}
for (const S of oturumListesi) inc(projeMaliyet, projectName(S.dirKey), S.s.maliyet);
const modelSirasi = sirali(modelMaliyet).map(([m]) => m);
const aracSirasi = sirali(aracAdet).map(([a]) => a);
const projeSirasi = sirali(projeMaliyet).map(([p]) => p);
const modelIdx = new Map(modelSirasi.map((m, i) => [m, i]));
const aracIdx = new Map(aracSirasi.map((a, i) => [a, i]));
const projeIdx = new Map(projeSirasi.map((p, i) => [p, i]));
const oturumIdx = new Map(oturumListesi.map((S, i) => [S.id, i]));
const dugumIdx = n => (n === ISTEM_DUGUM ? -1 : n === YANIT_DUGUM ? -2 : aracIdx.get(n));
const tokenNesnesi = s => ({ g: s.g, c: s.c, o: s.o, y: s.y });
const metinsiz = args.metinsiz;

// Ajanlar
const ajanCikti = [];
for (const S of oturumListesi) {
  const liste = S.ajanlar.map(A => {
    const [lo, hi] = minMax(A.s.ts);
    return { A, basla: Number.isFinite(lo) ? lo : null, bitis: Number.isFinite(hi) ? hi : null };
  }).sort((a, b) => (a.basla ?? 0) - (b.basla ?? 0) || (a.A.id < b.A.id ? -1 : 1));
  for (const { A, basla, bitis } of liste) {
    const meta = metaOku(A);
    const tuid = str(meta && meta.toolUseId) || ajanBag.get(A.id) || null;
    const sp = (tuid && spawnlar.get(tuid)) || null;
    let model = null;
    if (A.s.modeller.size) {
      let enM = -1;
      for (const [m, v] of A.s.modeller) if (v > enM) { enM = v; model = modelIdx.get(m); }
    }
    let arkaPlan = sp && typeof sp.b === "boolean" ? sp.b : null;
    if (arkaPlan == null && meta && meta.requestShape) arkaPlan = meta.requestShape === "background" ? true : meta.requestShape === "foreground" ? false : null;
    A.idx = ajanCikti.length;
    A.basla = basla;
    ajanCikti.push({
      oturum: oturumIdx.get(S.id),
      id: A.id,
      tur: str(meta && meta.agentType) || (sp && sp.t) || "?",
      aciklama: metinsiz ? null : (sp && sp.d) || (str(meta && meta.description) && redact(meta.description)) || null,
      model,
      basla, bitis,
      cagri: A.s.cagri, arac: A.s.arac, hata: A.s.hata,
      maliyet: A.s.maliyet,
      token: tokenNesnesi(A.s),
      zirveBaglam: A.zirve,
      arkaPlan,
      izolasyon: (sp && sp.i) || (meta && meta.spawnedWithWorktree === true ? "worktree" : null),
      istem: metinsiz ? null : (sp && sp.p) || (A.dosyalar.find(f => f.d.ilkMetin) || { d: {} }).d.ilkMetin || null,
    });
  }
}

// Oturumlar
const oturumCikti = oturumListesi.map(S => {
  const b0 = S.basla ?? 0;
  const sn = t => Math.max(0, Math.round(((t ?? b0) - b0) / 1000));
  // istemler: tur süresi = istemden sonraki insan isteminden önceki son ana oturum asistan kaydına
  // Birden çok ana dosya (iki kaynak/klasör) varsa istemler zamana göre birleştirilir; "i" olay
  // argümanları yeni sıraya çevrilir.
  const sira = S.istemler.map((_, i) => i).sort((a, b) => (S.istemler[a][0] ?? 0) - (S.istemler[b][0] ?? 0) || a - b);
  const yeniYer = new Map(sira.map((eski, yeni) => [eski, yeni]));
  const istemlerSirali = sira.map(i => S.istemler[i]);
  const istemler = sira.map(i => {
    const p = S.istemler[i], son = S.istemSonAsistan[i];
    const tur = son != null && p[0] != null ? Math.max(0, Math.round((son - p[0]) / 1000)) : 0;
    return [p[0], p[1], tur, metinsiz ? null : p[3]];
  });
  S.egriHam.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  S.sikistirma.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const ilkMetinli = istemlerSirali.find(p => p[3]);
  // Başlık/ad: ana dosyalar arasında (tarama sırasıyla) son dolu değer; zamanlı: herhangi bir kopya.
  const sonDolu = alan => S.anaDosyalar.reduce((v, f) => f.d[alan] || v, null);
  let baslik = sonDolu("baslik") || ozelBaslikDosyasi(S) || sonDolu("ad") || null;
  if (!baslik && ilkMetinli && !metinsiz) baslik = ilkMetinli[3].replace(/\s+/g, " ").trim().slice(0, 80);
  if (!baslik) baslik = S.id.slice(0, 8);
  // sıkıştırma "sonra" değeri yoksa sonraki ilk ana oturum çağrısının bağlamı
  const sikistirma = S.sikistirma.map(c => {
    let sonra = c.sonra;
    if (sonra == null) { const p = S.egriHam.find(x => x[0] != null && x[0] > c.t); sonra = p ? p[1] : null; }
    return { t: c.t, once: c.once, sonra, tetik: c.tetik };
  });
  const egri = egriSeyrelt(S.egriHam.map(p => [sn(p[0]), p[1]]));
  const olayHam = S.olayHam.map(o => [sn(o[0]), o[1], o[1] === "a" || o[1] === "x" ? aracIdx.get(o[2]) : o[1] === "i" ? yeniYer.get(o[2]) : o[2]]);
  for (const A of S.ajanlar) olayHam.push([sn(A.basla), "g", A.idx]);
  olayHam.sort((a, b) => a[0] - b[0]);   // kararlı sıralama: aynı saniyede dosya sırası korunur
  const { olaylar, kirpildi } = olayKirp(olayHam);
  const dosyalarS = [...S.dosyalar.entries()].sort((a, b) => (b[1][0] + b[1][1] + b[1][2]) - (a[1][0] + a[1][1] + a[1][2]) || (a[0] < b[0] ? -1 : 1)).slice(0, 40);
  const gecisler = [...S.gecis.entries()].map(([k, n]) => { const [a, b] = k.split("\u0000"); return [dugumIdx(a), dugumIdx(b), n]; })
    .sort((x, y) => y[2] - x[2] || x[0] - y[0] || x[1] - y[1]);
  const modeller = {};
  for (const [m, v] of [...S.s.modeller.entries()].sort((a, b) => b[1] - a[1])) modeller[String(modelIdx.get(m))] = v;
  return {
    id: S.id,
    kaynak: S.kaynak,
    proje: projeIdx.get(projectName(S.dirKey)),
    baslik,
    ilkIstem: metinsiz || !ilkMetinli ? null : ilkMetinli[3].slice(0, 300),
    zamanli: S.anaDosyalar.some(f => f.d.zamanli === true),
    basla: S.basla, bitis: S.bitis,
    aktifSn: aktifSaniye(S.s.ts),
    istem: S.istemler.length,
    yanit: S.yanit,
    cagri: S.s.cagri,
    arac: S.s.arac,
    hata: S.s.hata,
    ret: S.s.ret,
    kesinti: S.s.kesinti,
    apiHata: S.s.apiHata,
    sikistirma,
    zirveBaglam: S.zirveAna,
    maliyet: S.s.maliyet,
    token: tokenNesnesi(S.s),
    modeller,
    altAjan: S.ajanlar.length,
    surum: enCok(S.surum),
    giris: enCok(S.giris),
    dallar: sirali(S.dal, 5).map(([d]) => d),
    cwd: enCok(S.cwdAna) ?? enCok(S.cwdAjan),
    efor: nesne(sirali(S.efor)),
    izin: nesne(sirali(S.izin)),
    dusunme: { blok: S.dusB, ms: S.dusMs },
    gorsel: S.gorsel,
    egri,
    olaylar,
    olayKirpildi: kirpildi,
    istemler,
    dosyalar: nesne(dosyalarS),
    komutlar: nesne(sirali(S.komutlar, 25)),
    alanlar: nesne(sirali(S.alanlar, 40)),
    beceriler: nesne(sirali(S.beceriler)),
    gecisler,
  };
});

const kovalar = [];
for (const [k, v] of kovaH) {
  const [oid, saat, alt, m] = k.split("|");
  kovalar.push([oturumIdx.get(oid), +saat, +alt, modelIdx.get(m), ...v]);
}
kovalar.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
const aracKovalari = [];
for (const [k, v] of aracKovaH) {
  const p = k.split("|");
  aracKovalari.push([oturumIdx.get(p[0]), +p[1], +p[2], aracIdx.get(p.slice(4).join("|")), v[0], v[1], p[3] ? modelIdx.get(p[3]) : -1]);
}
aracKovalari.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[6] - b[6]);

const evDizini = os.homedir();
const kokGoster = k => (k === evDizini || k.startsWith(evDizini + path.sep) ? "~" + k.slice(evDizini.length).split(path.sep).join("/") : k);
const ilkTs = oturumCikti.reduce((m, o) => (o.basla != null && (m == null || o.basla < m) ? o.basla : m), null);
const sonTs = oturumCikti.reduce((m, o) => (o.bitis != null && (m == null || o.bitis > m) ? o.bitis : m), null);

const veri = {
  meta: {
    surum: VERI_SURUM,
    uretildi: Date.now(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    metinler: !metinsiz,
    filtre: { since: args.since, until: args.until, kaynak: args.kaynak, metinsiz },
    kaynaklar: KAYNAKLAR.map(k => ({ ad: k.ad, kok: kokGoster(k.kok), dosya: k.dosya || 0 })),
    ilk: ilkTs, son: sonTs,
    fiyatNotu: "API liste fiyatı karşılığı; Max aboneliğinde ayrıca faturalanmaz.",
    sureMs: 0,
  },
  sozluk: {
    modeller: modelSirasi.map(id => ({ id, ad: label(id) })),
    araclar: aracSirasi,
    projeler: projeSirasi,
  },
  oturumlar: oturumCikti,
  ajanlar: ajanCikti,
  kovalar,
  aracKovalari,
  ozet: { cagri: cagrilar.size, maliyet: toplamMaliyet, oturum: oturumCikti.length, ajan: ajanCikti.length },
};
veri.meta.sureMs = Date.now() - BASLA_MS;

// ---------------------------------------------------------------------------
// 5) Yaz
// ---------------------------------------------------------------------------
const outHtml = path.resolve(args.out || path.join(OUT_DIZINI, "pano.html"));
// --out baştan doğrulandı: .html ile biter. --yalniz-json (sunucu) yalnız verilen JSON yolunu yazar.
const outJson = args.yalnizJson != null ? path.resolve(args.yalnizJson) : outHtml.replace(/\.html$/i, ".json");
fs.mkdirSync(path.dirname(outJson), { recursive: true });
const jsonMetni = JSON.stringify(veri);
fs.writeFileSync(outJson, jsonMetni);

let htmlYazildi = false;
let artifactYolu = null;
if (args.yalnizJson != null) {
  /* yalnız JSON: HTML yazılmaz */
} else if (!fs.existsSync(SABLON_YOLU)) {
  console.error(`Uyarı: şablon yok (${SABLON_YOLU}); yalnız JSON yazıldı.`);
} else {
  const sablon = fs.readFileSync(SABLON_YOLU, "utf8");
  const eslesme = sablon.match(YER_TUTUCU_RE) || [];
  if (eslesme.length !== 1) {
    console.error(`Hata: şablonda <script id="pano-veri" type="application/json">__PANO_VERI__</script> tam bir kez olmalı (bulunan: ${eslesme.length}); HTML yazılmadı.`);
    process.exitCode = 1;
  } else {
    const gomulu = jsonMetni.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const html = sablon.replace(YER_TUTUCU_RE, (_, ac, kapa) => ac + gomulu + kapa);
    fs.writeFileSync(outHtml, html);
    htmlYazildi = true;
    // --artifact: claude.ai Artifact'ı için gövde parçası. Yayın kendi iskeletini (doctype, charset,
    // viewport) ve CSP'sini ekler; bunlar ve html/head/body etiketleri çıkarılır, <title> başta kalır.
    if (args.artifact) {
      // Yayın redaksiyonu: genel IPv4 adresleri (sunucu adresi gibi) [IP] olur; loopback ve özel ağlar kalır.
      // JSON metni üzerinde çalışır (sayılar en çok bir nokta içerir, sürüm dizgeleri üç parçalıdır).
      const ozelIp = ip => /^(?:127\.|10\.|0\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);
      let yayinJson = jsonMetni.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, ip => ozelIp(ip) ? ip : "[IP]");
      // pano/yayin-maskeler.json: birebir dize değişimleri (hesap kimlikleri, üçüncü kişi adları...).
      // Dizeler JSON içinde kaçışlı halleriyle aranır; değiştirilen metin de kaçışlanır.
      const MASKE_YOLU = path.join(BETIK_DIZINI, "pano", "yayin-maskeler.json");
      if (fs.existsSync(MASKE_YOLU)) {
        let maskeler = [];
        try { maskeler = JSON.parse(fs.readFileSync(MASKE_YOLU, "utf8")).maskeler || []; }
        catch (e) { console.error(`Hata: ${MASKE_YOLU} okunamadı: ${e.message}`); process.exit(1); }
        for (const m of maskeler) {
          if (!m || typeof m.bul !== "string" || !m.bul || typeof m.yerine !== "string") continue;
          const bul = JSON.stringify(m.bul).slice(1, -1), yerine = JSON.stringify(m.yerine).slice(1, -1);
          const once = yayinJson.length;
          yayinJson = yayinJson.split(bul).join(yerine);
          if (yayinJson.length === once && m.bul !== m.yerine && !yayinJson.includes(yerine)) console.error(`Not: maske bulunamadı: ${m.bul.slice(0, 40)}`);
        }
      }
      JSON.parse(yayinJson);   // maskeler JSON'u bozmasın
      fs.writeFileSync(outHtml.replace(/\.html$/i, "-artifact.json"), yayinJson);
      const yayinGomulu = yayinJson.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      const parca = sablon.replace(YER_TUTUCU_RE, (_, ac, kapa) => ac + yayinGomulu + kapa)
        .replace(/^\s*<!doctype html>\s*/i, "")
        .replace(/<html\b[^>]*>|<\/html>|<head>|<\/head>|<body>|<\/body>/gi, "")
        .replace(/<meta\b[^>]*(?:charset|http-equiv|name="viewport")[^>]*>\s*/gi, "")
        .trimStart();
      if (!parca.startsWith("<title>")) { console.error("Hata: artifact parçası <title> ile başlamıyor; şablonun başı değişmiş olabilir."); process.exitCode = 1; }
      else { artifactYolu = outHtml.replace(/\.html$/i, "-artifact.html"); fs.writeFileSync(artifactYolu, parca); }
    }
  }
}

// ---------------------------------------------------------------------------
// 6) Konsol özeti
// ---------------------------------------------------------------------------
const usd = v => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const boyut = p => { const b = fs.statSync(p).size; return b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : (b / 1e3).toFixed(0) + " KB"; };
const sayi = v => v.toLocaleString("tr-TR");
const istemToplam = oturumCikti.reduce((n, o) => n + o.istem, 0);
const sureSn = ((Date.now() - BASLA_MS) / 1000).toFixed(1);
console.log(`Pano verisi hazır (${sureSn} sn)`);
console.log(`Kaynaklar: ${KAYNAKLAR.map(k => `${k.ad} ${sayi(k.dosya || 0)} jsonl`).join(" · ")}  (ayrıştırılan ${sayi(ayristirilan)}, önbellekten ${sayi(onbellekten)})`);
if (args.since || args.until) console.log(`Aralık: ${args.since || "…"} → ${args.until || "…"}`);
console.log(`Oturum ${sayi(oturumCikti.length)} · ajan ${sayi(ajanCikti.length)} · istem ${sayi(istemToplam)} · çağrı ${sayi(cagrilar.size)} · maliyet ${usd(toplamMaliyet)} (API-eşdeğeri)`);
if (fiyatsiz.size) console.log(`Fiyatı olmayan model: ${[...fiyatsiz].join(", ")}`);
if (metinsiz) console.log("Metinsiz: serbest metin alanları boş bırakıldı.");
console.log(`JSON: ${outJson} (${boyut(outJson)})`);
if (htmlYazildi) console.log(`HTML: ${outHtml} (${boyut(outHtml)})`);
if (artifactYolu) console.log(`Artifact: ${artifactYolu} (${boyut(artifactYolu)}); yayından önce: node pano/yayin-kontrol.mjs`);

if (args.ac) {
  if (!htmlYazildi) { console.error("Hata: --ac verildi ama HTML yazılmadı (şablon yok ya da bozuk); açılacak bir şey yok."); process.exitCode = 1; }
  else {
    // Windows'ta kabuk (cmd) kullanılmaz: yol yorumlanmadan explorer.exe'ye argüman olarak gider.
    const [komut, kArgs] = process.platform === "darwin" ? ["open", [outHtml]]
      : process.platform === "win32" ? ["explorer.exe", [outHtml]]
      : ["xdg-open", [outHtml]];
    try {
      const c = spawn(komut, kArgs, { detached: true, stdio: "ignore" });
      c.on("error", e => console.error(`Uyarı: tarayıcı açılamadı (${e.message}).`));
      c.unref();
    } catch (e) { console.error(`Uyarı: tarayıcı açılamadı (${e.message}).`); }
  }
}

// Paylaşılan yardımcılar (pano.mjs kullanır). Buradaki fiyat tablosu, kaynak okuma ve proje adı
// kuralları usage.mjs ile; redact/excerpt report.mjs ile BİREBİR aynı tutulmalı. usage.mjs ya da
// report.mjs'te bunlar değişirse burayı da güncelle (o iki dosya kendi kopyalarını kullanıyor).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Kaynak listesi (usage.mjs ile aynı davranış): Mac + Windows arşivi. Dosya hiç yoksa yalnız
// ~/.claude/projects; dosya bozuksa (geçersiz JSON, eksik alan, aynı "ad" iki kez, boş liste) hata
// verip çıkar. Göreli "kok" JSON dosyasının dizinine göre çözülür. Listede olup diskte bulunmayan
// kök uyarıyla atlanır. Listenin ilk girişi canlı kaynaktır.
// ---------------------------------------------------------------------------
export const KAYNAK_DOSYASI = path.join(os.homedir(), "Arsiv", "claude-konusmalar", "kaynaklar.json");
function kaynakHatasi(msg) { console.error(`Hata: ${KAYNAK_DOSYASI}: ${msg}`); process.exit(1); }
export function kaynaklariOku() {
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

// ---------------------------------------------------------------------------
// Fiyatlar (usage.mjs'den birebir). Kaynak: claude-api skill fiyat tablosu (önbellek: 2026-09-25),
// $/MTok. Yazma fiyatları standart oranla: 5 dk = 1.25x giriş, 1 sa = 2x giriş.
// Fable 5.1 önbellek okuma $0.25 skill'de açıkça verildi; diğerleri 0.1x giriş.
// ---------------------------------------------------------------------------
export const BASE = {
  "claude-fable-5-1":  { in: 10, out: 50, cacheRead: 0.25 },
  "claude-fable-5":    { in: 10, out: 50, cacheRead: 1.00 },
  "claude-opus-5-5":   { in: 4,  out: 20, cacheRead: 0.20 },
  "claude-opus-5":     { in: 5,  out: 25, cacheRead: 0.50 },
  "claude-sonnet-5-5": { in: 2,  out: 10, cacheRead: 0.20 },
  "claude-sonnet-5":   { in: 2,  out: 10, cacheRead: 0.20 },
  "claude-haiku-5-5":  { in: 0.10, out: 0.50, cacheRead: 0.01 },
"claude-haiku-4-5":  { in: 1,  out: 5,  cacheRead: 0.10 },
};
export const LABELS = {
  "claude-fable-5-1": "Fable 5.1", "claude-fable-5": "Fable 5", "claude-opus-5-5": "Opus 5.5",
  "claude-opus-5": "Opus 5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-5-5": "Haiku 5.5", "claude-haiku-4-5": "Haiku 4.5",
};
export function normModel(m) { return m && m.startsWith("claude-haiku-4-5") ? "claude-haiku-4-5" : m; }
export function label(m) { return LABELS[m] || m; }

// u: { input, output, cacheRead, cw5m, cw1h }. Fiyatı bilinmeyen model için null.
export function cost(model, u) {
  const p = BASE[model];
  if (!p) return null;
  const M = 1e6;
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead +
          u.cw5m * p.in * 1.25 + u.cw1h * p.in * 2) / M;
}

// Proje adı: dizin adının son segmenti (diskort iki farklı yolda olabilir -> birleşir). usage.mjs'den birebir.
export function projectName(dirKey) {
  const m = dirKey.match(/zProjects-(.+)$/);
  if (m) return m[1];
  if (dirKey.startsWith("C--dev-")) return dirKey.slice(7);
  if (/^(C-)?-Users-[^-]+-ZZ$/.test(dirKey)) return "ZZ (genel)";
  return dirKey;
}

// Bir kök altındaki bütün .jsonl dosyaları (usage.mjs ile aynı sıra: readdirSync sırası, derinlik önce).
export function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".jsonl")) acc.push(p);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Redaksiyon / alıntı (report.mjs'den birebir): transkriptler salt okunur girdi, sır yazdırılmaz.
// ---------------------------------------------------------------------------
export function redact(text) {
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
// Not: max aşılırsa sonuna "..." eklenir (sonuç en çok max + 3 karakter). Kesin üst sınır gerekiyorsa max - 3 ver.
export function excerpt(text, max = 600) {
  const r = redact(text);
  if (r.length <= max) return r;
  return r.slice(0, max) + "...";
}

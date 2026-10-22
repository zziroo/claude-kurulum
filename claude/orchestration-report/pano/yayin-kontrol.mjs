#!/usr/bin/env node
// Pano'yu Artifact olarak yayınlamadan önce: out/pano.json'daki bütün serbest metinleri (istemler,
// ajan istemleri, başlıklar, açıklamalar, dosya yolları, komutlar, alan adları...) çıkarır, daha önce
// onaylanmış olanları ayıklar ve yalnız YENİ metinleri out/pano-yayin-yeni.txt'ye yazar. Böylece her
// yayından önce okunması gereken yalnız son yayından beri eklenenlerdir. Ayrıca e-posta, telefon,
// IP, IBAN, kimlik no ve sır benzeri kalıpları otomatik işaretler.
//
// Kullanım: node pano/yayin-kontrol.mjs            -> yeni metinleri listele (onaylamaz)
//           node pano/yayin-kontrol.mjs --onayla   -> şu anki bütün metinleri "görüldü" olarak kaydet
// Şablon (pano/sablon.html) değiştiyse bu da raporlanır; --onayla şablon özetini de kaydeder.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const KOK = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Yayınlanacak veri: pano.mjs --artifact çıktısı (IP maskeli). Yoksa ham veri.
const VERI = [path.join(KOK, "out", "pano-artifact.json"), path.join(KOK, "out", "pano.json")].find(f => fs.existsSync(f)) || path.join(KOK, "out", "pano-artifact.json");
const GORULEN = path.join(KOK, "out", ".pano-yayin-gorulen.json");
const YENI = path.join(KOK, "out", "pano-yayin-yeni.txt");
const SABLON = path.join(KOK, "pano", "sablon.html");

const onayla = process.argv.includes("--onayla");
const bilinmeyen = process.argv.slice(2).filter(a => a !== "--onayla");
if (bilinmeyen.length) { console.error(`bilinmeyen argüman: ${bilinmeyen.join(" ")}`); process.exit(1); }
if (!fs.existsSync(VERI)) { console.error(`Veri yok: ${VERI}. Önce: node pano.mjs --artifact`); process.exit(1); }

const ozet = s => crypto.createHash("sha1").update(s).digest("hex");
const veri = JSON.parse(fs.readFileSync(VERI, "utf8"));
const kayitlar = [];   // { tur, nerede, metin }
const ekle = (tur, nerede, s) => { if (typeof s === "string" && s) kayitlar.push({ tur, nerede, metin: s }); };

for (const o of veri.oturumlar || []) {
  const n = `oturum ${String(o.id).slice(0, 8)}`;
  ekle("baslik", n, o.baslik); ekle("ilkIstem", n, o.ilkIstem); ekle("cwd", n, o.cwd);
  for (const i of o.istemler || []) ekle("istem", n, i[3]);
  for (const k of Object.keys(o.dosyalar || {})) ekle("dosya", n, k);
  for (const k of Object.keys(o.komutlar || {})) ekle("komut", n, k);
  for (const k of Object.keys(o.alanlar || {})) ekle("alan", n, k);
  for (const k of Object.keys(o.beceriler || {})) ekle("beceri", n, k);
  for (const b of o.dallar || []) ekle("dal", n, b);
  ekle("surum", n, o.surum); ekle("giris", n, o.giris);
}
for (const a of veri.ajanlar || []) {
  const n = `ajan ${String(a.id).slice(0, 8)}`;
  ekle("ajanIstem", n, a.istem); ekle("aciklama", n, a.aciklama); ekle("tur", n, a.tur);
}
for (const p of veri.sozluk?.projeler || []) ekle("proje", "sözlük", p);
for (const p of veri.sozluk?.araclar || []) ekle("arac", "sözlük", p);
for (const m of veri.sozluk?.modeller || []) { ekle("model", "sözlük", m.id); ekle("model", "sözlük", m.ad); }
for (const k of veri.meta?.kaynaklar || []) { ekle("kaynak", "meta", k.ad); ekle("kaynak", "meta", k.kok); }

let gorulen = { sablon: null, metinler: [] };
try { gorulen = JSON.parse(fs.readFileSync(GORULEN, "utf8")); } catch { /* ilk yayın */ }
const gorulenSet = new Set(gorulen.metinler || []);
const sablonOzet = fs.existsSync(SABLON) ? ozet(fs.readFileSync(SABLON, "utf8")) : null;

// Otomatik işaretler: okurken özellikle bakılacak kalıplar (redact zaten anahtarları maskeler).
const KALIPLAR = [
  ["e-posta", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["telefon", /(?:\+90|\b0)\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/],
  ["IPv4", /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ["IBAN", /\bTR\d{2}\s?(?:\d{4}\s?){5}\d{2}\b/i],
  ["11 hane (TC kimlik?)", /\b[1-9]\d{10}\b/],
  ["kart no?", /\b(?:\d{4}[\s-]?){3}\d{4}\b/],
  ["sır kelimesi", /\b(?:password|parola|şifre|sifre|secret|token|api[_-]?key)\b/i],
  ["redakte", /\[REDACTED/],
];

const yeniMap = new Map();   // metin -> {tur, nerede}
for (const k of kayitlar) if (!gorulenSet.has(ozet(k.metin)) && !yeniMap.has(k.metin)) yeniMap.set(k.metin, k);
const yeni = [...yeniMap.values()];
const sayac = {};
for (const k of yeni) sayac[k.tur] = (sayac[k.tur] || 0) + 1;

const satir = s => s.replace(/\r?\n/g, " ⏎ ");
const isaretli = [];
const govde = [];
for (const tur of Object.keys(sayac)) {
  govde.push(`\n### ${tur} (${sayac[tur]})`);
  for (const k of yeni.filter(x => x.tur === tur)) {
    const bul = KALIPLAR.filter(([, re]) => re.test(k.metin)).map(([ad]) => ad);
    if (bul.length) isaretli.push(`[${bul.join(", ")}] ${k.tur} · ${k.nerede}: ${satir(k.metin).slice(0, 300)}`);
    govde.push(`- ${k.nerede}: ${satir(k.metin)}`);
  }
}
const sablonDegisti = sablonOzet !== gorulen.sablon;
const rapor = [
  `# Pano yayın kontrolü (${new Date().toISOString()})`,
  `Toplam metin: ${new Set(kayitlar.map(k => k.metin)).size} · yeni: ${yeni.length} · karakter: ${yeni.reduce((n, k) => n + k.metin.length, 0)}`,
  `Şablon: ${sablonDegisti ? "DEĞİŞTİ (ya da ilk yayın) — sablon.html gözden geçirilmeli" : "aynı"}`,
  `\n## Otomatik işaretlenenler (${isaretli.length})`, ...isaretli.map(s => "- " + s),
  `\n## Yeni metinler`, ...govde,
].join("\n");
fs.writeFileSync(YENI, rapor + "\n");

console.log(`Yeni metin: ${yeni.length} (${Object.entries(sayac).map(([t, n]) => `${t} ${n}`).join(", ") || "yok"})`);
console.log(`İşaretli: ${isaretli.length} · şablon ${sablonDegisti ? "değişti" : "aynı"}`);
console.log(`Liste: ${YENI}`);

if (onayla) {
  const hepsi = new Set(gorulenSet);
  for (const k of kayitlar) hepsi.add(ozet(k.metin));
  fs.writeFileSync(GORULEN, JSON.stringify({ sablon: sablonOzet, guncellendi: new Date().toISOString(), metinler: [...hepsi] }));
  console.log(`Onaylandı: ${hepsi.size} metin özeti ve şablon özeti kaydedildi (${GORULEN}).`);
}

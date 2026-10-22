// Pano sunucusu başlatıcısı (pano.mjs sunucu kipi ve canli.mjs kullanır).
// Portta bizim sunucumuz (sunucu.mjs; /durum meta.uygulama) çalışıyorsa onu kullanır, yeniden
// başlatmaz. Port boşsa sunucuyu arka planda ayrık süreç olarak başlatır (günlük: out/sunucu.log)
// ve /durum cevap verene kadar bekler. Port başka bir şeydeyse söyler ve --port önerir.
// Sunucu yalnız 127.0.0.1'e bağlanır; burada da yalnız 127.0.0.1'e istek atılır.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const SUNUCU_MJS = path.join(BURASI, "sunucu.mjs");
const GUNLUK = path.join(BURASI, "out", "sunucu.log");
const UYGULAMA = "orchestration-report";   // sunucu.mjs ile aynı
const SUNUCU_SURUM = 2;                     // sunucu.mjs ile aynı
const bekle = ms => new Promise(r => setTimeout(r, ms));

function iste(port, yol, zamanAsimi) {
  return new Promise((coz, ret) => {
    const req = http.get({ host: "127.0.0.1", port, path: yol, timeout: zamanAsimi }, res => {
      const parcalar = []; let n = 0;
      res.on("data", d => { n += d.length; if (n <= 8_000_000) parcalar.push(d); });
      res.on("end", () => coz({ kod: res.statusCode, govde: Buffer.concat(parcalar).toString("utf8") }));
      res.on("error", ret);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("zaman aşımı"), { code: "ETIMEDOUT" })));
    req.on("error", ret);
  });
}

// Portu kim tutuyor: bos | bizim | eski-surum (bizim, başka sunucu sürümü) | eski-canli (eski canli.mjs) | baska
async function kimTutuyor(port) {
  let r;
  try { r = await iste(port, "/durum", 2500); }
  catch (e) { return e.code === "ECONNREFUSED" ? { tur: "bos" } : { tur: "baska", hata: e.message }; }
  let j = null;
  if (r.kod === 200) { try { j = JSON.parse(r.govde); } catch { /* json değil */ } }
  const m = j && j.meta && typeof j.meta === "object" ? j.meta : null;
  if (m && m.uygulama === UYGULAMA) return { tur: m.sunucuSurum === SUNUCU_SURUM ? "bizim" : "eski-surum", meta: m };
  if (m && m.surum === 1 && "kok" in m && Array.isArray(j.oturumlar)) return { tur: "eski-canli", meta: m };
  return { tur: "baska", hata: "HTTP " + r.kod };
}

async function durdur(meta, port) {
  if (!meta || !Number.isInteger(meta.pid)) { console.error("Hata: çalışan sunucunun pid'i bilinmiyor; elle durdur: pkill -f \"orchestration-report/sunucu.mjs\""); return false; }
  // Sunucunun kendi beyanına güvenme: pid gerçekten sunucu.mjs mi? (ps yoksa/okunamazsa eski davranış)
  try {
    const komut = execFileSync("ps", ["-p", String(meta.pid), "-o", "command="], { encoding: "utf8", timeout: 3000 });
    if (!komut.includes("sunucu.mjs")) { console.error(`Hata: pid ${meta.pid} bir pano sunucusu değil (${komut.trim().slice(0, 80)}); durdurulmadı.`); return false; }
  } catch (e) { if (e && e.status === 1) { console.error(`Hata: pid ${meta.pid} yerelde çalışmıyor; durdurulmadı.`); return false; } }
  try { process.kill(meta.pid, "SIGTERM"); } catch (e) { console.error(`Hata: sunucu (pid ${meta.pid}) durdurulamadı: ${e.message}`); return false; }
  for (let i = 0; i < 50; i++) { await bekle(100); if ((await kimTutuyor(port)).tur === "bos") return true; }
  console.error(`Hata: sunucu (pid ${meta.pid}) 5 sn içinde kapanmadı.`);
  return false;
}

function gunlukSonu() {
  try { return fs.readFileSync(GUNLUK, "utf8").trim().split("\n").slice(-6).join("\n"); } catch { return "(günlük okunamadı)"; }
}

async function sunucuBaslat(o) {
  fs.mkdirSync(path.dirname(GUNLUK), { recursive: true });
  const fd = fs.openSync(GUNLUK, "w");
  const argv = [SUNUCU_MJS, "--port", String(o.port)];
  if (o.pencere != null) argv.push("--pencere", String(o.pencere));
  let c;
  try { c = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", fd, fd], windowsHide: true, cwd: BURASI }); }
  finally { fs.closeSync(fd); }
  let cikis = null;
  c.on("exit", (kod, sinyal) => { cikis = sinyal || kod; });
  c.on("error", e => { cikis = e.message; });
  c.unref();
  for (let i = 0; i < 150; i++) {   // en çok ~30 sn
    await bekle(200);
    if (cikis !== null) { console.error(`Hata: sunucu açılırken kapandı (${cikis}). Günlük (${GUNLUK}):\n${gunlukSonu()}`); return null; }
    const k = await kimTutuyor(o.port);
    if (k.tur === "bizim") return k.meta;
  }
  console.error(`Hata: sunucu 30 sn içinde cevap vermedi. Günlük (${GUNLUK}):\n${gunlukSonu()}`);
  return null;
}

function tarayiciAc(url) {
  // Kabuk yok: URL yorumlanmadan argüman olarak gider (Windows'ta cmd/start '&' içeren sorguyu bölerdi).
  const [komut, kArgs] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  try {
    const c = spawn(komut, kArgs, { detached: true, stdio: "ignore" });
    c.on("error", e => console.error(`Uyarı: tarayıcı açılamadı (${e.message}); elle aç: ${url}`));
    c.unref();
  } catch (e) { console.error(`Uyarı: tarayıcı açılamadı (${e.message}); elle aç: ${url}`); }
}

const usd = v => "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sayi = v => (Number(v) || 0).toLocaleString("tr-TR");

// o: { port, pencere, ac, canli, durdur, yeniden, yenile, suzgec: { since, until, kaynak, metinsiz } }
// Dönüş: çıkış kodu.
export async function baslat(o) {
  // Çıktı kapanmış bir boruya giderse (ör. `| head -1`) çökme yok; sunucu ayrık süreçte çalışmaya devam eder.
  for (const s of [process.stdout, process.stderr]) s.on("error", e => { if (e.code !== "EPIPE") throw e; });
  const sorgu = new URLSearchParams();
  for (const k of ["since", "until", "kaynak"]) if (o.suzgec && o.suzgec[k]) sorgu.set(k, o.suzgec[k]);
  if (o.suzgec && o.suzgec.metinsiz) sorgu.set("metinsiz", "1");
  const qs = sorgu.toString() ? "?" + sorgu.toString() : "";
  const url = `http://127.0.0.1:${o.port}/${qs}${o.canli ? "#canli" : ""}`;

  let k = await kimTutuyor(o.port);
  if (o.durdur || o.yeniden) {
    if (k.tur === "bizim" || k.tur === "eski-surum") {
      if (!(await durdur(k.meta, o.port))) return 1;
      console.log(`Sunucu durduruldu (pid ${k.meta.pid}).`);
      k = { tur: "bos" };
    } else if (k.tur === "bos") {
      if (o.durdur) console.log(`${o.port} portunda çalışan pano sunucusu yok.`);
    } else if (k.tur === "eski-canli") {
      console.error(`Hata: ${o.port} portunda eski canli.mjs sunucusu var; pid'i bilinmiyor. Elle durdur: pkill -f "orchestration-report/canli.mjs"`);
      return 1;
    } else {
      console.error(`Hata: ${o.port} portundaki sunucu bizim değil (${k.hata || "?"}); durdurulmadı.`);
      return 1;
    }
    if (o.durdur) return 0;
  }
  if (k.tur === "eski-canli") {
    console.error(`Hata: ${o.port} portunda eski canlı pano (canli.mjs, yalnız canlı) çalışıyor. Durdurup yeniden dene:\n  pkill -f "orchestration-report/canli.mjs" && node ${path.join(BURASI, "pano.mjs")}${o.canli ? " --canli" : ""}`);
    return 1;
  }
  if (k.tur === "baska") {
    console.error(`Hata: ${o.port} portu başka bir uygulamada (${k.hata || "?"}). Başka port ver: --port ${o.port === 7788 ? 7790 : o.port + 1}`);
    return 1;
  }
  if (k.tur === "eski-surum") console.error(`Uyarı: çalışan sunucu başka sürüm (sunucuSurum ${k.meta.sunucuSurum}, beklenen ${SUNUCU_SURUM}); yenisi için: node pano.mjs --yeniden`);

  let meta = k.meta, yeni = false;
  if (k.tur === "bos") { meta = await sunucuBaslat(o); if (!meta) return 1; yeni = true; }
  console.log(`Pano: ${url}  (${yeni ? "yeni başlatıldı" : "zaten çalışıyordu"}, pid ${meta.pid}; durdurmak için: node pano.mjs --durdur${o.port !== 7788 ? " --port " + o.port : ""})`);

  // Özet: canlı durum + geçmiş (geçmiş hesabı bitene kadar bekler; önbellekle ~1-2 sn, ilk kez ~1 dk)
  const oq = new URLSearchParams(sorgu); if (o.yenile) oq.set("yenile", "1");
  try {
    const r = await iste(o.port, "/ozet" + (oq.toString() ? "?" + oq : ""), 15 * 60_000);
    const j = JSON.parse(r.govde);
    if (r.kod !== 200) console.error(`Uyarı: özet alınamadı: ${j.hata || "HTTP " + r.kod}`);
    else {
      const c = j.canli || {};
      console.log(`Canlı: ${sayi(c.oturum)} oturum (aktif ${sayi(c.aktifOturum)}, bekleyen dahil ${sayi(c.canliOturum)}), ${sayi(c.ajan)} ajan (çalışan ${sayi(c.aktifAjan)}); son 1 saat ${sayi(c.sonSaat && c.sonSaat.tok)} token, ${usd(c.sonSaat && c.sonSaat.maliyet)} (API karşılığı)`);
      if (j.gecmis && j.gecmis.ozet) console.log("Geçmiş:\n" + j.gecmis.ozet.split("\n").map(l => "  " + l).join("\n"));
      if (j.gecmis && j.gecmis.hata) console.error(`Uyarı: geçmiş verisi: ${j.gecmis.hata}`);
    }
  } catch (e) { console.error(`Uyarı: özet alınamadı (${e.message}); sayfa yine de açılabilir.`); }

  if (o.ac) tarayiciAc(url);
  return 0;
}

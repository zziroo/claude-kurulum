#!/usr/bin/env node
// Son cevabı Ahenk Cep (yerel Türkçe TTS) ile hoparlörden okur. İki kipte çalışır:
// - UserPromptSubmit: kullanıcı "oku", "/sesli oku" ya da "sesli oku" yazınca bir önceki cevabı okur (okuma tuşu);
//   "dur", "/sesli dur" çalanı keser. Bu kip her zaman açık.
// - Stop: ~/.claude/sesli/acik varsa (/sesli otomatik aç) her cevabı kendiliğinden okur.
// Ayarlar: ~/.claude/sesli/ayar.json. Okuyucu: ~/.claude/sesli/oku.py (kendi venv'inde, arka planda;
// hook hemen çıkar, cevabı asla bekletmez).
import { readFileSync, existsSync, openSync, readSync, fstatSync, closeSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KOK = join(homedir(), '.claude', 'sesli');
const KUYRUK = 1024 * 1024;

function ayarlar() {
  const v = { cumle: 6, karakter: 700 };
  try { Object.assign(v, JSON.parse(readFileSync(join(KOK, 'ayar.json'), 'utf8'))); } catch { /* varsayılan */ }
  return v;
}

// Transkriptin kuyruğundan son asistan girdisinin metin bloklarını alır (sonra gelen user/tool satırları atlanır).
function sonCevap(yol) {
  const fd = openSync(yol, 'r');
  let metin;
  try {
    const boy = fstatSync(fd).size;
    const n = Math.min(boy, KUYRUK);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, boy - n);
    metin = buf.toString('utf8');
  } finally { closeSync(fd); }
  const satirlar = metin.split('\n').reverse();
  for (const s of satirlar) {
    if (!s.includes('"assistant"')) continue;
    let d;
    try { d = JSON.parse(s); } catch { continue; }
    if (d.type !== 'assistant' || !Array.isArray(d.message?.content)) continue;
    const parcalar = d.message.content.filter(b => b.type === 'text' && b.text).map(b => b.text);
    if (parcalar.length) return parcalar.join('\n');
  }
  return null;
}

// Markdown'ı konuşma metnine indirger.
function sadelestir(t) {
  return t
    .replace(/```[\s\S]*?```/g, ' Kod bloğu atlandı. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*[-|: ]+$/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*)[*_]/g, '$1$2')
    .replace(/https?:\/\/\S+/g, 'bağlantı')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function kirp(t, { cumle, karakter }) {
  const parcalar = t.split(/(?<=[.!?…])\s+|\n/).map(s => s.trim()).filter(Boolean);
  const secilen = [];
  let uzunluk = 0;
  for (const p of parcalar) {
    if (secilen.length >= cumle || uzunluk + p.length > karakter) break;
    secilen.push(p);
    uzunluk += p.length;
  }
  let sonuc = secilen.join(' ');
  if (secilen.length < parcalar.length) sonuc += ' Gerisi ekranda.';
  return sonuc;
}

function durdur() {
  try {
    const pid = Number(readFileSync(join(KOK, 'pid'), 'utf8'));
    if (pid > 1) process.kill(-pid, 'SIGTERM');
  } catch { /* yok ya da bitmiş */ }
}

function cevapla(not) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: not },
  }));
}

try {
  const girdi = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (girdi.stop_hook_active || girdi.agent_id || !girdi.transcript_path) process.exit(0);
  const istek = girdi.hook_event_name === 'UserPromptSubmit';
  let sinirsiz = false;
  if (istek) {
    const p = String(girdi.prompt || '').trim();
    if (/^\/?sesli\s+dur\b/i.test(p) || /^dur\.?$/i.test(p)) {
      durdur();
      cevapla('Sesli okuma durduruldu; kullanıcıya tek kelimeyle söyle.');
      process.exit(0);
    }
    const m = /^\/?(?:sesli\s+)?oku(?:\s+(hepsini|tam))?\.?$/i.exec(p);
    if (!m) process.exit(0);
    sinirsiz = Boolean(m[1]);
  } else if (!existsSync(join(KOK, 'acik'))) {
    process.exit(0);
  }
  const python = join(KOK, '.venv', 'bin', 'python');
  const oku = join(KOK, 'oku.py');
  if (!existsSync(python) || !existsSync(oku)) {
    if (istek) cevapla('Sesli okuma kurulu değil: ~/.claude/sesli/kur.sh çalıştırılmalı. Kullanıcıya tek satırla söyle.');
    process.exit(0);
  }

  const ham = sonCevap(girdi.transcript_path);
  if (!ham) process.exit(0);
  const ayar = ayarlar();
  if (sinirsiz) { ayar.cumle = 10_000; ayar.karakter = 20_000; }
  const metin = kirp(sadelestir(ham), ayar);
  if (metin.length < 2) process.exit(0);

  durdur(); // önceki okuma sürüyorsa kes
  const gunluk = openSync(join(KOK, 'son.log'), 'w');
  const cocuk = spawn(python, [oku], { detached: true, stdio: ['pipe', gunluk, gunluk], cwd: KOK });
  cocuk.stdin.end(metin);
  cocuk.unref();
  writeFileSync(join(KOK, 'son-metin.txt'), metin);
  if (istek) cevapla('Önceki cevap Ahenk ile okunuyor (arka planda başladı). Yalnız tek kelimeyle onayla, cevabı tekrar yazma.');
} catch { /* sessiz: okuma hiçbir zaman cevabı engellemez */ }
process.exit(0);

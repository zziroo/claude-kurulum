#!/usr/bin/env node
// SessionStart hook: vault'u günceller, çalışma klasörünün projesini bulur ve
// _overview.md'nin "Güncel durum" + "Sıradaki işler" bölümlerini bağlama ekler.
// Eşleme: brain/20-Areas/working-rules/klasor-proje-eslemesi.md
// Hata olursa sessizce çıkar; oturum açılışını asla engellemez.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const HOME = homedir();
const VAULT = join(HOME, 'ZZ', 'brain');
const ZPROJ = join(HOME, 'ZZ', 'zProjects');
const ESLEME = join(VAULT, '20-Areas', 'working-rules', 'klasor-proje-eslemesi.md');
const DISKORT_INBOX = join(HOME, 'diskort-inbox');
const MAKS = 6000; // bağlama eklenecek en fazla karakter

const DURUM = /^(güncel durum|durum)\b/i;
const SIRADAKI = /^(sıradaki işler|sonraki adımlar|doğrulanmayanlar)\b/i;

function girdi() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function vaultCek() {
  try {
    execFileSync('git', ['-C', VAULT, 'pull', '--ff-only', '-q'], { timeout: 8000, stdio: 'ignore' });
    return null;
  } catch {
    return 'vault güncellenemedi (git pull --ff-only başarısız; ağ ya da çakışma). Not eski olabilir.';
  }
}

function eslemeOku() {
  const harita = new Map();
  for (const satir of readFileSync(ESLEME, 'utf8').split('\n')) {
    const m = satir.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m || m[1] === 'Klasör' || m[1].startsWith('---')) continue;
    const klasor = m[1].startsWith('~') ? resolve(HOME + m[1].slice(1)) : join(ZPROJ, m[1]);
    harita.set(klasor, m[2] === '-' ? null : m[2]);
  }
  return harita;
}

function projeBul(cwd, harita) {
  const yol = resolve(cwd);
  let enIyi = null;
  for (const [klasor, proje] of harita) {
    if ((yol === klasor || yol.startsWith(klasor + sep)) && (!enIyi || klasor.length > enIyi[0].length)) {
      enIyi = [klasor, proje];
    }
  }
  return enIyi; // [klasor, proje|null] ya da null
}

function bolumler(metin) {
  const parcalar = metin.split(/^## /m).slice(1);
  const durum = [], siradaki = [];
  for (const p of parcalar) {
    const baslik = p.split('\n', 1)[0].trim();
    if (DURUM.test(baslik)) durum.push('## ' + p.trimEnd());
    else if (SIRADAKI.test(baslik)) siradaki.push('## ' + p.trimEnd());
  }
  return [...durum, ...siradaki].join('\n\n');
}

function tarih(metin) {
  const m = metin.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

function diskortInbox() {
  try {
    const okunmamis = readdirSync(DISKORT_INBOX).filter(
      (f) => f.endsWith('.md') && f !== 'BENIOKU.md' && statSync(join(DISKORT_INBOX, f)).isFile(),
    );
    return okunmamis.length
      ? `Diskort inbox'ta ${okunmamis.length} okunmamış dosya var (${DISKORT_INBOX}, okundu/ hariç): ${okunmamis.join(', ')}. Kullanıcı isterse oku, özetle, sonra okundu/'ya taşı.`
      : null;
  } catch { return null; }
}

function main() {
  const g = girdi();
  if (g.source && !['startup', 'clear'].includes(g.source)) return;
  if (!existsSync(VAULT) || !existsSync(ESLEME)) return;
  const cwd = g.cwd || process.cwd();
  const bulunan = projeBul(cwd, eslemeOku());
  if (!bulunan || !bulunan[1]) return; // ZZ kökü, eşlemesiz ya da vault'ta tutulmayan klasör

  const uyari = vaultCek();
  const proje = bulunan[1];
  const ozet = join(VAULT, '10-Projects', proje, '_overview.md');
  if (!existsSync(ozet)) return;
  const metin = readFileSync(ozet, 'utf8');

  let govde = bolumler(metin);
  if (!govde) govde = '(_overview.md\'de "Güncel durum" / "Sıradaki işler" bölümü bulunamadı.)';
  if (govde.length > MAKS) govde = govde.slice(0, MAKS) + `\n\n[…kısaltıldı; devamı ${ozet}]`;

  const d = tarih(metin);
  const gun = d ? Math.floor((Date.now() - Date.parse(d)) / 86400000) : null;
  const satirlar = [
    `Vault projesi: ${proje} (${ozet}). Aşağısı vault'un anlık görüntüsüdür; sunucu, sürüm ve repo durumunu işlem yapmadan önce canlıdan doğrula. Kararlar/dersler için önce Grep, tüm notu okuma.`,
    d ? `Overview tarihi: ${d}${gun > 3 ? ` (${gun} gün önce, eski olabilir)` : ''}.` : null,
    uyari,
    proje === 'diskort' ? diskortInbox() : null,
    '',
    govde,
  ].filter((x) => x !== null);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: satirlar.join('\n') },
  }));
}

try { main(); } catch { /* oturumu asla engelleme */ }

#!/usr/bin/env node
// PostToolUse hook, yalnız alt ajanlarda çalışır: ajanın transkriptinden çağrı sayısını,
// son bağlam büyüklüğünü ve ekran görüntüsü sayısını okur. Eşikler aşılınca ajana kısa bir
// hatırlatma ekler (CLAUDE.md Orchestration: ≤200k bağlam, ~100 çağrıda faz sınırında bitir,
// ekran görüntüsü yalnız düzen sorusunda ve sonda). Aynı eşik için bir kez uyarır
// (durum dosyası tmp'de). Hata olursa sessizce çıkar; aracı asla engellemez.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';

const BAGLAM = 200_000;
const CAGRI = 100, CAGRI_ADIM = 40;
const GORUNTU = 5, GORUNTU_ADIM = 5;

function transkriptYolu(g) {
  const y = g.transcript_path || '';
  if (y.includes('/subagents/')) return y;
  if (!g.agent_id || !y) return null;
  const aday = join(dirname(y), basename(y, '.jsonl'), 'subagents', `agent-${g.agent_id}.jsonl`);
  return existsSync(aday) ? aday : null;
}

function olc(yol) {
  let cagri = 0, goruntu = 0, ctx = 0;
  for (const s of readFileSync(yol, 'utf8').split('\n')) {
    if (s.includes('"type":"assistant"') && s.includes('"usage"')) {
      cagri++;
      try {
        const u = JSON.parse(s)?.message?.usage;
        if (u) ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      } catch { /* yok say */ }
    } else if (s.includes('"type":"image"') && s.includes('"tool_result"')) {
      goruntu += (s.match(/"type":"image"/g) || []).length;
    }
  }
  return { cagri, goruntu, ctx };
}

try {
  const g = JSON.parse(readFileSync(0, 'utf8') || '{}');
  if (!g.agent_id) process.exit(0);
  const yol = transkriptYolu(g);
  if (!yol) process.exit(0);
  const { cagri, goruntu, ctx } = olc(yol);
  const durumYolu = join(tmpdir(), `ajan-tavani-${g.agent_id}.json`);
  let durum = { cagri: 0, goruntu: 0, baglam: false };
  try { durum = { ...durum, ...JSON.parse(readFileSync(durumYolu, 'utf8')) }; } catch { /* ilk kez */ }
  const notlar = [];
  if (ctx >= BAGLAM && !durum.baglam) {
    durum.baglam = true;
    notlar.push(`bağlam ~${Math.round(ctx / 1000)}k, tavan 200k: bu işi bir sonraki doğal faz sınırında bitir ve devir notuyla (dosyalar, kararlar, hipotezler, kalanlar) geri dön; yeni büyük okuma yapma.`);
  }
  if (cagri >= CAGRI && cagri >= durum.cagri + CAGRI_ADIM) {
    durum.cagri = cagri;
    notlar.push(`${cagri} çağrı: eşik ~100. Kök sebebe çok yakın değilsen faz sınırında bitir ve devir notuyla dön.`);
  }
  if (goruntu >= GORUNTU && goruntu >= durum.goruntu + GORUNTU_ADIM) {
    durum.goruntu = goruntu;
    notlar.push(`${goruntu} ekran görüntüsü bağlamda birikti ve her çağrıda yeniden okunuyor. Kalan doğrulamayı read_page / get_page_text / javascript_tool ya da log ile yap; görüntü yalnız düzen sorusunda, scale 0.5, sonda.`);
  }
  if (notlar.length) {
    try { writeFileSync(durumYolu, JSON.stringify(durum)); } catch { /* yok say */ }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Ajan tavanı uyarısı: ' + notlar.join(' ') },
    }));
  }
} catch { /* sessiz */ }
process.exit(0);

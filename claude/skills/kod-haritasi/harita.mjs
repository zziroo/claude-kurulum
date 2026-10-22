#!/usr/bin/env node
// Kod haritası yardımcısı (bağımlılıksız). Proje kökünde (git repo) çalıştır.
//   node harita.mjs iskelet [--include a,b] [--exclude c,d] [--out dosya]
//   node harita.mjs kontrol [--map docs/kod-haritasi.md] [--siki]
// Kapsam haritanın başındaki yorumdan da okunur:
//   <!-- kod-haritasi: include=src,scripts exclude=src/client/mockups -->
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { extname, dirname } from 'node:path';

const SRC_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.go', '.rs', '.cs', '.gd', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.lua', '.rb', '.php', '.sh', '.sql',
  '.css', '.scss', '.html',
]);
const DEFAULT_EXCLUDE = [
  'node_modules', 'dist', 'build', 'out', 'vendor', '.next', 'coverage',
  'Pods', 'DerivedData', '.godot', 'Library', 'obj', 'bin',
];
const BIG = 500;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const list = (s) => (s ? s.split(',').map((x) => x.trim().replace(/\/$/, '')).filter((x) => x && !/^-+$/.test(x)) : []);

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
try { git('rev-parse', '--show-toplevel'); } catch { die('Git deposu değil; proje kökünde çalıştır.'); }
const root = git('rev-parse', '--show-toplevel').trim();
process.chdir(root);

const mapPath = opt('map', 'docs/kod-haritasi.md');
const mapText = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
const scopeComment = mapText.match(/<!--\s*kod-haritasi:([^>]*)-->/);
const scopeFrom = (key) => scopeComment?.[1].match(new RegExp(`${key}=(\\S+)`))?.[1];
const include = list(opt('include', scopeFrom('include')));
const exclude = [...DEFAULT_EXCLUDE, ...list(opt('exclude', scopeFrom('exclude')))];

const under = (f, d) => f === d || f.startsWith(d + '/');
const excluded = (f) => exclude.some((d) => under(f, d) || f.split('/').includes(d));
const isTest = (f) => /(^|\/)(tests?|__tests__|spec)\//.test(f) || /\.(test|spec)\.[a-z]+$/.test(f);

function sourceFiles() {
  return git('ls-files').split('\n').filter(Boolean)
    .filter((f) => SRC_EXT.has(extname(f)))
    .filter((f) => !include.length || include.some((d) => under(f, d)))
    .filter((f) => !excluded(f))
    .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
}

const SYM_RE = {
  js: [/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/],
  py: [/^(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^class\s+([A-Za-z_]\w*)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/, /^type\s+([A-Z]\w*)/],
  rs: [/^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|mod)\s+(\w+)/],
  cs: [/^\s{0,8}(?:public|internal)\s+(?:(?:static|sealed|abstract|partial|readonly)\s+)*(?:class|struct|interface|enum|record)\s+(\w+)/],
  gd: [/^class_name\s+(\w+)/, /^func\s+([a-zA-Z]\w*)/, /^signal\s+(\w+)/],
  jvm: [/^\s{0,4}(?:public\s+|internal\s+|open\s+|data\s+|abstract\s+|final\s+)*(?:class|interface|object|enum|struct|protocol|fun|func)\s+(\w+)/],
  sh: [/^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/],
};
const langOf = (f) => {
  const e = extname(f);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(e)) return 'js';
  if (e === '.py') return 'py'; if (e === '.go') return 'go'; if (e === '.rs') return 'rs';
  if (e === '.cs') return 'cs'; if (e === '.gd') return 'gd'; if (e === '.sh') return 'sh';
  if (['.java', '.kt', '.swift'].includes(e)) return 'jvm';
  return null;
};

function scan(f) {
  const text = readFileSync(f, 'utf8');
  const lines = text.replace(/\n$/, '').split('\n');
  const res = SYM_RE[langOf(f)] || [];
  const syms = [];
  for (const l of lines) for (const r of res) { const m = l.match(r); if (m && !syms.includes(m[1])) syms.push(m[1]); }
  return { lines: lines.length, syms };
}

function iskelet() {
  const files = sourceFiles();
  const byDir = new Map();
  for (const f of files) {
    const d = dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  const out = [];
  const total = { files: 0, lines: 0 };
  const big = [];
  out.push(`# İskelet: ${root.split('/').pop()} (${new Date().toISOString().slice(0, 10)}, ${git('rev-parse', '--short', 'HEAD').trim()})`);
  out.push(`kapsam: include=${include.join(',') || '(hepsi)'} exclude=${exclude.slice(DEFAULT_EXCLUDE.length).join(',') || '-'}`);
  out.push('biçim: satır sayısı  dosya  — dışa açılan semboller (en çok 12; testlerde gösterilmez)\n');
  for (const d of [...byDir.keys()].sort()) {
    const rows = byDir.get(d).sort().map((f) => ({ f, ...scan(f) }));
    const dl = rows.reduce((a, r) => a + r.lines, 0);
    out.push(`## ${d}/  (${rows.length} dosya, ${dl} satır)`);
    for (const r of rows) {
      total.files++; total.lines += r.lines;
      if (r.lines > BIG && !isTest(r.f)) big.push(r);
      const s = isTest(r.f) ? '' : r.syms.slice(0, 12).join(', ') + (r.syms.length > 12 ? ` …(+${r.syms.length - 12})` : '');
      out.push(`${String(r.lines).padStart(6)}  ${d === '.' ? r.f : r.f.slice(d.length + 1)}${s ? '  — ' + s : ''}`);
    }
    out.push('');
  }
  out.push(`## Büyük dosyalar (>${BIG} satır, test hariç): iç harita adayı`);
  for (const r of big.sort((a, b) => b.lines - a.lines)) out.push(`${String(r.lines).padStart(6)}  ${r.f}`);
  out.push(`\nToplam: ${total.files} dosya, ${total.lines} satır.`);
  const text = out.join('\n') + '\n';
  const o = opt('out');
  if (o) { writeFileSync(o, text); console.log(`${o}: ${total.files} dosya, ${byDir.size} klasör, ${big.length} büyük dosya.`); }
  else process.stdout.write(text);
}

function kontrol() {
  if (!mapText) die(`${mapPath} yok. Önce: harita.mjs iskelet`);
  const tracked = new Set(git('ls-files').split('\n').filter(Boolean));
  const trackedArr = [...tracked];
  const problems = [];
  const warnings = [];
  const mentioned = new Set();

  const globRe = (t) => new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '§/').replace(/\*\*/g, '¤').replace(/\*/g, '[^/]*').replace(/§\//g, '(?:.*/)?').replace(/¤/g, '.*') + '$');
  const topDirs = new Set(trackedArr.filter((f) => f.includes('/')).map((f) => f.split('/')[0]));
  const baseNames = new Map();
  for (const f of trackedArr) { const b = f.split('/').pop(); baseNames.set(b, [...(baseNames.get(b) || []), f]); }
  // { files: anlatılan dosyalar, dir: klasörse altındaki kaynaklar } ya da null (yok)
  const resolvePath = (t) => {
    const p = t.replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
    if (p.includes('*')) { const re = globRe(p); const m = trackedArr.filter((f) => re.test(f)); return m.length ? { files: m, glob: true } : null; }
    if (tracked.has(p)) return { files: [p] };
    const dir = p.replace(/\/$/, '');
    if (trackedArr.some((f) => under(f, dir))) return { files: [], dir: trackedArr.filter((f) => under(f, dir) && SRC_EXT.has(extname(f))) };
    if (!p.includes('/') && baseNames.has(p)) { const m = baseNames.get(p); return { files: m.length === 1 ? m : [], dir: m }; }
    if (existsSync(p)) return { files: [] }; // git dışı ama gerçek (dist/, data/, dışlanmış klasör)
    return null;
  };
  const isIdent = (t) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?(\(\))?$/.test(t) && t.length > 2;
  const fileCache = new Map();
  const has = (f, sym) => {
    if (!fileCache.has(f)) { try { fileCache.set(f, readFileSync(f, 'utf8')); } catch { fileCache.set(f, ''); } }
    return new RegExp(`\\b${sym.replace(/[$]/g, '\\$')}\\b`).test(fileCache.get(f));
  };
  const repoHas = (sym) => {
    try { execFileSync('git', ['grep', '-q', '-w', '-F', sym], { stdio: 'ignore' }); return true; } catch { return false; }
  };

  let inFence = false;
  mapText.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence || line.includes('kod-haritasi:')) return;
    const toks = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const files = [];
    const dirFiles = [];
    const syms = []; // [sembol, en yakın önceki dosyalar]
    let cur = [];
    for (const t of toks) {
      if (/\s/.test(t)) continue; // komut/örnek metin
      if (/:\/\/|^\/|^@|[<>{}]|^\.\.?$/.test(t)) continue; // URL, rota, paket, yer tutucu
      const hasExt = SRC_EXT.has(extname(t)) || /\.(json|md|xml|plist|gradle|yml|yaml|toml|properties|example)$/.test(t);
      const looksPath = t.includes('/') && (hasExt || topDirs.has(t.replace(/^\.\//, '').split('/')[0]) || existsSync(t));
      if (looksPath || hasExt || baseNames.has(t)) {
        const r = resolvePath(t);
        if (!r) { problems.push(`satır ${i + 1}: yol yok → \`${t}\``); continue; }
        r.files.forEach((f) => mentioned.add(f));
        if (r.glob) dirFiles.push(...r.files); // glob: kapsama sayılır, sembol için gevşek havuz
        else if (r.files.length) { files.push(...r.files); cur = r.files; }
        if (r.dir) { dirFiles.push(...r.dir); if (t.includes('/')) r.dir.forEach((f) => mentioned.add(f)); }
      } else if (isIdent(t)) syms.push([t.replace(/\(\)$/, ''), cur]);
    }
    for (const [s, near] of syms) {
      const leaf = s.split('.').pop();
      const inLine = files.some((f) => has(f, leaf));
      if (inLine) { if (near.length && !near.some((f) => has(f, leaf))) warnings.push(`satır ${i + 1}: \`${s}\` önündeki dosyada değil, satırdaki başka dosyada`); continue; }
      if (dirFiles.length && dirFiles.some((f) => has(f, leaf))) continue;
      if (!repoHas(leaf)) problems.push(`satır ${i + 1}: sembol bulunamadı → \`${s}\``);
      else if (files.length) problems.push(`satır ${i + 1}: \`${s}\` bu satırdaki dosyalarda değil (başka yerde var)`);
    }
  });

  // Kapsam: büyük dosyalar ve klasörler haritada geçiyor mu
  const src = sourceFiles().filter((f) => !isTest(f));
  const bigMissing = src.filter((f) => !mentioned.has(f)).map((f) => ({ f, n: scan(f).lines })).filter((r) => r.n > BIG);
  const dirs = [...new Set(src.map((f) => dirname(f)))];
  const dirMissing = dirs.filter((d) => !src.some((f) => dirname(f) === d && mentioned.has(f)) && !mapText.includes(d));

  // Haritanın son commit'inden beri eklenen/silinen/taşınan kaynak dosyalar
  let since = [];
  let mapCommit = '';
  try { mapCommit = git('log', '-1', '--format=%h %cs', '--', mapPath).trim(); } catch {}
  if (mapCommit) {
    const h = mapCommit.split(' ')[0];
    since = git('log', `${h}..HEAD`, '--diff-filter=ADR', '--name-status', '--format=').split('\n').filter(Boolean)
      .map((l) => l.split('\t')).filter((p) => SRC_EXT.has(extname(p[p.length - 1])) && !isTest(p[p.length - 1]) && !excluded(p[p.length - 1]))
      .filter((p) => !include.length || include.some((d) => under(p[p.length - 1], d)))
      .map((p) => `${p[0][0]} ${p.slice(1).join(' → ')}`);
  }

  const lines = [`Kod haritası kontrolü: ${mapPath} (${mapText.replace(/\n$/, '').split('\n').length} satır; son commit ${mapCommit || 'yok (commit edilmemiş)'})`];
  const sec = (title, arr) => { if (arr.length) { lines.push(`\n${title} (${arr.length}):`); arr.slice(0, 60).forEach((x) => lines.push('  ' + x)); if (arr.length > 60) lines.push(`  … +${arr.length - 60}`); } };
  sec('Bozuk referanslar', problems);
  if (args.includes('--siki')) sec('Uyarı (çıkış kodunu etkilemez): sembol en yakın önceki dosyada değil', warnings);
  else if (warnings.length) lines.push(`(${warnings.length} yakın-dosya uyarısı; görmek için --siki)`);
  sec(`Haritada geçmeyen büyük dosyalar (>${BIG} satır)`, bigMissing.map((r) => `${r.f} (${r.n})`));
  sec('Haritada hiç geçmeyen klasörler', dirMissing);
  sec('Harita güncellendikten sonra eklenen/silinen/taşınan dosyalar (A/D/R)', since);
  const bad = problems.length + bigMissing.length;
  lines.push(bad || since.length || dirMissing.length ? '' : '\nHarita güncel görünüyor.');
  if (mapText.replace(/\n$/, '').split('\n').length > 450) lines.push(`Uyarı: harita ${mapText.replace(/\n$/, '').split('\n').length} satır; hedef ≤ ~400.`);
  console.log(lines.join('\n'));
  process.exit(bad ? 1 : 0);
}

function die(m) { console.error(m); process.exit(2); }

if (cmd === 'iskelet') iskelet();
else if (cmd === 'kontrol') kontrol();
else die('Kullanım: harita.mjs iskelet|kontrol [--include a,b] [--exclude c] [--map yol] [--out dosya]');

---
name: sesli
description: Son cevabı Ahenk Cep (yerel Türkçe TTS) ile sesli okur ("okuma tuşu"), okumayı durdurur, otomatik okumayı açar/kapatır ya da ayarlar. Kullanıcı /sesli yazınca ya da "oku, sesli oku, sesi kes, otomatik okumayı aç" deyince çalışır.
argument-hint: "oku [hepsini] | dur | otomatik aç|kapat | durum | dene [metin] | cümle N"
---

# /sesli: cevapları Ahenk ile sesli oku

Parçalar: kanca `~/.claude/hooks/sesli-oku.mjs` (settings.json'da UserPromptSubmit ve Stop'a bağlı), okuyucu
`~/.claude/sesli/oku.py` (kendi `.venv`'i, Ahenk Cep modeli), otomatik bayrağı `~/.claude/sesli/acik`,
ayarlar `~/.claude/sesli/ayar.json` (`cumle`: en fazla kaç cümle, `karakter`: en fazla kaç karakter).
Kanca metni kod blokları ve markdown'dan arındırıp kırpar, arka planda okutur; yeni okuma öncekini keser.

## Argümana göre
- `oku` / `oku hepsini`: **kanca zaten başlattı** (istem gönderilirken UserPromptSubmit'te bir önceki cevabı
  okutur; `hepsini` sınırsız). Hiçbir şey çalıştırma; tek kelimeyle onayla ("Okunuyor."). Cevabı tekrar yazma.
- `dur`: kanca durdurdu; "Durdu." de.
- `otomatik aç`: `touch ~/.claude/sesli/acik` (her cevap kendiliğinden okunur). `otomatik kapat`: `rm -f ~/.claude/sesli/acik`.
- `durum` ya da boş: otomatik açık mı, ayar.json değerleri, `son-metin.txt` ilk satırı, `son.log` son 3 satırı.
- `dene [metin]`: `echo "<metin>" | ~/.claude/sesli/.venv/bin/python ~/.claude/sesli/oku.py`
  (metin yoksa "Sesli okuma çalışıyor."). Süreyi ve hatayı bildir.
- `cümle N`: ayar.json'da `cumle` değerini N yap (dosya yoksa `{"cumle": N, "karakter": 700}`).
- Venv yoksa (`~/.claude/sesli/.venv/bin/python`): `~/.claude/sesli/kur.sh` çalıştırılması gerektiğini söyle.

Sonda tek satır Türkçe durum ver.

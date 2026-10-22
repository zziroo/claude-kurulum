# claude-kurulum

Claude Code için çalışan kişisel düzen: global çalışma kuralları (`CLAUDE.md`), kancalar, ajan tanımları, skill'ler ve orkestrasyon raporu / pano betikleri. `~/.claude` altındaki bu parçalar burada sürümlenir, `kur.sh` ile her makinede symlink olarak bağlanır.

## Brain ile ilişkisi

İki ayrı depo, paralel çalışır:

- **brain** (Obsidian vault, ör. `~/ZZ/brain`): kararlar (neden + reddedilen seçenekler), dersler, runbook'lar, oturum özetleri. Bilgi.
- **claude-kurulum** (bu repo): o kararların uygulandığı çalışan düzen. Kod, kanca, kural.

Bir kural değişince: kural metni burada (`claude/CLAUDE.md`, skill, kanca) değişir ve commit'lenir; nedeni ve dersi vault'a not olarak yazılır. `/kaydet` ve `/bitir` skill'leri vault'a yazar, bu repoya yazmaz.

## Kurulum

Gereken: bash, git, Node 20+ (kancalar ve betikler), isteğe bağlı Python 3 (`gunluk-olcum.py`).

```bash
git clone <bu-repo> ~/ZZ/claude-kurulum
cd ~/ZZ/claude-kurulum
./kur.sh --kuru   # önce ne yapacağını gör
./kur.sh          # bağla
```

`kur.sh` şunları yapar:

- `claude/` altındaki `CLAUDE.md`, `hooks`, `agents`, `skills`, `orchestration-report` girdilerini `~/.claude/<ad>` olarak symlink'ler.
- Hedefte gerçek dosya/klasör varsa `~/.claude/<ad>.yedek-YYYYMMDD-HHMMSS` olarak kenara alır; zaten doğru symlink ise atlar (tekrar çalıştırmak güvenli).
- `~/.claude/settings.json` yoksa `claude/settings.ornek.json`'dan kopyalar. Varsa dokunmaz: örnekteki `hooks` bölümünü kendi `settings.json`'ına elle birleştir.
- `--kaldir`: bu repoya işaret eden symlink'leri söker, her girdinin en son yedeğini geri koyar.
- Sonda Node sürümünü kontrol eder. `CLAUDE_DIZINI=/baska/yol ./kur.sh` ile başka bir hedefe denenebilir.

Bağlandıktan sonra `~/.claude/...` altında yapılan düzenlemeler doğrudan bu repoda görünür; `git diff` ile gözden geçir, commit'le, diğer makinede `git pull` yeterli.

Not: `orchestration-report/out/` (rapor çıktıları, kişisel veri) ve `pano/yayin-maskeler.json` (yayın maskeleri) `.gitignore`'dadır. İlk kurulumda `kur.sh` eski `orchestration-report` klasörünü kenara alırken içindeki `out/` ve `yayin-maskeler.json` dosyalarını yeni yere taşır; veri kaybolmaz, repoya da girmez.

### settings.ornek.json

Yalnızca kanca bağlantılarını içerir (JSON yorum desteklemediği için açıklama burada):

- `SessionStart` → `hooks/oturum-baslangici.mjs`: oturum açılışında bağlam notu.
- `UserPromptSubmit` → `hooks/baglam-uyarisi.mjs`: bağlam 300k'yı geçince ya da eski büyük oturum açılınca uyarı.
- `PostToolUse` → `hooks/ajan-tavani.mjs`: ajan bağlam/çağrı/ekran görüntüsü tavanı hatırlatması.
- `UserPromptSubmit` + `Stop` → `hooks/sesli-oku.mjs`: "oku" yazınca önceki cevabı Ahenk Cep ile sesli okur; `~/.claude/sesli/acik` varsa her cevabı kendiliğinden okur (aşağıda).

Yollar `$HOME/.claude/hooks/...` biçimindedir, makineye özel değildir. İzin listesi (`permissions.allow`) kişiye özeldir (ör. ssh kuralları) ve repoya girmez; her makinede kendi `settings.json`'ında tutulur.

## Dizin

```
kur.sh                         kurulum / kaldırma
claude/
  CLAUDE.md                    global çalışma kuralları (her projede yüklenir)
  settings.ornek.json          kanca bağlantıları örneği
  hooks/                       SessionStart, UserPromptSubmit, PostToolUse kancaları
  agents/                      inceleme (review), supheci (skeptic), kesif (keşif) ajan tipleri
  skills/
    kaydet/                    oturumun kalıcı değerini vault'a yazar
    bitir/                     kaydet + oturumu kapat
    pano/                      yerel panoyu açar
    kod-haritasi/              docs/kod-haritasi.md şablonu ve harita.mjs
    sesli/                     /sesli oku|dur|otomatik aç|kapat|durum|dene|cümle N
  sesli/                       Ahenk Cep sesli okuma: oku.py, kur.sh (venv), ayar.json; .venv ve durum dosyaları git dışı
  orchestration-report/        token/maliyet/oturum raporu, pano sunucusu, canlı görünüm
    README.md                  betiklerin ayrıntılı belgesi
```

## Sesli okuma (isteğe bağlı)

Cevapları yerel Türkçe TTS ile hoparlörden okur: [Ahenk Cep](https://github.com/ozguradmin/ahenk-turkish-tts)
(8.6M parametre, CPU, ses ~2 sn'de başlar; ağırlıklar CC BY 4.0). Yalnız macOS (`afplay`).

```bash
~/.claude/sesli/kur.sh     # uv ile Python 3.12 venv, torch (~200 MB) ve model (34 MB)
```

Okuma tuşu gibi çalışır: bir cevaptan sonra `oku` (ya da `/sesli oku`) yazınca o cevap okunur, `dur` keser,
`oku hepsini` kırpmadan okur. Kanca metni markdown ve kod bloklarından arındırır, `ayar.json`'daki sınıra göre
kırpar (varsayılan 6 cümle / 700 karakter, sonuna "Gerisi ekranda" ekler) ve arka planda okutur; yeni okuma
öncekini keser. `/sesli otomatik aç` ile her cevap kendiliğinden okunur (alt ajanlar hariç), `otomatik kapat` ile durur.

## Kendine uyarlama

Başka biri (ya da sen başka bir düzende) kullanacaksa:

1. **`claude/CLAUDE.md`**: kişiye özel kısımları değiştir ya da sil:
   - cevap dili ve plan adı (en üstteki "General working rules"),
   - oturum başlığı önekleri ve proje adları,
   - `## Server (VPS)`: `vps` ssh alias'ı ve izin kuralları (sunucun yoksa bölümü sil),
   - `## Tools`: orkestrasyon raporu yolu (`~/.claude/orchestration-report/`) ve vault içindeki not yolu,
   - `## Second brain`: vault yolu (`~/ZZ/brain`). Vault kullanmıyorsan bölümü sil.
2. **`skills/kaydet/SKILL.md`**: vault yolu, vault içindeki klasör-proje eşleme notu ve vault'un uzak deposu. Vault yoksa `kaydet` ve `bitir` skill'lerini sil.
3. **Transkript kökleri (`kaynaklar.json`)**: rapor ve pano betikleri önce `~/Arsiv/claude-konusmalar/kaynaklar.json` dosyasını okur, yoksa yalnız `~/.claude/projects`'i tarar. Tek makinede bir şey yapmana gerek yok. Başka bir makinenin arşivini de katmak istersen bu dosyayı oluştur; biçimi ve örneği `claude/orchestration-report/README.md`'de.
4. **Yayın maskeleri**: pano'yu paylaşılabilir HTML olarak üretecek misin, `pano/yayin-maskeler.ornek.json`'ı `yayin-maskeler.json` adıyla kopyala ve gizlenecek dizeleri ekle.
5. **Ajan modelleri**: `agents/*.md` frontmatter'ındaki `model` / `effort` değerlerini planına göre ayarla.

Kendi değişikliklerini kendi fork'unda tut; `kur.sh` repo nerede olursa olsun çalışır (yolları kendi konumundan bulur).

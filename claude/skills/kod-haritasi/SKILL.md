---
name: kod-haritasi
description: Projenin kod haritasını (docs/kod-haritasi.md) çıkarır, günceller ya da bayatlığını kontrol eder. Kullanıcı /kod-haritasi yazınca, "kod haritası çıkar/güncelle" deyince, ya da koordinatör yapıyı değiştiren (dosya ekleyen/silen/taşıyan) bir commit'ten önce haritayı kontrol ederken kullanılır.
argument-hint: "[olustur|guncelle|kontrol]"
---

# /kod-haritasi

Amaç: ajanlar koda soğuk başlarken aramaya harcadıkları çağrıları kesmek. Harita "X nerede, Y'yi yapmak için hangi dosyalara dokunulur" sorusunu tek okumada cevaplar. Karar ve gerekçe: vault `20-Areas/working-rules/2026-10-20-token-ucuncu-tur-kod-haritasi-ve-kural-gozden-gecirme.md`.

Yardımcı betik: `node ~/.claude/skills/kod-haritasi/harita.mjs` (proje kökünde, bağımlılıksız).
- `iskelet [--include a,b] [--exclude c] --out <scratchpad>/iskelet.md`: kaynak dosyaları klasör klasör satır sayısı + dışa açılan sembollerle, sonda >500 satırlık dosyalar.
- `kontrol [--siki]`: haritadaki her `yol` ve `sembol` hâlâ var mı (`--siki`: sembol kendinden önceki en yakın dosyada değilse uyarır; akış satırlarında gürültülü); haritada geçmeyen büyük dosyalar ve klasörler; harita son commit'inden beri eklenen/silinen/taşınan dosyalar. Bozuk referans ya da eksik büyük dosya varsa çıkış kodu 1.
- Kapsam haritanın ilk satırlarındaki yorumdan okunur: `<!-- kod-haritasi: include=src,scripts exclude=src/client/mockups -->`.

## Harita kuralları
- Yer: `docs/kod-haritasi.md` (projenin CLAUDE.md'si başka yer gösteriyorsa orası). Projenin CLAUDE.md'sinde (yoksa README'de) tek satır işaretçi olsun.
- Boyut ≤ ~400 satır. Her dosyayı listeleme; alanları, giriş noktalarını, büyük dosyaları ve tuzakları anlat. Tekrarlayan kalıp (ör. 40 oyun klasörü) bir kez anlatılır + örnek bir klasör.
- **Satır numarası yok.** Dosya yolu + grep'lenebilir sembol adı (fonksiyon, sınıf, sabit, CSS sınıfı, i18n anahtar öneki) backtick içinde. Aynı satırdaki sembol o satırdaki dosyada aranır; `kontrol` bunu doğrular, o yüzden sembolü doğru dosyanın satırına yaz.
- Dil: kullanıcının dili (Türkçe), kısa maddeler. Kod adları olduğu gibi.
- Belgeler (`docs/*.md`) zaten anlatıyorsa tekrar etme, bağla.

## Şablon
```
# Kod haritası: <proje>
<!-- kod-haritasi: include=... exclude=... -->
_Güncelleme: YYYY-MM-DD (<commit>). Bakım: yapıyı değiştiren commit'te güncelle; `node ~/.claude/skills/kod-haritasi/harita.mjs kontrol`._

## Genel bakış        (5–10 satır: katmanlar, çalışma zamanı, veri akışı tek cümlede, derleme/test komutları)
## Alanlar            (alan → klasör/dosyalar → ne yapar, ana semboller)
## Şunu yapmak için   ("yeni oyun eklemek", "yeni ekran", "API ucu", "i18n metni", "DB göçü"... → dokunulacak dosyalar sırayla)
## Büyük dosyaların içi (>500 satır, sık düzenlenenler: bölümler ve her bölümün sembol adı)
## Akışlar            (2–5 kritik akış: giriş, bir tur oynama, ödeme... çağrı zinciri sembollerle)
## Testler            (nerede, nasıl koşulur, hangi alanı hangi test dosyası kapsar)
## Tuzaklar           (kopya mantık, iki yerde güncellenmesi gerekenler, üretilen dosyalar, elle dokunulmayacaklar)
```

## olustur (harita yoksa)
1. Koordinatör: `iskelet` çıktısını scratchpad'e yazdır; kapsamı (include/exclude: üretilmiş, vendor, mockup, platform kabuğu klasörleri) iskelete bakıp seç.
2. Haritayı bir alt ajan yazar (`model: "opus"`, `effort: "high"`; çok okuma ister). Brief: bu SKILL.md'nin yolu, iskelet dosyasının yolu, proje belgeleri (`docs/`, CLAUDE.md), yalın bağlam kuralı. Ajan iskeletle başlar, yalnız giriş noktalarını, büyük dosyaların bölüm başlarını ve belgeleri okur; ≤200k bağlam. Büyük projede alanlara bölünür (her ajan bir bölüm taslağı, sonra biri birleştirir).
3. Koordinatör `kontrol` çalıştırır, bozuk referansları düzelttirir; haritayı baştan sona kendisi okur (uydurma yol/sembol, yanlış akış).
4. Doğrulama: bir `kesif` ajanına haritayı kullanarak 2–3 gerçek soru sor ("X'i değiştirmek için nereye bakılır"); çağrı sayısını ve doğruluğu not et.
5. Commit (harita + CLAUDE.md işaretçisi), proje kurallarına göre.

## guncelle
1. `kontrol` çalıştır. Çıktıdaki A/D/R dosyalarına ve bozuk referanslara göre yalnız ilgili bölümleri düzelt; `_Güncelleme:` satırını yenile.
2. Küçük güncelleme koordinatörde inline; çok alan değiştiyse bir ajana (`sonnet` yeterli) kontrol çıktısıyla ver.

## kontrol
`kontrol` çıktısını kullanıcıya kısaca özetle (kaç bozuk referans, kaç yeni/silinen dosya). Çıkış kodu 1 ise `guncelle` öner.

## Bakım (koordinatör kuralı)
Dosya ekleyen/silen/taşıyan ya da bir alanın giriş noktasını değiştiren commit'ten önce `kontrol` çalıştır; bozulduysa haritayı aynı commit'te güncelle. Ajan brief'lerinde "önce `docs/kod-haritasi.md`'yi oku" yazılı olsun; `kesif` ajanı haritadaki yanlışları raporlar, koordinatör düzeltir.

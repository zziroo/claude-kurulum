---
name: pano
description: Yerel pano sunucusunu başlatır (ya da çalışanı kullanır) ve tarayıcıda açar; tek sayfada Canlı sekmesi (çalışan oturum ve ajanlar) ve bütün Claude Code geçmişinin (Mac + Windows arşivi) sekmeleri: token, maliyet, oturumlar, akışlar, ajanlar, alışkanlıklar. Kullanıcı /pano yazınca ya da "panoyu/dashboard'u aç, token raporu çıkar" deyince çalışır. Paylaşmak için statik dosya: "/pano metinsiz". ("/pano yayınla" eski Artifact akışı, kullanımdan kalkıyor.)
argument-hint: "[--since YYYY-MM-DD] [--until YYYY-MM-DD] [--kaynak mac|windows] [--port N] [--yeniden|--durdur] | metinsiz | yayınla"
---

# /pano: Claude Code panosu (yerel sunucu)

Araç: `~/.claude/orchestration-report/pano.mjs` (başlatıcı + hesap), `sunucu.mjs` (sunucu),
arayüz `pano/sablon.html` (Canlı sekmesi de içinde gömülü), veri sözleşmeleri `pano/SEMA.md`,
`canli/SEMA.md`. Sunucu yalnız `127.0.0.1`'e bağlanır, varsayılan port 7788.

## Adımlar
Argüman `yayınla` ise aşağıdaki "Artifact'ı güncelle" bölümüne bak; `metinsiz` ise "Paylaşım için
statik dosya" bölümünü uygula; değilse:
1. Çalıştır (argümanları olduğu gibi geçir; normal Bash çağrısı, arka plan gerekmez):
   `node ~/.claude/orchestration-report/pano.mjs --ac $ARGUMENTS`
   Portta pano sunucusu zaten çalışıyorsa yeniden başlatılmaz, yalnız sayfa açılır. Çalışmıyorsa
   arka planda başlatılır (günlük `out/sunucu.log`); komut sunucu hazır olunca döner.
   Geçmiş hesabı önbellekle ~1 sn, önbelleksiz ilk çalıştırmada ~1 dk sürer.
2. Çıktıdan kullanıcıya 2–3 satır Türkçe özet ver: URL, canlı durum (oturum/çalışan ajan, son 1
   saat), geçmiş (oturum/istem sayısı, toplam API karşılığı maliyet). Maliyetin Max aboneliğinde
   ayrıca faturalanmadığını, "API'den olsaydı" tahmini olduğunu hatırlat.
3. Hata durumları (çıktı söyler):
   - Port başka bir uygulamadaysa kullanıcıya söyle ve `--port <başka>` öner.
   - Eski `canli.mjs` sunucusu portu tutuyorsa çıktıdaki `pkill` komutunu kullanıcıya öner.
   - Sunucu kodu güncellendiyse ya da tuhaf davranıyorsa `--yeniden` ile yeniden başlat;
     durdurmak için `node ~/.claude/orchestration-report/pano.mjs --durdur`.
   - Bir şey tutarsız görünürse `--yenile` (ayrıştırma önbelleğini yok sayar).

Sayfa: ilk sekme "Canlı" (`#canli`), sonra geçmiş sekmeleri. Geçmiş her sayfa açılışında sunucudan
taze gelir (`/pano.json`). `--since/--until/--kaynak` sayfa adresine sorgu olarak geçer.

## Paylaşım için statik dosya ("/pano metinsiz")
`node ~/.claude/orchestration-report/pano.mjs --metinsiz --ac [--since …]` → `out/pano.html` (tek
dosya, istem metinleri ve ajan açıklamaları yok, Canlı sekmesi yok). Başkasıyla paylaşmadan önce
HTML'in tamamını oku. Metinli statik dosya gerekiyorsa `--statik`.

## Artifact'ı güncelle ("/pano yayınla", "panoyu artifacta yükle")
**Kullanımdan kalkıyor, artık önerilmez:** pano yerel sunucuda çalışıyor; Artifact canlı veri
göstermez ve elle yayın ister. Kullanıcı açıkça isterse aşağıdaki eski akış hâlâ çalışır.
Kullanıcının özel Artifact'ı (2026-10-13'te kuruldu, metinli): https://claude.ai/artifact/SneuVWTaoNhnvPutMgX8nN
Artifact kendi kendine güncellenmez; yalnız kullanıcı isteyince bu adımlarla yeni sürüm yüklenir:
1. `node ~/.claude/orchestration-report/pano.mjs --artifact` → `out/pano-artifact.html`. Genel IP'ler `[IP]` olur; `pano/yayin-maskeler.json`'daki dizeler değiştirilir. Yerel pano değişmez.
2. `node ~/.claude/orchestration-report/pano/yayin-kontrol.mjs` → son yayından beri eklenen metinler `out/pano-yayin-yeni.txt`'de, otomatik işaretlerle birlikte (e-posta, IP, IBAN, telefon, sır kelimesi). Yeni metinlerin TAMAMINI oku: azsa kendin oku, çoksa (~100 KB üstü) parçalara bölüp salt okunur `haiku` ajanlara okut (şüpheli bir şey çıkarsa o parçayı kendin oku). Şablon değiştiyse `pano/sablon.html` farkını da oku. Gizlenmesi gereken bir şey çıkarsa `yayin-maskeler.json`'a ekleyip 1. adımı tekrarla.
3. Dosyayı scratchpad'e kopyala ve `Artifact` aracıyla `url` vererek yayınla (önce `action: "read"` ile o artifact'ı oku; başka oturumdan `url` olmadan yayın yeni artifact açar). Okunan dosyayla yayınlanan dosya aynı olmalı: arada `pano.mjs`'i yeniden çalıştırma.
4. Yayından sonra `node ~/.claude/orchestration-report/pano/yayin-kontrol.mjs --onayla` (okunan metinleri "görüldü" olarak kaydeder; bir dahakine yalnız yeniler listelenir).

## Kurallar
- Yalnız yerel: sunucu 127.0.0.1'e bağlanır; dışarı açma, tünel kurma, port yönlendirme yapma.
- Sayfada ve `out/pano.html`'de istem metinleri var. Buluta ya da vault'a kopyalama; başkası için
  paylaşılacaksa `--metinsiz` statik dosya üret ve paylaşmadan önce HTML'in tamamını oku.
- Transkript köklerine (`~/.claude/projects`, `~/Arsiv/claude-konusmalar/...`) hiçbir şey yazma.
- Windows'tan yeni kayıt gelmişse önce `python3 ~/Arsiv/claude-konusmalar/ice-aktar.py <zip>` ile içe aktar; sunucu bunu en geç 5 dk içinde görür (hemen görmek için sayfayı `?taze=1` ile aç).

---
name: kaydet
description: Bu sohbette alınan kararları, öğrenilenleri ve proje durumundaki değişiklikleri ikinci beyine (vault) yazar. Yalnızca kullanıcı /kaydet yazınca çalışır.
argument-hint: "[proje-adı] [ek not]"
disable-model-invocation: true
---

# /kaydet: oturumu ikinci beyne yaz

Amaç: bu sohbetin kalıcı değerini `~/ZZ/brain` içine yaz. Türkçe yaz. **Önce `~/ZZ/brain/CLAUDE.md` kurallarını oku ve aynen uygula** (frontmatter, kebab-case dosya adı, `[[bağlantı]]`, atomik notlar, secret yok).

## Adımlar
0. **Vault'u güncelle:** `git -C <vault> pull --ff-only`. Diğer makinede yazılmış notlar böylece gelir. Başarısız olursa dur ve kullanıcıya söyle.
1. **Projeyi belirle:** argüman verildiyse o; yoksa çalışma klasörünü `20-Areas/working-rules/klasor-proje-eslemesi.md` tablosunda bul (klasör adı vault adından farklı olabilir: `mobil-playus` → `tussle`). ZZ kökündeyse konuya göre aynı nottaki "Proje klasörü olmayan konular" bölümüne uy (`sistem:` → `20-Areas/working-rules/`, `marka:` → `10-Projects/marka/`). Konu başka bir projeye aitse (ör. diskort oturumunda ziroo-edge işi) o projenin klasörüne yaz. Tabloda yoksa kullanıcıya sor; yeni proje açılırsa tabloya satır ekle.
2. **Sohbeti tara**, şunları çıkar:
   - **Kararlar:** ne karar verildi, **neden**, **reddedilen alternatifler**
   - **Dersler:** tekrar yaşanmaması gereken hata, ortam tuzağı, işe yarayan yöntem
   - **Durum değişiklikleri:** yayınlanan sürüm, taşınan/kurulan şey, biten ve yeni açılan işler
   - **Doğrulanmayanlar:** emin olunmayan ya da cihazda/canlıda denenmemiş her şey
3. **Yazmadan önce ara.** Her aday not için vault'ta `Grep` ile aynı konuyu ara. Varsa yeni dosya açma, mevcut notu güncelle ya da eskisini `status: superseded` yapıp yenisine bağla. Aynı karardan iki not üretme.
4. **Yaz:**
   - `10-Projects/<proje>/decisions/<konu>.md` ([[99-Templates/decision]] biçimi)
   - `10-Projects/<proje>/lessons/<konu>.md`
   - `10-Projects/<proje>/sessions/YYYY-MM-DD-<konu>.md` (kısa oturum özeti, `source:` bu sohbetin konusu)
   - **`_overview.md`**: "Güncel durum" ve "Sıradaki işler" bölümlerini güncelle (biteni sil/işaretle, yeniyi ekle), frontmatter `date`'i bugüne çek. Proje durumunun tek kaynağı budur. **Kısa tut:** her yeni oturum bu iki bölümü otomatik okur (hook, ~6000 karakterde keser). "Güncel durum" yalnızca *şu anki* durumdur, değişiklik günlüğü değil: madde başına 1-2 satır, ayrıntı ve geçmiş oturum notuna/karar notuna bağlantıyla gider; eskiyen maddeyi sil (bilgi zaten oturum notunda). Bölüm başlıkları tam olarak `## Güncel durum` ve `## Sıradaki işler` olsun.
   - Emin olunmayan her bilgi için `status: unverified`.
   - Yeni notu `_overview.md` ya da ilgili indeksten bağla (yetim not bırakma).
5. **Hafıza kuralı:** davranış kuralı ya da Yusuf'un yeni bir tercihi çıktıysa ilgili hafıza dosyasını da güncelle (kısa tut). Durum kopyası hafızaya yazılmaz.
6. **Kontrol et:**
   - Yazdığın dosyalarda secret, token, parola, özel anahtar, cihaz kimliği olmadığını tara. Sunucu IP'si yalnızca zaten orada olan runbook'larda kalsın.
   - Kırık `[[bağlantı]]` ve yetim not olmadığını kontrol et.
7. **Commit at ve push et:** yalnızca vault deposu, kısa Türkçe mesaj. Vault'un kendi uzak deposuna (özel tutulmalı) `git push` çalıştır. Push başarısız olursa (ağ yok, çakışma) raporda söyle; zorla push yapma.
8. **Raporla** (en fazla ~10 satır): yazılan/güncellenen dosyalar, atlananlar ve nedeni, doğrulanmayan noktalar.
9. **Arşiv öner, kendin arşivleme** (oturumu kapatmak için kullanıcı `/bitir` kullanır): masaüstü uygulamasındaysan raporu `mcp__ccd_turn__wrap_up` ile bitir: `ask` "Oturumu arşivleyeyim mi?", `actions` iki yanıt düğmesi: `{"label": "Arşivle", "message": "Oturumu arşivle."}` ve "Devam ediyorum". `{"action": "archive"}` kullanma: wrap_up kabul etse de kutuda düğmeler görünmüyor (2026-10-16). Uzaktan bağlıyken (düğme görünmez) aynı soruyu kapanış mesajına yaz; "evet" gelirse `mcp__ccd_session_mgmt__archive_session` (`self`). Otomatik arşivleme yok: `/kaydet` çoğu zaman oturum ortasında çalışır.

## Kurallar
- Sohbette gerçekten geçmeyen bir şeyi uydurma. Net olmayan kararı "karar verildi" diye yazma.
- Hiçbir notu silme; eskiyeni `superseded` yap ve `90-Archive/`'a taşıma kararını kullanıcıya bırak.
- Küçük, sıradan bir oturumdaysa (karar, ders, durum değişikliği yok) bunu söyle ve yalnızca kısa bir oturum notu öner; boş not üretme.

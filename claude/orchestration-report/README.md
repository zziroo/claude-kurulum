# Orkestrasyon Raporu Üretici

Claude Code oturumlarındaki ana oturum + arka plan ajanları (subagent) akışını
tek bir kendi kendine yeten HTML raporuna döken, tekrar çalıştırılabilir bir
araç. Sadece Node 20+ ile çalışır, harici npm bağımlılığı yoktur.

## Kullanım

```
node report.mjs [--session <id>] [--project <proje-dizini>] [--out <dosya.html>]
```

- Hiçbiri verilmezse yalnız **canlı kaynakta** (`kaynaklar.json`'daki ilk giriş, dosya
  yoksa `~/.claude/projects`) bütün proje dizinleri içinde dosya zamanına göre en yeni
  `.jsonl` oturumu seçilir. Arşiv kaynaklarına düşülmez: canlı kök yoksa ya da hiç
  `.jsonl` içermiyorsa hata verir ve `--session` / `--project` önerir.
- `--session` verilirse oturum bütün kaynaklardaki proje dizinlerinde aranır
  (`--project` de verilmişse yalnız o projede). Aynı oturum kimliği birden çok kaynakta
  varsa stderr'e uyarı yazılır, listedeki ilk kaynak kullanılır.
- `--project` yalnız verilirse, o dizindeki (hangi kaynakta varsa) dosya zamanına göre en
  yeni `.jsonl` oturumu seçilir. Dizin adı hangi kaynakta varsa oradan bulunur (Mac:
  `-Users-ziroo-ZZ-zProjects-diskort`, Windows arşivi: `C--Users-yusuf-ZZ-zProjects-diskort`).
- `--out` verilmezse çıktı `out/<sessionId>.html` olarak yazılır; yanına aynı
  isimle bir `<sessionId>.json` (ham hesaplanmış veri) de yazılır.

Örnek:

```
node report.mjs --session 72824d08-d870-48e5-bdad-ab589c1b5f78 --project C--dev-diskort
```

## Kaynaklar (Mac + Windows)

İki araç da transkriptleri tek bir kök yerine `~/Arsiv/claude-konusmalar/kaynaklar.json`
listesindeki bütün köklerden okur (`~` açılır):

```
{"kaynaklar": [{"ad": "mac", "kok": "~/.claude/projects"},
               {"ad": "windows", "kok": "~/Arsiv/claude-konusmalar/windows/projects"}]}
```

Dosya hiç yoksa yalnız `~/.claude/projects` okunur. Dosya varsa ama bozuksa (geçersiz JSON,
eksik `ad`/`kok`, aynı `ad` iki kez, boş liste) dört araç da hata verip çıkar (sessizce
yalnız Mac'e düşmez). Göreli `kok`, bu dosyanın dizinine göre çözülür. Listede olup
diskte bulunmayan kök uyarıyla atlanır. Listenin **ilk girişi canlı kaynaktır** (`report.mjs`
argümansız bunu kullanır), sırayı değiştirme. Aynı liste `ayikla.py` ve `ice-aktar.py`
tarafından da kullanılır; yeni makine/kaynak eklemek için yalnız bu dosyaya satır eklenir.

`ice-aktar.py <zip> [--dene] [--hedef <dizin>]` yeni bir Windows zip'ini `windows` köküne ekler
(kuralları dosyanın başındaki yardım metninde): `.jsonl` yalnız sonuna eklenerek büyüyebilir,
yerinde yeniden yazılan diğer dosyalar (memory, `custom-title.json` ...) zip'teki tarih daha
yeniyse güncellenir, başka her fark çakışma sayılıp dokunulmaz; zip-slip, çift ad ve bozuk girdide
hiçbir şey yazılmadan durur; hedef `~/.claude/projects` olamaz.

## Toplam kullanım: `usage.mjs`

```
node usage.mjs [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--out <dosya.html>]
```

Bütün kaynaklardaki ana oturum ve subagent kayıtlarını tarar; model / proje / gün /
oturum bazında token ve API-eşdeğeri maliyet çıkarır (`out/usage.html` + `.json`).
Konsol özeti ve HTML başlığı kullanılan kaynakları gösterir. Aynı mesaj kimliği
birden çok dosyada geçerse bir kez sayılır.

- `--since` / `--until`: `YYYY-MM-DD` ise **UTC günü** bazında (sınır günü dahil; kayıt
  zamanları UTC), saatli ISO ise anlık karşılaştırma (UTC için sonuna `Z`:
  `--until 2026-10-05T12:30:00Z`; saat dilimi yazılmazsa yerel saat).
- `--kaynak <ad>`: yalnız o kaynağı oku (`mac`, `windows`).
- Bayrak değersiz bırakılırsa ya da değeri `--` ile başlıyorsa (ör. `--since --out x`) hata verir.

## Pano (dashboard): `pano.mjs` + `sunucu.mjs`

```
# Sunucu kipi (varsayılan): yerel pano sunucusu, tek sayfada Canlı + geçmiş sekmeleri
node pano.mjs [--ac] [--canli] [--port 7788] [--pencere <dk>] [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--yenile]
node pano.mjs --yeniden | --durdur [--port N]
# Statik dosya kipi (paylaşım, Artifact yayını)
node pano.mjs --statik|--metinsiz|--artifact|--out <dosya.html> [--since <ISO>] [--until <ISO>] [--kaynak <ad>] [--yenile] [--ac]
```

**Sunucu kipi.** `node pano.mjs` portta (varsayılan 7788) bizim sunucumuz çalışıyorsa onu kullanır
(yeniden başlatmaz); port boşsa `sunucu.mjs`'i arka planda ayrık süreç olarak başlatır (günlük
`out/sunucu.log`), URL'yi ve kısa özeti (canlı + geçmiş) yazar, `--ac` ile tarayıcıda açar. Port
başka bir uygulamadaysa söyler ve `--port` önerir; eski `canli.mjs` sunucusu tutuyorsa onu söyler.
`--canli` sayfayı Canlı sekmesinde (`/#canli`) açar; `--yeniden` çalışan sunucuyu durdurup yeniden
başlatır (sunucu kodu değişince gerekir; şablonlar her istekte diskten okunur), `--durdur` durdurur.
`--since/--until/--kaynak` sayfa adresine sorgu olarak geçer (`/?since=2026-10-01`); `--metinsiz`
bir sunucu bayrağıyla (ör. `--port`) verilirse `?metinsiz=1` olur.

- Yalnız `127.0.0.1`; `Host` başlığı yerel değilse 403, GET/HEAD dışı 405. Yollar:
  `/` birleşik sayfa (`pano/sablon.html`, veri yerine `{"sunucuModu":2}` işareti), `/canli` ve
  `/canli.html` → `/#canli` (302; Canlı sekmesi gömülü modül), `/durum` canlı anlık görüntü,
  `/olaylar` SSE, `/pano.json` geçmiş verisi, `/ozet` başlatıcının yazdığı özet (JSON).
- `/pano.json`: sunucu `pano.mjs --yalniz-json`'u alt süreçte çalıştırır (önbellekle ~1 sn) ve sonucu
  süzgeç başına bellekte tutar. Canlı kökte değişiklik varsa 15 sn'den eski sonuç yeniden hesaplanır;
  izlenmeyen kökler (Windows arşivi) için en çok 5 dk. `?taze=1` hemen, `?yenile=1` ayrıştırma
  önbelleğini de yok sayarak hesaplar. Hesap başarısızsa eski sonuç `X-Pano-Bayat` başlığıyla döner.
- `?metinsiz=1` canlı akışta da geçerli: istemden türeyen başlık, ajan açıklaması, istem/araç özetleri gönderilmez.

**Statik kip** bütün kaynaklardaki oturum ve alt ajan transkriptlerinden tek dosyalık, animasyonlu
bir dashboard üretir: `out/pano.html` + `out/pano.json` (Canlı sekmesi yok).

- Bölümler: Genel bakış, Token ve maliyet, Projeler (worktree klasörleri ana projede birleşir;
  proje başına gönderilen kelime ≈ ve aktif oturum süresi), Oturumlar (oturum başına oynatılabilir
  zaman çizelgesi, bağlam eğrisi, olay yoğunluğu), Akışlar (araç geçişleri ve orkestrasyon Sankey'i),
  Ajanlar, Alışkanlıklar, Dosyalar. Tarih, kaynak, proje, model ve zamanlanmış görev filtreleri tarayıcıda uygulanır.
- `--since/--until/--kaynak` anlamı `usage.mjs` ile aynı; `--ac` tarayıcıda açar;
  `--metinsiz` istem metinlerini ve ajan açıklamalarını çıkarır (paylaşmadan önce kullan).
- Önbellek: `out/.pano-onbellek.json`. İlk tam tarama ~5 sn, sonrakiler <1 sn. `--yenile`
  önbelleği yok sayar; `redact` değişince önbellek kendiliğinden yenilenir.
- Dosyalar: `pano.mjs` (toplayıcı), `ortak.mjs` (kaynak listesi, fiyatlar, proje adı, redact;
  `usage.mjs`/`report.mjs`'ten kopya, onlar değişirse elle eşitle), `pano/sablon.html`
  (arayüz, harici bağımlılık yok, CSP'li), `pano/SEMA.md` (veri sözleşmesi).
- Doğrulama kuralı: `ozet.cagri` ve `ozet.maliyet`, aynı süzgeçle `usage.mjs` toplamına
  birebir eşit olmalı (SEMA.md "Doğrulama").
- Çıktıda istem metinleri var: Artifact/bulut/vault'a yalnız istenirse.
- Artifact yayını: `node pano.mjs --artifact` ek olarak `out/pano-artifact.html` (+ `.json`) yazar. Bu dosya
  claude.ai iskeletine uygun bir gövde parçasıdır: doctype/html/head/body, charset/viewport/CSP meta'ları yok.
  Genel IPv4 adresleri `[IP]` olur, `pano/yayin-maskeler.json`'daki dizeler birebir değiştirilir.
  Yayından önce `node pano/yayin-kontrol.mjs` son yayından beri eklenen metinleri `out/pano-yayin-yeni.txt`'ye
  döker (otomatik e-posta/IP/IBAN/telefon/sır işaretleriyle). Okunduktan ve yayınlandıktan sonra
  `--onayla` ile `out/.pano-yayin-gorulen.json`'a kaydedilir. Adımlar ve artifact adresi `/pano` skill'inde.

## Canlı sekmesi (eski `canli.mjs`)

```
node pano.mjs --canli [--ac] [--port 7788] [--pencere <dk>]
```

Şu an çalışan oturumları ve alt ajanları canlı gösterir; artık ayrı bir sunucu değil, pano
sunucusunun (`sunucu.mjs`) ilk sekmesi. `/pano` zaten Canlı sekmesinde açılır. `/canli` komutu
ve `canli.mjs` kısayolu 2026-10-20'de kaldırıldı (kopyaları: `out/yedek-2026-10-20/skill-canli/`,
`out/yedek-2026-10-20/canli-kisayol.mjs`). Eski tek başına sunucunun kopyası: `out/yedek-2026-10-20/canli.mjs`.

- Yalnız `127.0.0.1`'e bağlanır. Canlı yolları: `/#canli` (arayüz; `/canli.html` oraya yönlenir), `/durum` (JSON anlık görüntü), `/olaylar` (SSE).
- `canli/sablon.html` **kullanımdan kalktı (yedek)**: sunucu artık onu sunmuyor; Canlı arayüzü
  `pano/sablon.html` içindeki gömülü modüldür. Dosya yalnız başvuru için duruyor.
- Yalnız **canlı kaynağı** (`kaynaklar.json`'daki ilk kök, yoksa `~/.claude/projects`) salt okur.
  Açılışta son `--pencere` dakikada (varsayılan 180) değişen dosyalar tam okunur; sonra
  `fs.watch` (özyinelemeli) + 2 sn yoklama ile `.jsonl`'lar kaldığı bayttan artımlı izlenir.
  Pencere dışındaki eski bir dosya büyürse o an baştan okunur.
- Arayüz "Orkestra": her oturum bir kart (model, durum, bağlam ölçeri, anlık araç, maliyet, 60 dk
  çıkış kıvılcımı), ajanları altında SVG bağlarla; yan sütunda model dağılımı ve son 60 kaydın akışı.
  Biten ajan 2 dk soluk kalıp toplanır. Boşta/kapalı oturumlar düğmeyle görünür.
- Durum kuralları, ajan bitiş sinyalleri ve veri biçimi: `canli/SEMA.md`.
- `--ac` tarayıcıda açar; durdurmak için `node pano.mjs --durdur` (ya da `pkill -f "orchestration-report/sunucu.mjs"`).
- Gizlilik: serbest metin `redact()`/`excerpt()`'ten geçer (en çok ~80 kr); istem gövdesi ve ham araç
  girdisi gönderilmez. Yine de sayfa yereldir: Artifact olarak yayınlama.

## Rapor neler içerir

1. **Özet** — model başına toplam token (giriş/önbellek yazma/önbellek okuma/çıkış),
   ajan sayısı, eşzamanlı ajan zirvesi, toplam ajan duvar-saati, tahmini maliyet.
2. **Zaman çizelgesi** — ana oturum + her ajan için bir Gantt şeridi (model rengine
   göre), ana oturumdaki kullanıcı mesajları dikey çizgi olarak işaretli.
3. **Ajan tablosu** — açıklama/tür/model/konum (ön plan, arka plan, worktree),
   başlangıç/süre, araç çağrıları, tokenler, zirve/son bağlam, bağlam grafiği,
   maliyet, durum.
4. **Bağlam büyümesi** — ana oturum ve her ajan için API çağrısı başına bağlam
   boyutunu gösteren küçük çizgi grafik (sparkline).
5. **İletişim akışı** — kullanıcı→ana oturum, ana oturum→ajan (spawn), ajan→ana
   oturum (hand-back), ana oturum→ajan (SendMessage) olaylarının kronolojik listesi.
6. **Olaylar** — izin reddi, araç hatası, compaction olayları.
7. **Ana orkestratör** — ana oturumun kendi token/bağlam eğrisi ve toplam
   maliyetteki payı.

## Maliyet rakamları hakkında

Maliyetler **API liste fiyatı karşılığıdır**. Pro/Max abonelikte bu tutarlar ayrıca
faturalandırılmaz, kullanım limitinden düşer. Fiyatlar `report.mjs` içindeki
`PRICES` tablosunda sabitlenmiştir; kaynağı ve türetilen (önbellek yazma/Sonnet 5
önbellek okuma) oranlar dosya içindeki yorumda açıklanmıştır. Fiyatlar zamanla
değişebilir — güncel fiyat için `claude-api` skill'i tekrar sorgulayıp tabloyu
güncelleyin.

## Veri kaynağı ve sınırlamalar

- Ana oturum: `<kaynak kökü>/<proje>/<sessionId>.jsonl` (kök: yukarıdaki kaynak listesi;
  Mac için `~/.claude/projects`)
- Ajanlar: `<kaynak kökü>/<proje>/<sessionId>/subagents/agent-<id>.jsonl`
  + `.meta.json` (`.meta.json` olmayan ajanları `report.mjs` göstermez; `usage.mjs` sayar)
- Token sayımı, aynı `requestId`'yi paylaşan satırlar için **bir kez** yapılır
  (bir istek birden çok JSONL satırına yayılabilir).
- Task-notification'daki `subagent_tokens` alanı, o ajanın tüm API çağrıları
  toplamı DEĞİL, ajanın **son/zirve bağlam boyutuna** yakın bir değerdir
  (önbellek nedeniyle çağrılar arası token toplamı gerçek dışı büyük çıkar).
  Rapor, kendi hesapladığı zirve/son bağlam değerlerini bu bildirimle yan yana
  gösterir, böylece çapraz kontrol edilebilir.
- Transkriptler salt okunur girdi olarak işlenir; istem ve hand-back metinleri
  raporda en fazla 600 karakterlik özetler halinde, olası anahtar/token benzeri
  dizeler kırpılmış (redakte edilmiş) olarak gösterilir.

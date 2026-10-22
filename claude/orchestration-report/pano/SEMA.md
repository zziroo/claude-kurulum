# Pano veri sözleşmesi (sürüm 1)

`pano.mjs` bu biçimde bir JSON üretir (`out/pano.json`) ve aynısını `pano/sablon.html`
içindeki yer tutucuya gömerek `out/pano.html` yazar. Arayüz (`sablon.html`) bütün
grafikleri bu ham tablolardan, **seçili filtreye göre tarayıcıda** hesaplar.

## Gömme kuralı

- Şablonda tam bir kez şu satır bulunur:
  `<script id="pano-veri" type="application/json">__PANO_VERI__</script>`
- `pano.mjs` `__PANO_VERI__` yerine `JSON.stringify(veri)` koyar; içinde `<` → `\u003c`,
  U+2028 → `\u2028`, U+2029 → `\u2029` kaçışı yapılır
  (altı karakterlik düz metin kaçış dizeleri; `</script>` kırılmasın).
- Arayüz: `JSON.parse(document.getElementById("pano-veri").textContent)`.
- Metin hâlâ `__PANO_VERI__` ise arayüz "veri yok, `node pano.mjs` çalıştır" ekranı gösterir.

### Sunucu modu

- `sunucu.mjs` `/` yolunda şablonu sunarken `__PANO_VERI__` yerine `{"sunucuModu":2}` koyar.
  Arayüz bu işareti görünce: ilk sekme olarak "Canlı"yı ekler (`#canli`; şablona gömülü modül, iframe yok:
  sayfa açılınca `EventSource("/olaylar" + location.search)` kurar, üst şeritte bağlantı çipi, sekmede canlı
  oturum rozeti), varsayılan sekme Canlı olur, filtre şeridi Canlı'da gizlenir ve veri
  `fetch("/pano.json" + location.search)` ile arkadan gelir (bu dosyadaki biçim, `pano.mjs --yalniz-json`
  çıktısı). Veri gelene kadar geçmiş sekmeleri "yükleniyor", hata olursa nedenini gösterir.
  Yenileme: üst şeritteki "Yenile" düğmesi `taze=1` ekleyerek yeniden çeker; sekmeye/pencereye dönünce
  (visibilitychange/focus, en çok dakikada bir, oturum ayrıntısındayken değil) sorgusuz çekilir ve
  `meta.uretildi` değişmediyse çizim yinelenmez. Etkin sekme ve filtre (kaynak/proje/model adlarıyla) korunur.
  `/canli.html` ve `/canli` `/#canli`'ya yönlenir (302); eski `canli/sablon.html` artık sunulmuyor (yedek).
- `/pano.json` sorgusu: `since`, `until`, `kaynak`, `metinsiz=1` (anlamları komut satırıyla aynı),
  `taze=1` (hemen yeniden hesapla), `yenile=1` (ayrıştırma önbelleğini de yok say). Hatalı biçim 400,
  hesap hatası 500 `{ "hata": "..." }`.
- Statik dosyada ve Artifact'ta işaret yoktur; Canlı sekmesi de yoktur.

## Genel kurallar

- Bütün zamanlar **epoch milisaniye** (sayı), UTC. Yerel saate çevirme arayüzün işi
  (tarayıcının saat dilimi). `saat` alanları `Math.floor(ms / 3600000)` (epoch saati).
- Maliyetler USD, API liste fiyatı karşılığı (Max aboneliğinde fatura değildir).
- Tokenlar: `g` giriş (input), `c` çıkış (output), `o` önbellek okuma, `y` önbellek yazma
  (5 dk + 1 sa toplam).
- Bağlam boyutu bir API çağrısı için `input + cache_read + cache_creation` (istem boyutu).
- Sözlük indeksleri 0'dan başlar. `-1` = "İstem" (kullanıcı), `-2` = "Yanıt" (asistanın
  metin cevabı) yalnız `gecisler` içinde sözde düğümdür.
- `metinler: false` ise (`--metinsiz`) bütün serbest metin alanları `null` olur:
  `ilkIstem`, `istemler[][3]`, ajan `istem` ve ajan `aciklama`; oturum başlıkları (`baslik`) ve
  dosya yolları kalır (başlık ilk istemden türetilmişse kimliğin ilk 8 karakteri olur).
- Serbest metinler, oturum `baslik`'ı ve ajan `aciklama`'sı `ortak.mjs`'teki `redact()` ile
  (report.mjs'tekiyle birebir aynı) anahtar/token/parola benzeri dizelerden arındırılır; istem
  metinleri kesilmeden önce arındırılır.

## Kök

```jsonc
{
  "meta": {
    "surum": 1,
    "uretildi": 1760000000000,          // ms
    "tz": "Europe/Istanbul",           // üretildiği makinenin saat dilimi (bilgi amaçlı)
    "metinler": true,
    // komut satırı süzgeci; verilmeyen since/until/kaynak null, metinsiz true|false
    "filtre": { "since": "2026-10-01", "until": null, "kaynak": null, "metinsiz": false },
    "kaynaklar": [{ "ad": "mac", "kok": "~/.claude/projects", "dosya": 132 }],
    "ilk": 1758000000000, "son": 1760000000000,   // en eski / en yeni kayıt
    "fiyatNotu": "API liste fiyatı karşılığı; Max aboneliğinde ayrıca faturalanmaz.",
    "sureMs": 41234                    // toplama süresi
  },
  "sozluk": {
    "modeller": [{ "id": "claude-opus-5-5", "ad": "Opus 5.5" }],
    "araclar": ["Bash", "Read", "Edit", "mcp__Claude_Browser__navigate"],
    "projeler": ["diskort", "ZZ (genel)"]
  },
  "oturumlar": [ /* Oturum */ ],
  "ajanlar":   [ /* Ajan */ ],
  // saat × oturum × rol × model kovası; ana oturum + alt ajan API çağrılarının TAMAMI burada
  // [oturumIdx, saat, altAjan(0|1), modelIdx, cagri, g, c, o, y, maliyet]
  "kovalar": [[0, 488000, 0, 0, 12, 340, 9100, 812000, 40000, 0.731]],
  // saat × oturum × rol × araç × model kovası
  // [oturumIdx, saat, altAjan(0|1), aracIdx, adet, hata, modelIdx]
  // modelIdx: aracı çağıran asistan mesajının modeli (bilinmiyorsa -1). Model sütunu toplanınca
  // (oturum, saat, rol, araç) toplamları çıkar; eski 6 elemanlı satırları okuyan arayüz bozulmaz.
  "aracKovalari": [[0, 488000, 0, 0, 7, 1, 0]],
  "ozet": { "cagri": 61234, "maliyet": 4328.12, "oturum": 290, "ajan": 460 }  // doğrulama için
}
```

## Oturum

Bir oturum kimliği (alt ajanlar `ajanlar`'da, `oturum` alanıyla bağlı). Aynı kimlik iki kaynakta
(ör. Mac ve Windows arşivi) ya da aynı kaynakta iki proje klasöründe olabilir: hepsi okunur, kopya
kayıtlar aşağıdaki sahiplik kuralıyla bir kez sayılır (stderr'e uyarı yazılır). Bu durumda `kaynak`
ve `proje` ilk görülen kopyadan; `baslik` ana dosyalar arasında son dolu değerden; `zamanli`
herhangi bir kopyada doğruysa doğrudur; `istemler` zamana göre birleştirilir.
Alanlardaki sayaçlar aksi yazmadıkça **ana oturum + alt ajanları** birlikte sayar.

```jsonc
{
  "id": "9f1a0281-...",
  "kaynak": "mac",                 // kaynaklar.json'daki ad
  "proje": 1,                      // sozluk.projeler indeksi
  "baslik": "Pano aracı",          // custom-title (son değer) > agent-name > ilk istemin ilk 80 karakteri
  "ilkIstem": "benim icin ...",    // ilk insan istemi, ≤ 300 karakter (metinsizde null)
  "zamanli": false,                // ilk kullanıcı mesajı "<scheduled-task" ile başlıyor (gözcü/zamanlanmış görev oturumu)
  "basla": 1759800000000, "bitis": 1759810000000,
  "aktifSn": 5400,                 // ana+alt ajan kayıt zamanları sıralanıp ≤ 10 dk boşluklar toplanır
  "istem": 14,                     // insan istemi sayısı (aşağıdaki tanım)
  "yanit": 22,                     // ana oturumda metin içeren asistan cevabı sayısı
  "cagri": 310,                    // tekil API çağrısı (message.id)
  "arac": 420,                     // tool_use sayısı
  "hata": 9,                       // is_error: true tool_result; izin reddi ve kesinti sonuçları HARİÇ
  "ret": 1,                        // izin reddi (kullanıcı/sınıflandırıcı/kural aracı reddetti)
  "kesinti": 2,                    // "[Request interrupted by user" ile başlayan kullanıcı metni
  "apiHata": 0,                    // system/api_error
  "sikistirma": [{ "t": 1759805000000, "once": 968755, "sonra": 21887, "tetik": "auto" }],  // yalnız ana oturum
  "zirveBaglam": 412000,           // ana oturumun en büyük bağlamı
  "maliyet": 41.2,
  "token": { "g": 1, "c": 2, "o": 3, "y": 4 },
  "modeller": { "0": 38.1, "2": 3.1 },   // modelIdx -> maliyet
  "altAjan": 5,
  "surum": "2.1.289",              // en sık Claude Code sürümü
  "giris": "claude-desktop",       // en sık entrypoint
  "dallar": ["main"],              // görülen gitBranch'ler (en çok 5)
  "cwd": "/Users/ziroo/ZZ",
  "efor": { "xhigh": 120, "medium": 3 },       // effort, tekil API çağrısı başına (ana + alt ajan)
  "izin": { "auto": 14, "plan": 1 },           // permissionMode, insan istemi başına
  "dusunme": { "blok": 80, "ms": 340000 },     // thinking blokları, thinkingDurationMs toplamı
  "gorsel": 2,                     // kullanıcının gönderdiği görsel sayısı
  // Ana oturumun bağlam eğrisi: [oturum başından saniye, bağlam token]; en çok 160 nokta
  // (fazlaysa zirveleri ve sıkıştırma düşüşlerini koruyacak şekilde seyreltilir)
  "egri": [[0, 21000], [35, 24000]],
  // Zaman çizelgesi olayları: [oturum başından saniye, kod, arg]
  //  "i" insan istemi (arg: istemler dizisindeki sıra)   "y" asistan metin cevabı
  //  "a" ana oturum araç çağrısı (arg: aracIdx)           "x" araç hatası (arg: aracIdx)
  //  "g" alt ajan başlatıldı (arg: ajanlar indeksi)       "s" sıkıştırma (arg: önceki token)
  //  "k" kullanıcı kesintisi                               "e" API hatası
  // En çok 4000 olay; aşarsa önce "a" olayları seyreltilir ve "olayKirpildi": true
  "olaylar": [[0, "i", 0], [3, "a", 0]],
  "olayKirpildi": false,
  // İnsan istemleri: [ms, karakter sayısı, tur süresi sn, metin ≤ 400 karakter | null]
  // tur süresi: istemden, sonraki insan isteminden önceki son asistan kaydına kadar
  "istemler": [[1759800000000, 412, 95, "..."]],
  // Dokunulan dosyalar (ana + alt ajan): yol -> [okuma, düzenleme, yazma]; en çok 40, işleme göre
  "dosyalar": { "/Users/ziroo/x.mjs": [3, 5, 1] },
  // Bash/PowerShell komut başları: "git commit", "npm", "node" ...; en çok 25
  "komutlar": { "git commit": 3, "node": 12 },
  "alanlar": { "github.com": 2 },  // WebFetch alan adları (+ "WebSearch" sayacı ayrı anahtar)
  "beceriler": { "/kaydet": 1, "dataviz": 1 },  // Skill aracı + kullanıcı slash komutları
  // Ana oturum araç geçişleri: [kaynakIdx, hedefIdx, adet]; -1 İstem, -2 Yanıt
  // sıra: istem -> araçlar (çağrı sırasıyla) -> metin cevabı -> istem ...
  "gecisler": [[-1, 0, 4], [0, 1, 9], [1, -2, 3]]
}
```

### İnsan istemi tanımı

`type:"user"`, `isSidechain` değil, `isMeta`/`isCompactSummary` değil; içerik düz metin ya da
`text`/`image` bloklarıdır (`tool_result` değil). `turnOrigin`/`origin` alanı varsa yalnız
`human` sayılır; `<scheduled-task` ile başlayan mesaj `human` taşısa da istem sayılmaz (otomatik). Alan yoksa (eski sürümler) şunlar istem sayılmaz: `<task-notification>`,
`<local-command-` ile başlayanlar, yalnız `<system-reminder>` içerenler,
`[Request interrupted by user` (bu `kesinti`'dir). `<command-name>/x</command-name>` içeren
mesaj istem sayılır ve `beceriler`'e `/x` eklenir.

### Sayaç tanımları

- `hata`: `is_error: true` araç sonuçlarından izin reddi ve kullanıcı kesintisi olmayanlar
  (`toolDenialKind: "automode-unavailable"`, yani sınıflandırıcının karar verememesi, hata sayılır).
  `aracKovalari` içindeki `hata` da aynı tanımdır.
- `ret`: `toolDenialKind` `user-rejected`, `automode-blocked` ya da `permission-rule` olan araç
  sonucu. Alan yoksa (eski sürümler) Claude Code ret metinlerine bakılır ("The user doesn't want to
  proceed ...", "Permission to use ... has been denied", "... denied by ...").
- `kesinti`: kullanıcı metni `[Request interrupted by user` ile başlayan kayıt (ana + alt ajan).
  Kullanıcı bir aracı reddedince Claude Code hem ret sonucu hem kesinti metni yazar; bu yüzden bir
  ret çoğu zaman `ret` ve `kesinti`'yi birer artırır. `toolDenialKind: "interrupted"` sonucu
  ("Request was aborted.") ne `hata` ne `ret` sayılır.
- `apiHata`: `system/api_error` kaydı (her yeniden deneme ayrı kayıttır).
- `efor` tekil API çağrısı başına, `izin` insan istemi başına sayılır; `dusunme.ms`
  (`thinkingDurationMs`) yalnız yeni Claude Code sürümlerinde vardır, eskilerde 0.
- `sikistirma`, `zirveBaglam`, `egri`, `olaylar`, `istemler`, `gecisler` yalnız ana oturumdan gelir
  (`olaylar` içindeki "g" alt ajan başlangıcıdır).

### Arayüzde türetilen proje ölçüleri (yeni alan gerektirmez)

Projeler sekmesi `sozluk.projeler` adlarından `X--claude-worktrees-…` biçimindekileri yalnız gösterimde
ana proje `X` ile birleştirir (süzgeç ve öteki sekmeler sözlük adlarını kullanır). Proje başına:
- **Gönderilen kelime ≈**: aralıktaki her istem için `istemler[i][3]` metninin kelime sayısı (`\S+`);
  metin kırpıksa (`istemler[i][1]` > metin uzunluğu) kalan karakterler ÷ (bütün saklı metinlerdeki
  karakter/kelime oranı) eklenir. Metin yoksa (`metinler: false`) kelime = karakter ÷ 6,8.
- **Aktif oturum süresi**: aralıkta etkin oturumların `aktifSn` toplamı (oturumun tamamı; klavye süresi değil).

### Zaman süzgeci

`--since/--until` kayıt düzeyindedir: aralık dışındaki her kayıt (çağrı, istem, araç, hata...) hiç
sayılmaz. Aralıkta kaydı olmayan oturum ve ajan çıktıya girmez; `basla`/`bitis`, `ilkIstem`, `baslik`
(istemden türetiliyorsa) aralıktaki kayıtlardan hesaplanır. Zaman damgası olmayan kayıt süzülmez
(usage.mjs ile aynı); kova ve gösterim için dosyada kendinden önceki son zamanı alır.

### Çatallanan / devam ettirilen oturumlar

Bir oturum çatallanınca ya da devam ettirilince yeni `.jsonl` eski geçmişi (alt ajan dosyaları dahil)
aynı `uuid` ve `message.id` ile kopyalar. Her kayıt (uuid) ve API çağrısı (message.id) tek bir
dosyaya atanır: (1) kaydın `sessionId`'si dosyanın oturumuyla eşleşen, (2) oturumu en erken biten
(ata oturum), (3) tarama sırasında ilk gelen. Toplam çağrı/maliyet bundan etkilenmez (usage.mjs ile
aynı); yalnız hangi oturuma yazıldığı değişir (usage.mjs kopyayı tarama sırasında ilk gelene yazar).
Hiç kendi kaydı kalmayan saf kopya oturum ve ajanlar listelenmez. Aynı oturum kimliğinin iki
kaynaktaki ya da iki proje klasöründeki kopyaları da aynı kuralla çözülür; oturum aynı olduğundan
genelde (3) belirler, yani listedeki ilk kaynak.

## Ajan

```jsonc
{
  "oturum": 0,                     // oturumlar indeksi
  "id": "a54bbe81391ab1d70",
  "tur": "general-purpose",        // meta.json agentType, yoksa "?"
  "aciklama": "Kamp ve arayüz incelemesi",   // spawn eden Agent/Task çağrısının description'ı
                                   // (yoksa meta.json description; redact edilir; metinsizde null)
  "model": 2,                      // en çok maliyetli modelIdx; hiç çağrısı yoksa null
  "basla": 1759800100000, "bitis": 1759801000000,
  "cagri": 40, "arac": 55, "hata": 1,
  "maliyet": 2.1,
  "token": { "g": 1, "c": 2, "o": 3, "y": 4 },
  "zirveBaglam": 98000,
  "arkaPlan": true,                // spawn çağrısındaki run_in_background (bilinmiyorsa null)
  "izolasyon": "worktree",         // ya da null
  "istem": "..."                   // spawn istemi ≤ 300 karakter (metinsizde null)
}
```

## Doğrulama

`ozet.cagri` ve `ozet.maliyet` aynı kaynaklar için `node usage.mjs` çıktısındaki toplam
çağrı ve maliyetle birebir aynı olmalı (aynı tekilleştirme: `message.id`, alanlar maks).

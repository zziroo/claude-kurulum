# Canlı pano veri sözleşmesi (sürüm 1)

Canlı kısım birleşik pano sunucusunda (`sunucu.mjs`, 2026-10-20'ye kadar ayrı `canli.mjs`). Sunucu
yalnız `127.0.0.1`'e bağlanır; canlı yolları:

| Yol | İçerik |
|---|---|
| `/canli.html` | `/#canli`'ya 302 (Canlı arayüzü `pano/sablon.html` içinde gömülü modül; `canli/sablon.html` kullanımdan kalktı, yedek) |
| `/canli` | `302` → `/#canli` (birleşik sayfa, Canlı sekmesi) |
| `/durum` | tam anlık görüntü (JSON, aşağıdaki **Anlık**) |
| `/olaylar` | SSE akışı: bağlanınca `anlik`, sonra artımlı olaylar |

Geçmiş yolları (`/`, `/pano.json`, `/ozet`) için README "Pano". `/durum` ve `/olaylar` `?metinsiz=1`
alırsa serbest metinler gönderilmez: oturum `baslik`'ı yalnız konmuş başlık (custom title) ya da
kimliğin ilk 8 karakteri, ajan `aciklama` `null` ve `baslik` kimlik, `sonArac.ozet` `null`, `istem`/
`arac`/`spawn` olaylarının `ozet`'i `null`, ajan olaylarında `kim` "ajan <kimlik>"; anlıkta `meta.metinler: false`.
Canlı arayüz kendi sayfa sorgusunu (`location.search`) `/olaylar`'a geçirir.

Başka her yol 404; GET/HEAD dışı 405; `Host` başlığı `127.0.0.1:<port>` ya da `localhost:<port>`
değilse 403 (DNS rebinding koruması).

## Genel kurallar

- Zamanlar epoch ms (UTC). Maliyet USD, API liste fiyatı karşılığı (`ortak.mjs` `cost()`).
- Tokenlar: `g` giriş, `c` çıkış, `o` önbellek okuma, `y` önbellek yazma (`y5` + `y1`).
- Aynı `message.id` birden çok satıra yayılır: alanlarda maksimum alınır, yalnız artış eklenir.
- `baglam` = son çağrının `input + cache_read + cache_creation`; `pencere` Fable/Opus için 1M, diğerleri 200K.
- Serbest metin (başlık, açıklama, araç özeti, istem) `redact()`/`excerpt()`'ten geçer, en çok ~80
  karakter. İstem gövdesi ve ham araç girdisi asla gönderilmez; araç özeti: Bash `description`
  (yoksa komutun ilk satırı), dosya araçlarında kısaltılmış yol, Grep/Glob deseni, Agent açıklaması,
  WebFetch alan adı.

## Anlık (`/durum`, SSE `anlik`)

```jsonc
{
  // uygulama/sunucuSurum/pid/basladi: başlatıcı (baslat.mjs) portu tutan sunucunun bizim olduğunu ve pid'ini buradan anlar
  "meta": { "surum": 1, "uygulama": "orchestration-report", "sunucuSurum": 2, "pid": 12345, "basladi": 0,
            "uretildi": 0, "kok": "~/.claude/projects", "pencereDk": 180, "port": 7788, "fiyatNotu": "..." },
  "genel": {
    "ts": 0, "aktifOturum": 1, "canliOturum": 3,   // canlı = aktif + bekliyor
    "aktifAjan": 4,
    "son5dk":  { "tok": 0, "cikis": 0, "maliyet": 0, "cagri": 0 },
    "sonSaat": { "tok": 0, "cikis": 0, "maliyet": 0, "cagri": 0 },
    "cikisDk": 3200,                                 // son 5 dk çıkış / 5
    "modeller": [{ "model": "claude-opus-5-5", "ad": "Opus 5.5", "tok1sa": 0, "maliyet1sa": 0, "cikis5dk": 0, "aktif": 2 }]
  },
  "oturumlar": [ /* Varlık, tur "oturum"; son etkinliğe göre azalan */ ],
  "ajanlar":   [ /* Varlık, tur "ajan"; başlangıca göre artan */ ],
  "olaylar":   [ /* Olay, en çok 60, eskiden yeniye */ ]
}
```

## Varlık

```jsonc
{
  "id": "…", "tur": "oturum" | "ajan", "oturum": "<ana oturum id>", "proje": "ZZ (genel)",
  "cwd": "~/ZZ", "dal": "main", "model": "claude-fable-5-1", "modelAd": "Fable 5.1",
  "durum": "aktif", "detay": "araç: Bash", "son": 0, "basla": 0,
  "tok": { "g": 0, "c": 0, "o": 0, "y": 0, "y5": 0, "y1": 0 }, "maliyet": 0,
  "baglam": 84000, "pencere": 1000000, "cagri": 12,
  "araclar": [["Bash", 9], ["Read", 4]],             // en çok 8, adede göre
  "sonArac": { "ad": "Bash", "ozet": "Run tests", "ts": 0 },
  "seri": [0, 0, 120 /* … */],                       // 60 eleman: son 60 dk, dakika başına çıkış tokenı
  // yalnız oturum:
  "baslik": "custom-title.json > custom-title kaydı > ilk istem (77 kr) > id[0:8]",
  "kapali": false, "ajanlar": ["<ajan id>"], "aktifAjan": 1,
  // yalnız ajan:
  "ust": "<ebeveyn varlık id: oturum ya da ajan>", "aciklama": "…", "ajanTuru": "general-purpose",
  "istenenModel": "opus", "derinlik": 1, "arkaPlan": true,
  "bitti": false, "bitisTs": null, "bitisDurum": "completed|teslim|sessiz|…", "sureMs": null
}
```

### Durumlar

Oturum (sessizlik = şimdi − son kayıt):
- `kapandı`: yanında `<id>.desktop-released.json` var ya da 30 dk+ sessiz.
- `bekliyor`: son tur bitti (yanıt `stop_reason` ≠ tool_use ya da kullanıcı kesti) ve ya çalışan
  ajanı var (`detay` "N ajanı bekliyor") ya da 5 dk'dan kısa sessiz ("kullanıcıyı bekliyor").
- `aktif`: 90 sn içinde kayıt var, ya da yanıtı gelmemiş araç çağrısı 10 dk'dan yeni. `detay`:
  "araç: X", "düşünüyor", "yazıyor".
- `boşta`: geri kalan (90 sn – 30 dk sessiz).

Ajan: `bitti` = son kayıttan sonra bitiş sinyali var (ebeveynde senkron Agent `tool_result`'ı,
`<task-notification>` ya da ajanın `SubagentHandback` sonucu), ya da 30 dk sessiz, ya da tur bitti
ve 90 sn sessiz, ya da ana oturum kapandı ve 90 sn sessiz. Sonra yeni kayıt gelirse (SendMessage ile
devam) yeniden `çalışıyor`. Ebeveyn `.meta.json` `toolUseId` → o Agent çağrısını yapan varlık.

## Olay (SSE `kayit`, `olaylar[]`)

```jsonc
{ "ts": 0, "id": "<varlık>", "varlikTur": "ajan", "oturum": "…", "kim": "proje ya da ajan açıklaması",
  "tur": "arac|spawn|sonuc|teslim|ajan-bitti|dusunce|metin|istem|bildirim|kesildi|cagri",
  "arac": "Bash", "ozet": "…", "dTok": 0, "dCikis": 0, "dMaliyet": 0,
  "durum": "aktif", "v": { /* yalnız SSE: güncel Varlık */ } }
```

## SSE olayları

| Olay | Ne zaman | Veri |
|---|---|---|
| `anlik` | bağlanınca ve 30 sn'de bir | Anlık |
| `kayit` | her yeni anlamlı satır | Olay + `v` |
| `varlik` | etkilenen oturum ya da zamanla değişen durum (5 sn tarama) | Varlık |
| `genel` | her işlenen grup sonrası | `genel` |
| `kalp` | 15 sn'de bir | `{ "ts": 0 }` |

Akışta `retry: 3000` gönderilir; arayüz kendi geri çekilmeli yeniden bağlanmasını da yapar
(1 → 30 sn; 40 sn mesajsızlıkta koparır).

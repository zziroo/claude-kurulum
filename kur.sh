#!/usr/bin/env bash
# claude-kurulum: claude/ altındaki düzeni ~/.claude'a symlink'ler.
# Kullanım: ./kur.sh [--kuru] [--kaldir]
#   --kuru    hiçbir şeyi değiştirmeden ne yapılacağını yazar
#   --kaldir  bu repoya işaret eden symlink'leri söker, en son yedekleri geri koyar
set -euo pipefail

KURU=0
KALDIR=0
for arg in "$@"; do
  case "$arg" in
    --kuru) KURU=1 ;;
    --kaldir) KALDIR=1 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Bilinmeyen bayrak: $arg" >&2; exit 2 ;;
  esac
done

# Repo kökü (taşınabilir: readlink -f yok)
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
KAYNAK="$REPO/claude"
HEDEF="${CLAUDE_DIZINI:-$HOME/.claude}"
GIRDILER=(CLAUDE.md hooks agents skills orchestration-report sesli)
ZAMAN="$(date +%Y%m%d-%H%M%S)"

yap() {
  if [ "$KURU" -eq 1 ]; then
    echo "  [kuru] $*"
  else
    "$@"
  fi
}

[ "$KURU" -eq 1 ] && echo "Kuru çalıştırma: hiçbir şey değişmeyecek."
[ -d "$KAYNAK" ] || { echo "Kaynak yok: $KAYNAK" >&2; exit 1; }

kaldir() {
  for ad in "${GIRDILER[@]}"; do
    hedef="$HEDEF/$ad"
    if [ -L "$hedef" ] && [ "$(readlink "$hedef")" = "$KAYNAK/$ad" ]; then
      echo "Sökülüyor: $hedef"
      yap rm "$hedef"
    elif [ -e "$hedef" ] || [ -L "$hedef" ]; then
      echo "Atlandı (bu repoya ait symlink değil): $hedef"
      continue
    fi
    # En son yedeği geri koy (adlar zaman damgalı, sözlük sırası = zaman sırası)
    son=""
    for y in "$HEDEF/$ad".yedek-*; do
      [ -e "$y" ] || [ -L "$y" ] || continue
      son="$y"
    done
    if [ -n "$son" ]; then
      echo "Geri konuyor: $son -> $hedef"
      yap mv "$son" "$hedef"
    fi
  done
  echo "Bitti. settings.json'a dokunulmadı; hooks bölümünü istersen elle sil."
}

kur() {
  yap mkdir -p "$HEDEF"
  for ad in "${GIRDILER[@]}"; do
    kaynak="$KAYNAK/$ad"
    hedef="$HEDEF/$ad"
    [ -e "$kaynak" ] || { echo "Uyarı: repoda yok, atlandı: $kaynak"; continue; }
    if [ -L "$hedef" ]; then
      if [ "$(readlink "$hedef")" = "$kaynak" ]; then
        echo "Zaten bağlı: $hedef"
        continue
      fi
      echo "Başka yere işaret eden symlink kenara alınıyor: $hedef -> $hedef.yedek-$ZAMAN"
      yap mv "$hedef" "$hedef.yedek-$ZAMAN"
    elif [ -e "$hedef" ]; then
      echo "Mevcut kenara alınıyor: $hedef -> $hedef.yedek-$ZAMAN"
      yap mv "$hedef" "$hedef.yedek-$ZAMAN"
    fi
    echo "Bağlanıyor: $hedef -> $kaynak"
    yap ln -s "$kaynak" "$hedef"
    # Kenara alınan orchestration-report'taki kişisel veriyi (out/, maske dosyası) yeni yere taşı
    if [ "$ad" = "orchestration-report" ] && [ -d "$hedef.yedek-$ZAMAN" ]; then
      for kisisel in out pano/yayin-maskeler.json; do
        eski="$hedef.yedek-$ZAMAN/$kisisel"; yeni="$kaynak/$kisisel"
        if [ -e "$eski" ] && [ ! -e "$yeni" ]; then
          echo "Kişisel veri taşınıyor: $eski -> $yeni"
          yap mv "$eski" "$yeni"
        fi
      done
    fi
  done

  ayar="$HEDEF/settings.json"
  if [ -e "$ayar" ]; then
    echo
    echo "settings.json zaten var, dokunulmadı."
    echo "Kancalar için $KAYNAK/settings.ornek.json içindeki \"hooks\" bölümünü elle birleştir."
  else
    echo "settings.json yok, örnekten kopyalanıyor."
    yap cp "$KAYNAK/settings.ornek.json" "$ayar"
  fi

  maske="$KAYNAK/orchestration-report/pano/yayin-maskeler.json"
  if [ ! -e "$maske" ]; then
    echo "Not: yayın maskeleri yok (isteğe bağlı): cp ${maske%.json}.ornek.json $maske"
  fi
}

if [ "$KALDIR" -eq 1 ]; then kaldir; else kur; fi

# Node 20+ kontrolü (kancalar ve betikler Node ile çalışır)
echo
if command -v node >/dev/null 2>&1; then
  surum="$(node --version | sed 's/^v//')"
  ana="${surum%%.*}"
  if [ "$ana" -ge 20 ] 2>/dev/null; then
    echo "Node v$surum: tamam."
  else
    echo "Uyarı: Node v$surum bulundu, 20+ gerekli."
  fi
else
  echo "Uyarı: node bulunamadı. Kancalar ve rapor betikleri Node 20+ ister."
fi

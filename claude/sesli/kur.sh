#!/usr/bin/env bash
# Ahenk Cep sesli okuma için venv kurar ve modeli indirir (uv + Python 3.12; torch ~200 MB, model 34 MB).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v uv >/dev/null || { echo "uv gerekli: brew install uv" >&2; exit 1; }
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch ema-lightning==1.1.2 soundfile huggingface_hub \
  "git+https://github.com/ozguradmin/ahenk-turkish-tts"
.venv/bin/python -c "from huggingface_hub import snapshot_download as s; print(s('ozgurguler/ahenk-cep-tr', allow_patterns=['*.pt','ahenk_cep.py']))"
[ -e ayar.json ] || echo '{"cumle": 6, "karakter": 700}' > ayar.json
echo "Deneme:"; echo "Sesli okuma kuruldu." | .venv/bin/python oku.py
echo "Açmak için: touch $(pwd)/acik   (ya da Claude Code'da /sesli aç)"

#!/usr/bin/env python
"""Stdin'deki Türkçe metni Ahenk Cep ile seslendirip afplay ile çalar.

Kullanım: echo "Merhaba" | .venv/bin/python oku.py [--wav cikti.wav] [--sessiz]
Kendi süreç grubunu açar ve pid dosyasına yazar; sesli-oku.mjs önceki okumayı bununla keser.
Model: ozgurguler/ahenk-cep-tr (CC BY 4.0, "Ahenk (https://github.com/ozguradmin/ahenk-turkish-tts)").
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time

KOK = os.path.dirname(os.path.abspath(__file__))
PID = os.path.join(KOK, "pid")


def main() -> int:
    argv = sys.argv[1:]
    wav = argv[argv.index("--wav") + 1] if "--wav" in argv else None
    sessiz = "--sessiz" in argv
    metin = sys.stdin.read().strip()
    if not metin:
        return 0

    try:
        os.setsid()
    except OSError:
        pass
    # Kesilince (yeni cevap geldi) finally blokları çalışsın: geçici WAV ve pid temizlenir.
    import signal
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with open(PID, "w") as f:
        f.write(str(os.getpid()))

    t0 = time.time()
    import soundfile as sf
    from huggingface_hub import snapshot_download

    d = snapshot_download("ozgurguler/ahenk-cep-tr", allow_patterns=["*.pt", "ahenk_cep.py"])
    sys.path.insert(0, d)
    from ahenk_cep import AhenkCep

    tts = AhenkCep(f"{d}/student.pt", f"{d}/decoder.pt")
    t1 = time.time()
    audio, sr = tts.say(metin)
    t2 = time.time()
    yol = wav or os.path.join(tempfile.gettempdir(), f"claude-sesli-{os.getpid()}.wav")
    sf.write(yol, audio, sr)
    print(f"yükleme {t1 - t0:.1f}s, sentez {t2 - t1:.1f}s, ses {len(audio) / sr:.1f}s, {len(metin)} karakter", flush=True)
    if not sessiz:
        try:
            subprocess.run(["afplay", yol], check=False)
        finally:
            if not wav:
                try:
                    os.remove(yol)
                except OSError:
                    pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        try:
            if open(PID).read().strip() == str(os.getpid()):
                os.remove(PID)
        except OSError:
            pass

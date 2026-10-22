---
name: bitir
description: Oturumu kapatır - /kaydet'in yaptığı her şeyi yapar (vault'a karar, ders, durum yazar, commit ve push), ardından sormadan oturumu arşivler. Yalnızca kullanıcı /bitir yazınca çalışır.
argument-hint: "[proje-adı] [ek not]"
disable-model-invocation: true
---

# /bitir: kaydet + arşivle

Oturumun sonu. Ara kayıt için `/kaydet` var; bu komut oturumu kapatır.

1. `~/.claude/skills/kaydet/SKILL.md` dosyasını oku ve **0-8. adımlarını aynen uygula** (argümanlar aynı). 9. adımı (arşiv sorusu) atla.
2. **Arşivle, sorma:** kayıt tamamlandıysa raporu yaz, sonra `mcp__ccd_session_mgmt__archive_session` ile `session_id: "self"` arşivle (yüklü değilse önce `ToolSearch` ile yükle). Arşivleme son araç çağrısı olsun; ondan sonra iş yapma.
3. **Arşivleme, şu durumlarda:** vault pull/commit başarısız olduysa, push başarısız olduysa, yazılacak şeyle ilgili kullanıcıya soru sorman gerektiyse ya da bu oturumda hâlâ çalışan bir arka plan ajanı/yan oturum varsa. Bunu raporda söyle ve kullanıcıya bırak.
4. Masaüstü uygulamasında değilsen (arşiv aracı yoksa) yalnızca kaydet ve "arşivleme bu ortamda yok" de.

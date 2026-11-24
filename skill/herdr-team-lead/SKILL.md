---
name: herdr-team-lead
description: Kullanıcı senden bir agent takımı yönetmeni istediğinde kullan (işi işçi agent'lara — Claude veya Codex — böl, yürüt, birleştir, raporla). Yalnızca herdr içinde ve `team` komutu kuruluyken.
---

# herdr takım lideri

Sen **lead**sin. Kullanıcı yalnızca seninle konuşur ve iki yerde araya girer: **planı onaylar** ve **sonucu görür**. Aradaki her şeyi (işçi açmak, görev vermek, beklemek, birleştirmek) sen yürütürsün. Üçüncü, istisnai durak: bir işçi takılırsa bunu kullanıcıya taşırsın.

Önkoşul: `HERDR_ENV=1` (herdr içindesin) ve `team` komutu PATH'te. Değilse kullanıcıya söyle, devam etme.

## Akış

1. **Plan.** Görevi işçilere böl: her işçi için ad (`[a-z0-9-]`), agent türü (`claude` veya `codex`), görevi, dokunabileceği dosyalar ve sıra. Aynı dosyaya iki işçi dokunmasın. Planı kullanıcıya göster ve **onayını bekle. Onay gelmeden işçi açma.**
2. **Aç.** Her işçi için: `team worktree add <ad> --agent claude|codex` (**prompt verme**; görevi bir sonraki adım gönderir). `HAZIR DEĞİL` çıktısı çıkarsa nedenini kullanıcıya söyle, kendi başına geçiştirme.
3. **Görev gönder.** `team task send <ad> --file <görev.md>` (ya da `--text "..."`). Komut agent'ın hazır olmasını bekler; onay/soru ekranı görünen agent'a göndermez. Görevi net yaz: ne yapılacak, hangi dosyalar, nasıl doğrulanacak.
4. **Bekle.** `team task wait <ad1> <ad2> ...`. **Bu komutu 600000 ms (10 dk) kabuk zaman aşımıyla çalıştır** (Bash aracının `timeout` parametresi; varsayılan 2 dk komutu keser ve çıkış kodunu hiç görmezsin). Komutun kendi dilimi 9 dk'dır; daha kısa bir kabuk sınırın varsa `--timeout <sn>` ile komutun dilimini onun altına indir. Aynısı `team merge` için de geçerli (hazırlık adımları ve `test` uzun sürebilir). Çıkış kodları:
   - **0** — hepsi bitti (`done`).
   - **4** — süre dilimi doldu, kimse takılmadı: **aynı komutu yeniden çağır.** Toplam bekleme için kendine bir üst sınır koy (örn. 3 çağrı ≈ 27 dk); aşarsan durumu kullanıcıya bildir ve ne yapacağını sor.
   - **2** — biri `blocked` (onay/soru ekranında) ya da `idle_without_result` (boşta ama sonuç yazmadı). **Sessizce bekleme.** Çıktıdaki ekran özetini kullanıcıya göster, onun kararını al. Kendin işçiyi onaylamaya çalışma.
5. **Sonuçları oku.** `team task result <ad>` her işçi için.
6. **Birleştir.** `team merge <ad1> <ad2> ... --into <entegrasyon-adı>`. Birleştirme **ayrı bir entegrasyon worktree'sinde** yapılır; kullanıcının çalıştığı checkout'a ve dalına **dokunma**. Çıkış kodları:
   - **0** — birleşti.
   - **3** — çakışma. Çıktıdaki dosyaları entegrasyon worktree'sinde çöz, `git add` + `git commit` yap, sonra **aynı `team merge` komutunu yeniden çalıştır** (birleşmiş olanlar atlanır).
   - **5** — birleşti ama testler başarısız. Düzelt ya da kullanıcıya bildir; komut yeniden çalıştırılabilir.
   `merge`, commit atamayan bir işçinin işini onun adına `team: <ad> işi (otomatik commit)` ile commit eder ve dosyaları listeler; çıktıyı oku, istenmeyen dosya varsa raporla.
7. **Temizle.** Birleşen her işçi için: `team worktree remove <ad> --merged-into <entegrasyon-adı>`. İşçinin işi entegrasyon branch'inde güvendedir; agent bağlamı kaybolur. Birleşmemiş commit'i olan dal silinmez, komut bunu söyler. **Entegrasyon worktree'sini silme**: kullanıcı indirene kadar durur.
8. **Raporla.** Kullanıcıya: işçi başına kısa özet, birleştirme durumu (çakışma nasıl çözüldü), test sonucu, **entegrasyon branch adı ve worktree yolu**, atlanan/uyarılı işçiler.

## Kurallar

- İşçilere **başka agent başlatmamalarını ve prompt etmemelerini** söyleyen satır görev mesajında hazır gelir; görevine de aynısını yaz.
- İşçi başına aynı anda tek görev. Çalışan ya da bloke bir işçiye `team task send` reddedilir; `--force`'u kullanıcı söylemeden kullanma.
- Entegrasyon branch'ini çalışılan dala (örn. `main`, `develop`) **kendin indirme**; bu kullanıcının kararıdır. Yolu ve branch adını ver.
- Her komutun çıkış kodunu oku. Beklenmeyen bir hata, bilinmeyen bir durum ya da işçinin yarım bıraktığı iş: dur, kullanıcıya bildir.
- Ortak veritabanı gibi worktree'lerin paylaştığı kaynaklara işçilerin aynı anda yazması çakışma yaratabilir; planlarken bunu hesaba kat.

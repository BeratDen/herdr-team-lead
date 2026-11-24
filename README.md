# herdr-team-lead

[herdr](https://herdr.dev) içinde çalışan bir Claude Code oturumunu **takım lideri**ne çeviren skill. Lead, işi işçi agent'lara (Claude veya Codex) böler, her birini kendi git worktree'sinde çalıştırır, sonuçları ayrı bir entegrasyon worktree'sinde birleştirir ve raporlar. Sen yalnızca iki yerde araya girersin: planı onaylarsın ve sonucu görürsün.

## İçindekiler

| Yol | Ne |
| --- | --- |
| `skill/herdr-team-lead/SKILL.md` | Lead'e akışı ve kuralları anlatan skill |
| `.herdr-team.json` | Projeye özel worktree ayarlarının genel bir örneği |

## Gereksinimler

- herdr içinde çalışan oturum (`HERDR_ENV=1`)
- PATH'te `team` komutu (`herdr-team` paketi)
- Git ve Node.js 20+

Bu repo yalnızca skill'i ve örnek config'i içerir; `team` komutu ayrı kurulur.

## Kurulum

Skill'i kullanıcı skill dizinine kopyala:

```sh
mkdir -p ~/.claude/skills
cp -r skill/herdr-team-lead ~/.claude/skills/
```

`team` komutu kuruluysa aynısını `team skill install` da yapar.

Sonra herdr içindeki bir Claude Code oturumunda lead'den bir takım yönetmesini iste. Skill kendiliğinden devreye girer.

## Proje config'i

Her proje, kök dizininde `.herdr-team.json` ile yeni worktree'lerin nasıl hazırlanacağını söyler. Dosya yoksa varsayılanlar kullanılır (`worktreeDir: ".worktrees"`, hazırlık adımı yok). Bu repodaki dosyayı kendi projene göre uyarla:

```json
{
  "worktreeDir": ".worktrees",
  "prepare": [
    { "copy": ".env" },
    { "link": "node_modules" },
    { "run": "npm install --prefer-offline", "cwd": "." }
  ],
  "verify": "node --version",
  "test": "npm test"
}
```

| Alan | Anlamı |
| --- | --- |
| `worktreeDir` | Worktree'lerin açılacağı klasör (göreli, `..` içermez) |
| `prepare` | Yeni worktree'de sırayla çalışan adımlar |
| `prepare[].copy` | Dosya veya klasörü ana checkout'tan kopyalar |
| `prepare[].link` | Ana checkout'taki klasöre bağ kurar (örn. `node_modules`) |
| `prepare[].run` | Komut çalıştırır; `cwd` ile göreli klasör verilebilir |
| `verify` | Hazırlık sonrası worktree'nin sağlıklı olduğunu denetleyen komut |
| `test` | `team merge` sonrası entegrasyon worktree'sinde çalışan test komutu |

Yollar göreli olmalıdır; mutlak yol ve `..` reddedilir. `.env` gibi gizli dosyaları kopyalayan adımlar yalnızca yerel worktree'ye yazar, ama config'i commit'lemeden önce içinde sır olmadığından emin ol.

## Akış

1. Lead görevi böler, planı gösterir, onayını bekler.
2. `team worktree add` ile işçi başına worktree açar, `team task send` ile görevi gönderir.
3. `team task wait` ile bekler; işçi takılırsa durumu sana taşır.
4. `team merge ... --into <ad>` ile işleri entegrasyon worktree'sinde birleştirir. Çalıştığın checkout'a ve dala dokunmaz.
5. Birleşen işçilerin worktree'lerini temizler ve sana entegrasyon dalının adını ve yolunu verir.

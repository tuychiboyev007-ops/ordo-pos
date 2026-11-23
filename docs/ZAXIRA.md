# Kunlik zaxira

Har kuni 06:00 (Toshkent) GitHub internetdagi bazaning to'liq nusxasini oladi
(`.github/workflows/zaxira.yml`). Nusxa har safar bo'sh Postgres'ga tiklab ko'riladi —
tiklanmasa ish xato bilan tugaydi va GitHub email yuboradi.

- Qayerda: GitHub → `ordo-pos` → Actions → «Kunlik zaxira (baza)» → kerakli kun → Artifacts.
- Qancha turadi: 30 kun; oyning 1-sanasidagi nusxa — 90 kun.
- Nima kiradi: ordo'ning hamma jadvali (`public` sxemasi). Fayl — `ordo-YYYY-MM-DD.sql.gz.gpg`.
- **Shifrlangan (AES-256).** Repo ochiq (public) — ochiq repoda artifact'larni GitHub'ga kirgan istalgan
  odam yuklab oladi, shuning uchun nusxa faqat shifrlangan holda yuklanadi. Parol — `BACKUP_PASSPHRASE`
  secret, nusxasi faqat egasining kompyuterida (`docs/LOCAL.md`). Parol yo'qolsa zaxirani ochib bo'lmaydi.

## Sozlash (bir marta)

```bash
cd ~/Downloads/ordo-pos && node dev/zaxira-sozla.mjs
cd ~/Downloads/ordo-pos && node dev/zaxira-parol.mjs
```

Birinchisi bazada faqat O'QIY oladigan kirish (`ordo_zaxira`) ochadi va uning ulanish satrini GitHub'ga
`BACKUP_DATABASE_URL` qilib yozadi. Ikkinchisi shifrlash parolini yaratadi (`BACKUP_PASSPHRASE` va
`docs/LOCAL.md`). Parol bo'lmasa zaxira xato bilan to'xtaydi — shifrlanmagan nusxa hech qachon yuklanmaydi.

## Tiklash

Avval bo'sh bazaga (Neon'da yangi branch yoki yangi baza) tiklab, tekshirib ko'ring —
ishlab turgan bazaning ustiga to'g'ridan-to'g'ri yozmang.

```bash
gpg -d ordo-2026-11-24.sql.gz.gpg | gunzip > tiklash.sql     # parol — docs/LOCAL.md
psql "<bo'sh baza ulanish satri>" -v ON_ERROR_STOP=1 -f tiklash.sql
```

Fayl `CREATE SCHEMA public` bilan boshlansa, bo'sh bazada avval `DROP SCHEMA public CASCADE` qiling.
Tekshirilgach Vercel'dagi `DATABASE_URL` ni yangi bazaga almashtiring va qayta chiqaring.

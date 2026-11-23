# ordo — restoran va kafe uchun kassa (POS)

Alohida mustaqil mahsulot (TopAgents/savdopro'ga aloqasi yo'q). Birinchi mijoz — **Mazza Point** (Qo'qon).
Repo: `tuychiboyev007-ops/ordo-pos` — **OCHIQ (public, 2026-11-23 dan)**, branch `main`. Kodga hech qachon parol,
kalit, PIN yoki mijoz ma'lumoti yozmang — hamma ko'radi.

## Internetda

- Sayt: **https://ordo-kassa.vercel.app** — `/kassa`, `/ofitsiant`, `/oshxona`, `/boshqaruv`.
- Vercel loyihasi `ordo-kassa` (fra1), scope `abdulaziz-tuychiboyev`. Git'ga ULANMAGAN — chiqarish qo'lda:
  `npx vercel deploy --prod --yes --scope abdulaziz-tuychiboyev`.
  Commit muallifi GitHub'ga bog'lanmagan bo'lsa Vercel deployni "Blocked" qiladi — bu repoda git user
  `tuychiboyev007-ops` qo'yilgan.
- Baza — Neon Postgres `ordo-db` (Vercel marketplace, eu-central-1). `DATABASE_URL`, `AUTH_SECRET` — Vercel
  sozlamalarida; mahalliy nusxasi `.env.local` (gitignore, `npx vercel env pull`).
- Sxema o'zgarsa migratsiya birinchi so'rovda o'zi ishlaydi (`src/lib/pg.js` `ensureSchema`, `ordo_meta`).
- Kunlik zaxira: `.github/workflows/zaxira.yml` (06:00 Toshkent, tiklab tekshiriladi, SHIFRLANGAN — repo ochiq,
  artifact'ni istalgan odam yuklab oladi) — `docs/ZAXIRA.md`.
- Qurilmalarni ulash: `docs/QURILMALAR.md`.

## Mahalliy ishga tushirish

```bash
npm run dev      # http://localhost:4310 — PGlite (.data/pg), internetdagi bazadan ALOHIDA
npm test         # API sinovlari (PGlite, 155 ta)
node dev/sinov-jonli.mjs   # JONLI sayt sinovi: namuna restoranda buyurtma yo'li, hisobotlar, himoya (Mazza'da faqat o'qiydi)
```

- `npm run demo` — bazani TOZALAB qayta yaratadi. Ishlab turgan mahalliy bazada ishga tushirmang.
- Sinov boshqa portda va bazada: `PORT=4330 ORDO_DATA=<nusxa> node dev/server.mjs`.
- Haqiqiy Postgres'da sinov: `TEST_DATABASE_URL=... npm test` — FAQAT bo'sh bazada (restorani bor bazada
  o'zi to'xtaydi).
- Bo'sh internet bazasini to'ldirish: `DATABASE_URL=... node dev/remote.mjs` (PGlite'da yaratib COPY bilan
  ko'chiradi — bittalab yuborish Frankfurtgacha soatlab cho'zilardi).

## Kirish ma'lumotlari — repoda YO'Q

`seed.local.json` (Mazza egasi email/paroli, PIN'lar — `src/lib/mazza.js` shundan o'qiydi) va `docs/LOCAL.md`
gitignore'da, faqat egasining kompyuterida. Parol/PIN'ni kodga, commitga yoki chatga yozmang.
Namuna restoran: `demo@ordo.uz` / `ordo2026` (ochiq, sinov uchun).
Egasining kirish emaili/parolini almashtirish: `node dev/egasi-kirish.mjs` — egasi O'ZI ishga tushiradi va parolni
o'zi yozadi (`--sinov` — yozmasdan ko'rsatadi). Claude ishlab turgan tizimga parol kiritmaydi.
Terminalda savolga javob yozish qiyin bo'lsa: `node dev/egasi-kirish.mjs yangi@email.uz --parol-yarat` — hech narsa
so'ramaydi, parolni o'zi yaratadi, ekranga CHIQARMAYDI: clipboard'ga nusxalaydi (kirish oynasida Cmd+V) va
`docs/LOCAL.md` ga yozadi.

## Tuzilish

| Qism | Fayl |
|---|---|
| API (Cloudflare/Vercel/Node uchun bitta `handle`) | `src/app.js`, `src/routes/*.js` |
| Baza qatlami (`?` → `$n`, `company_id` siz so'rov rad etiladi) | `src/lib/db.js` |
| Sxema | `src/lib/schema.js` (`SCHEMA`, `TENANT_TABLES`) |
| Postgres drayveri (Neon) | `src/lib/pg.js` — BIGINT/NUMERIC son, jsonb satr ikki marta o'ralmaydi |
| Vercel funksiyasi | `api/router.js` + `vercel.json` (hamma `/api/*` → `__p`) |
| Kassa (oflayn navbat bilan) | `public/kassa.html`, `public/js/kassa.js`, `store.js` |
| Buyurtma yadrosi — kassa va server UMUMIY | `public/js/core.js` `applyOp` |
| Ofitsiant telefoni / oshxona ekrani | `public/js/waiter.js`, `kitchen.js` |
| Boshqaruv | `public/admin.html`, `public/js/admin.js` |
| Qo'shimchalar (modifikatorlar) | `public/js/mods.js` |

Muhim qoidalar:
- Buyurtma amallari (`open`, `add`, `pay`, `close`, `ready`, `xfer_in/out` ...) faqat `core.js` orqali — kassa
  oflaynda ham shu kod bilan ishlaydi, server `/api/sync` da aynan shuni qayta qo'llaydi.
- Har tenant jadvalga so'rov `company_id` bilan (`db.js` tekshiradi); global so'rov — `/* tenant:global */`.
- Pul — so'm, butun son. Tannarx sotuv paytida suratga olinadi (`order_items.cost`).
- Telefonda http (LAN) bo'lsa crypto yo'q — PIN serverda tekshiriladi (`POST /api/pin`).
- UI'da emoji ishlatilmaydi — chiziqli SVG ikonkalar (`public/js/ui.js`).

## Kassa va boshqaruv — keyingi o'zgarishlar (2026-11-24)

- **Taom rasmlari kassada:** rasmi bor restoranda kartochka balandroq (`.pgrid.pics`, rasm tepada, nom va narx toifa
  rangidagi tasmada); rasmsiz restoranda eski ixcham rangli tugmalar. Rasm yuklanmasa kartochka rangli ko'rinishga
  qaytadi (`error` — capture bosqichida). Ofitsiant ro'yxatida kichik rasm. `/img/*` 7 kun keshda (`vercel.json`).
  «Tez kassa»ga o'tishda rasm tushib qolgan edi — egasi "rasmlar qani" dedi; olib tashlamang.
- **Moddiy hisobotda pul xulosasi** (`money`): savdo, sof foyda, utilizatsiya, xodimlar olgani, kassada bor.
  Hisob `reports.js` `periodMoney()` dan — Foyda hisoboti ham shundan (ikki ekranda raqam bir xil bo'lishi shart).
  «Xodimlar oldi» = rasxod turi `ish haqi | avans | oylik | maosh` (so'z bo'yicha). «Kassada bor» — ochiq smenaning
  hozirgi naqd puli (`shiftSummary().expected_cash`), davrga bog'liq emas; smena yopiq — `null`.
- **Texkarta, yangi masalliq:** ro'yxatda yo'q nom yozilsa qator OSTIDA `gramm (kg) / ml (litr) / dona` tanlovi chiqadi
  (`.newing`; ilgari faqat ochiladigan ro'yxat ichida edi va egasi topolmadi). Hech biri oldindan belgilanmaydi.
  Miqdor `recQty()` bilan o'qiladi: "10", "10 gr", "0,03 kg", "1 dona". Nomi ro'yxatdagi bilan aynan bir xil
  yozilsa o'zi tanlanadi. Masalliq NARXI alohida yozilmaydi — Ombor → Kirim qilinganda qo'yiladi.
- **Logo:** boshqaruvda bosilsa Bosh sahifa (`#home`), kassada — Zal (`.rail .mk[data-nav=zal]`; kassa hodisalari
  `button,[data-nav],…` bo'yicha — yangi bosiladigan element `button` bo'lmasa shu ro'yxatga kirsin).
- Tushuntiruvchi video (UFO burger → ombordan ayrilishi) skriptlari:
  `~/Downloads/savdopro-main-2/_preview/promo-src/ordo/ufo-ombor/` (README bilan).

## Kelishilgan qarorlar

- Nomi va ko'rinishi: kichik harfli «ordo», to'q ko'k `#14213d` + qizil-to'q sariq `#e4572e`, logo «halqa va nuqta».
- Kassa — «C — Tez kassa»: chapda chek + raqam tugmalari, o'ngda rangli toifa va taom kartalari, yashil TO'LOV;
  bir bosishda aralash to'lov (naqd + karta).
- Bor: zal/olib ketish/yetkazish, chekni bo'lish va birlashtirish, qo'shimchalar, ofitsiant va oshxona ekrani,
  ombor va texkarta, utilizatsiya, nasiya, rasxod, smena X/Z, foyda va moddiy hisobot.
- Hali yo'q: fiskal chek (keyingi bosqich), chek printeri bilan oynasiz chop etish va pul qutisi (printer
  kelganda), egasiga Telegram xabar (bot tokeni egasidan), `ordopos.uz` domeni (egasi oladi).
- Ochiq xavfsizlik ishi: server kassa qurilmasidan kelgan narxga ishonadi (oflayn rejim uchun) — haqiqiy pul
  bilan ishlashdan oldin tuzatilishi kerak.
- Mazza'dan kutilmoqda: stollar soni, xodimlar, masalliq qoldig'i va narxi, qo'shimchalar narxi.

Reklama sayti alohida: `~/Downloads/ordo-sayt` → https://ordopos.vercel.app (Vercel loyihasi `ordopos`).

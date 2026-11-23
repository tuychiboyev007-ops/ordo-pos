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
npm test         # API sinovlari (PGlite, 328 ta)
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

## Analitika, to'lov turini tuzatish, zagotovka (2026-11-24)

- **Hisobotlar → Analitika** (`GET /api/reports/analytics?from=&to=`, `reports.analytics`, `PAGES.analytics`): tanlangan
  davr OLDINGI shu uzunlikdagi davr bilan solishtiriladi (`cur` / `old` — `periodMoney` dan, «Foyda» bilan bir xil raqam),
  kunlar yonma-yon, hafta kuni × soat xaritasi (Toshkent vaqti; kunlik o'rtacha — o'sha hafta kuni davrda necha marta
  kelganiga bo'linadi), toifalar, ABC (sinf — taom qo'shilishidan OLDINGI yig'ma ulushdan: 80% / 95%), o'sgan / pasaygan
  (`gone` — oldin sotilgan, hozir yo'q) va sotilmagan taomlar (`dead`, oxirgi sotilgan kuni 180 kundan). Xulosa matni
  brauzerda yig'iladi (`insights`). Davr 400 kundan oshmaydi.
- **Chekda to'lov turini o'zgartirish** — `POST /api/order/pay-method {order_id, payment_id, method}` (`sync.changePayMethod`,
  faqat rahbar, faqat YOPILGAN chek, `qarz`ga/dan emas). `orders.doc` va `payments.method` birga o'zgaradi, `ops`ga
  `pay_method` yoziladi (buyurtma tarixida «Naqd → Karta»), smena yopilgan bo'lsa `expected_cash`/`summary` qayta
  hisoblanadi. Panel: Buyurtmalar → chek → to'lov qatorida «O'zgartirish».
- **Ombor → Inventarizatsiya** — menyuda alohida bo'lim (`PAGES.inv` → `PAGES.docs(m, 'inv')`); ilgari faqat «Kirim»
  sahifasidagi tugma edi.
- **Zagotovka (yarim tayyor mahsulot)** — kotlet, sous, xamir. U ham masalliq (`ingredients.prep = true`, `yield` — bir
  partiyadan necha birlik chiqadi), tarkibi `prep_lines` da. Zagotovka ichida zagotovka BO'LMAYDI (`400 nested`).
  - Narxi `lib/cost.js` `ingCosts()`: tarkibdagi masalliqlarning hozirgi narxidan `Σ(miqdor × narx) ÷ yield`; biror
    masalliq narxi yo'q bo'lsa — o'zining o'rtacha narxi. `unitCosts()` (taom tannarxi) shundan foydalanadi.
  - Sotuvda (`lib/stock.js` `applyNeeds`, `consume` shuni chaqiradi): omborda TAYYORI bor — o'shandan, yetmagan qismi
    tarkibidagi masalliqlardan ayiriladi; zagotovka qoldig'i sotuv tufayli manfiyga tushmaydi. Egasi «Tayyorlash»ni
    yuritmasa ham ombor to'g'ri kamayadi. Zagotovkalar har doim oddiy masalliqlardan OLDIN qulflanadi (deadlock bo'lmasin) —
    `saveDoc` ham satrlarni shu tartibda yuradi.
  - «Tayyorlash» — `POST /api/stock/doc {kind: 'tayyorlash', lines: [{ingredient_id, qty}]}` (`produce()`): masalliqlar
    chiqadi, zagotovka shu masalliqlar narxida kiradi; hujjat odatdagidek bekor qilinadi. Moddiy hisobotda zagotovkaga —
    «Kirim», masalliqqa — «Sarf» ustunida. Zagotovkani utilizatsiya qilish ham tayyoridan, yetmasa tarkibidan.
  - Yo'llar: `GET /api/stock/preps`, `POST /api/stock/prep` (`id` oddiy masalliqniki bo'lsa — zagotovkaga aylanadi),
    `POST /api/stock/prep/unset`. Panel: Ombor → Zagotovkalar (`PAGES.preps`, `prepForm`, `produceForm`); Masalliq
    kartasida «Zagotovka qilish»; taom texkartasida oddiy masalliqdek tanlanadi («zagotovka» belgisi bilan).
- **Tayyor (dona) tovar** — Cola, suv, tayyor keladigan kotlet (egasi: "shtuk-shtuk"). Menyu → «+ Tayyor tovar» yoki taom
  oynasidagi «Tayyor tovar — donalab sotiladi» belgisi: `POST /api/admin/product {goods: true}` shu nomli masalliqni o'zi
  ochadi (bor bo'lsa — o'shanga bog'lanadi), texkartaga 1:1 yozadi va `products.goods_id` ni qo'yadi; oynadagi «nechta
  bor / necha pulga olingan» — oddiy kirim hujjati. Sotuv, tannarx va hisobotlar texkarta orqali — alohida yo'l YO'Q.
  `goods` yuborilmasa bog'lanish o'zgarmaydi; boshqa texkarta yozilsa yoki masalliq o'chirilsa bog'lanish uziladi;
  omborda boshqa o'lchovda yuritilgan (harakati bor) masalliq bo'lsa `409 unit_mismatch` — taom yaratilmasdan OLDIN.
  Menyu ro'yxatida «tovar» belgisi va «omborda N dona». Faqat taom tarkibida ishlatiladigan tayyor narsa (kotlet) —
  oddiy masalliq, o'lchovi «dona» (`guessUnit` kotlet/sosiska/nagget… uchun o'zi «dona»ni tanlaydi).
- Bosh sahifada tezkor tugmalar (`.quick`): menyuga qo'shish, masalliq, kirim, zagotovka, analitika — egasi "menyu
  yaratish yo'q" dedi (tugma bor edi, topolmadi).
- **Nomlar (egasi tanlagan):** panelda «masalliq» o'rniga **«element»**, menyu bo'limi — **«Menyu»** (`['menu', 'Menyu']`,
  `['stock', 'Elementlar']`). Kodda nomlar o'zgarmagan (`ingredients`, `/api/stock/ingredient`); yangi matn yozsangiz
  «element» deng, «masalliq» emas.
- **Kassaning o'zida qo'shish** (`kassa.js` `quickProduct`, `quickElement`): tepada rahbarga «+ Menyu» (taom yoki tayyor
  tovar) va «+ Element» (nomi, o'lchovi, nechta bor, necha pulga olingan). Boshqaruv yo'llari rahbar sessiyasini so'raydi —
  kassa uni PIN kiritilganda oladi (`MGR`), so'rov `mgrPost()` bilan ketadi; oflayn bo'lsa qo'shilmaydi (xabar chiqadi).
  Saqlangach `refreshBoot()` — yangi taom kassa kartochkalarida darrov ko'rinadi. Kassir va ofitsiantda tugmalar yo'q.
- **Element kartasi** (`ingredientForm`): yangi elementda turi — Xom ashyo / Zagotovka (tarkib oynasiga o'tadi) / Tayyor tovar
  (menyu toifasi va sotuv narxi), guruh tugmalari, 1 birlik narxi YOKI jami summa (biri yozilsa ikkinchisi chiqadi),
  yetkazib beruvchi (to'langan / qarzga), eng kam qoldiq. Tahrirlashda `GET /api/stock/ingredient?id=` (`ingredientInfo`):
  qoldiq, narx, qaysi taom va zagotovkalarda ishlatiladi, oxirgi kirim, menyudagi tayyor tovari; «Kirim qilish» va «Harakatlar».
- **Savdo analitikasi** (`analytics()` ga qo'shildi): `waiters` (xodim: savdo, ulush, o'rtacha chek, oldingi davr, bekor
  qilgani, chegirmasi), `types`, `methods`, `halls`, `tables`, `extra` (mehmon boshiga, chekdagi taom soni, zalda o'tirish
  vaqti — 12 soatdan uzun buyurtma sanalmaydi) va `forecast` (`monthForecast`: shu oy hozirgacha + qolgan kunlarga so'nggi
  28 kundagi SHU HAFTA KUNINING o'rtachasi; asos bo'lmasa `projected: null`).
- **Diagnostika** (`GET /api/reports/diagnostics`, `PAGES.diag`): savdo (7 kun), pul nazorati, ombor, menyu (30 kun va hozir)
  bo'yicha tekshiruvlar — har biri `level` (bad | warn | ok | info), sarlavha, izoh va tuzatiladigan bo'lim (`page`).
  Ball = 100 − 12 × muammo − 5 × ogohlantirish. Yangi tekshiruv — `diagnostics()` ichida `add(guruh, kalit, daraja, …)`;
  me'yorlar shu yerda (bekor qilish 1/3%, chegirma 5/10%, utilizatsiya 3/6%, tannarx ulushi 40/50%, taom tannarxi 45%).
- **Umumiy hisobot** (`PAGES.report`, Hisobotlar ro'yxatida birinchi): butun davr bitta sahifada — asosiy ko'rsatkichlar
  (oldingi davr bilan), foyda va zarar (rasxod turlari bilan), to'lov va buyurtma turlari, smenalar va kassa farqi, xodimlar,
  toifalar, nazorat, eng ko'p sotilgan 15 taom, ombor qiymati, qarzlar; «Chop etish / PDF» (`window.print()`, `@media print`
  A4) va Excel (CSV, hamma bo'lim). Alohida server yo'li YO'Q — mavjud yo'llardan ketma-ket yig'iladi (`analytics`, `summary`,
  `expenses`, `material`, `shifts`, `debts`, `suppliers`), shuning uchun raqamlar boshqa hisobotlar bilan aynan bir xil.
- **Qoldiq va narxni to'g'rilash** (`openingForm`, `POST /api/stock/opening`, `stock.opening`): hamma element bitta jadvalda —
  «haqiqatda bor» va «1 birlik narxi»; bo'sh satr o'zgarmaydi. Narx yozilsa qoldiq avval nolga tushiriladi (inventarizatsiya),
  keyin haqiqiy miqdor shu narxda kirim qilinadi — o'rtacha narx AYNAN yozilgan narx bo'ladi (eski noto'g'ri narx yoki manfiy
  qoldiq aralashmaydi). Ikki hujjat yoziladi (pul harakatisiz, bekor qilsa bo'ladi). Elementlar sahifasida manfiy qoldiq yoki
  narxsiz element bo'lsa qizil ogohlantirish va «Hammasini to'g'rilash» tugmasi chiqadi; Diagnostika ham shu yerga yo'naltiradi.
  Egasi "to'g'irla" dedi — haqiqiy son va narxni faqat u biladi, jonli bazaga Claude yozmaydi (o'qishga ham ruxsat berilmagan).
- **Ma'lumotni tozalash** (egasi: "hisobotni nolga tushir, menyu emas"): Sozlamalar → «Ma'lumotni tozalash» →
  «Hisobotlarni nolga tushirish» (`resetForm`). `GET /api/admin/reset` (sonlar), `POST /api/admin/reset {scope, confirm}` —
  **faqat egasi** (menejer 403), `confirm` aynan `TOZALASH`. `hammasi` (standart): buyurtma, to'lov, smena, kassa harakati,
  rasxod, nasiya, ombor hujjatlari va harakati o'chadi, qoldiqlar va qarzlar 0. `savdo`: faqat savdo va pul — kirim hujjatlari
  qoladi, sotuv yechgan elementlar omborga qaytadi. **Hech qachon o'chmaydi:** menyu, texkarta, elementlar ro'yxati va narxi,
  zagotovka tarkibi, xodimlar, zal/stollar, sozlamalar, qurilmalar. `settings.reset_at` yoziladi; `/api/state` uni qaytaradi va
  kassa (`store.js` `pull`) o'zgarganini ko'rsa mahalliy tarixni (`ordo.recent`, `ordo.failed`, chek hisoblagichi) tashlaydi.
  Yangi jadval qo'shsangiz `SALES_TABLES` / `STOCK_TABLES` (admin.js) ro'yxatiga kiriting — aks holda tozalashdan keyin qoladi.
  Jonli Mazza'da tugmani **egasi o'zi** bosadi — Claude jonli ma'lumotni o'chirmaydi.
- **Kassada to'lov turini o'zgartirish** (egasi: "chek to'lov turini o'zgartirish"): kassa → «Buyurtmalar» (tarix) → chek →
  «To'lov turini o'zgartirish» (`changePayMethod`, kassa.js). Server yo'li o'sha — `POST /api/order/pay-method` (rahbar sessiyasi).
  `managerToken(title)`: egasi/menejer o'zi kirgan bo'lsa `MGR` belgisi, kassir bo'lsa menejer tanlanib PIN kiritiladi va
  `/api/pin` dan belgi olinadi (PIN serverda tekshiriladi — `approve()` dagi mahalliy tekshiruvdan farqi; internet kerak).
  Nasiya (`qarz`) to'lovi bu yerda o'zgarmaydi. `store.js` `updateRecent(doc)` mahalliy tarixdagi nusxani yangilaydi.
- **Marinovka** (egasi: "marinadlash hisobi"): zagotovkaning TURI — `ingredients.prep_kind` ('' | 'marinovka'), `marin_hours`
  (necha soatda tayyor), `keep_hours` (saqlash muddati; ikkalasi ixtiyoriy). Hisob-kitob zagotovkaniki bilan AYNAN bir xil
  (tarkib, `yield`, `tayyorlash` hujjati, sotuvda tayyoridan yoki tarkibidan ayirish) — alohida yo'l yozilmagan.
  `GET /api/stock/preps` har birida `kind`, `last` (oxirgi bekor qilinmagan partiya) va `batch` (`batchState`:
  `marinating | ready | expired`, faqat omborda tayyori bo'lsa; qoldiq partiyalab yuritilmaydi — bu OXIRGI partiya haqida).
  `savePrep`: `kind` yuborilmasa turi, vaqt yuborilmasa vaqt o'zgarmaydi. `GET /api/stock/docs?prep_kind=` — hujjatlarni turiga
  ajratadi. Panel: Ombor → **Marinovka** (`PAGES.marin`; `prepsPage(m, kind)` Zagotovkalar bilan umumiy, matnlar `PREP_T`),
  kartada «Turi» tugmalari, «Marinadlash» oynasida **element bo'yicha** kiritish («20 kg go'sht» → tayyor mahsulot o'zi hisoblanadi).
- **Rus tili — to'xtatilgan** (egasi: "rus tili kerak emas"). Yarim tayyor ish `git stash` da («rus tili (to'xtatilgan
  2026-11-24)»): `public/js/i18n.js`, `tools/i18n/`. So'ralmaguncha qaytarmang.

## Kelishilgan qarorlar

- Nomi va ko'rinishi: kichik harfli «ordo», to'q ko'k `#14213d` + qizil-to'q sariq `#e4572e`, logo «halqa va nuqta».
- Kassa — «C — Tez kassa»: chapda chek + raqam tugmalari, o'ngda rangli toifa va taom kartalari, yashil TO'LOV;
  bir bosishda aralash to'lov (naqd + karta).
- Bor: zal/olib ketish/yetkazish, chekni bo'lish va birlashtirish, qo'shimchalar, ofitsiant va oshxona ekrani,
  ombor va texkarta, zagotovka, utilizatsiya, inventarizatsiya, nasiya, rasxod, smena X/Z, foyda, analitika va moddiy hisobot.
- Hali yo'q: fiskal chek (keyingi bosqich), chek printeri bilan oynasiz chop etish va pul qutisi (printer
  kelganda), egasiga Telegram xabar (bot tokeni egasidan), `ordopos.uz` domeni (egasi oladi).
- Ochiq xavfsizlik ishi: server kassa qurilmasidan kelgan narxga ishonadi (oflayn rejim uchun) — haqiqiy pul
  bilan ishlashdan oldin tuzatilishi kerak.
- Mazza'dan kutilmoqda: stollar soni, xodimlar, masalliq qoldig'i va narxi, qo'shimchalar narxi.

Reklama sayti alohida: `~/Downloads/ordo-sayt` → https://ordopos.vercel.app (Vercel loyihasi `ordopos`).

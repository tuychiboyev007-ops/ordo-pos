# Qurilmalarni ulash

ordo internetda ishlaydi: **https://ordo-kassa.vercel.app** — kompyuter, telefon, planshet,
istalgan tarmoqdan (Wi‑Fi, mobil internet). Kassa kompyuterini yoqib turish shart emas.

| Qurilma | Manzil | Kim kiradi |
|---|---|---|
| Kassa | `https://ordo-kassa.vercel.app/kassa` | kassir, menejer |
| Ofitsiant telefoni | `https://ordo-kassa.vercel.app/ofitsiant` | ofitsiant (o'z PIN-kodi bilan) |
| Oshxona ekrani | `https://ordo-kassa.vercel.app/oshxona` | oshpaz (PIN bilan, bir marta) |
| Boshqaruv (egasi telefonda ham) | `https://ordo-kassa.vercel.app/boshqaruv` | egasi, menejer |

Internet uzilsa kassa ishlashda davom etadi: buyurtma va to'lovlar qurilmada saqlanadi,
aloqa tiklanganda serverga o'zi yuboriladi.

Mahalliy nusxa (`npm run dev`) — xuddi shu manzillar `http://<kompyuter-IP>:4310/...` da.

Birinchi ochilishda qurilma egasining email va paroli bilan bir marta ulanadi, keyin faqat PIN so'raladi.

- Ofitsiant: stol → taom qo'shadi (qo'shimchalari bilan) → «Oshxonaga» → «Hisob so'rash». To'lov kassada.
- Oshxona: yuborilgan taomlar kartochkada; taom bosilsa — tayyor, «Hammasi tayyor» — butun buyurtma.
  Tayyor taom kassada va ofitsiant telefonida «tayyor» bo'lib ko'rinadi, ofitsiant telefoni titraydi.
  Olib ketish buyurtmasi to'lanib yopilgan bo'lsa ham, taomi tayyor bo'lgunicha ekranda turadi.
- Sex (Oshxona, Mangal, Bar) bo'yicha filtr bor; sexi yo'q taom (ichimlik) oshxona ekraniga chiqmaydi.

Mahalliy nusxada macOS birinchi marta «node kiruvchi ulanishlarga ruxsat berilsinmi?» deb so'raydi — «Ruxsat berish».

## Server (ishlab chiquvchi uchun)

- Vercel loyihasi `ordo-kassa` (Frankfurt), baza — Neon Postgres (`ordo-db`, Frankfurt). Ulanish satri
  va `AUTH_SECRET` Vercel sozlamalarida; mahalliy nusxasi `.env.local` (git'da yo'q).
- Chiqarish: `npx vercel deploy --prod`. Sxema o'zgarsa migratsiya birinchi so'rovda o'zi ishlaydi
  (`src/lib/pg.js` `ensureSchema`, `ordo_meta` jadvali).
- Sinovlar haqiqiy Postgres'da: `TEST_DATABASE_URL=... npm test` — FAQAT bo'sh sinov bazasida.
- Bo'sh bazani to'ldirish: `DATABASE_URL=... node dev/remote.mjs` (bazada restoran bo'lsa hech narsa qilmaydi).

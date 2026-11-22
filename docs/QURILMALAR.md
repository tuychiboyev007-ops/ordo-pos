# Ofitsiant telefoni va oshxona ekrani

Kassa kompyuteri (server) bilan bir Wi‑Fi tarmog'ida bo'lgan har qanday telefon yoki planshet ulanadi.

| Qurilma | Manzil | Kim kiradi |
|---|---|---|
| Kassa | `http://<kompyuter-IP>:4310/kassa` | kassir, menejer |
| Ofitsiant telefoni | `http://<kompyuter-IP>:4310/ofitsiant` | ofitsiant (o'z PIN-kodi bilan) |
| Oshxona ekrani | `http://<kompyuter-IP>:4310/oshxona` | oshpaz (PIN bilan, bir marta) |
| Boshqaruv | `http://<kompyuter-IP>:4310/boshqaruv` | egasi, menejer |

Birinchi ochilishda qurilma egasining email va paroli bilan bir marta ulanadi, keyin faqat PIN so'raladi.

- Ofitsiant: stol → taom qo'shadi (qo'shimchalari bilan) → «Oshxonaga» → «Hisob so'rash». To'lov kassada.
- Oshxona: yuborilgan taomlar kartochkada; taom bosilsa — tayyor, «Hammasi tayyor» — butun buyurtma.
  Tayyor taom kassada va ofitsiant telefonida «tayyor» bo'lib ko'rinadi, ofitsiant telefoni titraydi.
  Olib ketish buyurtmasi to'lanib yopilgan bo'lsa ham, taomi tayyor bo'lgunicha ekranda turadi.
- Sex (Oshxona, Mangal, Bar) bo'yicha filtr bor; sexi yo'q taom (ichimlik) oshxona ekraniga chiqmaydi.

macOS birinchi marta «node kiruvchi ulanishlarga ruxsat berilsinmi?» deb so'raydi — «Ruxsat berish».

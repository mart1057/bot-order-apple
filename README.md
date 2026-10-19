# bot-order-apple

ชีทคำสั่งครบทุกสีและความจุ: [COMMANDS.md](COMMANDS.md)

## เลือกสินค้าตอนรัน

`npm start` ใช้ `selectedProduct` ใน `settings.json` ตามเดิม

คำสั่งลัดเลือกรุ่น สี และความจุเฉพาะรอบนั้น โดยไม่แก้ `settings.json`:

```sh
npm run duo-wh-256
npm run duo-ns-512
npm run pm-bg-256
npm run pro-bk-1tb
```

รูปแบบคือ `npm run <รุ่น>-<สี>-<ความจุ>`:

| ตัวเลือก | รหัส |
| --- | --- |
| รุ่น | `duo` = iPhone Duo, `pro` = iPhone 18 Pro, `pm` = iPhone 18 Pro Max |
| สี | `wh` = Star White, `ns` = Night Sky, `bk` = Black, `sl` = Silver, `bg` = Burgundy, `gl` = Glacier |
| ความจุ | `256`, `512`, `1tb`, `2tb` (ตามรุ่นที่มีใน settings) |

ดูคำสั่งทั้งหมดด้วย `npm run` คำสั่งลัดใช้ขั้นตอนเฝ้าสต็อกและซื้อเหมือน `npm start` และใช้การตั้งค่าอื่นจาก `settings.json` เหมือนเดิม

ระบุรหัสสินค้าเต็มได้ด้วย เช่น:

```sh
npm start -- --product iphone-duo-256gb-starwhite
npm run checkout -- --product iphone-duo-256gb-starwhite
```

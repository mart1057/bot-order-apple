# bot-order-apple

ชีทคำสั่งครบทุกสีและความจุ: [COMMANDS.md](COMMANDS.md) · รันเบื้องหลังด้วย pm2: [PM2.md](PM2.md)

## เลือกสินค้าผ่าน UI

```sh
npm run ui          # รัน UI เบื้องหลังด้วย pm2
npm run ui:logs     # ดู log
npm run ui:status   # ดูสถานะ
npm run ui:restart  # รีสตาร์ต
npm run ui:stop     # หยุด (ส่งสัญญาณหยุดบอตด้วย)
npm run ui:delete   # ลบออกจาก pm2
npm run ui:dev      # รันแบบเดิมใน terminal (ไม่ใช้ pm2)
```

เปิด `http://127.0.0.1:3310` ในเบราว์เซอร์ ค่าเริ่มต้นคือ Duo Star White 256GB เลือกรุ่น ความจุ สี และจำนวนต่อเบราว์เซอร์ แล้วกด **เริ่มเฝ้าสต็อกและซื้อ** ดูสถานะและ log ได้ในหน้าเดียวกัน และกด **หยุดบอต** เพื่อยุติงานอัตโนมัติ

UI ใช้สินค้าและการตั้งค่าปัจจุบันจาก `settings.json` รวมถึงโปรไฟล์ `.env` ตามพฤติกรรมบอตเดิม โดยไม่เปลี่ยน `selectedProduct` หรือ `quantity` จากการเลือกใน UI จำนวนที่เลือกใช้ต่อเบราว์เซอร์ เช่น 2 หน้าต่าง × 2 เครื่อง = รวม 4 เครื่อง รองรับบอตที่เริ่มจาก UI ครั้งละหนึ่งรอบ (แต่ละรอบเปิดหลายหน้าต่างได้ตามการตั้งค่า) และไม่ควบคุมบอตที่รันแยกจาก terminal

การกดเริ่มจะเฝ้าสต็อกก่อนซื้อเหมือน `npm start` หากตั้ง `autoPlaceOrder: true` บอตจะกดส่งคำสั่งซื้อตามขั้นตอนเดิม ปุ่มหยุดไม่ยกเลิกคำสั่งซื้อที่ส่งแล้ว ปิดแท็บ UI อย่างเดียวบอตยังทำงานอยู่; ใช้ `npm run ui:stop` (หรือ `Ctrl+C` เมื่อรันด้วย `ui:dev`) เพื่อปิด UI และส่งสัญญาณหยุดบอตด้วย

หากพอร์ตไม่ว่าง ใช้ `UI_PORT=3311 npm run ui` (ถ้ารันอยู่แล้วใช้ `UI_PORT=3311 npm run ui:restart`) แล้วเปิดพอร์ตที่ระบุ UI เปิดรับการเชื่อมต่อเฉพาะเครื่องนี้

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

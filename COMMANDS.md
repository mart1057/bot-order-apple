# ชีทคำสั่งเลือกรุ่นสินค้า

รวมคำสั่งลัดครบ 40 ตัวเลือกจาก `package.json` ใช้รันจากโฟลเดอร์โปรเจกต์

- `npm start` ใช้สินค้าตาม `selectedProduct` ใน `settings.json`
- คำสั่งลัดด้านล่างเลือกสินค้าเฉพาะรอบนั้น โดยไม่แก้ `settings.json` และใช้การตั้งค่าอื่นตามเดิม
- ทุกคำสั่งลัดเริ่มเฝ้าสต็อก แล้วดำเนินการซื้อตามขั้นตอนและการตั้งค่าของบอต
- หยุดบอตด้วย `Ctrl+C`

## iPhone Duo

| ความจุ | สี | คำสั่ง |
| --- | --- | --- |
| 256GB | Star White (สตาร์ไวท์) | `npm run duo-wh-256` |
| 256GB | Night Sky (ไนท์สกาย) | `npm run duo-ns-256` |
| 512GB | Star White (สตาร์ไวท์) | `npm run duo-wh-512` |
| 512GB | Night Sky (ไนท์สกาย) | `npm run duo-ns-512` |
| 1TB | Star White (สตาร์ไวท์) | `npm run duo-wh-1tb` |
| 1TB | Night Sky (ไนท์สกาย) | `npm run duo-ns-1tb` |
| 2TB | Star White (สตาร์ไวท์) | `npm run duo-wh-2tb` |
| 2TB | Night Sky (ไนท์สกาย) | `npm run duo-ns-2tb` |


## iPhone 18 Pro Max

| ความจุ | สี | คำสั่ง |
| --- | --- | --- |
| 256GB | Black (ดำ) | `npm run pm-bk-256` |
| 256GB | Silver (เงิน) | `npm run pm-sl-256` |
| 256GB | Burgundy (เบอร์กันดี) | `npm run pm-bg-256` |
| 256GB | Glacier (ธารน้ำแข็ง) | `npm run pm-gl-256` |
| 512GB | Black (ดำ) | `npm run pm-bk-512` |
| 512GB | Silver (เงิน) | `npm run pm-sl-512` |
| 512GB | Burgundy (เบอร์กันดี) | `npm run pm-bg-512` |
| 512GB | Glacier (ธารน้ำแข็ง) | `npm run pm-gl-512` |
| 1TB | Black (ดำ) | `npm run pm-bk-1tb` |
| 1TB | Silver (เงิน) | `npm run pm-sl-1tb` |
| 1TB | Burgundy (เบอร์กันดี) | `npm run pm-bg-1tb` |
| 1TB | Glacier (ธารน้ำแข็ง) | `npm run pm-gl-1tb` |
| 2TB | Black (ดำ) | `npm run pm-bk-2tb` |
| 2TB | Silver (เงิน) | `npm run pm-sl-2tb` |
| 2TB | Burgundy (เบอร์กันดี) | `npm run pm-bg-2tb` |
| 2TB | Glacier (ธารน้ำแข็ง) | `npm run pm-gl-2tb` |

## ระบุรหัสสินค้าเต็ม

ใช้รหัสจาก `products` ใน `settings.json` แทนคำสั่งลัดได้:

```sh
npm start -- --product iphone-duo-256gb-starwhite
```

หากต้องการเริ่มขั้นตอนซื้อทันทีโดยข้ามการเฝ้าสต็อก:

```sh
npm run checkout -- --product iphone-duo-256gb-starwhite
```

ดูรายชื่อคำสั่งทั้งหมดด้วย `npm run`

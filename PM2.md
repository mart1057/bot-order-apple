# PM2 — รันบอตเบื้องหลัง

process ที่ pm2 ดูแล:

| ชื่อ | โปรเจกต์ |
|---|---|
| `apple-bot-ui` | bot-order-apple (UI ที่ `http://127.0.0.1:3310`) |
| `slip-bot` | slip-tracking |
| `slip-dashboard` | slip-tracking |

## ตั้งค่าครั้งแรก (ทำครั้งเดียว)

```sh
# 1. ติดตั้ง pm2 แบบ global
npm install -g pm2

# 2. เปิด apple-bot-ui (slip-bot / slip-dashboard เปิดด้วยสคริปต์เดิม)
cd ~/Desktop/Private/bot-order-apple
npm install
npm run ui

# 3. เช็กว่าครบ 3 ตัว แล้วบันทึกรายการ
pm2 status
pm2 save

# 4. ตั้งให้เปิดเองตอนเปิดเครื่อง
pm2 startup
# → copy คำสั่ง `sudo env PATH=...` ที่มันพิมพ์ออกมาไปรัน
```

## เปิดเครื่องมา

ไม่ต้องรันอะไร pm2 จะเปิดทั้ง 3 ตัวเองหลังล็อกอิน

```sh
pm2 status       # เช็กว่า online ครบ 3 ตัว
pm2 resurrect    # ถ้าตัวไหนไม่ขึ้น: เปิดทั้งหมดจากรายการที่ save ไว้
```

> ไม่ต้องรัน `setup-autostart.command` ทุกครั้งที่เปิดเครื่อง (ถ้ามันสั่ง `pm2 start` อาจได้ process ซ้อน)

## คำสั่งคุมทั้งหมดพร้อมกัน

```sh
pm2 restart all
pm2 stop all
pm2 logs          # log รวมทุกตัว
```

## คำสั่งเฉพาะ apple-bot-ui (รันในโฟลเดอร์ bot-order-apple)

```sh
npm run ui          # เปิดผ่าน pm2
npm run ui:logs     # ดู log
npm run ui:status   # ดูสถานะ
npm run ui:restart  # รีสตาร์ต (หลังแก้โค้ด)
npm run ui:stop     # หยุด (ส่งสัญญาณหยุดบอตด้วย)
npm run ui:delete   # ลบออกจาก pm2
npm run ui:dev      # รันแบบเดิมใน terminal ไม่ผ่าน pm2
```

## ข้อควรรู้

- เพิ่ม / ลบ process ใน pm2 แล้วต้อง `pm2 save` ใหม่ทุกครั้ง
- เปลี่ยนพอร์ต: `UI_PORT=3311 npm run ui:restart` แล้ว `pm2 save`
- เช็กพอร์ตว่าง: `lsof -i :3310`
- Mac หลับ = บอตหยุด ถ้าเฝ้าสต็อกยาวๆ ให้รัน `caffeinate -dims` ค้างไว้
- ยกเลิกเปิดเองตอนบูต: `pm2 unstartup` แล้วรันคำสั่งที่มันพิมพ์ออกมา

# ทดสอบฐานข้อมูล

ทดสอบ `../schema.sql` กับ Postgres จริงในเครื่อง (จำลอง `auth.users` / `auth.uid()` ของ Supabase ด้วย `shim.sql`)
ครอบคลุมสิทธิ์ตามบทบาท, ขั้นตอนการขอเบิก/อนุมัติ/งวดจ่าย/บัญชี, การตรวจยอดงบฝั่งเซิร์ฟเวอร์, การจัดการผู้ใช้

```bash
createdb sp
psql -d sp -f shim.sql
psql -d sp -f ../schema.sql
npm install
PGDATABASE=sp node run.js      # ตั้ง PGHOST / PGPORT / PGUSER ตามเครื่อง
```

อย่ารัน `shim.sql` กับโปรเจกต์ Supabase จริง (ใช้เฉพาะตอนทดสอบในเครื่อง)

## ทดสอบระบบรอบใหม่ (`schema_v2.sql`)
- `v2_test.sql` — ฐานข้อมูลล้วน: บัญชี บทบาทสิทธิ์ เปิดใช้ครั้งแรก และ **ข้อมูลหลัก (เฟส 2)** ครอบคลุมสิทธิ์ การตรวจรูปแบบ กันบันทึกทับกัน ประวัติ เพิ่ม Supplier
  `psql -v ON_ERROR_STOP=1 -d sp -f shim.sql -f ../schema_v2.sql -f v2_test.sql`
- `web_master.js` — หน้าเว็บจริง (Playwright) ↔ `fake-supabase.js` ↔ Postgres จริง: Admin เข้าระบบบันทึกค่าตั้งต้น · แก้ข้อมูลหลัก · ผู้ใช้อื่นเห็น · แก้ทับกันถูกปฏิเสธ · เซิร์ฟเวอร์ใช้ไม่ได้ก็ยังเปิดระบบได้แต่บันทึกไม่ได้
  `PGDATABASE=sp node web_master.js` (ต้องรัน `npm install` ในโฟลเดอร์นี้ และมี Playwright)
- `v2c_test.sql` — **กฎธุรกิจที่ฐานข้อมูลบังคับ** (เปิดบังคับ): ขั้นตอนสถานะงบ · GL · วงเงินงบที่เปิดใช้ · คำขอเบิก (เงินทดรอง / สำรองจ่าย / PR-PO / ใบเก่า) · คำขอเพิ่มงบ · สวิตช์ปิดฉุกเฉิน — `psql -v ON_ERROR_STOP=1 -d <ฐานข้อมูลใหม่> -f shim.sql -f ../schema_v2_all.sql -f v2c_test.sql` (`v2b_test.sql` ปิดกฎไว้ เพราะทดสอบการมองเห็นด้วยเอกสารจำลอง)
- `check_schema.js` — ไม่ใช้ฐานข้อมูล: ตรวจว่า `schema_v2_all.sql` เป็นปัจจุบัน และ `SCHEMA_VERSION` ใน js/app.js = `v2_schema_version()` ใน schema_v2b.sql · **รันทุกครั้งที่แก้ supabase/schema_v2*.sql**: `node check_schema.js`
- `web_users.js` (หน่วยงาน/ผู้ใช้/ฟอร์มงบ/ธุรการ) · `web_schema.js` (แถบเตือนฐานข้อมูลยังไม่อัปเดต) — `PGDATABASE=sp node <ไฟล์>`

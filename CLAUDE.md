# คำแนะนำสำหรับ Claude ในรีโปนี้

## สไตล์ (ใช้เป็นหลักจนกว่าเจ้าของระบบจะสั่งเปลี่ยน)

- หน้าตา UI ทั้งหมดต้องเป็นไปตาม [`docs/STYLE.md`](docs/STYLE.md) (ฟอนต์ Sarabun / Kanit / IBM Plex Mono, token สีใน `:root` ของ `css/style.css`, component กลาง)
- reuse class ที่มีอยู่ ห้ามสร้าง variant ต่อหน้า · ห้ามใช้ hex ตรงๆ ถ้ามี token · ต้องการสีใหม่ให้ถามผู้ใช้ก่อน
- เจ้าของระบบจะบอกเองเมื่อต้องการเปลี่ยนบางอย่างของสไตล์ — ให้แก้เฉพาะจุดนั้นแล้วอัปเดต `docs/STYLE.md`

## ฐานข้อมูล Supabase (ลดการให้ผู้ใช้รันสคีมาซ้ำ)

- เว็บขึ้นเองหลัง merge แต่ฐานข้อมูลไม่ขึ้นด้วย — ทุกครั้งที่แก้ `supabase/schema_v2*.sql` ผู้ใช้ต้องรันใหม่เอง (โฮสต์ Supabase ถูกบล็อกจากเซสชัน ทำแทนไม่ได้)
- **ก่อนแก้ฐานข้อมูล**: ถ้าความต้องการยังไม่ชัด ให้ถามก่อน อย่าเดาแล้วแก้ · รวมการแก้ฐานข้อมูลของหลายเรื่องไว้รอบเดียวเมื่อทำได้ · งานที่แก้แค่หน้าเว็บ (js/css/html) ไม่ต้องให้ผู้ใช้รันอะไร
- **สรุปท้ายงานทุกครั้ง** ต้องบอกชัดว่า "รอบนี้ต้องรันสคีมา / Deploy Edge Function หรือไม่" (ผู้ใช้รันไฟล์เดียว: `supabase/schema_v2_all.sql`)
- **เมื่อแก้ schema**: (1) แก้ `schema_v2.sql` / `schema_v2b.sql` (รันซ้ำได้ ไม่ลบข้อมูล) (2) เพิ่มเลขใน `v2_schema_version()` (schema_v2b.sql ท้ายไฟล์) และ `SCHEMA_VERSION` ใน `js/app.js` ให้เท่ากัน (3) `sh supabase/build_schema_all.sh` (4) `node supabase/tests/check_schema.js` (5) รันชุดทดสอบใน `supabase/tests/` (6) อัปเดต `supabase/SETUP-v2.md`
- เว็บตรวจเลขเวอร์ชันนี้เองหลังล็อกอิน ถ้าฐานข้อมูลเก่ากว่าจะขึ้นแถบเตือนให้รันสคีมาใหม่

## ขั้นตอนขึ้นเว็บ

- พัฒนาที่ branch `claude/adoring-bardeen-2zqnm7` (รีเซ็ตจาก `origin/main` ทุกงาน) → push → สร้าง draft PR → ตั้งเป็น ready → squash merge → ตรวจ GitHub Pages deploy
- รีโป: `precise-org/Budgeting` (git remote `origin` = https://github.com/precise-org/Budgeting) · เว็บ: https://precise-org.github.io/Budgeting/ (ตรวจ deploy โดยเปิดเว็บแล้วดู meta `app-version` ว่าตรงกับเลขที่เพิ่งขึ้น)
- เปลี่ยนเลขเวอร์ชันใน `index.html` (5 จุด: meta `app-version` และ `?v=` ของ css / js) ทุกครั้งที่ขึ้นเว็บ
- ห้ามนำข้อมูลบริษัทจริงขึ้นเว็บสาธารณะ · ห้ามใส่ service_role key / รหัสผ่านฐานข้อมูล
- ตอบผู้ใช้เป็นภาษาไทย

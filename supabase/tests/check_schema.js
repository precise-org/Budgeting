/*
 * ตรวจความสอดคล้องของสคีมากับหน้าเว็บ (ไม่ต้องใช้ฐานข้อมูล) — รันก่อนขึ้นเว็บทุกครั้งที่แก้ supabase/schema_v2*.sql
 *   node check_schema.js
 *   1) schema_v2_all.sql ต้องเป็นปัจจุบัน (= schema_v2.sql + schema_v2b.sql · สร้างใหม่ด้วย sh ../build_schema_all.sh)
 *   2) เลขเวอร์ชันสคีมาใน schema_v2b.sql (v2_schema_version) ต้องเท่ากับ SCHEMA_VERSION ใน js/app.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const sup = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(f, 'utf8');
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail += 1; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// 1) ไฟล์รวมเป็นปัจจุบัน
const current = read(path.join(sup, 'schema_v2_all.sql'));
execFileSync('sh', [path.join(sup, 'build_schema_all.sh')], { stdio: 'ignore' });
const rebuilt = read(path.join(sup, 'schema_v2_all.sql'));
check(current === rebuilt, 'schema_v2_all.sql เป็นปัจจุบัน' + (current === rebuilt ? '' : ' (เพิ่งสร้างใหม่ให้แล้ว — commit ไฟล์นี้ด้วย)'));

// 2) เลขเวอร์ชัน
const sql = read(path.join(sup, 'schema_v2b.sql')).match(/v2_schema_version\(\) returns integer[\s\S]*?select\s+(\d+)\s*\$\$/);
const js = read(path.join(sup, '..', 'js', 'app.js')).match(/const SCHEMA_VERSION = (\d+);/);
check(!!sql && !!js, 'พบเลขเวอร์ชันทั้งใน SQL และ js/app.js');
check(sql && js && sql[1] === js[1], 'SCHEMA_VERSION ใน js/app.js (' + (js && js[1]) + ') เท่ากับ v2_schema_version() (' + (sql && sql[1]) + ')');

process.exit(fail ? 1 : 0);

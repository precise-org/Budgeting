/*
 * ทดสอบแถบเตือน "ฐานข้อมูลยังไม่อัปเดต" (หน้าเว็บจริง ↔ Supabase จำลอง ↔ Postgres) — ปัจจุบัน = ไม่เตือน · ไม่มีฟังก์ชันเลขเวอร์ชัน / เลขต่ำกว่า = เตือน (Admin เห็นวิธีแก้ · คนอื่นให้แจ้ง Admin)
 *   PGDATABASE=sp node web_schema.js   (ปล่อยฐานข้อมูล sp ให้รัน schema_v2_all.sql ใหม่หลังทดสอบ)
 */
const T = __dirname + '/';

const { chromium } = require('playwright');
const { startFake } = require(T + 'fake-supabase');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
(async () => {
  const fake = await startFake({ database: 'sp' });
  const sql = (q, p) => fake.admin('sql', { sql: q, params: p });
  await sql('delete from public.v2_profiles'); await sql('delete from auth.users');
  const mk = async (email, name, role) => { const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id,email,name,role,companies,password_set_at) values ($1,$2,$3,$4,'{PBI}',now())", [u.id, email, name, role]); };
  await mk('admin1@example.com', 'แอดมิน', 'admin');
  await mk('biz@example.com', 'ผู้ขอ', 'business');
  const b = await chromium.launch();
  const open = async (email) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((c) => { window.PROCUREMENT_CONFIG = c; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
    const p = await ctx.newPage(); p.setDefaultTimeout(5000); p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.goto('file://' + require('path').resolve(__dirname, '../../index.html') + '');
    await p.fill('[name=email]', email); await p.fill('[name=password]', 'Passw0rd1');
    await p.click('#authForm button[type=submit]'); await p.waitForSelector('#userBtn', { state: 'visible' }); await p.waitForTimeout(800); return p; };

  // ฐานข้อมูลปัจจุบัน → ไม่มีแถบเตือน
  let p = await open('admin1@example.com');
  ok(!(await p.$('#schemaWarn')), 'no warning when schema is current');
  // ฐานข้อมูลเก่า (ไม่มีฟังก์ชันเลขเวอร์ชัน) → มีแถบเตือน
  await sql('drop function public.v2_schema_version()');
  p = await open('admin1@example.com');
  const t = await p.$eval('#schemaWarn', (e) => e.innerText).catch(() => '');
  ok(/schema_v2_all\.sql/.test(t), 'admin sees run-schema instruction: ' + t.slice(0, 90));
  const biz = await open('biz@example.com');
  const tb = await biz.$eval('#schemaWarn', (e) => e.innerText).catch(() => '');
  ok(/แจ้งผู้ดูแลระบบ/.test(tb) && !/schema_v2_all/.test(tb), 'non-admin told to inform admin: ' + tb.slice(0, 90));
  // เลขเวอร์ชันต่ำกว่าที่เว็บต้องการ → มีแถบเตือน
  await sql('create function public.v2_schema_version() returns integer language sql immutable as $$ select 1 $$');
  await sql('grant execute on function public.v2_schema_version() to authenticated');
  p = await open('admin1@example.com');
  ok(!!(await p.$('#schemaWarn')), 'old version number shows warning');
  console.log('pass', pass, 'fail', fail);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

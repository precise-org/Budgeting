/*
 * ทดสอบเฟส 2 (ข้อมูลหลักบนเซิร์ฟเวอร์) ทั้งระบบ: หน้าเว็บจริง (Playwright) ↔ Supabase จำลอง (fake-supabase.js) ↔ Postgres จริง
 *
 *   createdb sp && psql -d sp -f shim.sql -f ../schema_v2.sql
 *   PGHOST=/tmp/pgtest PGPORT=5544 PGUSER=postgres node web_master.js
 */
const path = require('path');
const { chromium } = require('playwright');
const { startFake } = require('./fake-supabase');

const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.log('FAIL', m); } };

(async () => {
  const fake = await startFake({ database: process.env.PGDATABASE || 'sp' });
  const sql = (q, params) => fake.admin('sql', { sql: q, params });
  await sql('truncate public.v2_master, public.v2_master_history');
  await sql('delete from public.v2_profiles');
  await sql('delete from auth.users');   // shim ไม่มี unique ที่อีเมล — ล้างก่อนเพื่อรันซ้ำได้
  const mk = async (email, name, role) => {
    const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id, email, name, role, companies, password_set_at) values ($1, $2, $3, $4, '{PBI,PCC}', now())", [u.id, email, name, role]);
    return u.id;
  };
  await mk('admin1@example.com', 'แอดมิน หนึ่ง', 'admin');
  await mk('admin2@example.com', 'แอดมิน สอง', 'admin');
  await mk('biz@example.com', 'ผู้ขอ', 'business');

  const browser = await chromium.launch();
  const open = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((cfg) => { window.PROCUREMENT_CONFIG = cfg; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
    const p = await ctx.newPage();
    p.setDefaultTimeout(5000);
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(PAGE);
    await p.fill('[name=email]', email); await p.fill('[name=password]', 'Passw0rd1');
    await p.click('#authForm button[type=submit]');
    await p.waitForSelector('#userBtn', { state: 'visible' });
    await p.waitForTimeout(500);
    return p;
  };
  // หน่วยงานต้องมีบริษัท: เติมบริษัทให้แถวที่ยังว่างก่อนกดบันทึก
  const fixCo = async (p) => { for (const sel of await p.$$('.master-form select[data-k=company]')) { if (!(await sel.inputValue())) await sel.selectOption('PBI'); } };
  // หน่วยงานเป็นบรรทัดย่อยของบริษัท: กด "+ เพิ่มหน่วยงาน" ของบริษัทลำดับ idx แล้วพิมพ์ชื่อ (ช่องใหม่ได้ focus อัตโนมัติ)
  const addDept = async (p, idx, name) => { await p.locator('[data-dept-add]').nth(idx).click(); await p.keyboard.type(name); };
  const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(400); };
  const keys = async () => (await sql('select key from public.v2_master order by key')).map((r) => r.key);
  const items = async (k) => (await sql('select items from public.v2_master where key = $1', [k]))[0].items;

  // ---- Admin คนแรกเข้าระบบ: บันทึกค่าตั้งต้นขึ้นเซิร์ฟเวอร์ (ครั้งเดียว)
  const a1 = await open('admin1@example.com');
  const ks = await keys();
  ok(['companies', 'departments', 'investGroups', 'listGroups', 'priorityGroups', 'suppliers'].every((k) => ks.includes(k)), 'admin login seeds all master keys: ' + ks.join());
  ok((await items('companies')).some((c) => c.code === 'PBI'), 'seeded companies include PBI');
  const hist0 = (await sql('select count(*)::int n from public.v2_master_history'))[0].n;
  ok(hist0 === 6, 'history has 6 seed rows: ' + hist0);

  // ---- Admin แก้หน่วยงาน → ขึ้นเซิร์ฟเวอร์
  await go(a1, '#/master/companies');
  ok(!!(await a1.$('.alert.info')) && !(await a1.$('.alert.error')), 'master page shows server-backed notice');
  await addDept(a1, 0, 'ฝ่ายใหม่ (เฟส 2)');
  await fixCo(a1);
  await a1.click('.master-form button[type=submit]'); await a1.waitForTimeout(700);
  const firstCo = (await items('companies'))[0].code;
  ok((await items('departments')).some((d) => d.name === 'ฝ่ายใหม่ (เฟส 2)' && d.company === firstCo), 'department saved on server under its company');
  ok(/บันทึกหน่วยงานแล้ว|บันทึก/.test(await a1.textContent('#app')), 'success flash');

  // ---- ผู้ใช้อื่นเห็นค่าที่ Admin บันทึก (เครื่อง/เบราว์เซอร์คนละ context)
  // หน่วยงานในฟอร์มงบ = หน่วยงานของเจ้าของงบ (Admin ตั้งให้ผู้ขอจากหน่วยงานที่เพิ่งบันทึกในข้อมูลหลัก)
  await sql("update public.v2_profiles set departments = array['ฝ่ายใหม่ (เฟส 2)'], company = 'PBI' where lower(email) = 'biz@example.com'");
  const biz = await open('biz@example.com');
  await go(biz, '#/budget/new');
  const opts = await biz.$$eval('[name=department] option', (o) => o.map((x) => x.value));
  ok(opts.length === 1 && opts[0] === 'ฝ่ายใหม่ (เฟส 2)', 'business budget form offers only the owner own department: ' + opts.join('|'));
  await go(biz, '#/master/companies');
  ok(/ไม่มีสิทธิ์จัดการข้อมูลหลัก/.test(await biz.textContent('#app')), 'business cannot open master page');

  // ---- บันทึกทับกัน: Admin2 แก้ก่อน → Admin1 บันทึกด้วยค่าเก่าถูกปฏิเสธ
  const a2 = await open('admin2@example.com');
  await go(a2, '#/master/companies');
  await addDept(a2, 0, 'โดย Admin2');
  await fixCo(a2);
  await a2.click('.master-form button[type=submit]'); await a2.waitForTimeout(700);
  await addDept(a1, 0, 'โดย Admin1');   // a1 ยังอยู่หน้าเดิมที่โหลดค่าเก่าไว้ (ก่อน Admin2 บันทึก)
  await fixCo(a1);
  await a1.click('.master-form button[type=submit]'); await a1.waitForTimeout(900);
  const txt = await a1.textContent('#app');
  ok(/มีผู้อื่นแก้ข้อมูลหลักนี้ไปก่อน/.test(txt), 'stale save rejected with message');
  const deps = (await items('departments')).map((d) => d.name);
  ok(deps.includes('โดย Admin2') && !deps.includes('โดย Admin1'), 'server keeps the other admin change: ' + deps.join('|'));
  ok((await a1.$$eval('.master-form input[data-k=dept]', (x) => x.map((i) => i.value))).includes('โดย Admin2'), 'page reloaded with the latest list');
  // แก้ซ้ำหลังเห็นค่าล่าสุดได้
  await addDept(a1, 0, 'โดย Admin1');
  await fixCo(a1);
  await a1.click('.master-form button[type=submit]'); await a1.waitForTimeout(700);
  ok((await items('departments')).some((d) => d.name === 'โดย Admin1'), 'second attempt saves');

  // ---- เปลี่ยนชื่อบริษัท / ลบ: ส่งขึ้นเซิร์ฟเวอร์ และ business เห็นเมื่อโหลดใหม่
  await go(a1, '#/master/companies');
  await a1.fill('.master-form tbody tr:first-child input[data-k=name]', 'ชื่อบริษัทใหม่');
  await a1.click('.master-form button[type=submit]'); await a1.waitForTimeout(700);
  ok((await items('companies'))[0].name === 'ชื่อบริษัทใหม่', 'company rename saved on server');
  await biz.reload(); await biz.waitForTimeout(800);
  await go(biz, '#/budget/new');
  ok((await biz.textContent('#app')).includes('ชื่อบริษัทใหม่'), 'business sees the renamed company after reload');

  // ---- ไม่มีฟังก์ชันบนเซิร์ฟเวอร์ (ยังไม่ได้รันสคริปต์) / ออฟไลน์ → ระบบยังเปิดได้ แต่บันทึกไม่ได้
  await sql('alter function public.v2_master_get() rename to v2_master_get_off');
  const a3 = await open('admin1@example.com');
  await go(a3, '#/master/suppliers');
  ok(!!(await a3.$('.alert.error')) && /เชื่อมข้อมูลหลักกับเซิร์ฟเวอร์ไม่ได้/.test(await a3.textContent('#app')), 'server master unavailable → clear error, app still opens');
  await a3.click('[data-m-add]');
  await a3.fill('.master-form tbody tr:last-child input[data-k=name]', 'ไม่ควรบันทึก');
  await a3.click('.master-form button[type=submit]'); await a3.waitForTimeout(700);
  ok(!(await items('suppliers')).some((s) => s.name === 'ไม่ควรบันทึก'), 'nothing saved while server master unavailable');
  await sql('alter function public.v2_master_get_off() rename to v2_master_get');

  const errs = [].concat(a1.errs, a2.errs, a3.errs, biz.errs);
  ok(errs.length === 0, 'page errors: ' + errs.join(' | '));
  console.log('pass', pass, 'fail', fail);
  await browser.close();
  await fake.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

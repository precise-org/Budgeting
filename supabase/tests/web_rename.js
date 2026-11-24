/*
 * ทดสอบการเปลี่ยนชื่อรายการข้อมูลหลักที่ถูกใช้อยู่ (โหมด Supabase): ชื่อที่ถูกใช้ในเอกสารเปลี่ยนไม่ได้ (Admin ไม่มีสิทธิ์เขียนเอกสารของ Business) · ชื่อที่ไม่ถูกใช้เปลี่ยนได้ · ไม่มีข้อผิดพลาด "ไม่มีสิทธิ์บันทึกเอกสารชนิดนี้"
 *   PGDATABASE=sp node web_rename.js
 */
const T = __dirname + '/';

const { chromium } = require('playwright');
const { startFake } = require(T + 'fake-supabase');
(async () => {
  const fake = await startFake({ database: 'sp' });
  const sql = (q, p) => fake.admin('sql', { sql: q, params: p });
  await sql('truncate public.v2_master, public.v2_master_history, public.v2_docs, public.v2_log, public.v2_counters');
  await sql('delete from public.v2_profiles'); await sql('delete from auth.users');
  const mk = async (email, name, role) => { const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id,email,name,role,companies,password_set_at) values ($1,$2,$3,$4,'{PBI}',now())", [u.id, email, name, role]); return u.id; };
  await mk('admin1@example.com', 'แอดมิน', 'admin');
  const bizId = await mk('biz@example.com', 'สมชาย', 'business');
  await sql("insert into public.v2_master (key, items) values ('suppliers', $1)", [JSON.stringify([{ name: 'บจก. ผู้ขาย เอ' }, { name: 'บจก. ผู้ขาย บี' }])]);
  const budget = { id: 'b1', type: 'CBS', code: 'X1', name: 'งบทดสอบ', company: 'PBI', department: 'ฝ่ายบัญชี', ownerId: bizId, structure: 'items', state: 'active', fiscalYear: 2026,
    items: [{ id: 'i1', code: '1', name: 'ค่าใช้จ่ายทดสอบ', amount: 1000000, vat: 0 }], history: [], attachments: [], revisions: [], createdAt: '2026-10-01T03:00:00.000Z' };
  const r = { id: 'r1', no: 'REQ-2026-0001', budgetId: 'b1', type: 'CBS', status: 'pending', requesterId: bizId, createdAt: '2026-10-02T02:00:00.000Z',
    steps: [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'waiting' }], lines: [{ itemId: 'i1', description: 'ค่าบริการ', supplier: 'บจก. ผู้ขาย เอ', amountBeforeVat: 1000, vat: 70, amount: 1070 }],
    amount: 1070, amountBeforeVat: 1000, vat: 70, useType: 'direct', cuts: [], history: [], attachments: [] };
  await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('budget','b1','PBI',$1,'','','ฝ่ายบัญชี',$2)", [bizId, JSON.stringify(budget)]);
  await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('request','r1','PBI',$1,$1,'b1','ฝ่ายบัญชี',$2)", [bizId, JSON.stringify(r)]);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((c) => { window.PROCUREMENT_CONFIG = c; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000); p.on('dialog', (d) => { console.log('DIALOG:', d.message().slice(0, 100)); d.accept(); });
  await p.goto('file://' + require('path').resolve(__dirname, '../../index.html') + '');
  await p.fill('[name=email]', 'admin1@example.com'); await p.fill('[name=password]', 'Passw0rd1');
  await p.click('#authForm button[type=submit]'); await p.waitForSelector('#userBtn', { state: 'visible' }); await p.waitForTimeout(900);
  await p.evaluate(() => { location.hash = '#/master/suppliers'; }); await p.waitForTimeout(800);
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
  const syncErr = async () => (await p.$eval('.sync-bar', (e) => e.innerText).catch(() => '')).trim();
  // 1) เปลี่ยนชื่อ Supplier ที่ถูกใช้ในคำขอ → ถูกปฏิเสธด้วยข้อความ ไม่แก้ข้อมูลหลัก ไม่มีข้อผิดพลาดบันทึกเอกสาร
  await p.locator('.master-form input[data-k=name]').first().fill('บจก. ผู้ขาย เอ (แก้ชื่อ)');
  await p.click('.master-form button[type=submit]'); await p.waitForTimeout(1500);
  ok(/เปลี่ยนชื่อ "บจก. ผู้ขาย เอ" ไม่ได้/.test(await p.textContent('#app')), 'renaming a supplier used by a request is refused with a message');
  ok((await sql("select items from public.v2_master where key='suppliers'"))[0].items[0].name === 'บจก. ผู้ขาย เอ', 'master unchanged on the server');
  ok((await syncErr()) === '', 'no document save error: ' + (await syncErr()));
  // 2) เปลี่ยนชื่อ Supplier ที่ไม่ถูกใช้ → ทำได้ และไม่มีข้อผิดพลาดบันทึกเอกสาร
  await p.evaluate(() => { location.hash = '#/master/listGroups'; }); await p.waitForTimeout(500);
  await p.evaluate(() => { location.hash = '#/master/suppliers'; }); await p.waitForTimeout(800);
  await p.locator('.master-form input[data-k=name]').nth(1).fill('บจก. ผู้ขาย บี (ชื่อใหม่)');
  await p.click('.master-form button[type=submit]'); await p.waitForTimeout(1500);
  ok((await sql("select items from public.v2_master where key='suppliers'"))[0].items.some((x) => x.name === 'บจก. ผู้ขาย บี (ชื่อใหม่)'), 'renaming an unused supplier works');
  ok((await syncErr()) === '', 'no document save error after a normal rename: ' + (await syncErr()));
  ok((await sql("select data->'lines'->0->>'supplier' s from public.v2_docs where id='r1'"))[0].s === 'บจก. ผู้ขาย เอ', 'request document untouched');
  console.log('pass', pass, 'fail', fail);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

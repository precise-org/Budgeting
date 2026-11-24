/*
 * ทดสอบช่องค้นหาในตาราง (หน้าเว็บจริง ↔ Supabase จำลอง ↔ Postgres):
 *   ข้อมูลหลักทุกหน้ามีช่องค้นหา (Supplier · บริษัทและหน่วยงานแบบกลุ่ม) · ตารางรายการทั่วไปที่ ≥ 12 แถวได้ช่องค้นหาอัตโนมัติ · < 12 แถวไม่มี
 *   PGDATABASE=sp node web_search.js
 */
const path = require('path');
const { chromium } = require('playwright');
const { startFake } = require('./fake-supabase');
const PAGE = 'file://' + path.resolve(__dirname, '../../index.html');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

(async () => {
  const fake = await startFake({ database: process.env.PGDATABASE || 'sp' });
  const sql = (q, p) => fake.admin('sql', { sql: q, params: p });
  await sql('truncate public.v2_master, public.v2_master_history, public.v2_docs, public.v2_log, public.v2_counters');
  await sql('delete from public.v2_profiles'); await sql('delete from auth.users');
  const mk = async (email, name, role) => { const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id,email,name,role,companies,password_set_at) values ($1,$2,$3,$4,'{PBI}',now())", [u.id, email, name, role]); return u.id; };
  await mk('admin1@example.com', 'แอดมิน', 'admin');
  const bizId = await mk('biz@example.com', 'สมชาย', 'business');

  // Supplier 40 ชื่อ + บริษัท/หน่วยงานตัวอย่าง
  const sup = Array.from({ length: 40 }, (_, i) => ({ name: (i % 2 ? 'บจก. ผู้ขายคู่ ' : 'ร้าน ผู้ขายคี่ ') + (i + 1) }));
  await sql("insert into public.v2_master (key, items) values ('suppliers', $1)", [JSON.stringify(sup)]);
  await sql("insert into public.v2_master (key, items) values ('companies', $1)", [JSON.stringify([{ code: 'PBI', name: 'บริษัท พีบีไอ', logo: '' }, { code: 'PCC', name: 'บริษัท พีซีซี', logo: '' }])]);
  await sql("insert into public.v2_master (key, items) values ('departments', $1)", [JSON.stringify([{ name: 'ฝ่ายบัญชี', company: 'PBI' }, { name: 'ฝ่ายผลิต', company: 'PBI' }, { name: 'ฝ่ายขาย', company: 'PCC' }])]);

  // คำขอเบิก 14 ใบ (≥ 12 แถว) + งบ 1 ใบ
  const budget = { id: 'b1', type: 'CBS', code: 'X1', name: 'งบทดสอบ', company: 'PBI', department: 'ฝ่ายบัญชี', ownerId: bizId, structure: 'items', state: 'active', fiscalYear: 2026,
    items: [{ id: 'i1', code: '1', name: 'ค่าใช้จ่ายทดสอบ', amount: 1000000, vat: 0 }], history: [], attachments: [], revisions: [], createdAt: '2026-10-01T03:00:00.000Z' };
  await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('budget','b1','PBI',$1,'','','ฝ่ายบัญชี',$2)", [bizId, JSON.stringify(budget)]);
  for (let i = 1; i <= 14; i++) {
    const r = { id: 'r' + i, no: 'REQ-2026-' + String(i).padStart(4, '0'), budgetId: 'b1', type: 'CBS', status: 'pending', requesterId: bizId, createdAt: '2026-10-' + String(i).padStart(2, '0') + 'T02:00:00.000Z',
      steps: [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'waiting' }], lines: [{ itemId: 'i1', description: i === 7 ? 'ค่าซ่อมพิเศษเจ็ด' : 'ค่าบริการ ' + i, amountBeforeVat: 1000, vat: 70, amount: 1070 }],
      amount: 1070, amountBeforeVat: 1000, vat: 70, useType: 'direct', cuts: [], history: [], attachments: [] };
    await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('request',$1,'PBI',$2,$2,'b1','ฝ่ายบัญชี',$3)", ['r' + i, bizId, JSON.stringify(r)]);
  }

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((c) => { window.PROCUREMENT_CONFIG = c; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000); p.on('dialog', (d) => d.accept()); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE);
  await p.fill('[name=email]', 'admin1@example.com'); await p.fill('[name=password]', 'Passw0rd1');
  await p.click('#authForm button[type=submit]'); await p.waitForSelector('#userBtn', { state: 'visible' }); await p.waitForTimeout(900);
  const go = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(700); };
  const visibleRows = async (sel) => p.$$eval(sel, (rows) => rows.filter((r) => !r.hidden && !r.matches('.search-empty')).length);

  // ---- ข้อมูลหลัก → Supplier
  await go('#/master/suppliers');
  ok(!!(await p.$('.table-search input[type=search]')), 'supplier page has a search box');
  ok(/40 รายการ/.test(await p.textContent('.search-count')), 'count shows 40: ' + (await p.textContent('.search-count')));
  await p.fill('.table-search input', 'ผู้ขายคู่ 1');   // ตรงกับ 'ผู้ขายคู่ 12','14','16','18' (คู่ = ลำดับคู่) และ 'คู่ 1' ไม่มี (i+1 คู่ = 2,4,..)
  await p.waitForTimeout(200);
  const hit = await p.$$eval('.master-form tbody tr:not(.search-empty):not([hidden]) input[data-k=name]', (e) => e.map((x) => x.value));
  ok(hit.length > 0 && hit.every((n) => n.includes('ผู้ขายคู่ 1')), 'filter shows only matches: ' + hit.join(' | '));
  await p.fill('.table-search input', 'ไม่มีชื่อนี้แน่นอน'); await p.waitForTimeout(200);
  ok((await visibleRows('.master-form tbody tr')) === 0 && !(await p.$eval('.search-empty', (e) => e.hidden)), 'empty-state row shown when nothing matches');
  // Enter ในช่องค้นหาต้องไม่ส่งฟอร์ม
  await p.press('.table-search input', 'Enter'); await p.waitForTimeout(300);
  ok(!!(await p.$('.table-search input')) && (await sql("select jsonb_array_length(items) n from public.v2_master where key='suppliers'"))[0].n === 40, 'Enter in the search box does not submit the form');
  // แถวใหม่ยังเห็นระหว่างค้นหา และบันทึกได้โดยไม่พังเพราะแถวสถานะว่าง
  await p.click('[data-m-add]'); await p.keyboard.type('บจก. ผู้ขายใหม่ทดสอบ');
  ok((await visibleRows('.master-form tbody tr')) === 1, 'a newly added row stays visible while searching');
  await p.fill('.table-search input', ''); await p.waitForTimeout(200);
  await p.click('.master-form button[type=submit]'); await p.waitForTimeout(1000);
  ok((await sql("select items from public.v2_master where key='suppliers'"))[0].items.some((x) => x.name === 'บจก. ผู้ขายใหม่ทดสอบ'), 'saving still works with the search row present');

  // ---- ข้อมูลหลัก → บริษัทและหน่วยงาน (กลุ่ม)
  await go('#/master/companies');
  ok(!!(await p.$('.table-search input')), 'companies page has a search box');
  await p.fill('.table-search input', 'ฝ่ายขาย'); await p.waitForTimeout(200);
  const co = await p.$$eval('.master-form tr.co-row:not([hidden]) input[data-k=code]', (e) => e.map((x) => x.value));
  const dp = await p.$$eval('.master-form tr.dept-row:not([hidden]) input[data-k=dept]', (e) => e.map((x) => x.value));
  ok(co.length === 1 && co[0] === 'PCC' && dp.length === 1 && dp[0] === 'ฝ่ายขาย', 'department search shows its company + that department only: ' + co + ' / ' + dp);
  await p.fill('.table-search input', 'PBI'); await p.waitForTimeout(200);
  const dp2 = await p.$$eval('.master-form tr.dept-row:not([hidden]) input[data-k=dept]', (e) => e.map((x) => x.value));
  ok(dp2.length === 2, 'company search shows all of its departments: ' + dp2.join(','));

  // ---- ตารางรายการทั่วไป: ≥ 12 แถว = มีช่องค้นหาอัตโนมัติ
  await go('#/requests');
  ok(!!(await p.$('.table-search input')), 'requests list (14 rows) gets an automatic search box');
  await p.fill('.table-search input', 'เจ็ด'); await p.waitForTimeout(200);
  ok((await visibleRows('.table-wrap tbody tr')) === 1, 'request search narrows to the matching row');
  // ตารางที่น้อยกว่า 12 แถวไม่มีช่องค้นหา
  await sql("delete from public.v2_docs where kind = 'request' and id not in ('r1', 'r2', 'r3')");
  await p.reload(); await p.waitForTimeout(1200); await go('#/requests');
  ok(!(await p.$('.table-search')), 'a short table (3 rows) has no search box');

  ok(errs.length === 0, 'page errors: ' + errs.join(' | '));
  console.log('pass', pass, 'fail', fail);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

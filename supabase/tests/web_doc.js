/*
 * ทดสอบท้ายใบเบิกใช้งบ (เอกสารที่อนุมัติในระบบ ไม่ต้องเซ็น): แสดงใครสร้าง/ใครอนุมัติ/เมื่อไร + ผู้พิมพ์ · ไม่มีช่องเซ็นชื่อ
 *   PGDATABASE=sp node web_doc.js
 */
const T = __dirname + '/';

const { chromium } = require('playwright');
const { startFake } = require(T + 'fake-supabase');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
(async () => {
  const fake = await startFake({ database: 'sp' });
  const sql = (q, p) => fake.admin('sql', { sql: q, params: p });
  await sql('delete from public.v2_docs'); await sql('delete from public.v2_profiles'); await sql('delete from auth.users');
  const mk = async (email, name, role, extra) => { const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id,email,name,title,role,companies,departments,password_set_at) values ($1,$2,$3,$4,$5,'{PBI}',$6,now())", [u.id, email, name, (extra && extra.title) || '', role, (extra && extra.departments) || '{}']); return u.id; };
  const adminId = await mk('admin1@example.com', 'แอดมิน', 'admin', { title: 'ผู้ดูแลระบบ' });
  const bizId = await mk('biz@example.com', 'สมชาย ใจดี', 'business', { title: 'วิศวกร', departments: '{ฝ่ายวิศวกรรม}' });
  const ctlId = await mk('ctl@example.com', 'มาลี เงินดี', 'controller', { title: 'ผู้คุมงบ' });
  const astId = await mk('ast@example.com', 'พิมพ์ ธุรการ', 'assistant', { title: 'ธุรการ', departments: '{ฝ่ายวิศวกรรม}' });
  const budget = { id: 'b1', type: 'CBS', code: 'X1', name: 'งบทดสอบ', company: 'PBI', department: 'ฝ่ายวิศวกรรม', ownerId: bizId, structure: 'items', state: 'active', fiscalYear: 2026,
    items: [{ id: 'i1', code: '1', name: 'ค่าใช้จ่ายทดสอบ', amount: 100000, vat: 0 }], history: [], attachments: [], revisions: [], createdAt: '2026-10-01T03:00:00.000Z' };
  const req = { id: 'r1', budgetId: 'b1', type: 'CBS', status: 'approved', docNo: 'OPEX-2026-0001', requesterId: bizId, proxyBy: astId, createdAt: '2026-10-19T02:15:00.000Z', approvedAt: '2026-10-20T07:40:00.000Z',
    steps: [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'approved', by: ctlId, at: '2026-10-20T07:40:00.000Z', comment: '' }],
    lines: [{ itemId: 'i1', description: 'ค่าบริการทดสอบ', amountBeforeVat: 1000, vat: 70, amount: 1070 }], amount: 1070, amountBeforeVat: 1000, vat: 70, useType: 'direct', cuts: [], history: [], attachments: [] };
  await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('budget','b1','PBI',$1,'','','ฝ่ายวิศวกรรม',$2)", [bizId, JSON.stringify(budget)]);
  await sql("insert into public.v2_docs (kind,id,company,owner_id,requester_id,budget_id,department,data) values ('request','r1','PBI',$1,$1,'b1','ฝ่ายวิศวกรรม',$2)", [bizId, JSON.stringify(req)]);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1000, height: 1400 } });
  await ctx.addInitScript((c) => { window.PROCUREMENT_CONFIG = c; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
  const p = await ctx.newPage(); p.setDefaultTimeout(5000); p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../../index.html') + '');
  await p.fill('[name=email]', 'ctl@example.com'); await p.fill('[name=password]', 'Passw0rd1');
  await p.click('#authForm button[type=submit]'); await p.waitForSelector('#userBtn', { state: 'visible' }); await p.waitForTimeout(1000);
  await p.evaluate(() => { location.hash = '#/doc/r1'; }); await p.waitForTimeout(900);
  const t = await p.$eval('.approval-trail', (e) => e.innerText).catch((e) => 'NONE ' + e.message.slice(0, 60));
  console.log(t);
  ok(/สร้างคำขอ/.test(t) && /สมชาย ใจดี/.test(t) && /ทำแทนโดย พิมพ์ ธุรการ/.test(t), 'creator + proxy shown');
  ok(/อนุมัติ \(ผู้คุมงบตรวจสอบ\)/.test(t) && /มาลี เงินดี/.test(t) && /ผู้คุมงบ/.test(t), 'approver shown with title');
  ok(/19 ต\.ค\. 2569/.test(t) && /20 ต\.ค\. 2569/.test(t), 'dates shown');
  ok(/ไม่ต้องลงนาม/.test(t) && /OPEX-2026-0001/.test(t) && /พิมพ์โดย มาลี เงินดี/.test(t), 'footer note with doc no and printer');
  ok(!(await p.$('.doc .signs')), 'no signature lines');
  await p.emulateMedia({ media: 'print' });
  await p.screenshot({ path: require('os').tmpdir() + '/trail.png', fullPage: true });
  console.log('pass', pass, 'fail', fail);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

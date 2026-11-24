/*
 * ทดสอบหน่วยงาน/ผู้ใช้/ฟอร์มงบ (หน้าเว็บจริง ↔ Supabase จำลอง ↔ Postgres): หน่วยงานต้องมีบริษัท · ฟอร์มผู้ใช้ตามบทบาท (Business 1 หน่วยงาน · ธุรการหลายหน่วยงาน · ผู้คุมงบบริษัทที่รับผิดชอบ) · ฟอร์มงบใช้หน่วยงานของเจ้าของ · ธุรการสร้างงบไม่ได้
 *   PGDATABASE=sp node web_users.js   (ฐานข้อมูล sp ต้องรัน shim.sql + schema_v2.sql + schema_v2b.sql แล้ว)
 */
const T = __dirname + '/';

const { chromium } = require('playwright');
const { startFake } = require(T + 'fake-supabase');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
(async () => {
  const fake = await startFake({ database: 'sp' });
  const sql = (q, p) => fake.admin('sql', { sql: q, params: p });
  await sql('truncate public.v2_master, public.v2_master_history, public.v2_docs, public.v2_log, public.v2_counters');
  await sql('delete from public.v2_profiles'); await sql('delete from auth.users');
  const mk = async (email, name, role, extra) => { const u = await fake.admin('user', { email, password: 'Passw0rd1' });
    await sql("insert into public.v2_profiles (id,email,name,role,companies,company,departments,password_set_at) values ($1,$2,$3,$4,$5,$6,$7,now())", [u.id, email, name, role, (extra && extra.companies) || '{}', (extra && extra.company) || '', (extra && extra.departments) || '{}']); return u.id; };
  await mk('admin1@example.com', 'แอดมิน', 'admin');
  const bizId = await mk('biz@example.com', 'ผู้ขอ', 'business', { company: 'PBI', departments: '{PBI101}' });
  const astId = await mk('ast@example.com', 'ธุรการ', 'assistant', { companies: '{PBI}' });
  const ctlId = await mk('ctl@example.com', 'ผู้คุมงบ', 'controller', { companies: '{PBI}' });
  const b = await chromium.launch();
  const open = async (email) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((c) => { window.PROCUREMENT_CONFIG = c; }, { supabaseUrl: fake.url, supabaseAnonKey: fake.anonKey });
    const p = await ctx.newPage(); p.setDefaultTimeout(5000); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('dialog', d => d.accept());
    await p.goto('file://' + require('path').resolve(__dirname, '../../index.html') + '');
    await p.fill('[name=email]', email); await p.fill('[name=password]', 'Passw0rd1');
    await p.click('#authForm button[type=submit]'); await p.waitForSelector('#userBtn', { state: 'visible' }); await p.waitForTimeout(700); return p; };
  const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(600); };
  const a = await open('admin1@example.com');

  // ---- ข้อมูลหลัก: บริษัทและหน่วยงาน (หน่วยงานเป็นบรรทัดย่อยของบริษัท)
  await go(a, '#/master/companies');
  ok(!(await a.$('#nav a[href="#/master/departments"]')), 'no separate department menu');
  const nsel = await a.$$eval('.master-form tr[data-unassigned] select[data-k=company]', e => e.length);
  ok(nsel >= 5, 'legacy departments shown in the unassigned group with a company select: ' + nsel);
  await a.click('.master-form button[type=submit]'); await a.waitForTimeout(500);
  ok(/เลือกบริษัทของหน่วยงาน/.test(await a.textContent('#app')), 'save blocked without company');
  const sels = await a.$$('.master-form tr[data-unassigned] select[data-k=company]');
  for (const [i, s] of sels.entries()) await s.selectOption(i === 1 ? 'PCC' : 'PBI');
  await a.click('.master-form button[type=submit]'); await a.waitForTimeout(900);
  const items = (await sql("select items from public.v2_master where key='departments'"))[0].items;
  ok(items.every(d => d.company) && items.some(d => d.company === 'PCC'), 'departments saved with company: ' + JSON.stringify(items.slice(0, 2)));
  ok(!(await a.$('.dept-unassigned-head')) && (await a.$$('.master-form tr.dept-row')).length === items.length, 'after save every department sits under its company');
  // เพิ่มบริษัทใหม่ + หน่วยงานใต้บริษัทนั้น
  await a.click('[data-co-add]'); await a.keyboard.type('NEWCO');
  await a.locator('.co-row').last().locator('input[data-k=name]').fill('บริษัทใหม่');
  await a.locator('[data-dept-add]').last().click(); await a.keyboard.type('ฝ่ายใหม่ใต้บริษัท');
  await a.click('.master-form button[type=submit]'); await a.waitForTimeout(1000);
  const cos = (await sql("select items from public.v2_master where key='companies'"))[0].items;
  const ds2 = (await sql("select items from public.v2_master where key='departments'"))[0].items;
  ok(cos.some(c => c.code === 'NEWCO') && ds2.some(d => d.name === 'ฝ่ายใหม่ใต้บริษัท' && d.company === 'NEWCO'), 'new company and its department saved together');
  // ลบบริษัทที่ยังมีหน่วยงานไม่ได้ · ลบหน่วยงานก่อนแล้วลบบริษัทได้
  const nCo = (await a.$$('.co-row')).length;
  const newRow = a.locator('.co-row', { has: a.locator('input[data-k=code][value=NEWCO]') });
  await newRow.locator('[data-m-remove]').click();
  ok((await a.$$('.co-row')).length === nCo, 'cannot remove a company that still has departments');
  await a.locator('tr.dept-row', { has: a.locator('input[data-k=dept][value="ฝ่ายใหม่ใต้บริษัท"]') }).locator('[data-m-remove]').click();
  await newRow.locator('[data-m-remove]').click();
  ok((await a.$$('.co-row')).length === nCo - 1, 'company removed after its departments are removed');
  await a.click('.master-form button[type=submit]'); await a.waitForTimeout(1000);
  const cos2 = (await sql("select items from public.v2_master where key='companies'"))[0].items;
  const ds3 = (await sql("select items from public.v2_master where key='departments'"))[0].items;
  ok(!cos2.some(c => c.code === 'NEWCO') && !ds3.some(d => d.company === 'NEWCO'), 'removal saved on server');

  // ---- ผู้ใช้: Business = บริษัท+หน่วยงาน 1 อัน
  await go(a, '#/admin');
  await a.click('tr[data-uid="' + bizId + '"] [data-user-edit]');
  const vis = async (id) => a.$eval('#' + id, e => e.style.display !== 'none');
  ok(await vis('affilField') && !(await vis('deptMultiField')) && !(await vis('coField')), 'business: affil only');
  const opts = await a.$$eval('#userForm [name=department] option', e => e.map(x => x.value));
  ok(opts.includes('PBI101') && !opts.includes('ฝ่ายโครงการ'), 'dept list filtered by company PBI: ' + opts.join());
  await a.selectOption('#userForm [name=company]', 'PCC');
  const opts2 = await a.$$eval('#userForm [name=department] option', e => e.map(x => x.value));
  ok(opts2.includes('ฝ่ายโครงการ') && !opts2.includes('PBI101'), 'dept list follows company PCC: ' + opts2.join());
  await a.click('#userForm button[type=submit]'); await a.waitForTimeout(400);
  ok(/เลือกหน่วยงานของผู้ใช้/.test(await a.evaluate(() => document.getElementById('userFormError').innerText)), 'business requires a department');
  await a.selectOption('#userForm [name=company]', 'PBI'); await a.selectOption('#userForm [name=department]', 'PBI103');
  await a.click('#userForm button[type=submit]'); await a.waitForTimeout(900);
  const bz = (await sql('select company, department, departments from public.v2_profiles where id=$1', [bizId]))[0];
  ok(bz.company === 'PBI' && JSON.stringify(bz.departments) === '["PBI103"]', 'business saved: ' + JSON.stringify(bz));
  const cell = await a.$eval('tr[data-uid="' + bizId + '"] td:nth-child(4)', e => e.innerText);
  ok(/PBI · PBI103/.test(cell), 'scope cell: ' + cell);

  // ---- ธุรการ: หลายหน่วยงาน + บริษัทที่รับผิดชอบ
  await a.click('tr[data-uid="' + astId + '"] [data-user-edit]');
  ok(!(await vis('affilField')) && await vis('deptMultiField') && !(await vis('coField')) && !(await a.$('#proxyField')), 'assistant: multi dept only (no companies, no pick-a-person field)');
  const groups = await a.$$eval('#deptChecks .muted', (e) => e.map((x) => x.innerText));
  ok(groups.some((g) => /^PBI/.test(g)) && groups.some((g) => /^PCC/.test(g)), 'assistant departments grouped under companies: ' + groups.join(' | '));
  await a.click('#userForm button[type=submit]'); await a.waitForTimeout(400);
  ok(/เลือกหน่วยงานที่ธุรการช่วยงาน/.test(await a.evaluate(() => document.getElementById('userFormError').innerText)), 'assistant requires at least one department');
  await a.check('#userForm [name=departments][value=PBI101]'); await a.check('#userForm [name=departments][value=PBI104]');
  await a.click('#userForm button[type=submit]'); await a.waitForTimeout(900);
  const as = (await sql('select departments, companies from public.v2_profiles where id=$1', [astId]))[0];
  ok(JSON.stringify(as.departments) === '["PBI101","PBI104"]', 'assistant multi dept: ' + JSON.stringify(as));

  // ---- ผู้คุมงบ: บริษัทที่รับผิดชอบเท่านั้น
  await a.click('tr[data-uid="' + ctlId + '"] [data-user-edit]');
  ok(!(await vis('affilField')) && !(await vis('deptMultiField')) && await vis('coField'), 'controller: companies only');
  await a.uncheck('#userForm [name=companies][value=PBI]');
  await a.click('#userForm button[type=submit]'); await a.waitForTimeout(400);
  ok(/เลือกบริษัทที่รับผิดชอบ/.test(await a.evaluate(() => document.getElementById('userFormError').innerText)), 'controller requires companies');
  await a.click('[data-user-cancel]');

  // ---- Business: ฟอร์มงบ หน่วยงานตามเจ้าของ บริษัทเลือกได้ทุกบริษัท
  const biz = await open('biz@example.com');
  await go(biz, '#/budget/new');
  const dopts = await biz.$$eval('[name=department] option', e => e.map(x => x.value));
  ok(dopts.length === 1 && dopts[0] === 'PBI103', 'business budget form: only own department: ' + dopts.join());
  const copts = await biz.$$eval('[name=company] option', e => e.map(x => x.value));
  ok(copts.includes('PBI') && copts.includes('PCC'), 'business can pick any company: ' + copts.join());
  // ---- ธุรการ: ไม่มีปุ่มสร้างงบ
  const ast = await open('ast@example.com');
  await go(ast, '#/my-budgets');
  ok(!(await ast.$('a[href="#/budget/new"]')), 'assistant has no create-budget button');
  await go(ast, '#/budget/new');
  ok(/ไม่มีสิทธิ์สร้างงบ/.test(await ast.textContent('#app')), 'assistant cannot open budget form: ' + (await ast.textContent('#app')).slice(0, 80));
  console.log('pass', pass, 'fail', fail);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

-- ทดสอบกฎธุรกิจที่ฐานข้อมูลบังคับ (_v2_check_doc ใน schema_v2b.sql) — เปิดบังคับ (enforce_rules = on)
--   psql -v ON_ERROR_STOP=1 -d sp -f shim.sql -f ../schema_v2.sql -f ../schema_v2b.sql -f v2c_test.sql
\set ON_ERROR_STOP on

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'u' || g || '@example.com' from generate_series(1, 10) g;
-- 01 admin · 02 ผู้คุมงบ PBI · 04 จัดซื้อ PBI · 05 Biz1 (ฝ่ายวิศวกรรม) · 06 Biz2 (ฝ่ายขาย) · 09 ธุรการ (ฝ่ายวิศวกรรม) · 10 บัญชี PBI
insert into public.v2_profiles (id, email, name, role, companies, active) values
  ('00000000-0000-0000-0000-000000000001', 'u1@example.com', 'Admin', 'admin', '{}', true),
  ('00000000-0000-0000-0000-000000000002', 'u2@example.com', 'CtrlPBI', 'controller', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000004', 'u4@example.com', 'PurPBI', 'purchasing', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000005', 'u5@example.com', 'Biz1', 'business', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000006', 'u6@example.com', 'Biz2', 'business', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000009', 'u9@example.com', 'AstPBI', 'assistant', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000010', 'u10@example.com', 'AccPBI', 'accountant', '{PBI}', true);
update public.v2_profiles set departments = array['ฝ่ายวิศวกรรม'], company = 'PBI' where id in ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000009');
update public.v2_profiles set departments = array['ฝ่ายขาย'], company = 'PBI' where id = '00000000-0000-0000-0000-000000000006';
grant usage on schema public to anon, authenticated;

create or replace function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0')), false);
end $$;
grant execute on function pg_temp.as_user(int) to public;
create or replace function pg_temp.ok(c boolean, label text) returns void language plpgsql as $$
begin if not c then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
grant execute on function pg_temp.ok(boolean, text) to public;

/** บันทึกเอกสารหนึ่งฉบับ — คืน 'OK' หรือข้อความ error */
create or replace function pg_temp.try_save(p_kind text, p_id text, p_ver int, p_data jsonb, p_deleted boolean default false) returns text language plpgsql as $$
begin
  perform public.v2_save_docs(jsonb_build_array(jsonb_build_object('kind', p_kind, 'id', p_id, 'version', p_ver, 'data', p_data, 'deleted', p_deleted)));
  return 'OK';
exception when others then return sqlerrm;
end $$;
grant execute on function pg_temp.try_save(text, text, int, jsonb, boolean) to public;

-- ตัวสร้างข้อมูลทดสอบ
create or replace function pg_temp.bud(p_type text, p_state text, p_owner int, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type', p_type, 'company', 'PBI', 'department', 'ฝ่ายวิศวกรรม', 'state', p_state,
    'ownerId', '00000000-0000-0000-0000-0000000000' || lpad(p_owner::text, 2, '0'), 'code', 'X',
    'items', case when p_type = 'CBS'
        then jsonb_build_array(jsonb_build_object('id', 'i1', 'code', '1', 'amount', 100000, 'vat', 0, 'glCode', '', 'glName', ''))
        else jsonb_build_array(jsonb_build_object('id', 'i1', 'code', 'C-01', 'amount', 100000, 'vat', 0)) end) || p_extra
$$;
grant execute on function pg_temp.bud(text, text, int, jsonb) to public;
create or replace function pg_temp.req(p_budget text, p_owner int, p_use text, p_status text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('budgetId', p_budget, 'requesterId', '00000000-0000-0000-0000-0000000000' || lpad(p_owner::text, 2, '0'),
    'useType', p_use, 'status', p_status, 'amount', 10000, 'lines', jsonb_build_array(jsonb_build_object('itemId', 'i1', 'amount', 10000)), 'cuts', '[]'::jsonb) || p_extra
$$;
grant execute on function pg_temp.req(text, int, text, text, jsonb) to public;

set role authenticated;

-- ================================================================ งบ: สร้างใหม่
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'bad', 0, pg_temp.bud('CAPEX', 'active', 5)) like '%สร้างงบด้วยสถานะ%', 'Business สร้างงบเป็นเปิดใช้เองไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'bps', 0, pg_temp.bud('CAPEX', 'pending_open', 5, '{"setup":true}')) like '%สร้างงบด้วยสถานะ%', 'Business สร้างงบรอเปิดใช้ (setup) เองไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 0, pg_temp.bud('CAPEX', 'draft', 5)) = 'OK', 'Business สร้างร่างได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 0, pg_temp.bud('CBS', 'draft', 5)) = 'OK', 'Business สร้างร่าง OPEX ได้');

-- ================================================================ งบ: ขั้นตอนสถานะ (CAPEX)
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 1, pg_temp.bud('CAPEX', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'Business ข้ามไปเปิดใช้งบจากร่างไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 1, pg_temp.bud('CAPEX', 'review', 5)) = 'OK', 'Business ส่งอนุมัติได้ (ร่าง → รออนุมัติ)');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 2, pg_temp.bud('CAPEX', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'Business อนุมัติงบตัวเองไม่ได้ (รออนุมัติ → เปิดใช้)');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 2, pg_temp.bud('CAPEX', 'pending_open', 5)) like '%ไม่ถูกขั้นตอน%', 'Business อนุมัติงบตัวเองไม่ได้ (รออนุมัติ → รอเปิดใช้)');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 2, pg_temp.bud('CAPEX', 'review', 5, '{"items":[{"id":"i1","code":"C-01","amount":999999,"vat":0}]}')) like '%แก้รายการ%', 'งบที่ส่งตรวจแล้วแก้วงเงินไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 2, pg_temp.bud('CAPEX', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'ผู้คุมงบเปิดใช้ CAPEX จากรออนุมัติตรงๆ ไม่ได้ (ต้องผ่าน Memo)');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 2, pg_temp.bud('CAPEX', 'pending_open', 5)) = 'OK', 'ผู้คุมงบตรวจผ่าน CAPEX → รอเปิดใช้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 3, pg_temp.bud('CAPEX', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'Business เปิดใช้ CAPEX เองโดยไม่ส่ง Memo ไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 3, pg_temp.bud('CAPEX', 'open_review', 5, '{"openMemo":{"no":"M1"}}')) = 'OK', 'Business ส่ง Memo ขอเปิดใช้ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 4, pg_temp.bud('CAPEX', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'Business ยืนยัน Memo ตัวเองไม่ได้');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 4, pg_temp.bud('CAPEX', 'active', 5)) like '%ธุรการ%', 'ธุรการยืนยัน Memo / เปิดใช้ไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 4, pg_temp.bud('CAPEX', 'active', 5, '{"openMemo":{"no":"M1"}}')) = 'OK', 'ผู้คุมงบยืนยัน Memo → เปิดใช้งบ');

-- ================================================================ งบที่เปิดใช้แล้ว: วงเงิน / ปรับงบ
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 5, pg_temp.bud('CAPEX', 'active', 5, '{"items":[{"id":"i1","code":"C-01","amount":500000,"vat":0}]}')) like '%เปลี่ยนวงเงิน%', 'Business แก้วงเงินงบที่เปิดใช้แล้วเองไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 5, pg_temp.bud('CAPEX', 'active', 5, '{"cashflow":{"i1":{"2026-11":1000}}}')) = 'OK', 'Business วาง Plan Cashflow ได้ (ไม่เปลี่ยนวงเงิน)');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 6, pg_temp.bud('CAPEX', 'active', 5, '{"cashflow":{"i1":{"2026-11":2000}}}')) = 'OK', 'ธุรการวาง Plan Cashflow แทนได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 7, pg_temp.bud('CAPEX', 'active', 5, '{"items":[{"id":"i1","code":"C-01","amount":150000,"vat":0}]}')) = 'OK', 'ผู้คุมงบปรับงบ (เปลี่ยนวงเงิน) ได้');

-- ================================================================ OPEX: ขั้นตอน + GL
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 1, pg_temp.bud('CBS', 'review', 5)) = 'OK', 'Business ส่งอนุมัติ OPEX ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 2, pg_temp.bud('CBS', 'active', 5)) like '%ไม่ถูกขั้นตอน%', 'Business เปิดใช้ OPEX เองจากรออนุมัติไม่ได้');
select pg_temp.as_user(10);
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 2, pg_temp.bud('CBS', 'review', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"510101","glName":"วัตถุดิบ"}]}')) like '%เมื่อผู้คุมงบยืนยัน Item%', 'บัญชีใส่ GL ระหว่างรออนุมัติไม่ได้ (Item ยังไม่ถูกยืนยัน)');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 2, pg_temp.bud('CBS', 'review', 5, '{"items":[{"id":"i1","code":"1","amount":777,"vat":0,"glCode":"","glName":""}]}')) like '%แก้รายการ%', 'บัญชีแก้วงเงินระหว่างรออนุมัติไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 2, pg_temp.bud('CBS', 'active', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"510101","glName":"วัตถุดิบ"}]}')) like '%GL%', 'ผู้คุมงบเปิดใช้พร้อมแอบใส่ GL ไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 2, pg_temp.bud('CBS', 'active', 5)) = 'OK', 'ผู้คุมงบตรวจผ่านและเปิดใช้ OPEX ขั้นเดียว');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 3, pg_temp.bud('CBS', 'active', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"999999","glName":"x"}]}')) like '%GL%', 'ผู้คุมงบแก้ GL ไม่ได้');
select pg_temp.as_user(10);
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 3, pg_temp.bud('CBS', 'active', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"520202","glName":"บัญชี"}]}')) = 'OK', 'บัญชีใส่ GL ได้หลังงบเปิดใช้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 4, pg_temp.bud('CBS', 'active', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"999999","glName":"x"}]}')) like '%GL%', 'Business แก้ GL ไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ox', 4, pg_temp.bud('CBS', 'active', 5, '{"items":[{"id":"i1","code":"1","amount":100000,"vat":0,"glCode":"520202","glName":"บัญชี"},{"id":"i2","code":"1.1","amount":0,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'Business เพิ่ม Item ย่อย OPEX ได้ (วงเงินรวมไม่เปลี่ยน)');

-- OPEX ที่ผู้คุมงบลงไว้ (setup): เจ้าของงบกดเปิดเอง · ผู้อื่นเปิดแทนไม่ได้
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'os', 0, pg_temp.bud('CBS', 'pending_open', 5, '{"setup":true}')) = 'OK', 'ผู้คุมงบลงงบ OPEX ให้ Business (รอเปิดใช้)');
select pg_temp.ok(pg_temp.try_save('budget', 'os', 1, pg_temp.bud('CBS', 'active', 5, '{"setup":true}')) like '%ไม่ถูกขั้นตอน%', 'ผู้คุมงบเปิดใช้ OPEX แทน Business ไม่ได้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'os', 1, pg_temp.bud('CBS', 'active', 5, '{"setup":true}')) = 'OK', 'Business เจ้าของงบกดขอดำเนินการใช้งบ OPEX ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'cx', 8, pg_temp.bud('CAPEX', 'active', 5), true) like '%ลบงบ%', 'ลบงบที่เปิดใช้งานไม่ได้');

-- OPEX งบรวมที่ผู้คุมงบลงไว้ → Business ลง Item เอง → ผู้คุมงบยืนยัน Item (ไม่มี Memo) → GL เมื่อเปิดใช้แล้ว
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 0, pg_temp.bud('CBS', 'pending_open', 5, '{"setup":true,"structure":"project","items":[]}')) = 'OK', 'ผู้คุมงบลงงบ OPEX แบบงบรวมทั้งโครงการ');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 1, pg_temp.bud('CBS', 'pending_open', 5, '{"setup":true,"structure":"items","items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) like '%ต้องบันทึกว่า Business เป็นผู้ลง%', 'Business ลง Item งบรวมโดยไม่บันทึก breakdown ไม่ได้ (ข้ามการยืนยันไม่ได้)');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 1, pg_temp.bud('CBS', 'pending_open', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'Business ลง Item งบรวม (บันทึก breakdown) ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 2, pg_temp.bud('CBS', 'active', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) like '%ไม่ถูกขั้นตอน%', 'Business เปิดใช้ OPEX ที่ลง Item เองโดยไม่ผ่านผู้คุมงบไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 2, pg_temp.bud('CBS', 'active', 5, '{"setup":true,"structure":"items","items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) like '%ไม่ถูกขั้นตอน%', 'Business ลบ breakdown แล้วเปิดใช้ในรอบเดียวไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 2, pg_temp.bud('CBS', 'open_review', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'Business ส่ง Item ให้ผู้คุมงบยืนยัน (รอผู้คุมงบตรวจ) ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 3, pg_temp.bud('CBS', 'open_review', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":70000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":30000,"vat":0,"glCode":"","glName":""}]}')) like '%แก้รายการ%', 'ระหว่างรอผู้คุมงบยืนยัน แก้ Item ไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 3, pg_temp.bud('CBS', 'active', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) like '%ไม่ถูกขั้นตอน%', 'Business ยืนยัน Item ของตัวเองไม่ได้');
select pg_temp.as_user(10);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 3, pg_temp.bud('CBS', 'open_review', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"510101","glName":"วัตถุดิบ"},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) like '%เมื่อผู้คุมงบยืนยัน Item%', 'บัญชีใส่ GL ก่อนผู้คุมงบยืนยัน Item ไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 3, pg_temp.bud('CBS', 'open_returned', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-01-01"},"returnReason":"แก้วงเงิน","items":[{"id":"a1","code":"1","amount":60000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":40000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'ผู้คุมงบส่ง Item กลับให้แก้ได้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 4, pg_temp.bud('CBS', 'open_review', 5, '{"setup":true,"structure":"items","items":[{"id":"a1","code":"1","amount":70000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":30000,"vat":0,"glCode":"","glName":""}]}')) like '%ลบบันทึกการลง Item%', 'Business ลบ breakdown ตอนส่งกลับไม่ได้');
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 4, pg_temp.bud('CBS', 'open_review', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-02-01"},"items":[{"id":"a1","code":"1","amount":70000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":30000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'Business แก้ Item แล้วส่งให้ผู้คุมงบยืนยันใหม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 5, pg_temp.bud('CBS', 'active', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-02-01","confirmedBy":"y"},"items":[{"id":"a1","code":"1","amount":70000,"vat":0,"glCode":"","glName":""},{"id":"a2","code":"2","amount":30000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'ผู้คุมงบยืนยัน Item และเปิดใช้งบ OPEX ได้');
select pg_temp.as_user(10);
select pg_temp.ok(pg_temp.try_save('budget', 'ob', 6, pg_temp.bud('CBS', 'active', 5, '{"setup":true,"structure":"items","breakdown":{"by":"x","at":"2026-02-01","confirmedBy":"y"},"items":[{"id":"a1","code":"1","amount":70000,"vat":0,"glCode":"510101","glName":"วัตถุดิบ"},{"id":"a2","code":"2","amount":30000,"vat":0,"glCode":"","glName":""}]}')) = 'OK', 'บัญชีใส่ GL ได้หลังผู้คุมงบยืนยัน Item (งบเปิดใช้แล้ว)');
select pg_temp.as_user(5);

-- ================================================================ คำขอเบิกใช้งบ
-- ขอเบิก: ต้องงบเปิดใช้ + เจ้าของงบ/ธุรการ + สถานะเริ่มต้นรอตรวจ
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'r0', 0, pg_temp.req('cx', 5, 'advance', 'approved')) like '%สร้างคำขอเบิกด้วยสถานะ%', 'Business สร้างคำขอเบิกเป็นอนุมัติแล้วเองไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'r0', 0, pg_temp.req('cx', 5, 'advance', 'pending', '{"cuts":[{"id":"x1","kind":"clear","amount":10}]}')) like '%ต้องไม่มีเลขเอกสาร%', 'คำขอใหม่แนบการตัดงบมาเองไม่ได้');
select pg_temp.as_user(6);
select pg_temp.ok(pg_temp.try_save('request', 'r0', 0, pg_temp.req('cx', 6, 'advance', 'pending')) like '%เจ้าของงบ%', 'Biz2 ขอเบิกจากงบของ Biz1 ไม่ได้');
select pg_temp.as_user(5);
-- เงินทดรอง
select pg_temp.ok(pg_temp.try_save('request', 'ra', 0, pg_temp.req('cx', 5, 'advance', 'pending')) = 'OK', 'Business ขอเบิกเงินทดรองได้');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2}')) <> 'OK', 'Business อนุมัติใบเบิกตัวเองไม่ได้');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.try_save('request', 'rx', 0, pg_temp.req('cx', 5, 'advance', 'pending')) = 'OK', 'ธุรการขอเบิกแทน Business ได้ (ในนามเจ้าของงบ)');
select pg_temp.ok(pg_temp.try_save('request', 'rx', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2}')) <> 'OK', 'ธุรการอนุมัติใบเบิกไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'ra', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2}')) like '%จ่ายเงินทดรอง%', 'อนุมัติเงินทดรองโดยไม่บันทึกจ่ายเงินทดรองไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true}}')) = 'OK', 'ผู้คุมงบอนุมัติ = จ่ายเงินทดรอง');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 2, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true},"amount":1}')) like '%แก้ยอด%', 'ใบที่อนุมัติแล้วแก้ยอดไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 2, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true},"cuts":[{"id":"c1","kind":"clear","amount":9000}]}')) like '%เคลียร์เงินทดรอง%', 'ผู้คุมงบเคลียร์เงินทดรองแทน Business ไม่ได้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'ra', 2, pg_temp.req('cx', 5, 'advance', 'closed', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true}}')) like '%ยังไม่มีรายการตัดงบ%', 'ปิดยอดเงินทดรองโดยไม่เคลียร์ไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 2, pg_temp.req('cx', 5, 'advance', 'closed', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true},"cuts":[{"id":"c1","kind":"clear","amount":9000}],"closed":{"actual":9000}}')) = 'OK', 'Business เคลียร์เงินทดรอง → ตัดงบและปิดยอด');
select pg_temp.ok(pg_temp.try_save('request', 'ra', 3, pg_temp.req('cx', 5, 'advance', 'closed', '{"cutRule":2,"docNo":"CAPEX-1","advance":{"amount":10000,"auto":true},"cuts":[{"id":"c1","kind":"clear","amount":1}],"closed":{"actual":9000}}')) like '%แก้ไข%', 'แก้ยอดการตัดงบที่บันทึกแล้วไม่ได้');
-- ธุรการเคลียร์แทน
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'rx', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"cutRule":2,"docNo":"CAPEX-2","advance":{"amount":10000,"auto":true}}')) = 'OK', 'ผู้คุมงบอนุมัติใบที่ธุรการขอ');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.try_save('request', 'rx', 2, pg_temp.req('cx', 5, 'advance', 'closed', '{"cutRule":2,"docNo":"CAPEX-2","advance":{"amount":10000,"auto":true},"cuts":[{"id":"c2","kind":"clear","amount":10000}],"closed":{"actual":10000}}')) = 'OK', 'ธุรการเคลียร์เงินทดรองแทน Business ได้');

-- สำรองจ่าย / จ่ายตรง: ตัดงบอัตโนมัติตอนอนุมัติ
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'rr', 0, pg_temp.req('cx', 5, 'reimburse', 'pending')) = 'OK', 'Business ขอเบิกสำรองจ่ายได้');
select pg_temp.ok(pg_temp.try_save('request', 'rr', 1, pg_temp.req('cx', 5, 'reimburse', 'closed', '{"cutRule":2,"cuts":[{"id":"a1","kind":"reimburse","amount":10000,"auto":true}]}')) <> 'OK', 'Business ปิดยอดสำรองจ่ายเองไม่ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'rr', 1, pg_temp.req('cx', 5, 'reimburse', 'closed', '{"cutRule":2,"cuts":[{"id":"a1","kind":"reimburse","amount":10000}]}')) like '%ตัดงบอัตโนมัติ%', 'ตัดงบสำรองจ่ายโดยไม่ใช่รายการอัตโนมัติไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'rr', 1, pg_temp.req('cx', 5, 'reimburse', 'closed', '{"cutRule":2,"cuts":[{"id":"a1","kind":"reimburse","amount":10000,"auto":true}]}')) = 'OK', 'ผู้คุมงบอนุมัติสำรองจ่าย → ตัดงบและปิดยอดอัตโนมัติ');

-- PR/PO: จัดซื้อบันทึก PO · ผู้คุมงบปิดยอด
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 0, pg_temp.req('cx', 5, 'prpo', 'pending')) = 'OK', 'Business ขอเบิกแบบ PR/PO ได้');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 1, pg_temp.req('cx', 5, 'prpo', 'approved', '{"cutRule":2,"docNo":"CAPEX-3"}')) = 'OK', 'ผู้คุมงบอนุมัติใบ PR/PO');
select pg_temp.ok(pg_temp.try_save('request', 'rp', 2, pg_temp.req('cx', 5, 'prpo', 'approved', '{"cutRule":2,"docNo":"CAPEX-3","cuts":[{"id":"p1","kind":"po","amount":9500}]}')) like '%PR/PO%', 'ผู้คุมงบบันทึก PO แทนจัดซื้อไม่ได้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 2, pg_temp.req('cx', 5, 'prpo', 'approved', '{"cutRule":2,"docNo":"CAPEX-3","cuts":[{"id":"p1","kind":"po","amount":9500}]}')) like '%PR/PO%', 'Business บันทึก PO เองไม่ได้');
select pg_temp.as_user(4);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 2, pg_temp.req('cx', 5, 'prpo', 'approved', '{"cutRule":2,"docNo":"CAPEX-3","cuts":[{"id":"p1","kind":"po","amount":9500}]}')) = 'OK', 'จัดซื้อบันทึก PO (ตัดงบตามยอด PO)');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 3, pg_temp.req('cx', 5, 'prpo', 'closed', '{"cutRule":2,"docNo":"CAPEX-3","cuts":[{"id":"p1","kind":"po","amount":9500}],"closed":{"actual":9500}}')) = 'OK', 'ผู้คุมงบยืนยันยอดและปิดยอด PR/PO');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'rp', 4, pg_temp.req('cx', 5, 'prpo', 'approved', '{"cutRule":2,"docNo":"CAPEX-3"}')) <> 'OK', 'เปิดใบที่ปิดยอดแล้วกลับมาไม่ได้');
select pg_temp.ok(pg_temp.try_save('request', 'rp', 4, pg_temp.req('cx', 5, 'prpo', 'closed', '{"cutRule":2,"docNo":"CAPEX-3"}'), true) like '%ลบใบเบิก%', 'ลบใบเบิกที่ปิดยอดแล้วไม่ได้');

-- ใบเก่า (ก่อนกฎตัดงบใหม่ ไม่มี cutRule): ผู้คุมงบจ่ายทดรอง / เคลียร์ / ปิดยอด ตามเดิม · Business เคลียร์เองไม่ได้
reset role;
insert into public.v2_docs (kind, id, company, owner_id, requester_id, budget_id, department, data, version, deleted, updated_by)
  select 'request', 'rl', 'PBI', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'cx', 'ฝ่ายวิศวกรรม',
         pg_temp.req('cx', 5, 'advance', 'approved', '{"docNo":"CAPEX-9"}'), 1, false, '00000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('request', 'rl', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"docNo":"CAPEX-9","cuts":[{"id":"l1","kind":"clear","amount":5000}]}')) like '%ผู้คุมงบ%', 'ใบเก่า: Business เคลียร์เงินทดรองเองไม่ได้ (ใช้ขั้นตอนเดิม)');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('request', 'rl', 1, pg_temp.req('cx', 5, 'advance', 'approved', '{"docNo":"CAPEX-9","advance":{"amount":10000}}')) = 'OK', 'ใบเก่า: ผู้คุมงบจ่ายเงินทดรอง');
select pg_temp.ok(pg_temp.try_save('request', 'rl', 2, pg_temp.req('cx', 5, 'advance', 'closed', '{"docNo":"CAPEX-9","advance":{"amount":10000},"cuts":[{"id":"l1","kind":"clear","amount":5000}],"closed":{"actual":5000}}')) = 'OK', 'ใบเก่า: ผู้คุมงบเคลียร์และปิดยอดตามเดิม');

-- ================================================================ คำขอเพิ่มงบ
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('change', 'g1', 0, jsonb_build_object('budgetId', 'cx', 'state', 'approved', 'lines', '[]'::jsonb)) like '%สร้างคำขอเพิ่มงบด้วยสถานะ%', 'Business สร้างคำขอเพิ่มงบเป็นยืนยันแล้วเองไม่ได้');
select pg_temp.ok(pg_temp.try_save('change', 'g1', 0, jsonb_build_object('budgetId', 'cx', 'state', 'draft', 'lines', '[{"itemId":"i1","amount":5000}]'::jsonb)) = 'OK', 'Business สร้างคำขอเพิ่มงบ (ร่าง) ได้');
select pg_temp.ok(pg_temp.try_save('change', 'g1', 1, jsonb_build_object('budgetId', 'cx', 'state', 'approved', 'lines', '[{"itemId":"i1","amount":5000}]'::jsonb)) like '%ไม่ถูกขั้นตอน%', 'Business ยืนยันเพิ่มงบเองไม่ได้');
select pg_temp.ok(pg_temp.try_save('change', 'g1', 1, jsonb_build_object('budgetId', 'cx', 'state', 'review', 'lines', '[{"itemId":"i1","amount":5000}]'::jsonb)) = 'OK', 'Business ส่งคำขอเพิ่มงบ');
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.try_save('change', 'g1', 2, jsonb_build_object('budgetId', 'cx', 'state', 'approved', 'lines', '[{"itemId":"i1","amount":5000}]'::jsonb)) = 'OK', 'ผู้คุมงบยืนยันเพิ่มงบ');
select pg_temp.ok(pg_temp.try_save('change', 'g1', 3, jsonb_build_object('budgetId', 'cx', 'state', 'approved', 'lines', '[{"itemId":"i1","amount":999999}]'::jsonb)) like '%ยืนยันแล้วแก้ไม่ได้%', 'คำขอเพิ่มงบที่ยืนยันแล้วแก้ไม่ได้');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.try_save('change', 'g2', 0, jsonb_build_object('budgetId', 'cx', 'state', 'draft', 'lines', '[]'::jsonb)) = 'OK', 'ธุรการขอเพิ่มงบแทน Business ได้');

-- ================================================================ สวิตช์ปิดฉุกเฉิน
reset role;
update public.v2_settings set value = 'off' where key = 'enforce_rules';
set role authenticated;
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'cz', 0, pg_temp.bud('CAPEX', 'active', 5)) = 'OK', 'ปิดกฎฉุกเฉิน (off): สร้างงบเปิดใช้เองได้ — ใช้เมื่อกฎเข้มเกินเท่านั้น');
reset role;
update public.v2_settings set value = 'on' where key = 'enforce_rules';
set role authenticated;
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.try_save('budget', 'cz2', 0, pg_temp.bud('CAPEX', 'active', 5)) like '%สร้างงบด้วยสถานะ%', 'เปิดกฎกลับ (on): บังคับอีกครั้ง');

reset role;
\echo ALL V2C TESTS PASSED

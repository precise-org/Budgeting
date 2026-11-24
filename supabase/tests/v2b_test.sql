-- ทดสอบ schema_v2b.sql (เฟส 2a) กับ Postgres ในเครื่อง — ต้องรัน shim.sql, schema_v2.sql, schema_v2b.sql ก่อน
--   psql -v ON_ERROR_STOP=1 -d sp -f shim.sql -f ../schema_v2.sql -f ../schema_v2b.sql -f v2b_test.sql
\set ON_ERROR_STOP on

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'u' || g || '@example.com' from generate_series(1, 12) g;
-- 01 admin · 02 ผู้คุมงบ PBI · 03 ผู้คุมงบ PCC · 04 จัดซื้อ PBI · 05 business1 · 06 business2 · 07 ผู้คุมงบที่ปิดใช้งาน · 08 ผู้คุมงบไม่มีบริษัท
insert into public.v2_profiles (id, email, name, role, companies, active) values
  ('00000000-0000-0000-0000-000000000001', 'u1@example.com', 'Admin', 'admin', '{}', true),
  ('00000000-0000-0000-0000-000000000002', 'u2@example.com', 'CtrlPBI', 'controller', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000003', 'u3@example.com', 'CtrlPCC', 'controller', '{PCC}', true),
  ('00000000-0000-0000-0000-000000000004', 'u4@example.com', 'PurPBI', 'purchasing', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000005', 'u5@example.com', 'Biz1', 'business', '{}', true),
  ('00000000-0000-0000-0000-000000000006', 'u6@example.com', 'Biz2', 'business', '{}', true),
  ('00000000-0000-0000-0000-000000000007', 'u7@example.com', 'Off', 'controller', '{PBI}', false),
  ('00000000-0000-0000-0000-000000000008', 'u8@example.com', 'NoCo', 'controller', '{}', true),
  ('00000000-0000-0000-0000-000000000009', 'u9@example.com', 'AstPBI', 'assistant', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000010', 'u10@example.com', 'AccPBI', 'accountant', '{PBI}', true),
  ('00000000-0000-0000-0000-000000000011', 'u11@example.com', 'AstPCC', 'assistant', '{PCC}', true),
  ('00000000-0000-0000-0000-000000000012', 'u12@example.com', 'AstNoTag', 'assistant', '{PBI}', true);
-- หน่วยงาน: Biz1 (05) = ฝ่ายวิศวกรรม · Biz2 (06) = ฝ่ายขาย · ธุรการ 09 ช่วยฝ่ายวิศวกรรม · 11 ช่วยฝ่ายขาย · 12 ยังไม่ได้กำหนดหน่วยงาน (เห็นอะไรไม่ได้)
update public.v2_profiles set departments = array['ฝ่ายวิศวกรรม'] where id in ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000009');
update public.v2_profiles set departments = array['ฝ่ายขาย'] where id in ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000011');
grant usage on schema public to anon, authenticated;
-- ไฟล์นี้ทดสอบการมองเห็น / สิทธิ์เขียนด้วยเอกสารจำลองที่ไม่ผ่านขั้นตอนจริง จึงปิดกฎขั้นตอนไว้ — กฎขั้นตอนทดสอบใน v2c_test.sql
update public.v2_settings set value = 'off' where key = 'enforce_rules';

create or replace function pg_temp.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0')), false);
end $$;
grant execute on function pg_temp.as_user(int) to public;
create or replace function pg_temp.expect_fail(sql text, label text, expect text default '') returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if expect <> '' and sqlerrm not like '%' || expect || '%' then raise exception 'FAIL: % ผิดข้อความ: %', label, sqlerrm; end if;
    raise notice 'PASS: % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL: % ควรถูกปฏิเสธ', label;
end $$;
grant execute on function pg_temp.expect_fail(text, text, text) to public;
create or replace function pg_temp.ok(c boolean, label text) returns void language plpgsql as $$
begin if not c then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
grant execute on function pg_temp.ok(boolean, text) to public;
create or replace function pg_temp.ids(j jsonb, k text) returns text language sql as $$
  select coalesce(string_agg(x ->> 'id', ',' order by x ->> 'id'), '') from jsonb_array_elements(j -> 'docs') x where x ->> 'kind' = k and not (x ->> 'deleted')::boolean
$$;
grant execute on function pg_temp.ids(jsonb, text) to public;

set role authenticated;

-- ข้อมูลหลักไม่ใช่เอกสารในชั้นนี้ (อยู่ที่ v2_master)
select pg_temp.as_user(1);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"master","id":"master","version":0,"data":{"companies":[]}}]')$$, 'ไม่รับเอกสารชนิด master แล้ว', 'ชนิดหรือรหัสเอกสารไม่ถูกต้อง');

-- ---------------------------------------------------------------- งบ: เจ้าของ / บริษัท
select pg_temp.as_user(1);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bX","version":0,"data":{"company":"PBI","ownerId":"x"}}]')$$, 'Admin ทำรายการงบไม่ได้', 'ไม่มีสิทธิ์');

select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"budget","id":"b1","version":0,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"A"}}]',
  '[{"action":"สร้างงบ","ref":"งบ A","detail":"ทดสอบ","ownerId":"00000000-0000-0000-0000-000000000005","company":"PBI"}]');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b2","version":0,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"B"}}]')$$, 'business สร้างงบให้คนอื่นเป็นเจ้าของไม่ได้', 'นอกขอบเขต');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b3","version":0,"data":{"company":"PBI","code":"C"}}]')$$, 'business สร้างงบที่ไม่มีเจ้าของ (มองไม่เห็น) ไม่ได้', 'นอกขอบเขต');

-- การมองเห็น
select pg_temp.as_user(5); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = 'b1', 'เจ้าของเห็นงบตัวเอง');
select pg_temp.as_user(6); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = '', 'business คนอื่นไม่เห็น');
select pg_temp.as_user(2); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = 'b1', 'ผู้คุมงบ PBI เห็นงบ PBI');
select pg_temp.as_user(3); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = '', 'ผู้คุมงบ PCC ไม่เห็นงบ PBI');
select pg_temp.as_user(4); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = 'b1', 'จัดซื้อ PBI เห็นงบ PBI');
select pg_temp.as_user(8); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = '', 'ผู้คุมงบที่ไม่ได้กำหนดบริษัทไม่เห็นงบเลย');
select pg_temp.as_user(1); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = 'b1', 'Admin เห็นทุกบริษัท');
select pg_temp.as_user(7); select pg_temp.expect_fail($$select public.v2_load()$$, 'บัญชีที่ปิดใช้งานโหลดไม่ได้', 'ไม่มีสิทธิ์');

-- แก้ไขงบ: ผู้คุมงบ PBI แก้ได้ · PCC แก้ไม่ได้ · business คนอื่นแก้ไม่ได้ · เวอร์ชันเก่า = CONFLICT
select pg_temp.as_user(3);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b1","version":1,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"HACK"}}]')$$, 'ผู้คุมงบ PCC แก้งบ PBI ไม่ได้', 'ไม่มีสิทธิ์');
select pg_temp.as_user(6);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b1","version":1,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"HACK"}}]')$$, 'business คนอื่นแย่งความเป็นเจ้าของงบไม่ได้', 'ไม่มีสิทธิ์');
select pg_temp.as_user(2);
select public.v2_save_docs('[{"kind":"budget","id":"b1","version":1,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"A","by":"ctrl"}}]');
select pg_temp.as_user(5);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b1","version":1,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"A","by":"stale"}}]')$$, 'บันทึกทับด้วยเวอร์ชันเก่า = CONFLICT', 'CONFLICT');
reset role;
select pg_temp.ok((select data ->> 'by' from public.v2_docs where id = 'b1') = 'ctrl', 'ข้อมูลไม่ถูกเขียนทับเมื่อ CONFLICT');
set role authenticated;

-- ---------------------------------------------------------------- คำขอเบิก + ออกเลขที่
select pg_temp.as_user(5);
do $$ declare r jsonb; begin
  r := public.v2_save_docs(
    '[{"kind":"request","id":"r1","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","no":"@@NO:REQ-2026:aaaa1111@@","memoNo":"@@NO:REQ-2026:aaaa1111@@"}},
      {"kind":"request","id":"r2","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","no":"@@NO:REQ-2026:bbbb2222@@"}}]',
    '[{"action":"สร้างคำขอ","ref":"@@NO:REQ-2026:aaaa1111@@","detail":"เลขที่ @@NO:REQ-2026:aaaa1111@@"}]');
  perform pg_temp.ok(r -> 'tokens' ->> '@@NO:REQ-2026:aaaa1111@@' = 'REQ-2026-0001' and r -> 'tokens' ->> '@@NO:REQ-2026:bbbb2222@@' = 'REQ-2026-0002', 'ออกเลขตามลำดับ ไม่ซ้ำ');
  perform pg_temp.ok(r -> 'log' -> 0 ->> 'ref' = 'REQ-2026-0001' and r -> 'log' -> 0 ->> 'detail' = 'เลขที่ REQ-2026-0001', 'แทนที่ token ใน Log ด้วย');
end $$;
reset role;
select pg_temp.ok((select data ->> 'memoNo' from public.v2_docs where id = 'r1') = 'REQ-2026-0001' and (select data ->> 'no' from public.v2_docs where id = 'r1') = 'REQ-2026-0001', 'เลขในเอกสารถูกแทนที่แล้ว');
select pg_temp.ok((select company from public.v2_docs where id = 'r1') = 'PBI' and (select owner_id from public.v2_docs where id = 'r1') = '00000000-0000-0000-0000-000000000005', 'บริษัท/เจ้าของของคำขอมาจากงบที่อ้างอิง');
set role authenticated;

-- ชุดที่ CONFLICT ไม่กินเลข และไม่บันทึกอะไรเลย (ทั้งชุด)
select pg_temp.as_user(5);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"r3","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","no":"@@NO:REQ-2026:cccc3333@@"}},{"kind":"request","id":"r1","version":99,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005"}}]')$$, 'ชุดที่มี CONFLICT ถูกปฏิเสธทั้งชุด', 'CONFLICT');
do $$ declare r jsonb; begin
  r := public.v2_save_docs('[{"kind":"request","id":"r3","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","no":"@@NO:REQ-2026:dddd4444@@"}}]');
  perform pg_temp.ok(r -> 'tokens' ->> '@@NO:REQ-2026:dddd4444@@' = 'REQ-2026-0003', 'เลขที่ไม่มีช่องว่างหลังชุดที่ล้มเหลว');
  r := public.v2_save_docs('[{"kind":"request","id":"r4","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","no":"@@NO:CAPEX-2026:eeee5555@@","x":"@@NO:REQ-2027:ffff6666@@"}}]');
  perform pg_temp.ok(r -> 'tokens' ->> '@@NO:CAPEX-2026:eeee5555@@' = 'CAPEX-2026-0001' and r -> 'tokens' ->> '@@NO:REQ-2027:ffff6666@@' = 'REQ-2027-0001', 'ตัวนับแยกตามคำนำหน้าและปี');
end $$;

-- ปลอมผู้ขอ / ข้ามบริษัท
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"r5","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000006"}}]')$$, 'business ปลอมผู้ขอเป็นคนอื่นไม่ได้', 'นอกขอบเขต');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"r6","version":0,"data":{"budgetId":"ไม่มีจริง","requesterId":"00000000-0000-0000-0000-000000000005"}}]')$$, 'อ้างงบที่ไม่มีอยู่ไม่ได้', 'ไม่พบงบ');
select pg_temp.as_user(3);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"r1","version":1,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","status":"HACK"}}]')$$, 'ผู้คุมงบ PCC แก้คำขอของงบ PBI ไม่ได้', 'ไม่มีสิทธิ์');

-- การมองเห็นคำขอ
select pg_temp.as_user(5); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') = 'r1,r2,r3,r4', 'ผู้ขอเห็นคำขอของตัวเอง');
select pg_temp.as_user(6); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') = '', 'business คนอื่นไม่เห็นคำขอ');
select pg_temp.as_user(2); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') = 'r1,r2,r3,r4', 'ผู้คุมงบ PBI เห็นทุกคำขอของบริษัท');
select pg_temp.as_user(3); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') = '', 'ผู้คุมงบ PCC ไม่เห็นคำขอ PBI');
-- จัดซื้อบันทึก PR/PO ที่คำขอได้ · ผู้คุมงบตัดสินใจได้
select pg_temp.as_user(4);
select public.v2_save_docs('[{"kind":"request","id":"r1","version":1,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","po":"PO-1"}}]');
select pg_temp.as_user(2);
select public.v2_save_docs('[{"kind":"request","id":"r1","version":2,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","po":"PO-1","status":"approved"}}]');

-- ---------------------------------------------------------------- คำขอเพิ่มงบ (change)
select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"change","id":"c1","version":0,"data":{"budgetId":"b1","no":"@@NO:INC-2026:gggg7777@@"}}]');
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'change') = 'c1', 'เจ้าของงบเห็นคำขอเพิ่มงบของงบตัวเอง');
select pg_temp.as_user(6); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'change') = '', 'business คนอื่นไม่เห็นคำขอเพิ่มงบ');
select pg_temp.as_user(3); select pg_temp.ok(pg_temp.ids(public.v2_load(), 'change') = '', 'ผู้คุมงบ PCC ไม่เห็นคำขอเพิ่มงบ PBI');

-- ---------------------------------------------------------------- ลบ + ซิงก์เพิ่มเติม (since)
select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"budget","id":"b9","version":0,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"ลบ"}}]');
do $$ declare t timestamptz; ld jsonb; begin
  t := (public.v2_load() ->> 'now')::timestamptz;
  perform public.v2_save_docs('[{"kind":"budget","id":"b9","version":1,"deleted":true}]');
  ld := public.v2_load(t);
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(ld -> 'docs') x where x ->> 'id' = 'b9' and (x ->> 'deleted')::boolean), 'ซิงก์เพิ่มเติมได้เอกสารที่ถูกลบ (tombstone)');
  perform pg_temp.ok(not (ld ->> 'full')::boolean, 'โหลดเพิ่มเติมไม่ใช่การโหลดทั้งหมด');
  perform pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = 'b1', 'โหลดทั้งหมดไม่มีเอกสารที่ลบแล้ว');
end $$;
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"nope","version":1,"deleted":true}]')$$, 'ลบเอกสารที่ไม่มีอยู่ไม่ได้', 'CONFLICT');

-- ---------------------------------------------------------------- Log
select pg_temp.as_user(5);
do $$ declare lg jsonb; begin
  lg := public.v2_load() -> 'log';
  perform pg_temp.ok(jsonb_array_length(lg) >= 1 and (lg -> 0 ->> 'by') = '00000000-0000-0000-0000-000000000005', 'ผู้ใช้เห็น Log ของตัวเอง');
end $$;
select pg_temp.as_user(6); select pg_temp.ok(jsonb_array_length(public.v2_load() -> 'log') = 0, 'business คนอื่นไม่เห็น Log ของคนอื่น');
select pg_temp.as_user(1); select pg_temp.ok(jsonb_array_length(public.v2_load() -> 'log') >= 1, 'ผู้มีสิทธิ์ log.view เห็น Log ทั้งหมด');
select pg_temp.as_user(2);
do $$ begin
  perform public.v2_save_docs('[]', '[{"action":"ปลอมผู้ทำ","ref":"x","detail":"by ควรเป็นผู้ล็อกอิน","by":"00000000-0000-0000-0000-000000000001"}]');
end $$;
reset role;
select pg_temp.ok((select by_id::text from public.v2_log where action = 'ปลอมผู้ทำ') = '00000000-0000-0000-0000-000000000002', 'Log บันทึกผู้ทำเป็นผู้ล็อกอิน ไม่เชื่อค่าจากเบราว์เซอร์');
set role authenticated;

-- ---------------------------------------------------------------- ธุรการ (business.proxy) และบัญชี (gl.manage)
-- ธุรการตามหน่วยงาน: 09 ช่วยฝ่ายวิศวกรรม (งบของ Biz1) · 11 ช่วยฝ่ายขาย (งบของ Biz2) แม้บริษัทของงบจะเป็นคนละบริษัท · 12 ไม่มีหน่วยงาน
select pg_temp.as_user(6);
select public.v2_save_docs('[{"kind":"budget","id":"bZ","version":0,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"Z","state":"draft"}}]');
select public.v2_save_docs('[{"kind":"budget","id":"bY","version":0,"data":{"company":"PCC","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"Y","state":"active"}}]');
select pg_temp.as_user(9);
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') not like '%bZ%' and pg_temp.ids(public.v2_load(), 'budget') not like '%bY%', 'ธุรการฝ่ายวิศวกรรมไม่เห็นงบของฝ่ายขาย');
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') like '%b1%', 'ธุรการฝ่ายวิศวกรรมเห็นงบของหน่วยงานตัวเอง');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bZ","version":1,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"Z","by":"ast"}}]')$$, 'ธุรการแก้งบของหน่วยงานอื่นไม่ได้', 'ไม่มีสิทธิ์');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bZ2","version":0,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"Z2"}}]')$$, 'ธุรการสร้างงบไม่ได้', 'ธุรการสร้างงบไม่ได้');
select pg_temp.as_user(12);
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') = '', 'ธุรการที่ยังไม่ได้กำหนดหน่วยงานไม่เห็นงบใครเลย');
select pg_temp.as_user(11);
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') like '%bZ%' and pg_temp.ids(public.v2_load(), 'budget') like '%bY%' and pg_temp.ids(public.v2_load(), 'budget') not like '%b1%',
  'ธุรการฝ่ายขายเห็นงบของฝ่ายขายข้ามบริษัท (PBI และ PCC) ไม่เห็นงบฝ่ายวิศวกรรม');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bZ","version":1,"data":{"company":"PBI","department":"ฝ่ายขาย","ownerId":"00000000-0000-0000-0000-000000000006","code":"Z","by":"ast11","state":"draft"}}]')$$, 'ธุรการแก้งบที่ยังเป็นร่างไม่ได้ (ทำได้เฉพาะงบที่เปิดใช้แล้ว)', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select public.v2_save_docs('[{"kind":"request","id":"rY","version":0,"data":{"budgetId":"bY","requesterId":"00000000-0000-0000-0000-000000000006","proxyBy":"00000000-0000-0000-0000-000000000011"}}]');
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') like '%rY%', 'ธุรการทำคำขอเบิกแทนบนงบที่เปิดใช้แล้วของหน่วยงานตัวเอง (ข้ามบริษัท) ได้');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"rZ","version":0,"data":{"budgetId":"bZ","requesterId":"00000000-0000-0000-0000-000000000006"}}]')$$, 'ธุรการทำคำขอเบิกบนงบที่ยังไม่เปิดใช้ไม่ได้', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"rB1","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005"}}]')$$, 'ธุรการทำคำขอเบิกบนงบของหน่วยงานอื่นไม่ได้', 'ไม่มีสิทธิ์');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"b1","version":2,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"A","by":"ast11"}}]')$$, 'ธุรการแก้งบของหน่วยงานอื่นไม่ได้ (คนละหน่วยงาน)', 'ไม่มีสิทธิ์');
select pg_temp.as_user(9);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bP0","version":0,"data":{"company":"PBI","ownerId":"00000000-0000-0000-0000-000000000009","code":"P0"}}]')$$, 'ธุรการเป็นเจ้าของงบเองไม่ได้', 'ธุรการเป็นเจ้าของงบไม่ได้');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":0,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"draft"}}]')$$, 'ธุรการสร้างร่างงบให้ Business ไม่ได้', 'ธุรการสร้างงบไม่ได้');
select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":0,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"draft"}}]');
select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":1,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"review"}}]');
select pg_temp.as_user(9);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":2,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"active"}}]')$$, 'ธุรการเปิดใช้งบ (active) ไม่ได้', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":2,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"review","by":"ast"}}]')$$, 'ธุรการแก้งบที่ยังไม่เปิดใช้ไม่ได้', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"rBad","version":0,"data":{"budgetId":"bP1","requesterId":"00000000-0000-0000-0000-000000000005"}}]')$$, 'ธุรการทำคำขอเบิกบนงบที่ยังไม่เปิดใช้ไม่ได้', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select public.v2_save_docs('[{"kind":"request","id":"rP","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005","proxyBy":"00000000-0000-0000-0000-000000000009"}}]');
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') like '%rP%', 'ธุรการทำคำขอเบิกในนามเจ้าของงบได้');
select pg_temp.as_user(5);
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'request') like '%rP%', 'Business เจ้าของงบเห็นคำขอที่ธุรการทำแทน');
select pg_temp.as_user(2);
select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":2,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"pending_open"}}]');
select pg_temp.as_user(9);
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":3,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"open_review"}}]')$$, 'ธุรการส่ง Memo ขอเปิดใช้งบแทน Business ไม่ได้', 'เฉพาะงบที่เปิดใช้งานแล้ว');
select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":3,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"open_review"}}]');
select pg_temp.as_user(10);
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') like '%bP1%', 'บัญชี PBI เห็นงบของบริษัทตัวเอง');
select public.v2_save_docs('[{"kind":"budget","id":"bP1","version":4,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"P1","state":"open_review","gl":"510101"}}]');
select pg_temp.ok((select x -> 'data' ->> 'gl' from jsonb_array_elements(public.v2_load() -> 'docs') x where x ->> 'id' = 'bP1') = '510101', 'บัญชีบันทึก GL ในเอกสารงบได้');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"request","id":"rQ","version":0,"data":{"budgetId":"b1","requesterId":"00000000-0000-0000-0000-000000000005"}}]')$$, 'บัญชีสร้างคำขอเบิกไม่ได้', 'ไม่มีสิทธิ์บันทึกเอกสารชนิดนี้');

-- ---------------------------------------------------------------- หน่วยงานของงบ = หน่วยงานของเจ้าของงบ
reset role;
update public.v2_profiles set departments = array['ฝ่ายวิศวกรรม'], company = 'PBI' where id = '00000000-0000-0000-0000-000000000005';
update public.v2_profiles set departments = array['ฝ่ายผลิต', 'ฝ่าย IT'] where id = '00000000-0000-0000-0000-000000000009';
select pg_temp.ok((select department from public.v2_profiles where id = '00000000-0000-0000-0000-000000000005') = 'ฝ่ายวิศวกรรม', 'department = หน่วยงานแรกของ departments');
select pg_temp.ok((select departments from public.v2_profiles where id = '00000000-0000-0000-0000-000000000009') = array['ฝ่ายผลิต', 'ฝ่าย IT'], 'ธุรการมีได้หลายหน่วยงาน');
set role authenticated;
select pg_temp.as_user(5);
select public.v2_save_docs('[{"kind":"budget","id":"bD1","version":0,"data":{"company":"PCC","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"D1","state":"draft"}}]');
select pg_temp.ok(pg_temp.ids(public.v2_load(), 'budget') like '%bD1%', 'Business เลือกบริษัทอื่นได้ งบขึ้นเป็นหน่วยงานของตัวเอง');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bD2","version":0,"data":{"company":"PBI","department":"ฝ่ายการตลาด","ownerId":"00000000-0000-0000-0000-000000000005","code":"D2","state":"draft"}}]')$$, 'หน่วยงานของงบไม่ใช่ของเจ้าของงบ ไม่ได้', 'หน่วยงานของงบต้องเป็นหน่วยงานของเจ้าของงบ');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bD1","version":1,"data":{"company":"PCC","department":"ฝ่ายผลิต","ownerId":"00000000-0000-0000-0000-000000000005","code":"D1","state":"draft"}}]')$$, 'แก้งบเปลี่ยนเป็นหน่วยงานที่ไม่ใช่ของเจ้าของงบไม่ได้', 'หน่วยงานของงบต้องเป็นหน่วยงานของเจ้าของงบ');
select public.v2_save_docs('[{"kind":"budget","id":"bD1","version":1,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"D1","state":"draft"}}]');
select pg_temp.ok(true, 'เปลี่ยนบริษัทของงบได้ หน่วยงานคงเดิม');
select pg_temp.as_user(2);
select public.v2_save_docs('[{"kind":"budget","id":"bD3","version":0,"data":{"company":"PBI","department":"ฝ่ายวิศวกรรม","ownerId":"00000000-0000-0000-0000-000000000005","code":"D3","state":"pending_open","setup":true}}]');
select pg_temp.ok(true, 'ผู้คุมงบลงงบให้ Business ด้วยหน่วยงานของเจ้าของงบได้');
select pg_temp.expect_fail($$select public.v2_save_docs('[{"kind":"budget","id":"bD4","version":0,"data":{"company":"PBI","department":"ฝ่ายผลิต","ownerId":"00000000-0000-0000-0000-000000000005","code":"D4","state":"pending_open","setup":true}}]')$$, 'ผู้คุมงบลงงบด้วยหน่วยงานที่ไม่ใช่ของเจ้าของงบไม่ได้', 'หน่วยงานของงบต้องเป็นหน่วยงานของเจ้าของงบ');

-- ---------------------------------------------------------------- เรียกตรงๆ ไม่ได้
select pg_temp.as_user(5);
select pg_temp.expect_fail($$select * from public.v2_docs$$, 'อ่านตารางเอกสารตรงๆ ไม่ได้');
select pg_temp.expect_fail($$update public.v2_docs set data = '{}'$$, 'แก้ตารางเอกสารตรงๆ ไม่ได้');
select pg_temp.expect_fail($$select * from public.v2_counters$$, 'อ่านตัวนับตรงๆ ไม่ได้');
select pg_temp.expect_fail($$select * from public.v2_log$$, 'อ่าน Log ตรงๆ ไม่ได้');
select pg_temp.expect_fail($$select public._v2_can_write('admin', 'budget')$$, 'เรียกฟังก์ชันภายในไม่ได้');
reset role; set role anon;
select pg_temp.expect_fail($$select public.v2_load()$$, 'anon โหลดไม่ได้');
select pg_temp.expect_fail($$select public.v2_save_docs('[]')$$, 'anon บันทึกไม่ได้');
reset role;
\echo ALL V2B TESTS PASSED

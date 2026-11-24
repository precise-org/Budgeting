-- ทดสอบ schema_v2.sql กับ Postgres ในเครื่อง (ต้องรัน shim.sql ก่อน) — ล้มเหลวเมื่อมี exception หลุด
--   psql -v ON_ERROR_STOP=1 -d sp -f shim.sql -f ../schema_v2.sql -f v2_test.sql
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'ctrl@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'biz@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'admin2@example.com');
insert into public.v2_profiles (id, email, name, role, companies) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com', 'Admin', 'admin', '{}'),
  ('00000000-0000-0000-0000-000000000002', 'ctrl@example.com', 'Ctrl', 'controller', '{PBI}'),
  ('00000000-0000-0000-0000-000000000003', 'biz@example.com', 'Biz', 'business', '{}');
grant usage on schema public to anon, authenticated;

create or replace function pg_temp.expect_fail_msg(sql text, label text, frag text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm not like '%' || frag || '%' then raise exception 'FAIL: % ปฏิเสธด้วยเหตุผลอื่น: %', label, sqlerrm; end if;
    raise notice 'PASS: % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL: % ควรถูกปฏิเสธ', label;
end $$;
grant execute on function pg_temp.expect_fail_msg(text, text, text) to public;

create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'PASS: % (%)', label, sqlerrm; return; end;
  raise exception 'FAIL: % ควรถูกปฏิเสธ', label;
end $$;
grant execute on function pg_temp.expect_fail(text, text) to public;

-- ผู้ใช้ทั่วไปเรียกตารางตรงๆ ไม่ได้
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.expect_fail($$select * from public.v2_profiles$$, 'อ่านตารางตรงไม่ได้');
select pg_temp.expect_fail($$select public._v2_need('user.manage')$$, 'เรียกฟังก์ชันภายในไม่ได้');
select pg_temp.expect_fail($$select public.v2_list_users()$$, 'business ดูรายชื่อ Admin ไม่ได้');
select pg_temp.expect_fail($$select public.v2_save_role('x1', 'X', '', '{}')$$, 'business สร้างบทบาทไม่ได้');

-- directory: ใช้ได้ทุกคนที่ล็อกอิน และไม่มีอีเมล
do $$ declare d jsonb; begin
  d := public.v2_directory();
  if jsonb_array_length(d) <> 3 then raise exception 'FAIL directory count %', d; end if;
  if d::text like '%@example.com%' then raise exception 'FAIL directory ไม่ควรมีอีเมล'; end if;
  raise notice 'PASS: directory';
end $$;

-- ผู้ใช้ที่ไม่มี profile
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select pg_temp.expect_fail($$select public.v2_directory()$$, 'ไม่มี profile เข้าไม่ได้');
do $$ begin if public.v2_me() is not null then raise exception 'FAIL v2_me ควรเป็น null'; end if; raise notice 'PASS: v2_me null เมื่อไม่มี profile'; end $$;

-- anon ขอรีเซ็ตได้ เรียกอย่างอื่นไม่ได้
reset role; set role anon;
select public.v2_request_reset(' CTRL@example.com ');
select public.v2_request_reset('nobody@example.com');
select pg_temp.expect_fail($$select public.v2_directory()$$, 'anon ดู directory ไม่ได้');

reset role;
do $$ begin
  if (select reset_requested_at from public.v2_profiles where email = 'ctrl@example.com') is null then raise exception 'FAIL reset_requested_at'; end if;
  raise notice 'PASS: ขอรีเซ็ตรหัสผ่านบันทึกแล้ว';
end $$;

-- ผู้คุมงบ login → ล้างคำขอรีเซ็ต + สิทธิ์
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ declare m jsonb; begin
  m := public.v2_me(true);
  if m ->> 'role' <> 'controller' or not (m -> 'permissions') ? 'budget.verify' or (m -> 'permissions') ? 'user.manage' then raise exception 'FAIL perms %', m; end if;
  if m ->> 'resetRequestedAt' is not null then raise exception 'FAIL ควรล้างคำขอรีเซ็ต'; end if;
  raise notice 'PASS: v2_me(login)';
end $$;

-- Admin จัดการผู้ใช้/บทบาท
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ declare u jsonb; r jsonb; begin
  if jsonb_array_length(public.v2_list_users()) <> 3 then raise exception 'FAIL list_users'; end if;
  u := public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz 2', 'วิศวกร', 'IT', 'PBI', '{PBI,PCC}', 'controller');
  if u ->> 'role' <> 'controller' or jsonb_array_length(u -> 'companies') <> 2 then raise exception 'FAIL update_user %', u; end if;
  raise notice 'PASS: Admin แก้ผู้ใช้';
  r := public.v2_save_role('auditor', 'ผู้ตรวจสอบ', 'อ่านอย่างเดียว', array['budget.view_all', 'not.real']);
  if jsonb_array_length(r -> 'permissions') <> 1 then raise exception 'FAIL save_role ต้องตัดสิทธิ์ที่ไม่มีในระบบ %', r; end if;
  raise notice 'PASS: สร้างบทบาท';
end $$;
select pg_temp.expect_fail($$select public.v2_save_role('Bad Key', 'x', '', '{}')$$, 'รหัสบทบาทผิดรูปแบบ');
select pg_temp.expect_fail($$select public.v2_save_role('admin', 'Admin', '', array['budget.view_all'])$$, 'admin ต้องมี user.manage');
select pg_temp.expect_fail($$select public.v2_update_user('00000000-0000-0000-0000-000000000001', 'Admin', '', '', '', '{}', 'business')$$, 'ลดสิทธิ์ Admin คนสุดท้ายไม่ได้');
select pg_temp.expect_fail($$select public.v2_delete_role('admin')$$, 'ลบบทบาทตั้งต้นไม่ได้');
select pg_temp.expect_fail($$select public.v2_update_user('00000000-0000-0000-0000-000000000003', '', '', '', '', '{}', 'business')$$, 'ชื่อว่างไม่ได้');
do $$ begin
  perform public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz 2', '', '', 'PBI', '{PBI}', 'auditor');
  begin perform public.v2_delete_role('auditor'); raise exception 'FAIL ลบบทบาทที่ยังมีผู้ใช้'; exception when others then
    if sqlerrm like 'FAIL%' then raise; end if; raise notice 'PASS: ลบบทบาทที่มีผู้ใช้ไม่ได้'; end;
  perform public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz 2', '', '', 'PBI', '{PBI}', 'business');
  perform public.v2_delete_role('auditor');
  raise notice 'PASS: ลบบทบาทที่สร้างเพิ่ม';
end $$;

-- ธุรการแท็กตามชื่อ Business: Admin ตั้ง proxy_for (กรอง id ที่ไม่มี/ตัวเองออก) · เวอร์ชัน 7 พารามิเตอร์ไม่ล้างค่าเดิม · แถวตัวเองใน directory มี proxyFor แถวอื่นไม่มี
do $$ declare u jsonb; d jsonb; begin
  u := public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz 2', '', '', 'PBI', '{PBI}', array['business'],
    array['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000003']);
  if u -> 'proxyFor' <> '["00000000-0000-0000-0000-000000000002"]'::jsonb then raise exception 'FAIL proxy_for ต้องกรอง id ที่ไม่มี/ตัวเอง %', u -> 'proxyFor'; end if;
  u := public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz 2', '', '', 'PBI', '{PBI}', array['business']);
  if u -> 'proxyFor' <> '["00000000-0000-0000-0000-000000000002"]'::jsonb then raise exception 'FAIL เวอร์ชัน 7 พารามิเตอร์ต้องคง proxy_for เดิม %', u -> 'proxyFor'; end if;
  raise notice 'PASS: Admin ตั้ง proxy_for (กรองค่าไม่ถูกต้อง) และการแก้โดยไม่ส่ง proxy_for ไม่ล้างค่า';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ declare d jsonb; me_row jsonb; other_row jsonb; begin
  d := public.v2_directory();
  select x into me_row from jsonb_array_elements(d) x where x ->> 'id' = '00000000-0000-0000-0000-000000000003';
  select x into other_row from jsonb_array_elements(d) x where x ->> 'id' = '00000000-0000-0000-0000-000000000002';
  if not (me_row ? 'proxyFor') or (other_row ? 'proxyFor') then raise exception 'FAIL directory: proxyFor เฉพาะแถวตัวเอง'; end if;
  raise notice 'PASS: directory ให้ proxyFor เฉพาะแถวของตัวเอง';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

-- มี Admin ที่สอง → ลดสิทธิ์คนแรกได้
reset role;
insert into public.v2_profiles (id, email, name, role) values ('00000000-0000-0000-0000-000000000004', 'admin2@example.com', 'Admin2', 'admin');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ begin
  perform public.v2_update_user('00000000-0000-0000-0000-000000000001', 'Admin', '', '', '', '{}', 'business');
  raise notice 'PASS: ลดสิทธิ์ได้เมื่อมี Admin อื่น';
end $$;
select pg_temp.expect_fail($$select public.v2_list_users()$$, 'หลังลดสิทธิ์ ดูรายชื่อไม่ได้');

-- ผู้ใช้ที่ถูกปิดใช้งานเข้าไม่ได้
reset role;
update public.v2_profiles set active = false where email = 'admin2@example.com';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select pg_temp.expect_fail($$select public.v2_list_users()$$, 'บัญชีที่ปิดใช้งานเข้าไม่ได้');

reset role;

-- ---------------------------------------------------------------- เปิดใช้ครั้งแรก (v2_activation_status)
reset role;
create or replace function pg_temp.ok(c boolean, label text) returns void language plpgsql as $$
begin if not c then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
grant execute on function pg_temp.ok(boolean, text) to public;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000009', 'newbie@example.com');
insert into public.v2_profiles (id, email, name, role) values ('00000000-0000-0000-0000-000000000009', 'newbie@example.com', 'Newbie', 'business');
select pg_temp.ok((select password_set_at from public.v2_profiles where email = 'newbie@example.com') is null, 'บัญชีที่ Admin เพิ่มใหม่ยังไม่มี password_set_at');
set role anon;
select pg_temp.ok(public.v2_activation_status(' NEWBIE@example.com ') = 'ready', 'อีเมลที่ Admin เพิ่ม ยังไม่เคยตั้งรหัสผ่าน = ready (ไม่สนตัวพิมพ์/ช่องว่าง)');
select pg_temp.ok(public.v2_activation_status('nobody@example.com') = 'not_found', 'อีเมลที่ไม่มี = not_found');
select pg_temp.ok(public.v2_activation_status('admin2@example.com') = 'inactive', 'บัญชีที่ปิดใช้งาน = inactive');
select pg_temp.ok(public.v2_activation_status('ctrl@example.com') = 'has_password', 'บัญชีที่เคยล็อกอิน (backfill/ล็อกอินแล้ว) = has_password');
select pg_temp.ok(public.v2_activation_status(null) = 'not_found', 'อีเมลว่าง = not_found');
select pg_temp.expect_fail($$select * from public.v2_profiles$$, 'anon อ่านโปรไฟล์ตรงๆ ไม่ได้');
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
select public.v2_me(true);
reset role; set role anon;
select pg_temp.ok(public.v2_activation_status('newbie@example.com') = 'has_password', 'ล็อกอินสำเร็จแล้ว (v2_me login) = has_password');
reset role;
-- Admin รีเซ็ต (Edge Function ตั้ง password_set_at = null) → กลับมา ready
update public.v2_profiles set password_set_at = null where email = 'newbie@example.com';
set role anon;
select pg_temp.ok(public.v2_activation_status('newbie@example.com') = 'ready', 'หลัง Admin รีเซ็ต = ready อีกครั้ง');
reset role;

-- ================================================================ เฟส 2: ข้อมูลหลัก
-- (ผู้ใช้ 1 = admin มี master.manage · 2 = controller · 3 = business มี request.create · 4 ไม่มี profile)
reset role;
update public.v2_profiles set role = 'admin', active = true where id = '00000000-0000-0000-0000-000000000001';
update public.v2_profiles set role = 'controller', active = true where id = '00000000-0000-0000-0000-000000000002';
update public.v2_profiles set role = 'business', active = true where id = '00000000-0000-0000-0000-000000000003';
delete from public.v2_profiles where id = '00000000-0000-0000-0000-000000000004';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
select pg_temp.expect_fail($$select public.v2_master_get()$$, 'ไม่มี profile อ่านข้อมูลหลักไม่ได้');
select pg_temp.expect_fail($$select public.v2_master_add_supplier('X')$$, 'ไม่มี profile เพิ่ม Supplier ไม่ได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.expect_fail($$select * from public.v2_master$$, 'อ่านตาราง v2_master ตรงๆ ไม่ได้');
select pg_temp.expect_fail($$select * from public.v2_master_history$$, 'อ่านประวัติข้อมูลหลักตรงๆ ไม่ได้');
select pg_temp.expect_fail($$insert into public.v2_master (key, items) values ('companies', '[]')$$, 'เขียนตารางตรงๆ ไม่ได้');
select pg_temp.expect_fail($$select public._v2_master_check('companies', '[]')$$, 'เรียกตัวตรวจภายในไม่ได้');
select pg_temp.expect_fail($$select public.v2_master_save('companies', '[{"code":"PBI","name":"x"}]')$$, 'business บันทึกข้อมูลหลักไม่ได้');
select pg_temp.expect_fail($$select public.v2_master_save('suppliers', '[{"name":"x"}]')$$, 'business แก้ Supplier ทั้งรายการไม่ได้');
select pg_temp.ok(public.v2_master_get() = '{}'::jsonb, 'ยังไม่มีข้อมูล = ว่าง (หน้าเว็บใช้ค่าตั้งต้น)');

-- admin บันทึก
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.expect_fail_msg($$select public.v2_master_save('bogus', '[]')$$, 'key ที่ไม่รู้จัก', 'ไม่รู้จัก');
select pg_temp.expect_fail_msg($$select public.v2_master_save('companies', '{"a":1}')$$, 'ต้องเป็นอาร์เรย์', 'รูปแบบข้อมูล');
select pg_temp.expect_fail_msg($$select public.v2_master_save('companies', '["x"]')$$, 'สมาชิกต้องเป็น object', 'รูปแบบข้อมูล');
select pg_temp.expect_fail_msg($$select public.v2_master_save('companies', '[{"code":1}]')$$, 'ค่าต้องเป็นข้อความ', 'ต้องเป็นข้อความ');
select pg_temp.expect_fail_msg($$select public.v2_master_save('departments', jsonb_build_array(jsonb_build_object('name', repeat('ก', 301))))$$, 'ข้อความยาวเกิน 300', 'ยาวเกินไป');
select pg_temp.expect_fail_msg($$select public.v2_master_save('departments', (select jsonb_agg(jsonb_build_object('name', i::text)) from generate_series(1, 2001) i))$$, 'เกิน 2,000 รายการ', 'มากเกินไป');
select pg_temp.ok(public.v2_master_get() = '{}'::jsonb, 'บันทึกที่ผิดรูปแบบไม่เขียนอะไรลงฐาน');
do $$ declare r jsonb; g jsonb; begin
  r := public.v2_master_save('companies', '[{"code":"PBI","name":"พรีไซซ"},{"code":"PCC","name":"คอร์ป","logo":"data:image/png;base64,AAAA"}]');
  if jsonb_array_length(r->'items') <> 2 or r->>'updatedAt' is null then raise exception 'FAIL save companies %', r; end if;
  g := public.v2_master_get();
  if (g->'companies'->'items'->1->>'logo') is null then raise exception 'FAIL logo หาย'; end if;
  raise notice 'PASS: admin บันทึกบริษัท (รวมโลโก้)';
end $$;
-- ทุกคนที่ล็อกอินอ่านได้
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.ok(jsonb_array_length(public.v2_master_get()->'companies'->'items') = 2, 'business อ่านข้อมูลหลักที่ Admin บันทึกได้');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.ok(jsonb_array_length(public.v2_master_get()->'companies'->'items') = 2, 'controller อ่านข้อมูลหลักได้');

-- ล็อกกันทับกัน (optimistic): ต้องส่ง updatedAt เดิม
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ declare t1 timestamptz; r jsonb; t2 timestamptz; begin
  t1 := (public.v2_master_get()->'companies'->>'updatedAt')::timestamptz;
  r := public.v2_master_save('companies', '[{"code":"PBI","name":"พรีไซซ 2"}]', t1);
  t2 := (r->>'updatedAt')::timestamptz;
  if t2 <= t1 then raise exception 'FAIL updatedAt ต้องเพิ่มขึ้น'; end if;
  begin
    perform public.v2_master_save('companies', '[{"code":"PBI","name":"ทับ"}]', t1);
    raise exception 'FAIL ควรปฏิเสธเมื่อ updatedAt เก่า';
  exception when sqlstate '40001' then raise notice 'PASS: แก้ทับของคนอื่นไม่ได้ (updatedAt เก่า)'; end;
  if (public.v2_master_get()->'companies'->'items'->0->>'name') <> 'พรีไซซ 2' then raise exception 'FAIL ค่าถูกทับ'; end if;
  begin
    perform public.v2_master_save('departments', '[{"name":"A"}]', now());
    raise exception 'FAIL ควรปฏิเสธเมื่อคาดว่ามีแถวแต่ไม่มี';
  exception when sqlstate '40001' then raise notice 'PASS: คาดว่ามีแถวแต่ไม่มี = ปฏิเสธ'; end;
  perform public.v2_master_save('departments', '[{"name":"A"}]');  -- ไม่ส่ง expected = บันทึกค่าตั้งต้นครั้งแรก
  raise notice 'PASS: บันทึกครั้งแรกไม่ต้องส่ง expected';
end $$;
reset role;
select pg_temp.ok((select count(*) from public.v2_master_history where key = 'companies') = 2, 'มีประวัติทุกครั้งที่บันทึก');
set role authenticated;

-- เพิ่ม Supplier: business ทำได้ (เพิ่มอย่างเดียว) ชื่อซ้ำไม่เพิ่ม
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ declare r jsonb; begin
  r := public.v2_master_add_supplier('  ร้าน  เอ  ');
  if r->'items'->0->>'name' <> 'ร้าน เอ' then raise exception 'FAIL ต้องจัดช่องว่าง %', r; end if;
  r := public.v2_master_add_supplier('ร้าน เอ');
  r := public.v2_master_add_supplier('ร้าน เอ');
  if jsonb_array_length(r->'items') <> 1 then raise exception 'FAIL ชื่อซ้ำไม่ควรเพิ่ม %', r; end if;
  r := public.v2_master_add_supplier('ร้าน บี');
  if jsonb_array_length(r->'items') <> 2 then raise exception 'FAIL เพิ่มชื่อใหม่ %', r; end if;
  raise notice 'PASS: business เพิ่ม Supplier ใหม่ได้ ชื่อซ้ำไม่เพิ่ม';
end $$;
select pg_temp.expect_fail_msg($$select public.v2_master_add_supplier('   ')$$, 'ชื่อว่าง', 'ระบุชื่อ');
select pg_temp.expect_fail_msg($$select public.v2_master_add_supplier(repeat('ก', 201))$$, 'ชื่อยาวเกิน', 'ยาวเกินไป');
-- controller ไม่มี request.create / master.manage → เพิ่ม Supplier ไม่ได้ (ผู้คุมงบไม่ได้ขอเบิกเอง)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.expect_fail($$select public.v2_master_add_supplier('ร้าน ซี')$$, 'controller เพิ่ม Supplier ไม่ได้');
-- admin แก้รายการ Supplier ทั้งชุดได้ และ Supplier ที่ business เพิ่มยังอยู่ก่อนหน้า
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.ok(jsonb_array_length(public.v2_master_get()->'suppliers'->'items') = 2, 'Admin เห็น Supplier ที่ business เพิ่ม');
-- ผู้ใช้ที่ถูกปิดการใช้งาน
reset role;
update public.v2_profiles set active = false where id = '00000000-0000-0000-0000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.expect_fail($$select public.v2_master_get()$$, 'บัญชีที่ปิดแล้วอ่านข้อมูลหลักไม่ได้');
select pg_temp.expect_fail($$select public.v2_master_add_supplier('Z')$$, 'บัญชีที่ปิดแล้วเพิ่ม Supplier ไม่ได้');
reset role;
update public.v2_profiles set active = true where id = '00000000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------------- 1 ผู้ใช้หลายบทบาท
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.v2_save_role('auditor', 'ผู้ตรวจสอบ', '', array['budget.view_all', 'log.view']);
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', '', '{PBI}', array['business', 'auditor'])->'roles') = '["business", "auditor"]'::jsonb, 'ตั้งหลายบทบาทได้ (คงลำดับ)');
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', '', '{PBI}', array['business', 'auditor', 'business'])->'roles') = '["business", "auditor"]'::jsonb, 'บทบาทซ้ำถูกตัดออก');
select pg_temp.ok((select role from public.v2_profiles where id = '00000000-0000-0000-0000-000000000003') = 'business', 'role = บทบาทหลัก (roles[1])');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.ok((public.v2_me() -> 'permissions') @> '["budget.create", "request.create", "budget.view_all", "log.view"]'::jsonb, 'สิทธิ์ = รวมของทุกบทบาท');
select pg_temp.ok(not ((public.v2_me() -> 'permissions') @> '["user.manage"]'::jsonb), 'ไม่ได้สิทธิ์ของบทบาทที่ไม่มี');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.expect_fail($$select public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', '', '{}', '{}'::text[])$$, 'ต้องมีอย่างน้อย 1 บทบาท');
select pg_temp.expect_fail($$select public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', '', '{}', array['business', 'nope'])$$, 'บทบาทที่ไม่มีอยู่ถูกปฏิเสธ');
select pg_temp.expect_fail($$select public.v2_delete_role('auditor')$$, 'ลบบทบาทที่ผู้ใช้มีเป็นบทบาทเสริมไม่ได้');
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', '', '{PBI}', 'business')->'roles') = '["business"]'::jsonb, 'เรียกแบบเดิม (บทบาทเดียว) ยังใช้ได้');
select public.v2_delete_role('auditor');
-- Admin คนสุดท้าย: admin เป็นบทบาทเสริมก็นับ
select public.v2_save_role('mgr', 'ผู้จัดการ', '', array['user.manage']);
select public.v2_update_user('00000000-0000-0000-0000-000000000002', 'Ctrl', '', '', '', '{PBI}', array['controller', 'mgr']);
select pg_temp.ok(public._v2_managers(null) = 2, 'ผู้จัดการผู้ใช้ผ่านบทบาทเสริมถูกนับ');
select pg_temp.expect_fail($$select public.v2_save_role('admin', 'Admin', '', array['budget.view_all'])$$, 'admin ต้องมี user.manage (หลายบทบาท)');
select public.v2_update_user('00000000-0000-0000-0000-000000000002', 'Ctrl', '', '', '', '{PBI}', array['controller']);
select public.v2_delete_role('mgr');
select pg_temp.ok((select roles from public.v2_profiles where id = '00000000-0000-0000-0000-000000000001') = array['admin'], 'ข้อมูลเดิมถูกย้ายเป็น roles');
reset role;
update public.v2_profiles set role = 'controller' where id = '00000000-0000-0000-0000-000000000003';
select pg_temp.ok((select roles from public.v2_profiles where id = '00000000-0000-0000-0000-000000000003') = array['controller'], 'แก้คอลัมน์ role ตรงๆ ซิงก์เข้า roles');
update public.v2_profiles set role = 'business' where id = '00000000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------------- หน่วยงานของผู้ใช้ (Business 1 · ธุรการได้หลาย)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', 'PBI', '{}', array['business'], '{}', array['ฝ่ายวิศวกรรม'])->'departments') = '["ฝ่ายวิศวกรรม"]'::jsonb, 'ตั้งหน่วยงานของ Business ได้');
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', 'PBI', '{}', array['business'], '{}', array['ฝ่ายผลิต', ' ฝ่าย IT ', 'ฝ่ายผลิต', ''])->'departments') = '["ฝ่ายผลิต", "ฝ่าย IT"]'::jsonb, 'หลายหน่วยงาน: ตัดช่องว่าง/ซ้ำ/ว่าง คงลำดับ');
select pg_temp.ok((select x ->> 'department' from jsonb_array_elements(public.v2_list_users()) x where x ->> 'id' = '00000000-0000-0000-0000-000000000003') = 'ฝ่ายผลิต', 'department = หน่วยงานแรก');
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', 'ฝ่ายบัญชี', 'PBI', '{}', array['business'], '{}')->'departments') = '["ฝ่ายบัญชี"]'::jsonb, 'เรียกแบบเดิม (หน่วยงานเดียว) ยังใช้ได้');
select pg_temp.ok((public.v2_update_user('00000000-0000-0000-0000-000000000003', 'Biz', '', '', 'PBI', '{}', array['business'], '{}', '{}'::text[])->'departments') = '[]'::jsonb, 'ล้างหน่วยงานได้');
reset role;
update public.v2_profiles set department = 'ฝ่าย IT' where id = '00000000-0000-0000-0000-000000000003';
select pg_temp.ok((select departments from public.v2_profiles where id = '00000000-0000-0000-0000-000000000003') = array['ฝ่าย IT'], 'แก้คอลัมน์ department ตรงๆ ซิงก์เข้า departments');
update public.v2_profiles set department = '' where id = '00000000-0000-0000-0000-000000000003';
\echo ALL V2 TESTS PASSED

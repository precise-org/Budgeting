-- schema_v2_all.sql = schema_v2.sql + schema_v2b.sql รวมเป็นไฟล์เดียว (สร้างด้วย build_schema_all.sh — อย่าแก้ไฟล์นี้ตรงๆ)
-- วางทั้งไฟล์ใน Supabase → SQL Editor → New query → Run · รันซ้ำได้ ไม่ลบข้อมูล

-- ระบบขอเบิกใช้งบประมาณ (ต้นแบบรอบใหม่) — 1 ผู้ใช้หลายบทบาท (v2_profiles.roles) · เฟส 1: ล็อกอินและบัญชีผู้ใช้ · เฟส 2: ข้อมูลหลัก
-- ตารางทั้งหมดขึ้นต้นด้วย v2_ ไม่แตะตารางของระบบรอบแรก (profiles / app_*)
-- รันซ้ำได้ ไม่ลบข้อมูล · วางทั้งไฟล์ใน Supabase → SQL Editor → Run
--
-- หลักความปลอดภัย
--   * ตารางเปิด RLS และ "ไม่มี policy" = เบราว์เซอร์อ่าน/เขียนตารางตรงๆ ไม่ได้เลย ทุกอย่างผ่านฟังก์ชัน v2_* ที่ตรวจสิทธิ์ที่ฝั่งฐานข้อมูล
--   * การสร้างบัญชี / ลิงก์ตั้งรหัสผ่าน / ปิดบัญชี ทำผ่าน Edge Function (supabase/functions/v2-admin-users) ซึ่งถือ service_role ฝั่งเซิร์ฟเวอร์เท่านั้น

-- ---------------------------------------------------------------- ตาราง

create table if not exists public.v2_roles (
  key          text primary key,
  name         text not null,
  description  text not null default '',
  permissions  text[] not null default '{}',
  is_system    boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.v2_profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                text not null,
  name                 text not null default '',
  title                text not null default '',
  department           text not null default '',
  company              text not null default '',
  companies            text[] not null default '{}',   -- บริษัทที่ดูงบ/งานได้ (ผู้คุมงบ / จัดซื้อ) · Admin เห็นทุกบริษัทเสมอ
  role                 text not null references public.v2_roles (key) on update cascade,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  last_login_at        timestamptz,
  reset_requested_at   timestamptz,                    -- ผู้ใช้กด "ลืมรหัสผ่าน"
  reset_at             timestamptz                     -- Admin รีเซ็ตรหัสผ่านล่าสุด
);
create unique index if not exists v2_profiles_email_key on public.v2_profiles (lower(email));

-- เพิ่มทีหลัง (รอบ "เปิดใช้ครั้งแรก"): เวลาที่ผู้ใช้ตั้งรหัสผ่านของตัวเอง · null = ยังไม่เคยตั้ง / ถูก Admin รีเซ็ตแล้ว รอตั้งใหม่
alter table public.v2_profiles add column if not exists password_set_at timestamptz;
update public.v2_profiles set password_set_at = last_login_at where password_set_at is null and last_login_at is not null;

-- หลายบทบาทต่อผู้ใช้: roles = บทบาททั้งหมด (สิทธิ์ = รวมทุกบทบาท) · role = บทบาทหลัก (roles[1]) เก็บไว้ให้โค้ดเดิม/Edge Function เก่าใช้ต่อได้
alter table public.v2_profiles add column if not exists roles text[] not null default '{}';
-- ธุรการ (สิทธิ์ business.proxy): รายการ id ของ Business ที่ช่วยงานให้ — เห็น/ทำแทนได้เฉพาะงบของคนในรายการ (Admin ตั้งให้ · ธุรการแก้เองไม่ได้) · ว่าง = เห็นและทำแทนได้ทั้งบริษัทไปก่อน
alter table public.v2_profiles add column if not exists proxy_for text[] not null default '{}';
update public.v2_profiles set roles = array[role] where cardinality(roles) = 0 and role is not null;
-- หน่วยงานของผู้ใช้: Business มี 1 หน่วยงาน (งบขึ้นเป็นหน่วยงานของเจ้าของงบ) · ธุรการที่ Admin ตั้งให้มีได้หลายหน่วยงาน · department = หน่วยงานแรก (เก็บไว้ให้โค้ด/Edge Function เก่าใช้ต่อได้)
alter table public.v2_profiles add column if not exists departments text[] not null default '{}';
update public.v2_profiles set departments = array[department] where cardinality(departments) = 0 and btrim(department) <> '';

create or replace function public._v2_sync_roles() returns trigger
language plpgsql set search_path = public as $$
begin
  if cardinality(coalesce(new.roles, '{}')) = 0 then
    new.roles := case when new.role is null then '{}'::text[] else array[new.role] end;   -- ผู้เรียกแบบเก่าส่งแต่ role
  elsif tg_op = 'INSERT' or new.roles is distinct from old.roles then
    new.role := new.roles[1];
  elsif new.role is distinct from old.role then
    new.roles := array[new.role];                                                         -- แก้คอลัมน์ role ตรงๆ ใน SQL Editor = บทบาทเดียว
  end if;
  return new;
end $$;
create or replace function public._v2_sync_departments() returns trigger
language plpgsql set search_path = public as $$
begin
  if cardinality(coalesce(new.departments, '{}')) = 0 then
    new.departments := case when btrim(coalesce(new.department, '')) = '' then '{}'::text[] else array[btrim(new.department)] end;   -- ผู้เรียกแบบเก่าส่งแต่ department
  elsif tg_op = 'INSERT' or new.departments is distinct from old.departments then
    new.department := new.departments[1];
  elsif new.department is distinct from old.department then
    new.departments := case when btrim(coalesce(new.department, '')) = '' then '{}'::text[] else array[btrim(new.department)] end;
  end if;
  return new;
end $$;
drop trigger if exists v2_profiles_sync_departments on public.v2_profiles;
create trigger v2_profiles_sync_departments before insert or update on public.v2_profiles
  for each row execute function public._v2_sync_departments();

drop trigger if exists v2_profiles_sync_roles on public.v2_profiles;
create trigger v2_profiles_sync_roles before insert or update on public.v2_profiles
  for each row execute function public._v2_sync_roles();

alter table public.v2_roles    enable row level security;
alter table public.v2_profiles enable row level security;
revoke all on public.v2_roles, public.v2_profiles from anon, authenticated;

-- ---------------------------------------------------------------- ตัวช่วยภายใน (เบราว์เซอร์เรียกไม่ได้)

/** สิทธิ์ทั้งหมดของระบบ — ต้องตรงกับ PERMISSIONS ใน js/app.js */
create or replace function public._v2_perm_catalog() returns text[]
language sql immutable set search_path = public as $$
  select array['budget.view_all', 'budget.create', 'request.create', 'budget.verify', 'budget.adjust', 'budget.manage',
               'request.decide', 'cut.record', 'po.record', 'master.manage', 'data.export', 'log.view', 'user.manage',
               'business.proxy', 'gl.manage']
$$;

-- บทบาทตั้งต้น (ไม่เขียนทับถ้า Admin แก้สิทธิ์ไว้แล้ว)
insert into public.v2_roles (key, name, description, permissions, is_system) values
  ('business',   'Business (ผู้ขอใช้งบ)',     '', array['budget.create', 'request.create'], true),
  ('controller', 'ผู้คุมงบ',                   '', array['budget.view_all', 'budget.manage', 'budget.verify', 'budget.adjust', 'request.decide', 'cut.record', 'data.export'], true),
  ('accountant', 'บัญชี',                       '', array['budget.view_all', 'gl.manage', 'data.export'], true),
  ('assistant',  'Admin ผู้ช่วย Business (ธุรการ)', '', array['request.create', 'business.proxy'], true),
  ('purchasing', 'จัดซื้อ',                    '', array['budget.view_all', 'po.record'], true),
  ('admin',      'ผู้ดูแลระบบ (Admin)',        '', array['budget.view_all', 'master.manage', 'log.view', 'user.manage', 'data.export'], true)
on conflict (key) do nothing;
-- ธุรการสร้างงบไม่ได้ (เห็น/ทำได้เฉพาะงบที่เปิดใช้งานแล้ว) — เอาสิทธิ์สร้างงบออกจากบทบาทธุรการเฉพาะที่ยังเป็นค่าตั้งต้นเดิม (ไม่ทับที่ Admin ปรับเอง)
update public.v2_roles set permissions = array['request.create', 'business.proxy']
 where key = 'assistant' and permissions = array['budget.create', 'request.create', 'business.proxy'];
-- เปลี่ยนชื่อบทบาทผู้คุมงบ (ตัดวงเล็บ) — เฉพาะที่ยังเป็นชื่อตั้งต้นเดิม ไม่ทับชื่อที่ Admin ตั้งเอง
update public.v2_roles set name = 'ผู้คุมงบ' where key = 'controller' and name = 'ผู้คุมงบ (บัญชีการเงิน)';

/** ผู้ใช้ที่ล็อกอินอยู่ (ต้อง active) */
create or replace function public._v2_user() returns public.v2_profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.v2_profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public._v2_perms(p_role text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select r.permissions from public.v2_roles r where r.key = p_role), '{}'::text[])
$$;

/** สิทธิ์รวมของหลายบทบาท (ไม่ซ้ำ) */
create or replace function public._v2_perms(p_roles text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(distinct k) from public.v2_roles r, unnest(r.permissions) k where r.key = any (coalesce(p_roles, '{}'))), '{}'::text[])
$$;

/** ต้องเป็นผู้ใช้ที่ active และบทบาทมีสิทธิ์ p_perm */
create or replace function public._v2_need(p_perm text) returns public.v2_profiles
language plpgsql stable security definer set search_path = public as $$
declare u public.v2_profiles;
begin
  u := public._v2_user();
  if u.id is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน (ไม่พบบัญชีในระบบ หรือบัญชีถูกปิดการใช้งาน)' using errcode = '42501';
  end if;
  if not (p_perm = any (public._v2_perms(u.roles))) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้' using errcode = '42501';
  end if;
  return u;
end $$;

/** จำนวนผู้ใช้ active ที่จัดการผู้ใช้/สิทธิ์ได้ ไม่นับผู้ใช้ p_ignore */
create or replace function public._v2_managers(p_ignore uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.v2_profiles p
  where p.active and (p_ignore is null or p.id <> p_ignore) and 'user.manage' = any (public._v2_perms(p.roles))
$$;

create or replace function public._v2_user_json(p public.v2_profiles, p_full boolean) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'title', p.title, 'department', p.departments[1], 'departments', to_jsonb(p.departments), 'company', p.company,
    'companies', to_jsonb(p.companies), 'role', p.roles[1], 'roles', to_jsonb(p.roles), 'active', p.active)
    || case when p_full then jsonb_build_object(
      'email', p.email, 'createdAt', p.created_at, 'lastLoginAt', p.last_login_at,
      'resetRequestedAt', p.reset_requested_at, 'resetAt', p.reset_at, 'passwordSetAt', p.password_set_at, 'proxyFor', to_jsonb(p.proxy_for)) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------- ฟังก์ชันที่เบราว์เซอร์เรียก

/** ข้อมูลของตัวเอง + สิทธิ์ (p_login = true ตอนเพิ่งเข้าสู่ระบบ → บันทึกเวลาเข้าใช้ และล้างคำขอรีเซ็ตรหัสผ่าน) */
create or replace function public.v2_me(p_login boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare u public.v2_profiles;
begin
  u := public._v2_user();
  if u.id is null then return null; end if;
  if p_login then
    update public.v2_profiles set last_login_at = now(), reset_requested_at = null, password_set_at = coalesce(password_set_at, now()) where id = u.id returning * into u;
  end if;
  return public._v2_user_json(u, true) || jsonb_build_object('permissions', to_jsonb(public._v2_perms(u.roles)));
end $$;

/** รายชื่อผู้ใช้ที่เปิดใช้งาน (ไม่มีอีเมล) — ไว้เลือก/แท็กงานถึงคน ใช้ได้ทุกคนที่ล็อกอิน */
create or replace function public.v2_directory() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me_id uuid;
begin
  me_id := (select id from public._v2_user());
  if me_id is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501';
  end if;
  -- แถวของตัวเองมี proxyFor (ธุรการช่วยงานให้ใคร) · แถวคนอื่นไม่มี
  return coalesce((select jsonb_agg(public._v2_user_json(p, false) || case when p.id = me_id then jsonb_build_object('proxyFor', to_jsonb(p.proxy_for)) else '{}'::jsonb end order by p.name)
    from public.v2_profiles p where p.active), '[]'::jsonb);
end $$;

/** รายชื่อผู้ใช้ทั้งหมดสำหรับหน้า Admin */
create or replace function public.v2_list_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._v2_need('user.manage');
  return coalesce((select jsonb_agg(public._v2_user_json(p, true) order by p.created_at, p.name) from public.v2_profiles p), '[]'::jsonb);
end $$;

-- เวอร์ชันเก่าที่มีพารามิเตอร์น้อยกว่า ใช้ฟังก์ชันเดียวด้านล่างแทน (ค่าเริ่มต้นของ p_proxy_for / p_departments) — ลบทิ้งกันเรียกซ้ำซ้อน
drop function if exists public.v2_update_user(uuid, text, text, text, text, text[], text[], text[]);
drop function if exists public.v2_update_user(uuid, text, text, text, text, text[], text[]);

/** แก้ข้อมูลบัญชี (ไม่รวมเปิด/ปิดใช้งานและอีเมล — ทำผ่าน Edge Function) · p_roles = บทบาททั้งหมดของผู้ใช้ (อย่างน้อย 1) · p_departments = หน่วยงานของผู้ใช้ (Business 1 หน่วยงาน · ธุรการได้หลายหน่วยงาน) */
create or replace function public.v2_update_user(p_id uuid, p_name text, p_title text, p_department text, p_company text, p_companies text[], p_roles text[], p_proxy_for text[] default null, p_departments text[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare target public.v2_profiles; new_roles text[]; new_proxy text[]; new_depts text[];
begin
  perform public._v2_need('user.manage');
  select * into target from public.v2_profiles where id = p_id;
  if target.id is null then raise exception 'ไม่พบบัญชี'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'กรุณาระบุชื่อ'; end if;
  new_roles := array(select distinct k from unnest(coalesce(p_roles, '{}')) k);
  if cardinality(new_roles) = 0 then raise exception 'กรุณาเลือกบทบาทอย่างน้อย 1 บทบาท'; end if;
  if exists (select 1 from unnest(new_roles) k where not exists (select 1 from public.v2_roles r where r.key = k)) then
    raise exception 'ไม่พบบทบาท';
  end if;
  -- คงลำดับตามที่ส่งมา (บทบาทแรก = บทบาทหลัก)
  new_roles := array(select k from unnest(coalesce(p_roles, '{}')) with ordinality t(k, i) group by k order by min(i));
  if target.active and 'user.manage' = any (public._v2_perms(target.roles)) and not ('user.manage' = any (public._v2_perms(new_roles)))
     and public._v2_managers(target.id) = 0 then
    raise exception 'ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน' using errcode = '42501';
  end if;
  -- ธุรการช่วยงานให้ใคร: เก็บเฉพาะ id ที่มีบัญชีอยู่จริง (ไม่รวมตัวเอง) ไม่ซ้ำ
  -- p_proxy_for ไม่ส่งมา (null) = คงรายชื่อเดิม
  new_proxy := array(select distinct x from unnest(coalesce(p_proxy_for, target.proxy_for)) x where exists (select 1 from public.v2_profiles q where q.id::text = x and q.id <> p_id));
  -- หน่วยงาน: ไม่ซ้ำ คงลำดับ (หน่วยงานแรก = หน่วยงานหลัก) · ไม่ส่งมา (null) = ใช้ p_department เดิมแบบหน่วยงานเดียว
  new_depts := array(select btrim(k) from unnest(coalesce(p_departments, case when btrim(coalesce(p_department, '')) = '' then '{}'::text[] else array[p_department] end)) with ordinality t(k, i)
                     where btrim(k) <> '' group by btrim(k) order by min(i));
  update public.v2_profiles set
    name = btrim(p_name), title = btrim(coalesce(p_title, '')), departments = new_depts, department = coalesce(new_depts[1], ''),
    company = btrim(coalesce(p_company, '')), companies = coalesce(p_companies, '{}'), roles = new_roles, proxy_for = new_proxy
  where id = p_id returning * into target;
  return public._v2_user_json(target, true);
end $$;

/** เวอร์ชันเดิม (บทบาทเดียว) — เก็บไว้ให้เว็บรุ่นเก่าที่ยังเปิดค้างอยู่ */
create or replace function public.v2_update_user(p_id uuid, p_name text, p_title text, p_department text, p_company text, p_companies text[], p_role text)
returns jsonb
language sql volatile security definer set search_path = public as $$
  select public.v2_update_user(p_id, p_name, p_title, p_department, p_company, p_companies, array[p_role])
$$;

/** ผู้ใช้กด "ลืมรหัสผ่าน" (ยังไม่ล็อกอิน) — ทำเครื่องหมายให้ Admin เห็น ตอบเหมือนกันไม่ว่ามีอีเมลนี้หรือไม่ */
create or replace function public.v2_request_reset(p_email text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.v2_profiles set reset_requested_at = now() where lower(email) = lower(btrim(coalesce(p_email, ''))) and active;
  return true;
end $$;

/**
 * "เปิดใช้ครั้งแรก": ผู้ใช้กรอกอีเมลตัวเองที่หน้าล็อกอิน (ยังไม่ล็อกอิน) → ระบบตอบว่า Admin เพิ่มอีเมลนี้แล้วหรือยัง และตั้งรหัสผ่านแล้วหรือยัง
 *   not_found = ไม่มีอีเมลนี้ · inactive = ถูกปิดการใช้งาน · ready = เพิ่มแล้ว ยังไม่เคยตั้งรหัสผ่าน (ตั้งได้) · has_password = ตั้งแล้ว
 * (การตั้งรหัสผ่านจริงทำใน Edge Function ที่ตรวจสถานะนี้ซ้ำอีกครั้ง)
 */
create or replace function public.v2_activation_status(p_email text) returns text
language plpgsql stable security definer set search_path = public as $$
declare p public.v2_profiles;
begin
  select * into p from public.v2_profiles where lower(email) = lower(btrim(coalesce(p_email, '')));
  if p.id is null then return 'not_found'; end if;
  if not p.active then return 'inactive'; end if;
  if p.password_set_at is null then return 'ready'; end if;
  return 'has_password';
end $$;

create or replace function public.v2_list_roles() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if (select id from public._v2_user()) is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'catalog', to_jsonb(public._v2_perm_catalog()),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('key', r.key, 'name', r.name, 'description', r.description,
        'permissions', to_jsonb(r.permissions), 'isSystem', r.is_system) order by r.is_system desc, r.created_at, r.key) from public.v2_roles r), '[]'::jsonb));
end $$;

create or replace function public.v2_save_role(p_key text, p_name text, p_description text, p_permissions text[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare perms text[]; r public.v2_roles;
begin
  perform public._v2_need('user.manage');
  if p_key !~ '^[a-z][a-z0-9_]{1,30}$' then raise exception 'รหัสบทบาทต้องเป็นตัวอักษรอังกฤษพิมพ์เล็ก/ตัวเลข/_ ยาว 2-31 ตัว'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'กรุณาระบุชื่อบทบาท'; end if;
  perms := array(select k from unnest(public._v2_perm_catalog()) k where k = any (coalesce(p_permissions, '{}')));
  if p_key = 'admin' and not ('user.manage' = any (perms)) then
    raise exception 'บทบาท Admin ต้องมีสิทธิ์จัดการผู้ใช้เสมอ';
  end if;
  if exists (select 1 from public.v2_roles where key = p_key) and not ('user.manage' = any (perms))
     and 'user.manage' = any (public._v2_perms(p_key))
     and not exists (select 1 from public.v2_profiles p where p.active and 'user.manage' = any (public._v2_perms(array_remove(p.roles, p_key)))) then
    raise exception 'ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน' using errcode = '42501';
  end if;
  insert into public.v2_roles (key, name, description, permissions) values (p_key, btrim(p_name), coalesce(p_description, ''), perms)
  on conflict (key) do update set name = excluded.name, description = excluded.description, permissions = excluded.permissions
  returning * into r;
  return jsonb_build_object('key', r.key, 'name', r.name, 'description', r.description, 'permissions', to_jsonb(r.permissions), 'isSystem', r.is_system);
end $$;

create or replace function public.v2_delete_role(p_key text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare r public.v2_roles;
begin
  perform public._v2_need('user.manage');
  select * into r from public.v2_roles where key = p_key;
  if r.key is null then raise exception 'ไม่พบบทบาท'; end if;
  if r.is_system then raise exception 'ลบบทบาทตั้งต้นไม่ได้'; end if;
  if exists (select 1 from public.v2_profiles where p_key = any (roles)) then raise exception 'ยังมีผู้ใช้ใช้บทบาทนี้อยู่ ย้ายผู้ใช้ไปบทบาทอื่นก่อน'; end if;
  delete from public.v2_roles where key = p_key;
end $$;

-- ---------------------------------------------------------------- เฟส 2: ข้อมูลหลัก (บริษัท หน่วยงาน กลุ่ม Supplier ฯลฯ) เก็บกลางบนเซิร์ฟเวอร์

/**
 * ข้อมูลหลัก 1 แถวต่อ 1 รายการ (key) — items เป็นอาร์เรย์ JSON ตามโครงเดียวกับที่หน้าเว็บใช้
 *   companies [{code,name,logo?}] · departments [{name}] · listGroups [{name}]
 *   suppliers [{name}] · priorityGroups [{name}] · investGroups [{name}]
 * ยังไม่มีแถวของ key ไหน = หน้าเว็บใช้ค่าตั้งต้นของระบบ · ผู้จัดการข้อมูลหลักคนแรกที่เข้าระบบจะบันทึกค่าปัจจุบันขึ้นมาเป็นต้นฉบับ
 */
create table if not exists public.v2_master (
  key         text primary key,
  items       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
-- ประวัติทุกครั้งที่บันทึก (ไว้ตรวจย้อนหลัง / กู้ค่าเดิม — เบราว์เซอร์อ่านไม่ได้)
create table if not exists public.v2_master_history (
  id        bigserial primary key,
  key       text not null,
  items     jsonb not null,
  saved_at  timestamptz not null default now(),
  saved_by  uuid
);
alter table public.v2_master         enable row level security;
alter table public.v2_master_history enable row level security;
revoke all on public.v2_master, public.v2_master_history from anon, authenticated;
revoke all on sequence public.v2_master_history_id_seq from anon, authenticated;

create or replace function public._v2_master_keys() returns text[]
language sql immutable set search_path = public as $$
  select array['companies', 'departments', 'listGroups', 'suppliers', 'priorityGroups', 'investGroups']
$$;

/** ตรวจรูปแบบรายการ: อาร์เรย์ของ object · ไม่เกิน 2000 รายการ · ข้อความไม่เกิน 300 ตัวอักษร (โลโก้ data URL ไม่เกิน 400,000) · ขนาดรวมไม่เกิน 3 MB */
create or replace function public._v2_master_check(p_key text, p_items jsonb) returns void
language plpgsql immutable set search_path = public as $$
declare e jsonb; kv record;
begin
  if p_key is null or not (p_key = any (public._v2_master_keys())) then raise exception 'ไม่รู้จักรายการข้อมูลหลัก'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'มีรายการมากเกินไป (สูงสุด 2,000)'; end if;
  if length(p_items::text) > 3000000 then raise exception 'ข้อมูลใหญ่เกินไป'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
    for kv in select * from jsonb_each(e) loop
      if jsonb_typeof(kv.value) <> 'string' then raise exception 'ค่าของ "%" ต้องเป็นข้อความ', kv.key; end if;
      if length(kv.value #>> '{}') > (case when kv.key = 'logo' then 400000 else 300 end) then raise exception 'ค่าของ "%" ยาวเกินไป', kv.key; end if;
    end loop;
  end loop;
end $$;

/** ข้อมูลหลักทั้งหมดที่มีบนเซิร์ฟเวอร์ — ใช้ได้ทุกคนที่ล็อกอิน · { "<key>": { "items": [...], "updatedAt": "..." }, ... } */
create or replace function public.v2_master_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if (select id from public._v2_user()) is null then
    raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501';
  end if;
  return coalesce((select jsonb_object_agg(m.key, jsonb_build_object('items', m.items, 'updatedAt', m.updated_at)) from public.v2_master m), '{}'::jsonb);
end $$;

/**
 * บันทึกข้อมูลหลักทั้งรายการ (แทนที่ทั้งหมด) — ต้องมีสิทธิ์ master.manage
 * p_expected = updatedAt ที่หน้าเว็บโหลดมา: ถ้ามีคนอื่นบันทึกไปก่อนแล้ว (updated_at ไม่ตรง) จะปฏิเสธ ไม่ให้ทับของกัน · ส่ง null = ไม่ตรวจ (ใช้ตอนบันทึกค่าตั้งต้นครั้งแรก ซึ่งยังไม่มีแถว)
 */
create or replace function public.v2_master_save(p_key text, p_items jsonb, p_expected timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare u public.v2_profiles; cur public.v2_master; r public.v2_master;
begin
  u := public._v2_need('master.manage');
  perform public._v2_master_check(p_key, p_items);
  select * into cur from public.v2_master where key = p_key for update;
  if cur.key is not null and p_expected is not null and cur.updated_at <> p_expected then
    raise exception 'มีผู้อื่นแก้ข้อมูลหลักนี้ไปก่อนแล้ว กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง' using errcode = '40001';
  end if;
  if cur.key is null and p_expected is not null then
    -- หน้าเว็บคิดว่ามีแถวอยู่แล้วแต่ไม่มี (ถูกลบ) — ถือว่าไม่ตรงกัน
    raise exception 'มีผู้อื่นแก้ข้อมูลหลักนี้ไปก่อนแล้ว กรุณาโหลดหน้าใหม่แล้วแก้อีกครั้ง' using errcode = '40001';
  end if;
  insert into public.v2_master (key, items, updated_at, updated_by) values (p_key, p_items, clock_timestamp(), u.id)
  on conflict (key) do update set items = excluded.items, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  returning * into r;
  insert into public.v2_master_history (key, items, saved_by) values (p_key, p_items, u.id);
  return jsonb_build_object('items', r.items, 'updatedAt', r.updated_at);
end $$;

/**
 * เพิ่มชื่อ Supplier ใหม่เข้าข้อมูลหลัก (ตอนผู้ขอพิมพ์ชื่อใหม่ในฟอร์มขอเบิก) — ผู้ใช้ที่ขอเบิกได้ (request.create) หรือจัดการข้อมูลหลักได้
 * เพิ่มได้อย่างเดียว ไม่แก้/ลบรายการเดิม · ชื่อซ้ำ (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) ไม่เพิ่มซ้ำ · คืนรายการ Supplier ล่าสุด
 */
create or replace function public.v2_master_add_supplier(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare u public.v2_profiles; n text; r public.v2_master;
begin
  u := public._v2_user();
  if u.id is null then raise exception 'ไม่มีสิทธิ์ใช้งาน' using errcode = '42501'; end if;
  if not ('request.create' = any (public._v2_perms(u.roles)) or 'master.manage' = any (public._v2_perms(u.roles))) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้' using errcode = '42501';
  end if;
  n := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if n = '' then raise exception 'กรุณาระบุชื่อ Supplier'; end if;
  if length(n) > 200 then raise exception 'ชื่อ Supplier ยาวเกินไป'; end if;
  insert into public.v2_master (key, items, updated_by) values ('suppliers', '[]'::jsonb, u.id) on conflict (key) do nothing;
  update public.v2_master m set
    items = m.items || jsonb_build_array(jsonb_build_object('name', n)), updated_at = clock_timestamp(), updated_by = u.id
  where m.key = 'suppliers'
    and jsonb_array_length(m.items) < 2000
    and not exists (select 1 from jsonb_array_elements(m.items) e where lower(btrim(e ->> 'name')) = lower(n))
  returning * into r;
  if r.key is not null then
    insert into public.v2_master_history (key, items, saved_by) values ('suppliers', r.items, u.id);
  else
    select * into r from public.v2_master where key = 'suppliers';
  end if;
  return jsonb_build_object('items', r.items, 'updatedAt', r.updated_at);
end $$;

-- ---------------------------------------------------------------- สิทธิ์เรียกฟังก์ชัน

revoke all on function public._v2_user(), public._v2_perms(text), public._v2_perms(text[]), public._v2_need(text), public._v2_managers(uuid),
  public._v2_user_json(public.v2_profiles, boolean), public._v2_perm_catalog(), public._v2_master_keys(), public._v2_master_check(text, jsonb) from public, anon, authenticated;

revoke all on function public.v2_me(boolean), public.v2_directory(), public.v2_list_users(),
  public.v2_update_user(uuid, text, text, text, text, text[], text), public.v2_update_user(uuid, text, text, text, text, text[], text[], text[], text[]), public.v2_request_reset(text),
  public.v2_list_roles(), public.v2_save_role(text, text, text, text[]), public.v2_delete_role(text) from public, anon, authenticated;

grant execute on function public.v2_me(boolean), public.v2_directory(), public.v2_list_users(),
  public.v2_update_user(uuid, text, text, text, text, text[], text), public.v2_update_user(uuid, text, text, text, text, text[], text[], text[], text[]),
  public.v2_list_roles(), public.v2_save_role(text, text, text, text[]), public.v2_delete_role(text) to authenticated;
grant execute on function public.v2_request_reset(text) to anon, authenticated;
revoke all on function public.v2_activation_status(text) from public, anon, authenticated;
grant execute on function public.v2_activation_status(text) to anon, authenticated;

-- เฟส 2: ข้อมูลหลัก
revoke all on function public.v2_master_get(), public.v2_master_save(text, jsonb, timestamptz), public.v2_master_add_supplier(text) from public, anon, authenticated;
grant execute on function public.v2_master_get(), public.v2_master_save(text, jsonb, timestamptz), public.v2_master_add_supplier(text) to authenticated;

-- ระบบขอเบิกใช้งบประมาณ (ต้นแบบรอบใหม่) — เฟส 2a: งบ คำขอเบิก คำขอเพิ่มงบ และ Log บนฐานข้อมูล
-- (ข้อมูลหลักเก็บแยกใน schema_v2.sql: v2_master / v2_master_history)
-- ต้องรัน schema_v2.sql (เฟส 1) ก่อน · รันซ้ำได้ ไม่ลบข้อมูล · วางทั้งไฟล์ใน Supabase → SQL Editor → Run
--
-- โมเดล
--   * เก็บเป็น "เอกสาร" รายตัว (งบ 1 ใบ = 1 แถว ฯลฯ) เนื้อหาเป็น jsonb พร้อมเลขเวอร์ชัน — หลายคนบันทึกพร้อมกันแล้วไม่เขียนทับกัน (เวอร์ชันไม่ตรง = CONFLICT)
--   * เลขที่เอกสารออกโดยเซิร์ฟเวอร์ (ตัวนับ ไม่ซ้ำ ไม่มีช่องว่าง): เบราว์เซอร์ใส่ token @@NO:REQ-2026:xxxx@@ ในข้อมูล เซิร์ฟเวอร์แทนที่เป็นเลขจริงตอนบันทึก
--   * การมองเห็น (RLS แบบฟังก์ชัน) — ตารางเปิด RLS และไม่มี policy จึงเข้าได้ผ่านฟังก์ชัน v2_load / v2_save_docs เท่านั้น
--       - ผู้ใช้ที่ "เห็นงานของคนอื่น" (มีสิทธิ์ดูทั้งหมด/ตรวจ/อนุมัติ/ตัดงบ/PO) เห็นเฉพาะบริษัทใน companies ของบัญชี · Admin เห็นทุกบริษัท
--       - ผู้ใช้อื่น (Business) เห็นเฉพาะงบที่ตนเป็นเจ้าของ และคำขอที่ตนเป็นผู้ขอ
--   * การเขียน — ตรวจสิทธิ์ตามชนิดเอกสาร + ต้องเป็นเอกสารที่ผู้เขียนมองเห็น (ทั้งก่อนและหลังแก้) · คอลัมน์บริษัท/เจ้าของที่ใช้คุมการมองเห็นคำนวณที่เซิร์ฟเวอร์จากเนื้อหาและงบที่อ้างอิง
--   * ยังไม่ตรวจกฎขั้นตอน (เช่น ใครกดอนุมัติได้ ยอดไม่เกินวงเงิน) — เฟส 2c จะย้ายขั้นตอนสำคัญมาตรวจที่นี่

-- ---------------------------------------------------------------- ตาราง

create table if not exists public.v2_docs (
  kind          text not null check (kind in ('budget', 'request', 'change')),
  id            text not null,
  company       text not null default '',     -- บริษัทของงบ (request/change ใช้ของงบที่อ้างอิง)
  owner_id      text not null default '',     -- เจ้าของงบ (id ผู้ใช้)
  requester_id  text not null default '',     -- ผู้ขอของคำขอเบิก
  budget_id     text not null default '',
  data          jsonb not null,
  version       integer not null default 1,
  deleted       boolean not null default false,
  updated_at    timestamptz not null default clock_timestamp(),
  updated_by    uuid,
  primary key (kind, id)
);
-- หน่วยงานของงบ (request/change ใช้ของงบที่อ้างอิง) — ธุรการเห็น/ทำแทนตามหน่วยงาน
alter table public.v2_docs add column if not exists department text not null default '';
update public.v2_docs set department = coalesce(data ->> 'department', '') where kind = 'budget' and department = '';
update public.v2_docs d set department = b.department from public.v2_docs b
  where d.kind in ('request', 'change') and d.department = '' and b.kind = 'budget' and b.id = d.budget_id and b.department <> '';
create index if not exists v2_docs_updated_idx on public.v2_docs (updated_at);
create index if not exists v2_docs_budget_idx on public.v2_docs (budget_id);

create table if not exists public.v2_counters (
  key  text primary key,                       -- เช่น REQ-2026
  n    integer not null default 0
);

create table if not exists public.v2_log (
  id        bigserial primary key,
  at        timestamptz not null default clock_timestamp(),
  by_id     uuid not null,
  action    text not null default '',
  ref       text not null default '',
  detail    text not null default '',
  company   text not null default '',
  owner_id  text not null default ''
);
create index if not exists v2_log_at_idx on public.v2_log (at);

alter table public.v2_docs     enable row level security;
alter table public.v2_counters enable row level security;
alter table public.v2_log      enable row level security;
revoke all on public.v2_docs, public.v2_counters, public.v2_log from anon, authenticated;

-- ---------------------------------------------------------------- ตัวช่วยภายใน (เบราว์เซอร์เรียกไม่ได้)

-- ลบเวอร์ชันเก่าที่รับบทบาทเดียว (ตอนนี้รับรายการบทบาทของผู้ใช้)
drop function if exists public._v2_sees_all(text);
drop function if exists public._v2_can_write(text, text);

/** บทบาทที่ต้องเห็นงานของคนอื่นทั้งบริษัท — ต้องตรงกับ canViewAll() ใน js/app.js (ธุรการ business.proxy ไม่อยู่ในนี้ — เห็นเฉพาะงบของ Business ที่ถูกแท็กใน v2_profiles.proxy_for · ยังไม่แท็กใครเลย = ทั้งบริษัทไปก่อน) */
create or replace function public._v2_sees_all(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public._v2_perms(p_roles) && array['budget.view_all', 'budget.manage', 'budget.verify', 'request.decide', 'cut.record', 'po.record', 'gl.manage']
$$;

/** ขอบเขตบริษัท — ต้องตรงกับ companyScope() ใน js/app.js (Admin เห็นทุกบริษัท) */
create or replace function public._v2_company_ok(u public.v2_profiles, p_company text) returns boolean
language sql immutable set search_path = public as $$
  select 'admin' = any (u.roles) or p_company = any (u.companies)
$$;

-- ลบเวอร์ชันเก่า (ไม่มีหน่วยงาน)
drop function if exists public._v2_doc_visible(public.v2_profiles, text, text, text, text);

/**
 * เอกสารที่ผู้ใช้เห็น (และแก้ได้):
 *   1) ผู้ที่เห็นงานของคนอื่น (ผู้คุมงบ/บัญชี/จัดซื้อ ฯลฯ): ทุกเอกสารของบริษัทในขอบเขต (Admin ทุกบริษัท)
 *   2) ธุรการ (business.proxy): เอกสารของ "หน่วยงาน" ที่ Admin กำหนดให้ — ไม่ว่าบริษัทของงบจะเป็นบริษัทไหน (หน่วยงานเดียวกันใช้งบข้ามบริษัทได้)
 *      (กฎ "เฉพาะงบที่เปิดใช้งานแล้ว" ตรวจตอนบันทึก)
 *   3) เจ้าของงบ / ผู้ขอของคำขอเบิก เห็นของตัวเองเสมอ
 */
create or replace function public._v2_doc_visible(u public.v2_profiles, p_kind text, p_company text, p_owner text, p_requester text, p_department text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public._v2_sees_all(u.roles) and public._v2_company_ok(u, p_company))
      or ('business.proxy' = any (public._v2_perms(u.roles)) and p_department <> '' and p_department = any (u.departments))
      or (case when p_kind = 'request' then p_requester else p_owner end) = u.id::text
$$;

create or replace function public._v2_can_write(p_roles text[], p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'budget'  then public._v2_perms(p_roles) && array['budget.create', 'budget.manage', 'budget.verify', 'budget.adjust', 'request.create', 'business.proxy', 'gl.manage']
    when 'request' then public._v2_perms(p_roles) && array['request.create', 'request.decide', 'cut.record', 'po.record', 'budget.manage', 'budget.verify', 'business.proxy']
    when 'change'  then public._v2_perms(p_roles) && array['budget.create', 'request.create', 'budget.verify', 'budget.manage', 'budget.adjust', 'business.proxy']
    else false
  end
$$;

create or replace function public._v2_log_visible(u public.v2_profiles, p_by uuid, p_owner text) returns boolean
language sql stable security definer set search_path = public as $$
  select 'log.view' = any (public._v2_perms(u.roles)) or p_by = u.id or p_owner = u.id::text
$$;

-- ---------------------------------------------------------------- กฎธุรกิจที่ฐานข้อมูลบังคับ (ไม่ใช่แค่หน้าเว็บ)
--   ตรวจทุกครั้งตอน v2_save_docs: ใครเปลี่ยนสถานะเอกสารไปขั้นไหนได้ · ใครแก้ GL · เงินทดรอง / การตัดงบ · เอกสารที่อนุมัติแล้วแก้ยอดไม่ได้
--   สวิตช์ปิดฉุกเฉิน (ถ้ากฎเข้มเกินจนบล็อกงานจริง): update public.v2_settings set value = 'off' where key = 'enforce_rules';  (เปิดกลับ: 'on')

create table if not exists public.v2_settings (
  key   text primary key,
  value text not null default ''
);
alter table public.v2_settings enable row level security;
revoke all on public.v2_settings from anon, authenticated;
insert into public.v2_settings (key, value) values ('enforce_rules', 'on') on conflict (key) do nothing;

create or replace function public._v2_enforce() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.v2_settings where key = 'enforce_rules'), 'on') <> 'off'
$$;

/** ตัวเลขจากข้อความ JSON (ไม่ใช่ตัวเลข = 0) */
create or replace function public._v2_num(p text) returns numeric
language sql immutable set search_path = public as $$
  select case when p ~ '^-?[0-9]+(\.[0-9]+)?$' then p::numeric else 0 end
$$;

/** วงเงินรวมของงบ — ต้องตรงกับ budgetTotal() ใน js/app.js: OPEX = Item หลัก (รหัสไม่มีจุด) · CAPEX = รายการย่อยล่างสุด (รวม VAT) */
create or replace function public._v2_ledger_total(p_data jsonb) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(sum(public._v2_num(i ->> 'amount') + public._v2_num(i ->> 'vat')), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' else '[]'::jsonb end) i
  where case when p_data ->> 'type' = 'CBS' then coalesce(i ->> 'code', '') !~ '\.'
        else not exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' else '[]'::jsonb end) j
          where left(coalesce(j ->> 'code', ''), length(coalesce(i ->> 'code', '')) + 1) = coalesce(i ->> 'code', '') || '.') end
$$;

/** รายการ Item โดยไม่รวม GL (บัญชีใส่ GL ได้ตั้งแต่งบอยู่ระหว่างตรวจ — GL ตรวจแยกต่างหาก) */
create or replace function public._v2_items_nogl(p_items jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(i - 'glCode' - 'glName' order by ord), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality t(i, ord)
$$;

/**
 * ตรวจกฎของเอกสารหนึ่งฉบับก่อนบันทึก (ผิดกฎ = ปฏิเสธทั้งชุด · errcode 42501)
 *   p_old = เอกสารเดิม (null = สร้างใหม่) · p_new = เอกสารใหม่ (null = ลบ) · p_budget = ข้อมูลงบที่คำขอ/คำขอเพิ่มงบอ้างถึง
 */
create or replace function public._v2_check_doc(u public.v2_profiles, p_kind text, p_old jsonb, p_new jsonb, p_budget jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  perms text[] := public._v2_perms(u.roles);
  me text := u.id::text;
  is_new boolean := p_old is null;
  st_o text; st_n text;
  owner_id text; is_owner boolean; is_proxy boolean;
  can_decide boolean := 'request.decide' = any (perms);
  can_verify boolean := 'budget.verify' = any (perms);
  can_manage boolean := 'budget.manage' = any (perms);
  can_adjust boolean := 'budget.adjust' = any (perms);
  can_gl boolean := 'gl.manage' = any (perms);
  can_cut boolean := 'cut.record' = any (perms);
  can_po boolean := 'po.record' = any (perms);
  typ text; use_type text; rule2 boolean;
  old_cuts jsonb; new_cuts jsonb; c jsonb; kind_c text;
  req_ok boolean;
begin
  -- ---------------- ลบเอกสาร
  if p_new is null then
    st_o := coalesce(p_old ->> 'state', p_old ->> 'status', '');
    if p_kind = 'budget' and st_o in ('active', 'review', 'open_review') then
      raise exception 'ลบงบที่เปิดใช้งาน / อยู่ระหว่างตรวจไม่ได้' using errcode = '42501';
    end if;
    if p_kind = 'request' and st_o in ('approved', 'closed') then
      raise exception 'ลบใบเบิกที่ออกเอกสารแล้วไม่ได้ (ยกเลิกแทน)' using errcode = '42501';
    end if;
    if p_kind = 'change' and st_o = 'approved' then
      raise exception 'ลบคำขอเพิ่มงบที่ยืนยันแล้วไม่ได้' using errcode = '42501';
    end if;
    return;
  end if;

  -- ================= งบ =================
  if p_kind = 'budget' then
    typ := p_new ->> 'type';
    owner_id := coalesce(p_new ->> 'ownerId', '');
    is_owner := owner_id = me;
    st_n := coalesce(p_new ->> 'state', 'active');
    if is_new then
      -- สร้างใหม่ได้เฉพาะ ร่าง / ส่งอนุมัติ (Business) หรือ รอเปิดใช้ที่ผู้คุมงบลงไว้ (setup)
      if not (st_n in ('draft', 'review') or (st_n = 'pending_open' and coalesce(p_new ->> 'setup', '') = 'true' and can_manage)) then
        raise exception 'สร้างงบด้วยสถานะ "%" ไม่ได้ — งบใหม่ต้องเป็นร่าง/ส่งอนุมัติ หรือผู้คุมงบลงไว้ (รอเปิดใช้)', st_n using errcode = '42501';
      end if;
      return;
    end if;

    st_o := coalesce(p_old ->> 'state', 'active');
    -- เปลี่ยนเจ้าของงบ: ผู้คุมงบเท่านั้น
    if coalesce(p_old ->> 'ownerId', '') is distinct from owner_id and not can_manage then
      raise exception 'เปลี่ยนเจ้าของงบได้เฉพาะผู้คุมงบ' using errcode = '42501';
    end if;

    -- ขั้นตอนของสถานะ
    if st_o is distinct from st_n and st_o in ('draft', 'review', 'returned', 'pending_open', 'open_review', 'open_returned', 'active', 'cancelled') then
      if not (
        -- Business ส่งอนุมัติ / ยกเลิกร่าง (เจ้าของงบ หรือผู้คุมงบแทน)
        (st_o in ('draft', 'returned') and st_n = 'review' and (is_owner or can_manage))
        or (st_o in ('draft', 'returned', 'pending_open') and st_n = 'cancelled' and (is_owner or can_manage))
        -- ผู้คุมงบตรวจงบที่ Business ส่งมา: ผ่าน (CAPEX → รอเปิดใช้ · OPEX → เปิดใช้เลย) หรือส่งกลับ
        or (st_o = 'review' and st_n = 'pending_open' and can_verify and typ = 'CAPEX')
        or (st_o = 'review' and st_n = 'active' and can_verify and typ = 'CBS')
        or (st_o = 'review' and st_n = 'returned' and can_verify)
        -- เปิดใช้งบครั้งแรก: CAPEX ต้องส่ง Memo (เจ้าของงบ) แล้วผู้คุมงบยืนยัน · OPEX เจ้าของงบกดเปิดเอง
        or (st_o in ('pending_open', 'open_returned') and st_n = 'open_review' and is_owner and typ = 'CAPEX')
        or (st_o in ('pending_open', 'open_returned') and st_n = 'active' and is_owner and typ = 'CBS')
        or (st_o = 'open_review' and st_n in ('active', 'open_returned') and can_verify)
      ) then
        raise exception 'เปลี่ยนสถานะงบจาก "%" เป็น "%" ไม่ได้ — ไม่ถูกขั้นตอน หรือไม่มีสิทธิ์ (ข้ามขั้นอนุมัติ / Memo ไม่ได้)', st_o, st_n using errcode = '42501';
      end if;
    end if;

    -- ระหว่างรอผู้คุมงบตรวจ แก้รายการ/วงเงินไม่ได้
    if st_o in ('review', 'open_review') and public._v2_items_nogl(p_new -> 'items') is distinct from public._v2_items_nogl(p_old -> 'items') then
      raise exception 'งบที่ส่งตรวจแล้วแก้รายการ/วงเงินไม่ได้ — รอผู้คุมงบตรวจหรือส่งกลับก่อน' using errcode = '42501';
    end if;

    -- งบที่เปิดใช้แล้ว: เปลี่ยนวงเงินรวมได้เฉพาะ ปรับงบ (โยก/ลด) หรือผู้คุมงบยืนยันเพิ่มงบ
    if st_o = 'active' and st_n = 'active'
       and abs(public._v2_ledger_total(p_new) - public._v2_ledger_total(p_old)) > 0.005
       and not (can_adjust or can_verify) then
      raise exception 'เปลี่ยนวงเงินงบที่เปิดใช้แล้วต้องผ่านการปรับงบ / ขอเพิ่มงบที่ผู้คุมงบยืนยัน' using errcode = '42501';
    end if;

    -- GL ของ OPEX: เฉพาะบัญชี (gl.manage) แก้ได้
    if typ = 'CBS' and not can_gl and exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_new -> 'items') = 'array' then p_new -> 'items' else '[]'::jsonb end) n
      join jsonb_array_elements(case when jsonb_typeof(p_old -> 'items') = 'array' then p_old -> 'items' else '[]'::jsonb end) o on o ->> 'id' = n ->> 'id'
      where coalesce(o ->> 'glCode', '') is distinct from coalesce(n ->> 'glCode', '')
         or coalesce(o ->> 'glName', '') is distinct from coalesce(n ->> 'glName', '')
    ) then
      raise exception 'แก้ GL Code ได้เฉพาะบัญชี (สิทธิ์ใส่ GL)' using errcode = '42501';
    end if;
    return;
  end if;

  -- ================= คำขอเบิกใช้งบ / คำขอเพิ่มงบ: ต้องอ้างงบที่เปิดใช้แล้ว =================
  if p_kind in ('request', 'change') then
    owner_id := coalesce(p_budget ->> 'ownerId', '');
    is_owner := owner_id = me;
    is_proxy := 'business.proxy' = any (perms) and btrim(coalesce(p_budget ->> 'department', '')) <> '' and btrim(p_budget ->> 'department') = any (u.departments);
    req_ok := is_owner or is_proxy;   -- เจ้าของงบ หรือธุรการที่ดูแลหน่วยงานนั้น
  end if;

  -- ================= คำขอเบิกใช้งบ =================
  if p_kind = 'request' then
    use_type := coalesce(p_new ->> 'useType', '');
    st_n := coalesce(p_new ->> 'status', '');
    rule2 := coalesce(p_new ->> 'cutRule', '') = '2';
    new_cuts := case when jsonb_typeof(p_new -> 'cuts') = 'array' then p_new -> 'cuts' else '[]'::jsonb end;

    if is_new then
      if st_n not in ('pending', 'memo') then
        raise exception 'สร้างคำขอเบิกด้วยสถานะ "%" ไม่ได้ — ต้องเป็นรอตรวจ (อนุมัติโดยผู้คุมงบเท่านั้น)', st_n using errcode = '42501';
      end if;
      if coalesce(p_budget ->> 'state', 'active') <> 'active' then
        raise exception 'ขอเบิกใช้งบได้เฉพาะงบที่เปิดใช้แล้ว' using errcode = '42501';
      end if;
      if not req_ok then
        raise exception 'ขอเบิกใช้งบได้เฉพาะเจ้าของงบ หรือธุรการที่ดูแลหน่วยงานของงบนั้น' using errcode = '42501';
      end if;
      if coalesce(p_new ->> 'requesterId', '') <> owner_id then
        raise exception 'ผู้ขอต้องเป็นเจ้าของงบ (ธุรการทำแทนในนามเจ้าของงบ)' using errcode = '42501';
      end if;
      if jsonb_array_length(new_cuts) > 0 or jsonb_typeof(p_new -> 'advance') = 'object' or jsonb_typeof(p_new -> 'closed') = 'object'
         or coalesce(p_new ->> 'docNo', '') <> '' or p_new ? 'cutRule' then
        raise exception 'คำขอใหม่ต้องไม่มีเลขเอกสาร การตัดงบ หรือเงินทดรอง' using errcode = '42501';
      end if;
      return;
    end if;

    st_o := coalesce(p_old ->> 'status', '');
    old_cuts := case when jsonb_typeof(p_old -> 'cuts') = 'array' then p_old -> 'cuts' else '[]'::jsonb end;

    -- ใบที่ออกเอกสารแล้ว: ยอด / รายการ / งบ / ผู้ขอ / ประเภทการเบิก แก้ไม่ได้
    if st_o in ('approved', 'closed') and (
         (p_new ->> 'amount') is distinct from (p_old ->> 'amount') or (p_new -> 'lines') is distinct from (p_old -> 'lines')
         or (p_new ->> 'budgetId') is distinct from (p_old ->> 'budgetId') or (p_new ->> 'requesterId') is distinct from (p_old ->> 'requesterId')
         or (p_new ->> 'useType') is distinct from (p_old ->> 'useType')) then
      raise exception 'ใบเบิกที่ออกเอกสารแล้วแก้ยอด / รายการ / ประเภทการเบิกไม่ได้' using errcode = '42501';
    end if;
    if (p_new ->> 'requesterId') is distinct from (p_old ->> 'requesterId') or (p_new ->> 'budgetId') is distinct from (p_old ->> 'budgetId') then
      raise exception 'เปลี่ยนผู้ขอ / งบของคำขอเบิกไม่ได้' using errcode = '42501';
    end if;
    -- เลขกฎการตัดงบ: ตั้งได้ตอนออกเอกสารเท่านั้น
    if (p_new ->> 'cutRule') is distinct from (p_old ->> 'cutRule') and not (st_o = 'pending' and st_n in ('approved', 'closed') and can_decide) then
      raise exception 'กฎการตัดงบกำหนดได้ตอนผู้คุมงบอนุมัติเท่านั้น' using errcode = '42501';
    end if;

    -- การตัดงบเดิมแก้ / ลบไม่ได้ · เพิ่มได้ตามชนิดและสิทธิ์
    if exists (select 1 from jsonb_array_elements(old_cuts) o where not exists (select 1 from jsonb_array_elements(new_cuts) n where n = o)) then
      raise exception 'รายการตัดงบที่บันทึกแล้วแก้ไข / ลบไม่ได้' using errcode = '42501';
    end if;
    for c in select n from jsonb_array_elements(new_cuts) n where not exists (select 1 from jsonb_array_elements(old_cuts) o where o ->> 'id' = n ->> 'id') loop
      kind_c := coalesce(c ->> 'kind', '');
      if public._v2_num(c ->> 'amount') <= 0 then raise exception 'ยอดตัดงบต้องมากกว่า 0' using errcode = '42501'; end if;
      if kind_c = 'po' then
        if not (use_type = 'prpo' and st_o = 'approved' and can_po) then
          raise exception 'บันทึก PO ได้เฉพาะจัดซื้อ กับใบเบิกแบบ PR/PO ที่ออกเอกสารแล้ว' using errcode = '42501';
        end if;
      elsif kind_c = 'clear' then
        if rule2 then
          if not (use_type = 'advance' and st_o = 'approved' and jsonb_typeof(p_old -> 'advance') = 'object' and (me = coalesce(p_old ->> 'requesterId', '') or is_proxy)) then
            raise exception 'เคลียร์เงินทดรองได้เฉพาะผู้ขอ (Business) หรือธุรการ หลังผู้คุมงบอนุมัติ = จ่ายเงินทดรองแล้ว' using errcode = '42501';
          end if;
        elsif not (can_cut and st_o = 'approved') then
          raise exception 'บันทึกการเคลียร์เงินทดรอง (ใบก่อนใช้กฎใหม่) ได้เฉพาะผู้คุมงบ' using errcode = '42501';
        end if;
      elsif kind_c in ('reimburse', 'payment') then
        if rule2 then
          if not (st_o = 'pending' and st_n = 'closed' and can_decide and coalesce(c ->> 'auto', '') = 'true' and use_type in ('reimburse', 'direct')) then
            raise exception 'สำรองจ่าย / จ่ายตรง Supplier ตัดงบอัตโนมัติตอนผู้คุมงบอนุมัติเท่านั้น' using errcode = '42501';
          end if;
        elsif not (can_cut and st_o = 'approved') then
          raise exception 'บันทึกการจ่าย (ใบก่อนใช้กฎใหม่) ได้เฉพาะผู้คุมงบ' using errcode = '42501';
        end if;
      else
        raise exception 'ชนิดการตัดงบไม่ถูกต้อง (%)', kind_c using errcode = '42501';
      end if;
    end loop;

    -- เงินทดรอง: ตั้งได้ตอนผู้คุมงบอนุมัติ (กฎใหม่) หรือผู้คุมงบจ่าย (ใบเก่า)
    if coalesce(p_new -> 'advance', 'null'::jsonb) is distinct from coalesce(p_old -> 'advance', 'null'::jsonb) and not (
         (st_o = 'pending' and st_n = 'approved' and can_decide and rule2 and use_type = 'advance')
         or (not rule2 and can_cut and st_o = 'approved')) then
      raise exception 'จ่ายเงินทดรองได้เฉพาะตอนผู้คุมงบอนุมัติ' using errcode = '42501';
    end if;

    -- สถานะ
    if st_o is distinct from st_n and st_o in ('memo', 'pending', 'rejected', 'approved', 'closed', 'cancelled') then
      if st_o = 'pending' and st_n = 'approved' and rule2 and use_type = 'advance' and jsonb_typeof(p_new -> 'advance') is distinct from 'object' then
        raise exception 'อนุมัติเงินทดรองต้องบันทึกการจ่ายเงินทดรองพร้อมกัน (ผู้คุมงบอนุมัติ = จ่ายเงินทดรอง)' using errcode = '42501';
      end if;
      if st_o = 'pending' and st_n = 'closed' and not exists (select 1 from jsonb_array_elements(new_cuts) n where coalesce(n ->> 'auto', '') = 'true') then
        raise exception 'ปิดยอดทันทีตอนอนุมัติต้องมีรายการตัดงบอัตโนมัติ' using errcode = '42501';
      end if;
      if st_o = 'approved' and st_n = 'closed' and jsonb_array_length(new_cuts) = 0 then
        raise exception 'ปิดยอดไม่ได้ — ยังไม่มีรายการตัดงบ (PO / เคลียร์ / จ่ายเงิน)' using errcode = '42501';
      end if;
      if not (
        (st_o = 'pending' and st_n in ('approved', 'rejected') and can_decide)
        -- ผู้คุมงบอนุมัติ สำรองจ่าย / จ่ายตรง → ตัดงบ + ปิดยอดทันที (กฎตัดงบใหม่)
        or (st_o = 'pending' and st_n = 'closed' and can_decide and rule2 and use_type in ('reimburse', 'direct'))
        or (st_o in ('rejected', 'memo') and st_n = 'pending' and (me = coalesce(p_old ->> 'requesterId', '') or is_proxy))
        or (st_o = 'pending' and st_n = 'memo' and (me = coalesce(p_old ->> 'requesterId', '') or is_proxy))
        or (st_o in ('memo', 'pending', 'rejected', 'approved') and st_n = 'cancelled' and (me = coalesce(p_old ->> 'requesterId', '') or is_proxy or can_decide))
        -- ปิดยอด: PR/PO = ผู้คุมงบ (หรือจัดซื้อ) · เงินทดรอง (กฎใหม่) = ปิดพร้อมการเคลียร์ของ Business / ธุรการ · ใบเก่า = ผู้คุมงบ
        or (st_o = 'approved' and st_n = 'closed' and use_type = 'prpo' and (can_cut or can_po))
        or (st_o = 'approved' and st_n = 'closed' and use_type = 'advance' and rule2
            and (me = coalesce(p_old ->> 'requesterId', '') or is_proxy)
            and exists (select 1 from jsonb_array_elements(new_cuts) n where n ->> 'kind' = 'clear'))
        or (st_o = 'approved' and st_n = 'closed' and not rule2 and (can_cut or can_po))
      ) then
        raise exception 'เปลี่ยนสถานะใบเบิกจาก "%" เป็น "%" ไม่ได้ — ไม่ถูกขั้นตอน หรือไม่มีสิทธิ์', st_o, st_n using errcode = '42501';
      end if;
    end if;
    return;
  end if;

  -- ================= คำขอเพิ่มงบ =================
  if p_kind = 'change' then
    st_n := coalesce(p_new ->> 'state', '');
    if is_new then
      if st_n not in ('draft', 'review') then
        raise exception 'สร้างคำขอเพิ่มงบด้วยสถานะ "%" ไม่ได้', st_n using errcode = '42501';
      end if;
      if coalesce(p_budget ->> 'state', 'active') <> 'active' then
        raise exception 'ขอเพิ่มงบได้เฉพาะงบที่เปิดใช้แล้ว' using errcode = '42501';
      end if;
      if not req_ok then
        raise exception 'ขอเพิ่มงบได้เฉพาะเจ้าของงบ หรือธุรการที่ดูแลหน่วยงานของงบนั้น' using errcode = '42501';
      end if;
      return;
    end if;
    st_o := coalesce(p_old ->> 'state', '');
    if st_o = 'approved' and ((p_new -> 'lines') is distinct from (p_old -> 'lines') or (p_new ->> 'budgetId') is distinct from (p_old ->> 'budgetId')) then
      raise exception 'คำขอเพิ่มงบที่ยืนยันแล้วแก้ไม่ได้' using errcode = '42501';
    end if;
    if st_o is distinct from st_n and st_o in ('draft', 'review', 'returned', 'approved', 'cancelled') then
      if not (
        (st_o in ('draft', 'returned') and st_n = 'review' and req_ok)
        or (st_o = 'review' and st_n in ('approved', 'returned') and can_verify)
        or (st_o in ('draft', 'review', 'returned') and st_n = 'cancelled' and (req_ok or can_verify))
      ) then
        raise exception 'เปลี่ยนสถานะคำขอเพิ่มงบจาก "%" เป็น "%" ไม่ได้ — ไม่ถูกขั้นตอน หรือไม่มีสิทธิ์', st_o, st_n using errcode = '42501';
      end if;
    end if;
    return;
  end if;
end $$;

-- ---------------------------------------------------------------- บันทึก

/**
 * บันทึกเอกสาร (และ Log) เป็นชุดเดียว — สำเร็จทั้งชุดหรือไม่เลย
 *   p_docs = [{ kind, id, version (ที่เบราว์เซอร์รู้ — 0 = เอกสารใหม่), data, deleted? }]
 *   p_log  = [{ action, ref, detail, company?, ownerId? }]
 * คืน { docs: [{kind,id,version}], tokens: {token: เลขที่จริง}, log: [{id,at,by,action,ref,detail}] }
 * ข้อผิดพลาด: 'CONFLICT: kind/id' = มีผู้อื่นแก้ไปก่อน · 42501 = ไม่มีสิทธิ์
 */
create or replace function public.v2_save_docs(p_docs jsonb, p_log jsonb default '[]'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  u public.v2_profiles;
  txt_docs text; txt_log text; tok text; tmap jsonb := '{}'::jsonb; v_key text; v_n integer;
  d jsonb; l jsonb; ex public.v2_docs; v_kind text; v_id text; expected integer; ver integer; is_del boolean;
  comp text; own text; req text; bud text; b public.v2_docs; v_proxy_only boolean; v_dept text; owner_depts text[]; dept text;
  out_docs jsonb := '[]'::jsonb; out_log jsonb := '[]'::jsonb; rec record; new_id bigint; new_at timestamptz;
begin
  u := public._v2_user();
  if u.id is null then raise exception 'ไม่มีสิทธิ์ใช้งาน (บัญชีถูกปิดหรือไม่พบ)' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_docs, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_log, '[]'::jsonb)) <> 'array' then raise exception 'รูปแบบข้อมูลไม่ถูกต้อง'; end if;
  if jsonb_array_length(coalesce(p_docs, '[]')) > 500 or jsonb_array_length(coalesce(p_log, '[]')) > 500 then raise exception 'ส่งข้อมูลครั้งละมากเกินไป'; end if;

  -- 1) ออกเลขที่แทน token (ตัวนับรายคำนำหน้า-ปี · ไม่ซ้ำ ไม่มีช่องว่าง เพราะอยู่ในธุรกรรมเดียวกับการบันทึก)
  txt_docs := coalesce(p_docs, '[]')::text;
  txt_log := coalesce(p_log, '[]')::text;
  for rec in select m[1] as t from regexp_matches(txt_docs || ' ' || txt_log, '(@@NO:[A-Z]{2,10}-[0-9]{4}:[A-Za-z0-9]{4,24}@@)', 'g') as m loop
    tok := rec.t;
    if tmap ? tok then continue; end if;
    v_key := substring(tok from '@@NO:([A-Z]{2,10}-[0-9]{4}):');
    insert into public.v2_counters as c (key, n) values (v_key, 1)
      on conflict (key) do update set n = c.n + 1 returning c.n into v_n;
    tmap := tmap || jsonb_build_object(tok, v_key || '-' || lpad(v_n::text, 4, '0'));
  end loop;
  for rec in select k, v from jsonb_each_text(tmap) as e(k, v) loop
    txt_docs := replace(txt_docs, rec.k, rec.v);
    txt_log := replace(txt_log, rec.k, rec.v);
  end loop;
  p_docs := txt_docs::jsonb;
  p_log := txt_log::jsonb;

  -- ธุรการ (business.proxy) ที่ไม่ได้ดูงานทั้งบริษัทด้วยบทบาทอื่น: ทำแทนได้เฉพาะงบที่เปิดใช้แล้ว สร้างงบเองไม่ได้
  v_proxy_only := 'business.proxy' = any (public._v2_perms(u.roles)) and not public._v2_sees_all(u.roles);

  -- 2) เอกสาร
  for d in select * from jsonb_array_elements(p_docs) loop
    v_kind := d ->> 'kind';
    v_id := d ->> 'id';
    if v_kind is null or v_kind not in ('budget', 'request', 'change') or coalesce(v_id, '') = '' then raise exception 'ชนิดหรือรหัสเอกสารไม่ถูกต้อง'; end if;
    if not public._v2_can_write(u.roles, v_kind) then raise exception 'ไม่มีสิทธิ์บันทึกเอกสารชนิดนี้ (%)', v_kind using errcode = '42501'; end if;
    is_del := coalesce((d ->> 'deleted')::boolean, false);
    expected := coalesce((d ->> 'version')::integer, 0);
    if not is_del and (d -> 'data' is null or jsonb_typeof(d -> 'data') <> 'object') then raise exception 'ไม่มีข้อมูลเอกสาร'; end if;
    if not is_del and octet_length((d -> 'data')::text) > 8000000 then raise exception 'เอกสารใหญ่เกินไป (เกิน 8 MB) — ลดขนาดไฟล์แนบ'; end if;

    select * into ex from public.v2_docs t0 where t0.kind = v_kind and t0.id = v_id for update;
    if ex.id is not null then
      if ex.version <> expected then raise exception 'CONFLICT: %/%', v_kind, v_id using errcode = '40001'; end if;
      if not ex.deleted and not public._v2_doc_visible(u, v_kind, ex.company, ex.owner_id, ex.requester_id, ex.department) then
        raise exception 'ไม่มีสิทธิ์แก้ไขเอกสารนี้ (%/%)', v_kind, v_id using errcode = '42501';
      end if;
    elsif expected <> 0 then
      raise exception 'CONFLICT: %/%', v_kind, v_id using errcode = '40001';
    end if;

    comp := ''; own := ''; req := ''; bud := ''; dept := '';
    if not is_del then
      if v_kind = 'budget' then
        comp := coalesce(d -> 'data' ->> 'company', '');
        own := coalesce(d -> 'data' ->> 'ownerId', '');
        dept := btrim(coalesce(d -> 'data' ->> 'department', ''));
      elsif v_kind in ('request', 'change') then
        bud := coalesce(d -> 'data' ->> 'budgetId', '');
        select * into b from public.v2_docs t1 where t1.kind = 'budget' and t1.id = bud and not t1.deleted;
        if b.id is null then raise exception 'ไม่พบงบที่อ้างอิง (%)', bud; end if;
        comp := b.company; own := b.owner_id; dept := b.department;
        if v_proxy_only and own <> u.id::text and coalesce(b.data ->> 'state', 'active') <> 'active' then
          raise exception 'ธุรการทำรายการได้เฉพาะงบที่เปิดใช้งานแล้ว (%)', bud using errcode = '42501';
        end if;
        if v_kind = 'request' then req := coalesce(d -> 'data' ->> 'requesterId', ''); end if;
      end if;
      if v_kind = 'budget' then
        -- ธุรการสร้างงบไม่ได้ · แก้/ทำรายการได้เฉพาะงบที่เปิดใช้งานแล้ว (ทั้งก่อนและหลังแก้)
        if v_proxy_only and own <> u.id::text then
          if ex.id is null or ex.deleted then raise exception 'ธุรการสร้างงบไม่ได้ — ให้ Business เจ้าของงบสร้างเอง' using errcode = '42501'; end if;
          if coalesce(ex.data ->> 'state', 'active') <> 'active' or coalesce(d -> 'data' ->> 'state', 'active') <> 'active' then
            raise exception 'ธุรการทำรายการได้เฉพาะงบที่เปิดใช้งานแล้ว' using errcode = '42501';
          end if;
        end if;
        -- หน่วยงานของงบต้องเป็นหน่วยงานของเจ้าของงบ (ตรวจเมื่อสร้างใหม่ หรือเมื่อเปลี่ยนหน่วยงาน/เจ้าของ — งบเดิมที่ไม่ได้แก้ส่วนนี้ไม่ถูกกระทบ)
        v_dept := btrim(coalesce(d -> 'data' ->> 'department', ''));
        if own <> '' and v_dept <> '' and (ex.id is null or ex.deleted or ex.owner_id is distinct from own or btrim(coalesce(ex.data ->> 'department', '')) is distinct from v_dept) then
          select pp.departments into owner_depts from public.v2_profiles pp where pp.id::text = own;
          if owner_depts is not null and cardinality(owner_depts) > 0 and not (v_dept = any (owner_depts)) then
            raise exception 'หน่วยงานของงบต้องเป็นหน่วยงานของเจ้าของงบ (เจ้าของงบอยู่หน่วยงาน %)', array_to_string(owner_depts, ', ') using errcode = '42501';
          end if;
        end if;
        -- ธุรการ (business.proxy) เป็นเจ้าของงบไม่ได้
        if own <> '' and exists (select 1 from public.v2_profiles pp where pp.id::text = own and 'business.proxy' = any (public._v2_perms(pp.roles))) then
          raise exception 'ธุรการเป็นเจ้าของงบไม่ได้ — เลือก Business เจ้าของงบ' using errcode = '42501';
        end if;
        -- ธุรการเปลี่ยนสถานะงบไปขั้นอนุมัติ / เปิดใช้ไม่ได้ (ทั้งสร้างใหม่และแก้ของเดิม) — สถานะเดิมที่ไม่เปลี่ยนแก้ข้อมูลอื่นได้
        if 'business.proxy' = any (public._v2_perms(u.roles))
           and coalesce(d -> 'data' ->> 'state', '') in ('pending_open', 'open_review', 'open_returned', 'active')
           and coalesce(d -> 'data' ->> 'state', '') is distinct from (case when ex.id is not null and not ex.deleted then coalesce(ex.data ->> 'state', '') end) then
          raise exception 'ธุรการอนุมัติหรือเปิดใช้งบไม่ได้ — เปิดใช้งบครั้งแรกต้องเป็น Business เจ้าของงบ' using errcode = '42501';
        end if;
      end if;
      if not public._v2_doc_visible(u, v_kind, comp, own, req, dept) then
        raise exception 'ไม่มีสิทธิ์บันทึกเอกสารนี้ (นอกขอบเขตบริษัท/เจ้าของ) (%/%)', v_kind, v_id using errcode = '42501';
      end if;
    elsif ex.id is null then
      raise exception 'ลบเอกสารที่ไม่มีอยู่';
    else
      comp := ex.company; own := ex.owner_id; req := ex.requester_id; bud := ex.budget_id; dept := ex.department;
    end if;

    -- กฎธุรกิจ (สถานะ / GL / เงินทดรอง-การตัดงบ / เอกสารที่อนุมัติแล้ว) — ปิดฉุกเฉินได้ที่ v2_settings.enforce_rules
    if public._v2_enforce() then
      perform public._v2_check_doc(u, v_kind,
        case when ex.id is null or ex.deleted then null else ex.data end,
        case when is_del then null else d -> 'data' end,
        case when not is_del and v_kind in ('request', 'change') then b.data end);
    end if;

    ver := expected + 1;
    insert into public.v2_docs as t (kind, id, company, owner_id, requester_id, budget_id, department, data, version, deleted, updated_at, updated_by)
      values (v_kind, v_id, comp, own, req, bud, dept, case when is_del then '{}'::jsonb else d -> 'data' end, ver, is_del, clock_timestamp(), u.id)
    on conflict (kind, id) do update set company = excluded.company, owner_id = excluded.owner_id, requester_id = excluded.requester_id, department = excluded.department,
      budget_id = excluded.budget_id, data = excluded.data, version = excluded.version, deleted = excluded.deleted,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    out_docs := out_docs || jsonb_build_object('kind', v_kind, 'id', v_id, 'version', ver);
  end loop;

  -- 3) Log (ผู้ทำ = ผู้ล็อกอิน เสมอ — ไม่เชื่อค่าจากเบราว์เซอร์)
  for l in select * from jsonb_array_elements(p_log) loop
    insert into public.v2_log (by_id, action, ref, detail, company, owner_id)
      values (u.id, left(coalesce(l ->> 'action', ''), 300), left(coalesce(l ->> 'ref', ''), 300), left(coalesce(l ->> 'detail', ''), 2000),
              left(coalesce(l ->> 'company', ''), 50), left(coalesce(l ->> 'ownerId', ''), 100))
      returning id, at into new_id, new_at;
    out_log := out_log || jsonb_build_object('id', new_id, 'at', new_at, 'by', u.id, 'action', left(coalesce(l ->> 'action', ''), 300),
      'ref', left(coalesce(l ->> 'ref', ''), 300), 'detail', left(coalesce(l ->> 'detail', ''), 2000));
  end loop;

  return jsonb_build_object('docs', out_docs, 'tokens', tmap, 'log', out_log);
end $$;

-- ---------------------------------------------------------------- โหลด

/**
 * โหลดเอกสารที่ผู้ใช้มองเห็น · p_since = null → โหลดทั้งหมด · มีค่า → เฉพาะที่เปลี่ยนตั้งแต่เวลานั้น (ย้อนหลัง 2 นาทีกันพลาด) รวมเอกสารที่ถูกลบ
 * คืน { now, full, docs: [{kind,id,version,deleted,data}], log: [{id,at,by,action,ref,detail}] }
 */
create or replace function public.v2_load(p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.v2_profiles; since timestamptz; docs jsonb; lg jsonb;
begin
  u := public._v2_user();
  if u.id is null then raise exception 'ไม่มีสิทธิ์ใช้งาน (บัญชีถูกปิดหรือไม่พบ)' using errcode = '42501'; end if;
  since := case when p_since is null then null else p_since - interval '2 minutes' end;
  select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'version', x.version, 'deleted', x.deleted, 'data', x.data) order by x.updated_at), '[]'::jsonb)
    into docs
    from public.v2_docs x
    where (case when since is null then not x.deleted else x.updated_at >= since end)
      and public._v2_doc_visible(u, x.kind, x.company, x.owner_id, x.requester_id, x.department);
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'at', y.at, 'by', y.by_id, 'action', y.action, 'ref', y.ref, 'detail', y.detail) order by y.id), '[]'::jsonb)
    into lg
    from (select * from public.v2_log z
          where (since is null or z.at >= since) and public._v2_log_visible(u, z.by_id, z.owner_id)
          order by z.id desc limit 1000) y;
  return jsonb_build_object('now', clock_timestamp(), 'full', p_since is null, 'docs', docs, 'log', lg);
end $$;

-- ---------------------------------------------------------------- สิทธิ์เรียกฟังก์ชัน

revoke all on function public._v2_sees_all(text[]), public._v2_company_ok(public.v2_profiles, text),
  public._v2_doc_visible(public.v2_profiles, text, text, text, text, text), public._v2_can_write(text[], text),
  public._v2_log_visible(public.v2_profiles, uuid, text), public._v2_enforce(), public._v2_num(text), public._v2_ledger_total(jsonb), public._v2_items_nogl(jsonb),
  public._v2_check_doc(public.v2_profiles, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.v2_save_docs(jsonb, jsonb), public.v2_load(timestamptz) from public, anon, authenticated;
grant execute on function public.v2_save_docs(jsonb, jsonb), public.v2_load(timestamptz) to authenticated;

-- ---------------------------------------------------------------- เลขเวอร์ชันของสคีมา (หน้าเว็บตรวจว่าฐานข้อมูลอัปเดตตรงกับเว็บไหม)
-- เพิ่มเลขนี้ทุกครั้งที่แก้ schema ที่หน้าเว็บต้องพึ่งพา และแก้ SCHEMA_VERSION ใน js/app.js ให้เท่ากัน (ตรวจด้วย supabase/tests/check_schema.js)
create or replace function public.v2_schema_version() returns integer
language sql immutable set search_path = public as $$ select 6 $$;
revoke all on function public.v2_schema_version() from public, anon;
grant execute on function public.v2_schema_version() to authenticated;

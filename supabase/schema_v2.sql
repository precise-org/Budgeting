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

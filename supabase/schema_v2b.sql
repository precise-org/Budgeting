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

create or replace function public._v2_doc_visible(u public.v2_profiles, p_kind text, p_company text, p_owner text, p_requester text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public._v2_sees_all(u.roles) then public._v2_company_ok(u, p_company)
    -- ธุรการ: เห็น/ทำแทนเฉพาะเอกสารของ Business ที่ Admin แท็กไว้ (p_owner = เจ้าของงบ) ในบริษัทที่มีสิทธิ์ · ยังไม่ได้แท็กใครเลย (proxy_for ว่าง) = ทั้งบริษัทไปก่อน
    when 'business.proxy' = any (public._v2_perms(u.roles)) and public._v2_company_ok(u, p_company) and (cardinality(u.proxy_for) = 0 or p_owner = any (u.proxy_for)) then true
    when p_kind = 'request' then p_requester = u.id::text
    else p_owner = u.id::text
  end
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
  comp text; own text; req text; bud text; b public.v2_docs;
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
      if not ex.deleted and not public._v2_doc_visible(u, v_kind, ex.company, ex.owner_id, ex.requester_id) then
        raise exception 'ไม่มีสิทธิ์แก้ไขเอกสารนี้ (%/%)', v_kind, v_id using errcode = '42501';
      end if;
    elsif expected <> 0 then
      raise exception 'CONFLICT: %/%', v_kind, v_id using errcode = '40001';
    end if;

    comp := ''; own := ''; req := ''; bud := '';
    if not is_del then
      if v_kind = 'budget' then
        comp := coalesce(d -> 'data' ->> 'company', '');
        own := coalesce(d -> 'data' ->> 'ownerId', '');
      elsif v_kind in ('request', 'change') then
        bud := coalesce(d -> 'data' ->> 'budgetId', '');
        select * into b from public.v2_docs t1 where t1.kind = 'budget' and t1.id = bud and not t1.deleted;
        if b.id is null then raise exception 'ไม่พบงบที่อ้างอิง (%)', bud; end if;
        comp := b.company; own := b.owner_id;
        if v_kind = 'request' then req := coalesce(d -> 'data' ->> 'requesterId', ''); end if;
      end if;
      if v_kind = 'budget' then
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
      if not public._v2_doc_visible(u, v_kind, comp, own, req) then
        raise exception 'ไม่มีสิทธิ์บันทึกเอกสารนี้ (นอกขอบเขตบริษัท/เจ้าของ) (%/%)', v_kind, v_id using errcode = '42501';
      end if;
    elsif ex.id is null then
      raise exception 'ลบเอกสารที่ไม่มีอยู่';
    else
      comp := ex.company; own := ex.owner_id; req := ex.requester_id; bud := ex.budget_id;
    end if;

    ver := expected + 1;
    insert into public.v2_docs as t (kind, id, company, owner_id, requester_id, budget_id, data, version, deleted, updated_at, updated_by)
      values (v_kind, v_id, comp, own, req, bud, case when is_del then '{}'::jsonb else d -> 'data' end, ver, is_del, clock_timestamp(), u.id)
    on conflict (kind, id) do update set company = excluded.company, owner_id = excluded.owner_id, requester_id = excluded.requester_id,
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
      and public._v2_doc_visible(u, x.kind, x.company, x.owner_id, x.requester_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'at', y.at, 'by', y.by_id, 'action', y.action, 'ref', y.ref, 'detail', y.detail) order by y.id), '[]'::jsonb)
    into lg
    from (select * from public.v2_log z
          where (since is null or z.at >= since) and public._v2_log_visible(u, z.by_id, z.owner_id)
          order by z.id desc limit 1000) y;
  return jsonb_build_object('now', clock_timestamp(), 'full', p_since is null, 'docs', docs, 'log', lg);
end $$;

-- ---------------------------------------------------------------- สิทธิ์เรียกฟังก์ชัน

revoke all on function public._v2_sees_all(text[]), public._v2_company_ok(public.v2_profiles, text),
  public._v2_doc_visible(public.v2_profiles, text, text, text, text), public._v2_can_write(text[], text),
  public._v2_log_visible(public.v2_profiles, uuid, text) from public, anon, authenticated;
revoke all on function public.v2_save_docs(jsonb, jsonb), public.v2_load(timestamptz) from public, anon, authenticated;
grant execute on function public.v2_save_docs(jsonb, jsonb), public.v2_load(timestamptz) to authenticated;

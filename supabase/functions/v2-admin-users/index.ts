// Edge Function: จัดการบัญชีผู้ใช้ที่ต้องใช้สิทธิ์ service_role (เบราว์เซอร์ทำเองไม่ได้ และห้ามมี service_role key ในเบราว์เซอร์)
//   ต้องเป็น Admin (แนบ Authorization: Bearer <access token> · ผู้เรียก active + มีสิทธิ์ user.manage):
//     { action: 'create', email, name, title, departments (รายการ · หรือ department หน่วยงานเดียว), company, companies, roles (รายการ · หรือ role บทบาทเดียว) } → { user }
//     { action: 'reset', id }                    → { ok }   (ล้างรหัสผ่านเดิมทิ้ง → ผู้ใช้ "เปิดใช้ครั้งแรก" ตั้งรหัสใหม่เอง)
//     { action: 'set_active', id, active }       → { user } (ปิดบัญชี = ban ใน Supabase Auth ด้วย)
//   สาธารณะ (ยังไม่ล็อกอิน — ใช้ anon key):
//     { action: 'activate', email, password }    → { ok }   (ผู้ใช้ตั้งรหัสผ่านของตัวเองครั้งแรก — ทำได้เฉพาะบัญชีที่ Admin เพิ่มไว้และยังไม่เคยตั้งรหัสผ่าน)
// ไม่มีลิงก์ / ไม่มีอีเมล: Admin ไม่เห็นและไม่ตั้งรหัสผ่านให้ใคร · รหัสผ่านที่ Admin ทำให้เกิดขึ้น (ตอนสร้าง/รีเซ็ต) เป็นค่าสุ่มที่ไม่มีใครรู้
//
// ข้อควรรู้: ใครรู้อีเมลที่ Admin เพิ่มไว้ และเปิดใช้ก่อนเจ้าของอีเมล จะได้ตั้งรหัสผ่านและยึดบัญชีนั้น — Admin เห็นสถานะ "รอตั้งรหัสผ่าน" ใน
// หน้า Admin และกด "รีเซ็ตรหัสผ่าน" เพื่อล้างได้ · ควรแจ้งผู้ใช้ให้เปิดใช้ทันทีหลังเพิ่มบัญชี

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BAN_FOREVER = '876000h';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ message }, status);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const str = (v: unknown) => String(v ?? '').trim();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

type Profile = {
  id: string; email: string; name: string; title: string; department: string; departments?: string[]; company: string;
  companies: string[]; role: string; roles: string[]; active: boolean; created_at: string; last_login_at: string | null;
  reset_requested_at: string | null; reset_at: string | null; password_set_at: string | null;
};

const userJson = (p: Profile) => ({
  id: p.id, email: p.email, name: p.name, title: p.title, department: (p.departments && p.departments[0]) || p.department, departments: p.departments && p.departments.length ? p.departments : (p.department ? [p.department] : []), company: p.company,
  companies: p.companies, role: (p.roles && p.roles[0]) || p.role, roles: p.roles && p.roles.length ? p.roles : [p.role], active: p.active, createdAt: p.created_at, lastLoginAt: p.last_login_at,
  resetRequestedAt: p.reset_requested_at, resetAt: p.reset_at, passwordSetAt: p.password_set_at,
});

const rolesOf = (p: { role: string; roles?: string[] }): string[] => (p.roles && p.roles.length ? p.roles : (p.role ? [p.role] : []));

/** สิทธิ์รวมของหลายบทบาท */
async function permsOfRoles(roles: string[]): Promise<string[]> {
  if (!roles.length) return [];
  const { data } = await admin.from('v2_roles').select('permissions').in('key', roles);
  return [...new Set((data || []).flatMap((r) => r.permissions as string[]))];
}

/** ผู้เรียกต้องล็อกอิน (token ถูกต้อง) + active + บทบาทมีสิทธิ์ user.manage */
async function caller(req: Request): Promise<Profile | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  const { data: p } = await admin.from('v2_profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!p || !p.active) return null;
  if (!(await permsOfRoles(rolesOf(p))).includes('user.manage')) return null;
  return p as Profile;
}

/** รหัสผ่านสุ่มที่ไม่มีใครรู้ — ทำให้บัญชีที่ยังไม่เปิดใช้ / ถูกรีเซ็ต ล็อกอินไม่ได้จนกว่าเจ้าของจะตั้งรหัสผ่านเอง */
const randomPassword = () => crypto.randomUUID() + crypto.randomUUID();

/** เงื่อนไขรหัสผ่าน (ตรงกับหน้าเว็บ): อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข ไม่ซ้ำอีเมล */
function passwordProblem(pw: string, email: string): string {
  if (pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (!/[A-Za-z\u0E00-\u0E7F]/.test(pw) || !/\d/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
  if (pw.toLowerCase() === email.toLowerCase()) return 'รหัสผ่านต้องไม่ซ้ำกับอีเมล';
  return '';
}

async function activeManagers(except: string): Promise<number> {
  const { data: roles } = await admin.from('v2_roles').select('key, permissions');
  const keys = (roles || []).filter((r) => (r.permissions as string[]).includes('user.manage')).map((r) => r.key);
  const { data } = await admin.from('v2_profiles').select('id').eq('active', true).neq('id', except).overlaps('roles', keys);
  return (data || []).length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('method not allowed', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('ข้อมูลไม่ถูกต้อง'); }

  // สาธารณะ: ผู้ใช้เปิดใช้ครั้งแรก (ตั้งรหัสผ่านของตัวเอง)
  if (body.action === 'activate') {
    try {
      const email = str(body.email).toLowerCase();
      const password = String(body.password ?? '');
      const problem = passwordProblem(password, email);
      if (problem) return fail(problem);
      const { data: p } = await admin.from('v2_profiles').select('id, active, password_set_at').ilike('email', email.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      if (!p) return fail('ไม่พบอีเมลนี้ในระบบ — ให้ผู้ดูแลระบบเพิ่มอีเมลของคุณก่อน', 404);
      if (!p.active) return fail('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 403);
      // จองสิทธิ์ตั้งรหัสผ่านแบบอะตอมมิก (ถ้ามีคนตั้งไปแล้ว จะไม่ได้แถว)
      const { data: claimed } = await admin.from('v2_profiles')
        .update({ password_set_at: new Date().toISOString(), reset_requested_at: null })
        .eq('id', p.id).is('password_set_at', null).select('id');
      if (!claimed || claimed.length === 0) return fail('บัญชีนี้ตั้งรหัสผ่านแล้ว — เข้าสู่ระบบได้เลย หรือกด "ลืมรหัสผ่าน" ถ้าจำรหัสไม่ได้', 409);
      const { error: ue } = await admin.auth.admin.updateUserById(p.id, { password });
      if (ue) {
        await admin.from('v2_profiles').update({ password_set_at: null }).eq('id', p.id); // คืนสถานะ ให้ลองใหม่ได้
        return fail('ตั้งรหัสผ่านไม่สำเร็จ: ' + ue.message);
      }
      return json({ ok: true });
    } catch (e) {
      return fail((e as Error).message || 'เกิดข้อผิดพลาด', 500);
    }
  }

  const me = await caller(req);
  if (!me) return fail('ไม่มีสิทธิ์จัดการผู้ใช้', 403);

  try {
    if (body.action === 'create') {
      const email = str(body.email).toLowerCase();
      const name = str(body.name);
      const roles = [...new Set((Array.isArray(body.roles) ? (body.roles as unknown[]) : [body.role]).map(str).filter(Boolean))];
      if (!validEmail(email)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
      if (!name) return fail('กรุณาระบุชื่อ');
      if (!roles.length) return fail('กรุณาเลือกบทบาทอย่างน้อย 1 บทบาท');
      const { data: found } = await admin.from('v2_roles').select('key').in('key', roles);
      if ((found || []).length !== roles.length) return fail('ไม่พบบทบาท');
      const { data: dup } = await admin.from('v2_profiles').select('id').ilike('email', email.replace(/[%_\\]/g, '\\$&')).maybeSingle();
      if (dup) return fail('อีเมลนี้มีอยู่ในระบบแล้ว');
      const company = str(body.company);
      const departments = [...new Set((Array.isArray(body.departments) ? (body.departments as unknown[]) : [body.department]).map(str).filter(Boolean))];
      const companies = Array.isArray(body.companies) ? [...new Set((body.companies as unknown[]).map(str).filter(Boolean))] : (company ? [company] : []);

      // สร้างบัญชีด้วยรหัสผ่านสุ่มที่ไม่มีใครรู้ — เจ้าของอีเมลมา "เปิดใช้ครั้งแรก" เพื่อตั้งรหัสผ่านเอง
      const created = await admin.auth.admin.createUser({ email, email_confirm: true, password: randomPassword() });
      if (created.error || !created.data.user) return fail('สร้างบัญชีไม่สำเร็จ: ' + (created.error?.message || ''), 400);
      const id = created.data.user.id;
      const { data: p, error: pe } = await admin.from('v2_profiles').insert({
        id, email, name, title: str(body.title), department: departments[0] || '', departments, company, companies, role: roles[0], roles, created_by: me.id,
      }).select('*').single();
      if (pe || !p) {
        await admin.auth.admin.deleteUser(id); // ไม่ให้เหลือบัญชีที่ไม่มีโปรไฟล์
        return fail('บันทึกโปรไฟล์ไม่สำเร็จ: ' + (pe?.message || ''), 400);
      }
      return json({ user: userJson(p as Profile) });
    }

    if (body.action === 'reset') {
      const { data: p } = await admin.from('v2_profiles').select('*').eq('id', str(body.id)).maybeSingle();
      if (!p) return fail('ไม่พบบัญชี');
      if (!p.active) return fail('บัญชีนี้ถูกปิดการใช้งาน');
      // ล้างรหัสผ่านเดิมทิ้ง (ตั้งเป็นค่าสุ่ม) → ผู้ใช้ "เปิดใช้ครั้งแรก" เพื่อตั้งรหัสใหม่เอง
      const { error: ue } = await admin.auth.admin.updateUserById(p.id, { password: randomPassword() });
      if (ue) return fail('รีเซ็ตรหัสผ่านไม่สำเร็จ: ' + ue.message);
      await admin.from('v2_profiles').update({ password_set_at: null, reset_at: new Date().toISOString(), reset_requested_at: null }).eq('id', p.id);
      return json({ ok: true });
    }

    if (body.action === 'set_active') {
      const id = str(body.id);
      const active = body.active === true;
      const { data: p } = await admin.from('v2_profiles').select('*').eq('id', id).maybeSingle();
      if (!p) return fail('ไม่พบบัญชี');
      if (!active) {
        if (id === me.id) return fail('ปิดบัญชีของตัวเองไม่ได้');
        if (p.active && (await permsOfRoles(rolesOf(p))).includes('user.manage') && (await activeManagers(id)) === 0) {
          return fail('ต้องมีผู้ดูแลระบบที่เปิดใช้งานอย่างน้อย 1 คน');
        }
      }
      const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : BAN_FOREVER });
      if (be) return fail('ปรับสถานะบัญชีไม่สำเร็จ: ' + be.message);
      const { data: up } = await admin.from('v2_profiles').update({ active }).eq('id', id).select('*').single();
      return json({ user: userJson(up as Profile) });
    }

    return fail('ไม่รู้จักคำสั่ง');
  } catch (e) {
    return fail((e as Error).message || 'เกิดข้อผิดพลาด', 500);
  }
});

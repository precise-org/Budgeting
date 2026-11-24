/*
 * ตัวเชื่อม Supabase แบบเบา (ไม่ต้องใช้ไลบรารีภายนอก)
 *   - ล็อกอินด้วยอีเมล + รหัสผ่าน (Supabase Auth / GoTrue REST) เก็บ session ใน localStorage และต่ออายุให้เอง
 *   - เรียกฟังก์ชันในฐานข้อมูล app_* ผ่าน PostgREST (/rest/v1/rpc/<ชื่อ>) — ดู supabase/schema.sql
 * เบราว์เซอร์ไม่มีสิทธิ์อ่านเขียนตารางตรง ๆ ทุกการเรียกตรวจสิทธิ์ที่ฝั่งเซิร์ฟเวอร์
 */
(function () {
  'use strict';

  const CFG = window.PROCUREMENT_CONFIG || {};
  const enabled = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  const base = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  const STORE_KEY = 'procurement.auth';

  class ApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code; // 'AUTH' = ต้องล็อกอินใหม่, 'NETWORK' = เชื่อมต่อไม่ได้, อื่น ๆ = รหัสจากฐานข้อมูล
    }
  }

  let session = null;
  try { session = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { session = null; }

  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s)); else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* ignore */ }
  }

  const nowSec = () => Math.floor(Date.now() / 1000);

  async function http(path, options) {
    let res;
    try {
      res = await fetch(base + path, options);
    } catch (e) {
      throw new ApiError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 0, 'NETWORK');
    }
    let body = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch (e) { body = { message: text }; } }
    return { status: res.status, ok: res.ok, body };
  }

  const baseHeaders = () => ({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' });

  function authMessage(body) {
    const raw = body && (body.error_description || body.msg || body.message || body.error) || '';
    if (/invalid login credentials|invalid_grant/i.test(raw)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (/email not confirmed/i.test(raw)) return 'บัญชียังไม่ได้ยืนยันอีเมล กรุณาติดต่อผู้ดูแลระบบ';
    if (/rate limit|too many/i.test(raw)) return 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
    return raw || 'เข้าสู่ระบบไม่สำเร็จ';
  }

  function toSession(body) {
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at || nowSec() + Number(body.expires_in || 3600),
      user: { id: body.user && body.user.id, email: body.user && body.user.email }
    };
  }

  async function signIn(email, password) {
    const r = await http('/auth/v1/token?grant_type=password', { method: 'POST', headers: baseHeaders(), body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new ApiError(authMessage(r.body), r.status, 'LOGIN');
    saveSession(toSession(r.body));
    return session.user;
  }

  let refreshing = null;
  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new ApiError('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่', 401, 'AUTH'));
    if (!refreshing) {
      refreshing = http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: baseHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }) })
        .then((r) => {
          if (!r.ok) { saveSession(null); throw new ApiError('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่', 401, 'AUTH'); }
          saveSession(toSession(r.body));
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function signOut() {
    const token = session && session.access_token;
    saveSession(null);
    if (!token) return;
    try { await fetch(base + '/auth/v1/logout', { method: 'POST', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + token }) }); } catch (e) { /* ออฟไลน์: session ในเครื่องถูกลบแล้ว */ }
  }

  /** เรียกฟังก์ชันในฐานข้อมูล: args = พารามิเตอร์ตามชื่อ (p_...) */
  async function rpc(fn, args) {
    if (!session) throw new ApiError('กรุณาเข้าสู่ระบบ', 401, 'AUTH');
    if (session.expires_at - nowSec() < 60) await refresh();
    const call = () => http('/rest/v1/rpc/' + fn, {
      method: 'POST', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + session.access_token }), body: JSON.stringify(args || {})
    });
    let r = await call();
    if (r.status === 401) { await refresh(); r = await call(); }
    if (r.status === 401) { saveSession(null); throw new ApiError('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่', 401, 'AUTH'); }
    if (!r.ok) throw new ApiError((r.body && (r.body.message || r.body.hint)) || 'ทำรายการไม่สำเร็จ (' + r.status + ')', r.status, r.body && r.body.code);
    return r.body === undefined ? null : r.body;
  }

  /** เรียกฟังก์ชันในฐานข้อมูลโดยไม่ต้องล็อกอิน (ใช้เฉพาะฟังก์ชันที่เปิดให้ anon เช่น v2_request_reset) */
  async function rpcAnon(fn, args) {
    const r = await http('/rest/v1/rpc/' + fn, { method: 'POST', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + CFG.supabaseAnonKey }), body: JSON.stringify(args || {}) });
    if (!r.ok) throw new ApiError((r.body && (r.body.message || r.body.hint)) || 'ทำรายการไม่สำเร็จ (' + r.status + ')', r.status, r.body && r.body.code);
    return r.body === undefined ? null : r.body;
  }

  /** เรียก Edge Function ด้วย token ของผู้ใช้ที่ล็อกอินอยู่ (ฟังก์ชันตรวจสิทธิ์เองอีกชั้น) */
  async function invoke(name, body) {
    if (!session) throw new ApiError('กรุณาเข้าสู่ระบบ', 401, 'AUTH');
    if (session.expires_at - nowSec() < 60) await refresh();
    const r = await http('/functions/v1/' + name, { method: 'POST', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + session.access_token }), body: JSON.stringify(body || {}) });
    if (r.status === 401) { saveSession(null); throw new ApiError('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่', 401, 'AUTH'); }
    if (!r.ok) throw new ApiError((r.body && (r.body.message || r.body.error)) || 'ทำรายการไม่สำเร็จ (' + r.status + ')', r.status, 'FUNCTION');
    return r.body;
  }

  /** ตั้ง / เปลี่ยนรหัสผ่านของผู้ใช้ที่ล็อกอินอยู่ (ใช้กับลิงก์ตั้งรหัสผ่านและหน้าบัญชีของฉัน) */
  async function updatePassword(password) {
    if (!session) throw new ApiError('กรุณาเข้าสู่ระบบ', 401, 'AUTH');
    if (session.expires_at - nowSec() < 60) await refresh();
    const r = await http('/auth/v1/user', { method: 'PUT', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + session.access_token }), body: JSON.stringify({ password }) });
    if (!r.ok) {
      const raw = (r.body && (r.body.msg || r.body.message || r.body.error_description)) || '';
      if (/same.*password|different from the old/i.test(raw)) throw new ApiError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', r.status, 'PASSWORD');
      if (/weak|short|at least/i.test(raw)) throw new ApiError('รหัสผ่านไม่ปลอดภัยพอ — ใช้อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข', r.status, 'PASSWORD');
      throw new ApiError(raw || 'ตั้งรหัสผ่านไม่สำเร็จ', r.status, 'PASSWORD');
    }
  }

  /** เรียก Edge Function แบบยังไม่ล็อกอิน (ใช้เฉพาะคำสั่งสาธารณะ เช่น เปิดใช้ครั้งแรก) */
  async function invokeAnon(name, body) {
    const r = await http('/functions/v1/' + name, { method: 'POST', headers: Object.assign(baseHeaders(), { Authorization: 'Bearer ' + CFG.supabaseAnonKey }), body: JSON.stringify(body || {}) });
    if (!r.ok) throw new ApiError((r.body && (r.body.message || r.body.error)) || 'ทำรายการไม่สำเร็จ (' + r.status + ')', r.status, 'FUNCTION');
    return r.body;
  }

  window.RemoteApi = {
    enabled,
    ApiError,
    hasSession: () => !!session,
    sessionUser: () => (session && session.user) || null,
    signIn,
    signOut,
    updatePassword,
    invoke,
    // ---- ระบบบัญชีรอบใหม่ (supabase/schema_v2.sql)
    v2Me: (login) => rpc('v2_me', { p_login: !!login }),
    v2Directory: () => rpc('v2_directory'),
    v2ListUsers: () => rpc('v2_list_users'),
    v2UpdateUser: (u) => rpc('v2_update_user', Object.assign({ p_id: u.id, p_name: u.name, p_title: u.title || '', p_department: u.department || '', p_company: u.company || '', p_companies: u.companies || [], p_roles: u.roles || [u.role] }, Array.isArray(u.departments) ? { p_departments: u.departments } : {}, Array.isArray(u.proxyFor) ? { p_proxy_for: u.proxyFor } : {})),
    v2RequestReset: (email) => rpcAnon('v2_request_reset', { p_email: email }),
    v2ActivationStatus: (email) => rpcAnon('v2_activation_status', { p_email: email }),
    activate: (email, password) => invokeAnon('v2-admin-users', { action: 'activate', email, password }),
    v2ListRoles: () => rpc('v2_list_roles'),
    v2SaveRole: (r) => rpc('v2_save_role', { p_key: r.key, p_name: r.name, p_description: r.description || '', p_permissions: r.permissions || [] }),
    v2DeleteRole: (key) => rpc('v2_delete_role', { p_key: key }),
    // ---- ข้อมูลหลักบนเซิร์ฟเวอร์ (เฟส 2)
    v2MasterGet: () => rpc('v2_master_get'),
    v2MasterSave: (key, items, expectedUpdatedAt) => rpc('v2_master_save', { p_key: key, p_items: items, p_expected: expectedUpdatedAt || null }),
    v2MasterAddSupplier: (name) => rpc('v2_master_add_supplier', { p_name: name }),
    adminUsers: (body) => invoke('v2-admin-users', body),
    // ---- ข้อมูลงบ (supabase/schema_v2b.sql)
    v2Load: (since) => rpc('v2_load', { p_since: since || null }),
    v2SaveDocs: (docs, log) => rpc('v2_save_docs', { p_docs: docs, p_log: log || [] }),
    me: () => rpc('app_me'),
    load: () => rpc('app_load'),
    saveMaster: (key, data, renames) => rpc('app_save_master', { p_key: key, p_data: data, p_renames: renames || [] }),
    saveBudget: (budget, expectedVersion) => rpc('app_save_budget', { p_budget: budget, p_expected_version: expectedVersion == null ? null : expectedVersion }),
    deleteBudget: (id) => rpc('app_delete_budget', { p_id: id }),
    submitRequest: (request) => rpc('app_submit_request', { p_request: request }),
    decide: (id, decision, comment) => rpc('app_decide_request', { p_id: id, p_decision: decision, p_comment: comment || '' }),
    cancel: (id, reason) => rpc('app_cancel_request', { p_id: id, p_reason: reason || '' }),
    recordPayment: (id, payment) => rpc('app_record_payment', { p_id: id, p_payment: payment }),
    deletePayment: (id, payId) => rpc('app_delete_payment', { p_id: id, p_pay_id: payId }),
    accountingSave: (id, data) => rpc('app_accounting_save', { p_id: id, p_data: data }),
    listUsers: () => rpc('app_list_users'),
    listRoles: () => rpc('app_list_roles'),
    saveRole: (r) => rpc('app_save_role', { p_key: r.key, p_name: r.name, p_description: r.description || '', p_permissions: r.permissions || [] }),
    deleteRole: (key) => rpc('app_delete_role', { p_key: key }),
    updateUser: (u) => rpc('app_update_user', { p_id: u.id, p_name: u.name, p_title: u.title, p_department: u.department, p_role: u.role || '', p_active: u.active })
  };
})();

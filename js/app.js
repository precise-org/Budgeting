/*
 * ระบบขอเบิกใช้งบประมาณ (ต้นแบบ)
 *
 * งบได้รับอนุมัติมาแล้ว ระบบนี้ใช้ยืนยันว่าใช้ถูกตัวงบ และติดตามยอดคงเหลือ
 *
 * - การเงิน: บันทึกงบที่อนุมัติแล้ว และปรับงบ (เก็บประวัติทุกครั้ง)
 *     CAPEX = รหัสโครงการ (Project No.) → รายการย่อย (Item No.)
 *     OPEX   = Job No. → รายการต้นทุนหลายชั้น (1 → 1.1 → 1.1.1) พร้อม GL Code
 * - ผู้ขอใช้งบ: ดูยอดคงเหลือ แล้วจัดทำเอกสารขอเบิกโดยระบุตัวงบทุกครั้งที่จะใช้
 *     CAPEX: ส่งให้การเงินตรวจสอบ → อนุมัติ (ออกใบเบิกงบประมาณ) / ไม่อนุมัติ (แก้ไขส่งใหม่หรือยกเลิก)
 *     CBS:   ออกเอกสารทันที ไม่ผ่านการเงิน (ใช้เกินงบได้แต่ต้องระบุเหตุผล) และผู้ขอยกเลิกเองได้
 * - บัญชี: บันทึกข้อมูลบัญชีของเอกสารที่ออกแล้ว (CAPEX แยก Asset/Expense, OPEX GL Code/สถานะจ่าย)
 *
 * ข้อมูลเก็บใน localStorage ของเบราว์เซอร์ (ยังไม่มี backend) — ข้อมูลตัวอย่างทั้งหมดเป็นข้อมูลสมมติ
 */
(function () {
  'use strict';

  const DB_KEY = 'procurement.v5';
  const VAT_RATE = 0.07;

  /** โหมดเชื่อม Supabase (ล็อกอินจริง ข้อมูลกลาง) เมื่อใส่ค่าใน js/config.js — ถ้าไม่ใส่จะเป็นโหมดทดลองในเบราว์เซอร์ */
  // ต้นแบบรอบใหม่ (วงจรงบ + เบิกใช้งบ) ยังไม่ได้เชื่อมฐานข้อมูล Supabase จึงใช้โหมดทดลองเสมอ
  // (เวอร์ชันที่เชื่อม Supabase ได้แล้วเก็บไว้ที่ /v1/)
  const REMOTE = false;
  /**
   * บัญชีและล็อกอินจริงบน Supabase (เฟส 1 — supabase/schema_v2.sql + Edge Function v2-admin-users)
   * เปิดเองเมื่อใส่ supabaseAnonKey ใน js/config.js · ข้อมูลงบ/คำขอยังเก็บในเบราว์เซอร์ (เฟส 2 จะย้ายขึ้นฐานข้อมูล)
   */
  const AUTH_REMOTE = !REMOTE && !!(window.RemoteApi && window.RemoteApi.enabled);

  /** บัญชีตัวอย่าง (โหมดทดลอง): อีเมลสมมติทั้งหมด — ผู้ใช้จริงให้ Admin เพิ่มอีเมลเอง ส่วนรหัสผ่านผู้ใช้ตั้งเอง */
  const DEMO_USERS = [
    { id: 'req1', email: 'somchai@demo.test', name: 'สมชาย ใจดี', title: 'วิศวกร', department: 'ฝ่ายวิศวกรรม', company: 'PBI', role: 'business' },
    { id: 'req2', email: 'suda@demo.test', name: 'สุดา รักงาน', title: 'เจ้าหน้าที่โครงการ', department: 'ฝ่ายโครงการ', company: 'PBI', role: 'business' },
    { id: 'fin1', email: 'mali@demo.test', name: 'มาลี เงินดี', title: 'บัญชีการเงิน', department: 'ฝ่ายบัญชีการเงิน', company: 'PBI', companies: ['PBI', 'PCC'], role: 'controller' },
    { id: 'fin2', email: 'wipa@demo.test', name: 'วิภา บัญชี', title: 'บัญชีการเงิน', department: 'ฝ่ายบัญชีการเงิน', company: 'PCC', companies: ['PCC'], role: 'controller' },
    { id: 'pur1', email: 'piti@demo.test', name: 'ปิติ จัดหา', title: 'เจ้าหน้าที่จัดซื้อ', department: 'ฝ่ายจัดซื้อ', company: 'PBI', companies: ['PBI', 'PCC'], role: 'purchasing' },
    { id: 'acc1', email: 'nida@demo.test', name: 'นิดา บัญชี', title: 'เจ้าหน้าที่บัญชี', department: 'ฝ่ายบัญชี', company: 'PBI', companies: ['PBI', 'PCC'], role: 'accountant' },
    { id: 'ast1', email: 'pim@demo.test', name: 'พิมพ์ ธุรการ', title: 'ธุรการ', department: 'ฝ่ายวิศวกรรม', company: 'PBI', companies: ['PBI'], role: 'assistant' },
    { id: 'adm1', email: 'adisorn@demo.test', name: 'อดิศร ดูแลระบบ', title: 'ผู้ดูแลระบบ (IT)', department: 'ฝ่าย IT', company: 'PBI', role: 'admin' }
  ];
  /** เปิดปุ่ม "เข้าด้วยบัญชีตัวอย่าง" ในหน้าล็อกอิน (โหมดทดลองเท่านั้น — ข้ามรหัสผ่านเพื่อทดสอบบทบาทต่างๆ) ปิดเมื่อใช้งานจริง */
  const DEMO_QUICK_LOGIN = false;
  let USERS = AUTH_REMOTE ? [] : DEMO_USERS.map((x) => Object.assign({ active: true, mustSetPassword: true, pwHash: '', pwSalt: '' }, x)); // โหมด Supabase: แทนที่ด้วยรายชื่อผู้ใช้จากฐานข้อมูล
  let remoteMe = null; // โหมด Supabase: ผู้ใช้ที่ล็อกอินอยู่ (null = ยังไม่ได้ล็อกอิน)

  const ROLE_LABEL = {
    business: 'Business (ผู้ขอใช้งบ)',
    controller: 'ผู้คุมงบ',
    accountant: 'บัญชี',
    assistant: 'Admin ผู้ช่วย Business (ธุรการ)',
    purchasing: 'จัดซื้อ',
    admin: 'ผู้ดูแลระบบ (Admin)',
    // ชื่อบทบาทเดิม (ยังอยู่ในประวัติของเอกสารเก่า)
    requester: 'ผู้ขอใช้งบ',
    finance: 'ผู้คุมงบ',
    accounting: 'ผู้คุมงบ'
  };

  /** สิทธิ์ทั้งหมดของระบบ (ต้นแบบรอบใหม่ — ฐานข้อมูลจะปรับตามเมื่อยืนยันขั้นตอนแล้ว) */
  const PERMISSIONS = [
    { key: 'budget.view_all', group: 'การมองเห็น', label: 'ดูงบและเอกสารของทุกคน', hint: 'ถ้าไม่มี จะเห็นเฉพาะงบที่ตนสร้าง/เป็นเจ้าของ' },
    { key: 'budget.create', group: 'Business', label: 'ขออนุมัติงบใหม่', hint: 'สร้างร่าง แนบมติที่ประชุม ส่งให้ผู้คุมงบเปิดใช้' },
    { key: 'request.create', group: 'Business', label: 'ขอเบิกใช้งบ / ขอเพิ่มงบ', hint: 'เฉพาะงบที่ตนเป็นเจ้าของ' },
    { key: 'business.proxy', group: 'Business', label: 'ทำเอกสารแทน Business (ธุรการ) — ยกเว้นเปิดใช้งบ', hint: 'ทำงบ คำขอเบิก ขอเพิ่มงบ Plan Cashflow Item ย่อยแทนเจ้าของงบในบริษัทที่มีสิทธิ์ · เปิดใช้งบครั้งแรกต้องเป็น Business เจ้าของงบเท่านั้น' },
    { key: 'budget.verify', group: 'ผู้คุมงบ', label: 'ตรวจอนุมัติงบ / ยืนยันเปิดใช้งบ / ยืนยันเพิ่มงบ', hint: 'ตรวจมติแล้วยืนยันหรือส่งกลับ' },
    { key: 'budget.adjust', group: 'ผู้คุมงบ', label: 'โยกงบ / ลดงบ', hint: 'โยกข้ามรายการหรือโครงการได้ ต้องระบุเหตุผล' },
    { key: 'budget.manage', group: 'ผู้คุมงบ', label: 'ลงงบประจำปี (สร้าง / Import Excel)', hint: 'ลงงบให้ Business ขอดำเนินการใช้งบครั้งแรก · จัดการ Item ย่อย' },
    { key: 'request.decide', group: 'ผู้คุมงบ', label: 'ตรวจสอบ / อนุมัติการเบิกใช้งบ', hint: 'ขอเกินงบรายการต้องใส่ Note' },
    { key: 'cut.record', group: 'ผู้คุมงบ', label: 'บันทึกการตัดงบและปิดยอด', hint: 'Advance · สำรองจ่าย · จ่ายตรง Supplier · ปิดยอดคืนส่วนต่าง (CAPEX และ OPEX)' },
    { key: 'po.record', group: 'จัดซื้อ', label: 'บันทึก PR / PO', hint: 'ตัดงบ PR/PO ตามยอด PO' },
    { key: 'gl.manage', group: 'บัญชี', label: 'ใส่ / แก้ GL Code (OPEX)', hint: 'หน้าจัดการ GL — กรอก GL ของ Item ได้ตั้งแต่ Business ขอเปิดงบ OPEX · ไม่ใช่ผู้คุมงบ' },
    { key: 'master.manage', group: 'ผู้ดูแลระบบ', label: 'จัดการข้อมูลหลัก', hint: 'บริษัท หน่วยงาน กลุ่มรายการ กลุ่ม Priority Supplier' },
    { key: 'data.export', group: 'การเงิน / บัญชี', label: 'ส่งออกข้อมูล (Excel)', hint: 'ดาวน์โหลดข้อมูลงบ คำขอ การตัดงบ ปรับงบ Plan Cashflow เป็นไฟล์ .xlsx' },
    { key: 'log.view', group: 'ผู้ดูแลระบบ', label: 'ดู Log การทำงาน', hint: '' },
    { key: 'user.manage', group: 'ผู้ดูแลระบบ', label: 'จัดการผู้ใช้ บทบาท และสิทธิ์', hint: 'หน้า Admin: เพิ่ม/แก้ผู้ใช้ รีเซ็ตรหัสผ่าน แก้สิทธิ์ของบทบาท' }
  ];
  /** โหมดทดลอง: สิทธิ์ตั้งต้นของแต่ละบทบาท */
  const DEMO_ROLE_PERMS = {
    business: ['budget.create', 'request.create'],
    controller: ['budget.view_all', 'budget.manage', 'budget.verify', 'budget.adjust', 'request.decide', 'cut.record', 'data.export'],
    accountant: ['budget.view_all', 'gl.manage', 'data.export'],
    assistant: ['request.create', 'business.proxy'],
    purchasing: ['budget.view_all', 'po.record'],
    admin: ['budget.view_all', 'master.manage', 'log.view', 'user.manage', 'data.export']
  };
  /** โหมดทดลอง: Admin แก้สิทธิ์ของบทบาท / สร้างบทบาทเพิ่มได้ — เก็บในเบราว์เซอร์ (คีย์ procurement.v5.roles) แล้วทับค่าตั้งต้นด้านบน */
  const ROLES_KEY = DB_KEY + '.roles';
  const BUILTIN_ROLES = Object.keys(DEMO_ROLE_PERMS);
  const DEFAULT_ROLE_PERMS = JSON.parse(JSON.stringify(DEMO_ROLE_PERMS));
  const DEFAULT_ROLE_LABEL = Object.assign({}, ROLE_LABEL);
  function loadRoles() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ROLES_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') return;
    Object.keys(saved).forEach((k) => {
      const r = saved[k];
      if (!r || !Array.isArray(r.perms)) return;
      DEMO_ROLE_PERMS[k] = r.perms.filter((x) => PERMISSIONS.some((p) => p.key === x));
      if (r.name) ROLE_LABEL[k] = String(r.name);
    });
    if (!DEMO_ROLE_PERMS.admin.includes('user.manage')) DEMO_ROLE_PERMS.admin.push('user.manage');
  }
  function saveRoles() {
    const out = {};
    Object.keys(DEMO_ROLE_PERMS).forEach((k) => { out[k] = { perms: DEMO_ROLE_PERMS[k], name: ROLE_LABEL[k] }; });
    try { localStorage.setItem(ROLES_KEY, JSON.stringify(out)); return true; } catch (e) { alert('บันทึกบทบาทไม่สำเร็จ (พื้นที่เบราว์เซอร์เต็ม)'); return false; }
  }
  if (!REMOTE && !AUTH_REMOTE) loadRoles();

  const COMPANIES = { PBI: 'บริษัท PBI (ตัวอย่าง)', PCC: 'บริษัท PCC (ตัวอย่าง)' };
  /**
   * เกณฑ์ Memo ผู้บริหารเซ็นตอนขอเบิกใช้งบ (ตั้งรายบริษัทที่ข้อมูลหลัก)
   * '' = ไม่ต้องใช้ · 'cross' = ต้องทำเมื่อใช้เงินข้ามบริษัทกับบริษัทนี้ (บริษัทอื่นมาใช้งบของบริษัทนี้ หรือบริษัทนี้ออกเงินให้งบของบริษัทอื่น)
   */
  const MEMO_MODES = [['', 'ไม่ต้องใช้'], ['cross', 'ใช้เงินข้ามบริษัทกับบริษัทนี้']];
  /** เกณฑ์ตั้งต้น: งบของ PCC ที่บริษัทอื่นมาใช้ (หรือ PCC ออกเงินให้งบของบริษัทอื่น) ต้องทำ Memo */
  const memoDefaultFor = (code) => (code === 'PCC' ? 'cross' : '');
  const TYPE_LABEL = { CAPEX: 'งบลงทุน (CAPEX)', CBS: 'งบดำเนินงาน (OPEX)' };
  /** ชื่อย่อที่แสดง: รหัสภายใน 'CBS' แสดงเป็น OPEX */
  const TYPE_SHORT = { CAPEX: 'CAPEX', CBS: 'OPEX' };
  const STATUS_LABEL = {
    memo: 'รอแนบ Memo ที่เซ็นแล้ว',
    pending: 'รอผู้คุมงบตรวจสอบ',
    approved: 'ออกเอกสารแล้ว',
    closed: 'ปิดยอดแล้ว',
    rejected: 'ส่งกลับแก้ไข',
    cancelled: 'ยกเลิก'
  };
  /**
   * สถานะของตัวงบ
   * ขั้นตอนหลัก (CAPEX / OPEX เหมือนกัน — ดู FLOW_BU / FLOW_CTL):
   *   Business สร้าง: draft / returned (สร้างงบประมาณ) → review รออนุมัติ (ผู้คุมงบตรวจเอกสารอนุมัติที่เซ็นนอกระบบ ผ่าน = pending_open / ส่งกลับ = returned)
   *     → pending_open · open_review · open_returned (เปิดใช้: CAPEX ส่ง Memo ให้ผู้คุมงบยืนยัน · OPEX Business กดขอดำเนินการใช้งบ) → active
   *   ผู้คุมงบสร้าง / Import: pending_open (สร้างงบประมาณ) → เปิดใช้ → active
   */
  const BUDGET_STATE = {
    draft: 'ร่าง', review: 'รออนุมัติ', returned: 'ส่งกลับแก้ไข',
    pending_open: 'ยังไม่เปิดใช้งบ', open_review: 'รอผู้คุมงบตรวจ Memo ขอดำเนินการใช้งบ', open_returned: 'ส่งกลับแก้ Memo ขอดำเนินการใช้งบ',
    active: 'เปิดใช้งบ', cancelled: 'ยกเลิก'
  };
  const BUDGET_STATE_BADGE = { draft: 'draft', review: 'pending', returned: 'rejected', pending_open: 'draft', open_review: 'pending', open_returned: 'rejected', active: 'approved', cancelled: 'cancelled' };
  /** งบที่ผู้คุมงบลงไว้ ยังรอ Business ขอดำเนินการใช้งบครั้งแรก (Business ทำ Memo / ขอดำเนินการใช้งบได้) */
  const waitingOpen = (b) => b.state === 'pending_open' || b.state === 'open_returned';
  /**
   * ขั้นตอนหลักของงบ (CAPEX / OPEX เหมือนกัน)
   *   Business สร้าง: สร้างงบประมาณ (ร่าง / ส่งกลับแก้ไข) → อนุมัติ (รออนุมัติ — ผู้คุมงบตรวจเอกสารอนุมัติที่ผู้อนุมัติเซ็นนอกระบบ ผ่าน / ส่งกลับ)
   *     → เปิดใช้ (ยังไม่เปิดใช้งบ → ส่ง Memo → รอผู้คุมงบตรวจ Memo) → จบเมื่อเปิดใช้งบ
   *   ผู้คุมงบสร้าง / Import: สร้างงบประมาณ → เปิดใช้ (เหมือนข้างบน) — ไม่มีขั้นอนุมัติ
   */
  const FLOW_BU = ['สร้างงบประมาณ', 'อนุมัติ', 'เปิดใช้'];
  const FLOW_CTL = ['สร้างงบประมาณ', 'เปิดใช้'];
  /** งบนี้อยู่ในขั้น "เปิดใช้" ได้ (ผู้คุมงบสร้าง หรือ Business สร้างแล้วผู้คุมงบอนุมัติแล้ว) */
  const openFlow = (b) => !!(b.setup || b.opening);
  const flowIndex = (b, setup) => {
    const st = b.state || 'active';
    if (st === 'cancelled') return -1;
    if (st === 'active') return (setup ? FLOW_CTL : FLOW_BU).length;
    if (st === 'pending_open' || st === 'open_review' || st === 'open_returned') return setup ? 1 : 2;
    if (st === 'review') return 1;
    return 0;
  };
  /** ประเภทการเบิกใช้งบ (CAPEX) และจังหวะที่ตัดงบจริง */
  const USE_TYPES = {
    prpo: { label: 'ซื้อโดยเปิด PR / PO', short: 'PR/PO', cut: 'ตัดงบเมื่อจัดซื้อออก PO (ตามยอด PO)', who: 'จัดซื้อ' },
    advance: { label: 'Advance (เงินทดรอง)', short: 'Advance', cut: 'ผู้คุมงบอนุมัติ = จ่ายเงินทดรอง · ตัดงบเมื่อ Business / ธุรการเคลียร์เงินทดรองพร้อมใบเสร็จ', who: 'Business / ธุรการ (เคลียร์)' },
    reimburse: { label: 'พนักงานสำรองจ่าย', short: 'สำรองจ่าย', cut: 'ตัดงบทันทีเมื่อผู้คุมงบตรวจผ่าน (ปิดยอดอัตโนมัติ)', who: 'ผู้คุมงบ (อัตโนมัติ)' },
    direct: { label: 'จ่ายตรงให้ Supplier', short: 'จ่ายตรง', cut: 'ตัดงบทันทีเมื่อผู้คุมงบตรวจผ่าน (ปิดยอดอัตโนมัติ)', who: 'ผู้คุมงบ (อัตโนมัติ)', hint: 'ค่าแรง · จ้างเหมา · จ่ายรายวัน · ค่าน้ำมัน · Stock' }
  };
  /** โหมดทดลองเก็บไฟล์แนบในเบราว์เซอร์ จึงจำกัดขนาดไว้เล็ก (ระบบจริงเก็บใน Storage ได้ใหญ่กว่า) */
  const ATTACH_MAX = 400 * 1024;
  /** กลุ่ม Priority ตั้งต้น (ตามไฟล์ Capex / Opex Governance Framework) — เพิ่ม / แก้ได้ที่ข้อมูลหลัก */
  const DEFAULT_PRIORITY_GROUPS = ['เพิ่มรายได้ (Revenue Growth)', 'ลดรายจ่าย (Cost Efficiency)', 'สร้างโอกาสอนาคต (Strategic/Future Growth)'];
  /** ตัวเลือกตั้งต้นของหน้าสร้างงบ (ตามที่เจ้าของระบบกำหนด) — เพิ่ม / แก้ได้ที่ข้อมูลหลัก */
  const DEFAULT_DEPARTMENTS = ['FAC-PBI103', 'IT-WSW', 'PBI101', 'PBI103', 'PBI104'];
  const DEFAULT_INVEST_GROUPS = ['Digital AI Automation', 'Investment to Build the Future', 'Maintenance or Renovate', 'Platform to Ecosystem for BG', 'Production System Development for Demand Satisfaction'];
  /** รุ่นของตัวเลือกตั้งต้น: เปลี่ยนเลขเมื่อปรับรายการ เพื่อเติมให้ข้อมูลเดิมในเบราว์เซอร์ครั้งเดียว */
  const MASTER_LISTS_V = 2;
  const CBS_STATUS = ['Plan', 'On Progress', 'แล้วเสร็จ'];

  // ---------------------------------------------------------------- storage


  /**
   * ข้อมูลหลัก (การเงินแก้ได้ที่เมนู "ข้อมูลหลัก"): บริษัท, หน่วยงาน, กลุ่มรายการ, กลุ่ม Priority, Supplier
   * เติมค่าตั้งต้นให้ครบ รวมค่าที่งบเดิมใช้อยู่แล้ว จะได้ไม่มีงบที่อ้างถึงค่าที่ไม่มีในรายการ
   */
  function ensureMaster(d) {
    const m = d.master || {};
    const list = (k) => (Array.isArray(m[k]) ? m[k] : []);
    const addBy = (arr, key, item) => { if (item[key] && !arr.some((x) => x[key] === item[key])) arr.push(item); };
    const companies = list('companies').slice();
    if (!REMOTE) Object.keys(COMPANIES).forEach((c) => addBy(companies, 'code', { code: c, name: COMPANIES[c] }));
    const departments = list('departments').slice();
    const priorityGroups = list('priorityGroups').slice();
    if (!priorityGroups.length) DEFAULT_PRIORITY_GROUPS.forEach((n) => priorityGroups.push({ name: n }));
    const investGroups = list('investGroups').slice();
    const listGroups = list('listGroups').slice();
    const suppliers = list('suppliers').slice();
    // บรรทัดคำขอที่เคยเก็บเป็น worker (ชื่อคนงาน) → supplier
    (d.requests || []).forEach((r) => (r.lines || []).forEach((l) => {
      if (l.worker) { if (!l.supplier) l.supplier = l.worker; delete l.worker; }
      addBy(suppliers, 'name', { name: l.supplier });
    }));
    // คำขอ OPEX เดิมที่ยังไม่มี Supplier รายบรรทัด: ใช้ชื่อผู้รับเงินเป็นตัวเลือก
    (d.requests || []).forEach((r) => { if (r.payee && !/ราย \(ดูรายการ\)$/.test(r.payee) && !(r.lines || []).some((l) => l.supplier)) addBy(suppliers, 'name', { name: r.payee }); });
    (d.budgets || []).forEach((b) => {
      addBy(companies, 'code', { code: b.company, name: '' });
      addBy(departments, 'name', { name: b.department });
      addBy(priorityGroups, 'name', { name: b.priorityGroup });
      addBy(investGroups, 'name', { name: b.investGroup });
      addBy(listGroups, 'name', { name: b.listGroup });
    });
    // ค่าเดิมแบบติ๊ก (true/false) หรือยังไม่ตั้ง → ใช้เกณฑ์ตั้งต้น "เฉพาะงบที่ไม่มี Item"
    // เกณฑ์ Memo แบบใหม่ (ใช้เงินข้ามบริษัท) — เปลี่ยนจากเกณฑ์เดิมครั้งเดียว แล้วปรับเองได้ที่ข้อมูลหลัก
    if (m.memoRule !== 2) companies.forEach((c) => { c.memo = memoDefaultFor(c.code); });
    companies.forEach((c) => { if (!MEMO_MODES.some(([v]) => v === c.memo)) c.memo = memoDefaultFor(c.code); });
    // ตัวเลือกตั้งต้นรุ่นใหม่ (ครั้งเดียว): เติมหน่วยงาน / กลุ่ม Priority / กลุ่ม Priority การลงทุน · เอากลุ่ม Priority ตั้งต้นเดิมที่ไม่อยู่ในรายการใหม่ออก ถ้ายังไม่มีงบใช้
    let prio = priorityGroups;
    if (m.listsV !== MASTER_LISTS_V) {
      const used = new Set((d.budgets || []).map((b) => b.priorityGroup).filter(Boolean));
      const oldDefault = 'จำเป็นต้องมี/ตามกฎหมาย (Mandatory/Compliance/BAU)';
      prio = DEFAULT_PRIORITY_GROUPS.map((n) => ({ name: n })).concat(priorityGroups.filter((x) => !DEFAULT_PRIORITY_GROUPS.includes(x.name) && (x.name !== oldDefault || used.has(x.name))));
      DEFAULT_DEPARTMENTS.forEach((n) => addBy(departments, 'name', { name: n }));
      DEFAULT_INVEST_GROUPS.forEach((n) => addBy(investGroups, 'name', { name: n }));
    }
    d.master = { companies, departments, priorityGroups: prio, investGroups, listGroups, suppliers, memoRule: 2, listsV: MASTER_LISTS_V };
    return d;
  }
  const companyMap = () => Object.fromEntries(db.master.companies.map((c) => [c.code, c.name]));
  /** บริษัทที่ลงทุน: ทุก Item ใช้งบของบริษัทเจ้าของงบ (ไม่มีการใช้งบข้ามบริษัทราย Item) · งบที่ไม่มี Item เลือกรายบรรทัดตอนขอเบิกใช้งบ */
  const itemInvestor = (b) => b.company;
  const lineInvestor = (b, l) => l.investor || (b.structure === 'project' ? b.company : itemInvestor(b, itemById(b, l.itemId)));
  const investorSelect = (name, selected, label) => '<div class="select-wrap"><select name="' + name + '" aria-label="' + (label || 'บริษัทที่ลงทุน') + '">' +
    optList(db.master.companies, 'code', (c) => c.code, selected) + '</select></div>';
  /** หลายคนคั่นด้วย ; หรือขึ้นบรรทัดใหม่ */
  const splitPeople = (v) => String(v || '').split(/\s*;\s*|\n/).map((x) => x.trim()).filter(Boolean);
  /** ผู้รับ/ผู้ลงนามใน Memo: เริ่มว่าง — ผู้ทำ Memo กรอกเองในแบบฟอร์ม (ไม่มีข้อมูลหลักผู้ลงนามแล้ว) */
  function defaultMemoParties() {
    return { to: [], cc: [], reviewers: [], approvers: [], proposer: '' };
  }
  const investorCell = (code) => '<span class="nowrap">' + esc(code) + '</span>';

  function seed() {
    const now = new Date();
    const iso = (d) => new Date(d).toISOString();
    const nowIso = now.toISOString();
    const year = now.getFullYear();
    const prev = year - 1;
    const yy = String(year).slice(-2);
    const day = (m, d) => year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const item = (id, code, name, _unused, amount) => ({ id, code, name, amount });
    const cbs = (id, code, name, extra) => Object.assign({ id, code, name, qty: '', unit: '', amount: 0, vat: 0, glCode: '', glName: '' }, extra || {});
    const sampleFile = (name) => ({ id: 'f-' + name, slot: 'resolution', name, size: 0, sample: true, at: nowIso, by: 'req1' });
    const budgets = [
      {
        id: 'b1', type: 'CAPEX', company: 'PBI', fiscalYear: year, code: 'EN0001', structure: 'items',
        name: 'ปรับปรุงสายการผลิต Phase 1', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: 'งบตัวอย่าง',
        meeting: { date: day(1, 15), no: 'มติที่ 1/' + year, note: 'ประชุมคณะกรรมการบริหาร' },
        items: [
          item('c1', year + '-01-EN001', 'เครื่องตัดชิ้นงาน', 'เครื่องจักร', 500000),
          item('c2', year + '-01-EN002', 'เครื่องมือและอุปกรณ์ห้องปฏิบัติการ', 'เครื่องมือและอุปกรณ์', 610000),
          item('c3', year + '-01-EN003', 'ระบบลำเลียงวัตถุดิบ (Conveyor)', 'เครื่องจักร', 1500000)
        ]
      },
      {
        id: 'b2', type: 'CAPEX', company: 'PBI', fiscalYear: year, code: 'IT0001', structure: 'items',
        name: 'อุปกรณ์ IT สำนักงาน', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: '',
        meeting: { date: day(1, 15), no: 'มติที่ 1/' + year, note: '' },
        items: [item('c4', year + '-01-IT001', 'คอมพิวเตอร์และอุปกรณ์ต่อพ่วง', 'อุปกรณ์สำนักงาน', 450000)]
      },
      {
        id: 'b3', type: 'CBS', company: 'PBI', fiscalYear: year, code: 'PJ0001-1', structure: 'items',
        name: 'ผลิตกล้าไม้ 10,000 กล้า', department: 'ฝ่ายโครงการ', ownerId: 'req2', note: '',
        meeting: { date: day(1, 3), no: 'อนุมัติผู้บริหาร MD-001/' + year, by: 'กรรมการผู้จัดการ', note: 'OPEX ไม่ต้องเข้าบอร์ด' },
        // Item หลัก (1, 2, 3, 4) มีวงเงินของตัวเอง · Item ย่อย (1.1 ...) เพิ่มทีหลัง จะกำหนดวงเงินหรือไม่ก็ได้ (ตัวอย่าง: 1.3 ไม่กำหนดวงเงิน)
        items: [
          cbs('i1', '1', 'ต้นทุนวัตถุดิบ', { amount: 269500, vat: 315, glCode: '510101', glName: 'ค่าวัตถุดิบ' }),
          cbs('i2', '1.1', 'กล้าพันธุ์ (รวมค่าขนส่ง)', { qty: 10000, unit: 'ต้น', amount: 230000, glCode: '510101', glName: 'ค่าวัตถุดิบ' }),
          cbs('i3', '1.2', 'วัสดุปลูก', { amount: 35000, glCode: '510101', glName: 'ค่าวัตถุดิบ' }),
          cbs('i4', '1.2.1', 'ดินผสม', { amount: 20000, glCode: '510101', glName: 'ค่าวัตถุดิบ' }),
          cbs('i5', '1.2.2', 'ถุงเพาะ ขนาด 6x12 นิ้ว', { amount: 15000, glCode: '510101', glName: 'ค่าวัตถุดิบ' }),
          cbs('i6', '1.3', 'วัสดุสิ้นเปลืองอื่น ๆ', { glCode: '510102', glName: 'วัสดุสิ้นเปลือง' }),
          cbs('i7', '2', 'ต้นทุนค่าแรง', { amount: 65000, glCode: '520101', glName: 'ค่าแรงงาน' }),
          cbs('i8', '2.1', 'คนงานประจำ', { qty: 2, unit: 'คน', amount: 20000, glCode: '520101', glName: 'ค่าแรงงาน' }),
          cbs('i9', '2.2', 'คนงานรายวัน', { unit: 'คน', amount: 45000, glCode: '520101', glName: 'ค่าแรงงาน' }),
          cbs('i10', '3', 'ต้นทุนค่าเช่า', { amount: 3000, glCode: '530101', glName: 'ค่าเช่าและสาธารณูปโภค' }),
          cbs('i11', '3.1', 'ค่าระบบน้ำ', { amount: 3000, glCode: '530101', glName: 'ค่าเช่าและสาธารณูปโภค' }),
          cbs('i12', '4', 'รายการส่วนเพิ่มอื่นๆ', { amount: 5000, glCode: '540101', glName: 'ค่าขนส่ง' }),
          cbs('i13', '4.1', 'ค่าขนส่ง', { amount: 5000, glCode: '540101', glName: 'ค่าขนส่ง' })
        ]
      },
      {
        id: 'b4', type: 'CAPEX', company: 'PBI', fiscalYear: prev, code: 'EN0002', structure: 'items',
        name: 'ระบบไอน้ำ (ยกมาจากปีก่อน)', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: 'งบปีก่อน ยกมาใช้ต่อ',
        meeting: { date: prev + '-02-10', no: 'มติที่ 2/' + prev, note: '' },
        items: [item('c5', prev + '-02-EN001', 'ชุดหม้อไอน้ำและท่อ', 'เครื่องจักร', 800000)]
      },
      {
        id: 'b5', type: 'CAPEX', company: 'PCC', fiscalYear: year, code: 'PD0001', structure: 'items',
        name: 'อุปกรณ์คลังสินค้า', department: 'ฝ่ายผลิต', ownerId: 'req2', note: '',
        meeting: { date: day(2, 1), no: 'มติที่ 2/' + year, note: '' },
        items: [
          item('c6', year + '-04-PD001', 'รถยกไฟฟ้า', 'ยานพาหนะ', 1200000),
          item('c7', year + '-04-PD002', 'ชั้นวางสินค้า', 'อื่นๆ', 300000)
        ]
      },
      {
        id: 'b6', type: 'CAPEX', company: 'PBI', fiscalYear: year, code: 'BD0001', structure: 'project',
        name: 'ปรับปรุงอาคารสำนักงาน (งบรวมโครงการ)', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: 'ยังไม่แยกรายการย่อย เพราะรายละเอียดยังไม่ชัดเจน',
        meeting: { date: day(3, 10), no: 'มติที่ 3/' + year, note: '' },
        items: [item('c8', 'BD0001', 'งบรวมทั้งโครงการ', 'อาคารและสิ่งปลูกสร้าง', 900000)]
      },
      {
        id: 'b7', type: 'CAPEX', company: 'PBI', fiscalYear: year + 1, code: 'EN0003', structure: 'project', state: 'draft',
        name: 'ระบบโซลาร์รูฟท็อป', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: 'เตรียมเข้าที่ประชุมรอบหน้า',
        items: [item('c10', 'EN0003', 'งบรวมทั้งโครงการ', 'เครื่องจักร', 2500000)]
      },
      {
        id: 'b8', type: 'CAPEX', company: 'PCC', fiscalYear: year, code: 'PD0002', structure: 'items', state: 'review',
        name: 'รถยกไฟฟ้าเพิ่มเติม', department: 'ฝ่ายผลิต', ownerId: 'req2', note: '',
        meeting: { date: day(10, 20), no: 'มติที่ 9/' + year, note: 'อนุมัติเต็มจำนวน' },
        attachments: [sampleFile('มติที่ประชุม-9-' + year + '.pdf')],
        items: [item('c9', year + '-04-PD003', 'รถยกไฟฟ้า 2 ตัน', 'ยานพาหนะ', 980000)]
      },
      {
        id: 'b9', type: 'CAPEX', company: 'PBI', fiscalYear: year + 1, code: 'CP0101', structure: 'items', state: 'pending_open', setup: true,
        name: 'ระบบบำบัดน้ำเสียโรงงาน 2', department: 'ฝ่ายวิศวกรรม', ownerId: 'req1', note: 'งบประจำปี ' + (year + 1) + ' ตามแผนที่บอร์ดอนุมัติ',
        meeting: { date: day(10, 25), no: 'มติงบประจำปี ' + (year + 1), note: '' },
        items: [item('c11', 'CP0101-01', 'ถังบำบัดและระบบเติมอากาศ', 'เครื่องจักร', 1800000), item('c12', 'CP0101-02', 'งานโยธาและติดตั้ง', 'อาคารและสิ่งปลูกสร้าง', 650000)]
      },
      {
        id: 'b10', type: 'CBS', company: 'PBI', fiscalYear: year + 1, code: 'OP0101', structure: 'items', state: 'draft',
        name: 'ค่าใช้จ่ายดำเนินงานแปลงเกษตร ' + (year + 1), department: 'ฝ่ายโครงการ', ownerId: 'req2', note: 'Business สร้างเอง — รอเสนอผู้บริหารอนุมัติ',
        items: [
          { id: 'i20', code: '1', name: 'ต้นทุนวัตถุดิบ', qty: '', unit: '', amount: 300000, vat: 21000, glCode: '510101', glName: 'ค่าวัตถุดิบ' },
          { id: 'i21', code: '2', name: 'ต้นทุนค่าแรง', qty: '', unit: '', amount: 240000, vat: 0, glCode: '', glName: '' }
        ]
      }
    ];
    budgets.forEach((b) => {
      b.createdAt = iso(day(1, 2));
      b.createdBy = b.ownerId;
      b.state = b.state || 'active';
      b.history = [{ at: b.createdAt, by: b.ownerId, action: 'สร้างร่างคำขออนุมัติงบ' }];
      if (b.setup) {
        b.createdBy = 'fin1';
        b.history = [{ at: b.createdAt, by: 'fin1', action: 'ผู้คุมงบลงงบประจำปี — รอ Business ขอดำเนินการใช้งบ' }];
        b.attachments = [];
        b.revisions = [];
        return;
      }
      if (b.state !== 'draft') {
        b.attachments = b.attachments || [sampleFile((b.type === 'CBS' ? 'เอกสารอนุมัติผู้บริหาร-' : 'มติที่ประชุม-') + b.code + '.pdf')];
        b.history.push({ at: iso(b.meeting.date), by: b.ownerId, action: b.type === 'CBS' ? 'แนบเอกสารอนุมัติผู้บริหารและส่งให้ผู้คุมงบตรวจสอบ' : 'แนบมติที่ประชุมและส่งให้ผู้คุมงบตรวจสอบ', note: b.meeting.no });
      }
      b.attachments = b.attachments || [];
      if (b.state === 'active') {
        b.activatedAt = iso(b.meeting.date);
        b.activatedBy = 'fin1';
        b.history.push({ at: b.activatedAt, by: 'fin1', action: 'ยืนยันเปิดใช้งบ' });
        b.revisions = [{ no: 0, at: b.activatedAt, by: 'fin1', note: 'เปิดใช้งบตาม' + b.meeting.no, total: budgetTotal(b), items: snapshotItems(b) }];
      } else {
        b.revisions = [];
      }
    });
    // ตัวอย่างการปรับงบหลังเปิดใช้: เครื่องตัดชิ้นงาน 400,000 → 500,000
    budgets[0].revisions[0].items[0].total = 400000;
    budgets[0].revisions[0].total -= 100000;
    budgets[0].revisions.push({ no: 1, at: iso(day(4, 2)), by: 'fin1', note: 'เพิ่มงบเครื่องตัดชิ้นงานตามมติที่ 4/' + year, total: budgetTotal(budgets[0]), items: snapshotItems(budgets[0]) });

    // ---- ตัวอย่างการเบิกใช้งบในสถานะต่าง ๆ
    const line = (itemId, description, before, extra) => Object.assign({ itemId, description, amountBeforeVat: before, vat: round2(before * VAT_RATE), amount: round2(before * (1 + VAT_RATE)) }, extra || {});
    const mk = (o) => {
      const amountBeforeVat = round2(o.lines.reduce((s, l) => s + l.amountBeforeVat, 0));
      const vat = round2(o.lines.reduce((s, l) => s + l.vat, 0));
      const decided = o.status !== 'pending' && o.status !== 'memo';
      const events = [{ at: o.createdAt, by: o.requesterId, action: o.memo ? 'บันทึกคำขอและออก Memo ' + o.memo.no : 'ส่งคำขอเบิกใช้งบ', note: '' }];
      if (o.memo && o.memo.at) events.push({ at: o.memo.at, by: o.requesterId, action: 'แนบ Memo ที่เซ็นแล้วและส่งให้ผู้คุมงบตรวจสอบ', note: o.memo.no + ' · ' + o.memo.by });
      if (decided && o.approvedAt) events.push({ at: o.approvedAt, by: 'fin1', action: 'อนุมัติ ออกใบเบิกใช้งบ ' + (o.docNo || ''), note: o.approverNote || '' });
      if (o.advance) events.push({ at: o.advance.at, by: o.advance.by, action: 'จ่ายเงินทดรอง', note: money(o.advance.amount) + ' บาท' });
      (o.cuts || []).forEach((c) => events.push({ at: c.at, by: c.by, action: 'บันทึก' + ({ po: 'ใบสั่งซื้อ (PO)', clear: 'เคลียร์เงินทดรอง', reimburse: 'จ่ายคืนพนักงาน', payment: 'จ่ายเงิน Supplier' }[c.kind]), note: money(c.amount) + ' บาท' }));
      if (o.closed) events.push({ at: o.closed.at, by: o.closed.by, action: 'ปิดยอด', note: 'ใช้จริง ' + money(o.closed.actual) + ' บาท' });
      return Object.assign({
        type: 'CAPEX', history: [], payee: 'บริษัทตัวอย่าง จำกัด', poNo: 'N/A', paymentPlan: { mode: 'single', installments: [] }, paymentTerms: 'จ่ายครั้งเดียว',
        payments: [], cuts: [], attachments: [], events, amountBeforeVat, vat, amount: round2(amountBeforeVat + vat),
        steps: [Object.assign({ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: decided ? 'approved' : 'waiting' },
          decided ? { by: 'fin1', at: o.approvedAt, comment: o.note || '' } : {})]
      }, o);
    };
    const requests = [
      mk({ id: 'r1', no: 'REQ-' + year + '-0001', budgetId: 'b1', itemId: 'c1', useType: 'prpo', requesterId: 'req1', createdAt: iso(day(9, 1)),
        status: 'approved', approvedAt: iso(day(9, 3)), docNo: 'CAPEX-' + year + '-0001', purpose: 'ทดแทนเครื่องเดิมที่เสื่อมสภาพ',
        lines: [line('c1', 'เครื่องตัดชิ้นงาน CNC พร้อมติดตั้ง', 450000)] }),
      mk({ id: 'r2', no: 'REQ-' + year + '-0002', budgetId: 'b1', itemId: 'c2', useType: 'advance', requesterId: 'req1', createdAt: iso(day(9, 20)),
        status: 'approved', approvedAt: iso(day(9, 22)), docNo: 'CAPEX-' + year + '-0002', purpose: 'ซื้ออุปกรณ์ห้องแล็บหน้าร้าน', payee: 'สมชาย ใจดี (เงินทดรอง)',
        advance: { at: iso(day(9, 25)), date: day(9, 25), amount: 32100, by: 'fin1' },
        lines: [line('c2', 'อุปกรณ์วัดและเครื่องมือห้องแล็บ', 30000)] }),
      mk({ id: 'r3', no: 'REQ-' + year + '-0003', budgetId: 'b2', itemId: 'c4', useType: 'reimburse', requesterId: 'req1', createdAt: iso(day(8, 5)),
        status: 'closed', approvedAt: iso(day(8, 6)), docNo: 'CAPEX-' + year + '-0003', purpose: 'ซื้อจอภาพด่วนสำหรับห้องประชุม', payee: 'สมชาย ใจดี (สำรองจ่าย)',
        lines: [line('c4', 'จอภาพ 27 นิ้ว 4 เครื่อง', 20000)],
        cuts: [{ id: 'x1', kind: 'reimburse', date: day(8, 12), amount: 19260, ref: 'ใบเสร็จ INV-5521', note: '', by: 'fin1', at: iso(day(8, 12)), attachments: [] }],
        closed: { at: iso(day(8, 12)), by: 'fin1', actual: 19260, returned: 2140, note: 'ซื้อได้ถูกกว่าที่ขอ' } }),
      mk({ id: 'r4', no: 'REQ-' + year + '-0004', budgetId: 'b6', itemId: 'c8', useType: 'direct', requesterId: 'req1', createdAt: iso(day(10, 28)),
        status: 'pending', purpose: 'งานปรับปรุงพื้นที่ชั้น 2', payee: 'หจก. ก่อสร้างตัวอย่าง',
        lines: [line('c8', 'งานรื้อถอนและปรับพื้นชั้น 2', 150000, { category: 'ค่าจ้างเหมา', investor: 'PBI' }), line('c8', 'กระเบื้องและวัสดุปูพื้น', 40000, { category: 'ค่าวัสดุ / อุปกรณ์', investor: 'PCC' })] }),
      mk({ id: 'r5', no: 'REQ-' + year + '-0005', budgetId: 'b5', itemId: 'c7', useType: 'prpo', requesterId: 'req2', createdAt: iso(day(10, 30)),
        status: 'pending', purpose: 'ขยายพื้นที่จัดเก็บสินค้า', requesterReason: 'ราคาเหล็กปรับขึ้นจากตอนตั้งงบ',
        lines: [line('c7', 'ชั้นวางสินค้าแบบ Heavy duty 12 ชุด', 327000)] }),
      mk({ id: 'r6', no: 'REQ-' + year + '-0006', budgetId: 'b3', type: 'CBS', itemId: 'i4', useType: 'direct', requesterId: 'req2', createdAt: iso(day(9, 10)),
        status: 'approved', approvedAt: iso(day(9, 11)), docNo: 'OPEX-' + year + '-0001', purpose: 'ซื้อดินผสมสำหรับเพาะกล้า', payee: 'ร้านวัสดุเกษตร',
        lines: [{ itemId: 'i4', description: 'ดินผสม 100 กระสอบ', amountBeforeVat: 5000, vat: 0, amount: 5000, glCode: '510101', glName: 'ค่าวัตถุดิบ' }] }),
      mk({ id: 'r8', no: 'REQ-' + year + '-0008', budgetId: 'b6', itemId: 'c8', useType: 'prpo', requesterId: 'req1', createdAt: iso(day(11, 2)),
        status: 'pending', purpose: 'ติดตั้งระบบไฟส่องสว่างชั้น 2', payee: '',
        lines: [line('c8', 'โคมไฟ LED พร้อมติดตั้ง 40 ชุด', 60000, { category: 'ค่าวัสดุ / อุปกรณ์', investor: 'PCC' })] }),
      mk({ id: 'r7', no: 'REQ-' + year + '-0007', budgetId: 'b3', type: 'CBS', itemId: 'i5', useType: 'prpo', requesterId: 'req2', createdAt: iso(day(10, 31)),
        status: 'pending', purpose: 'วัสดุเพาะกล้ารอบถัดไป', payee: '',
        lines: [{ itemId: 'i5', description: 'ถุงเพาะ 6x12 นิ้ว 5,000 ใบ', amountBeforeVat: 6000, vat: 420, amount: 6420, glCode: '510101', glName: 'ค่าวัตถุดิบ' },
          { itemId: 'i11', description: 'ท่อและหัวจ่ายน้ำ', amountBeforeVat: 1500, vat: 105, amount: 1605, glCode: '530101', glName: 'ค่าเช่าและสาธารณูปโภค' }] })
    ];
    // ตัวอย่างคำขอเพิ่มงบที่รอผู้คุมงบตรวจสอบ
    const changes = [{
      id: 'g1', no: 'INC-' + year + '-0001', budgetId: 'b1', state: 'review', reason: 'ขยายระบบลำเลียงเพิ่มอีก 1 สาย',
      lines: [{ itemId: 'c3', amount: 200000 }], meeting: { date: day(10, 25), no: 'มติที่ 10/' + year, note: '' },
      attachments: [sampleFile('มติที่ประชุม-10-' + year + '.pdf')], createdBy: 'req1', createdAt: iso(day(10, 22)),
      history: [{ at: iso(day(10, 22)), by: 'req1', action: 'สร้างคำขอเพิ่มงบ' }, { at: iso(day(10, 26)), by: 'req1', action: 'แนบมติที่ประชุมและส่งให้ผู้คุมงบตรวจสอบ', note: 'มติที่ 10/' + year }]
    }];
    const log = [];
    budgets.forEach((b) => b.history.forEach((h) => log.push({ at: h.at, by: h.by, action: h.action, ref: 'งบ ' + b.code, detail: h.note || '' })));
    changes.forEach((c) => c.history.forEach((h) => log.push({ at: h.at, by: h.by, action: h.action, ref: c.no, detail: h.note || '' })));
    requests.forEach((r) => {
      log.push({ at: r.createdAt, by: r.requesterId, action: 'ส่งขอเบิกใช้งบ', ref: r.no, detail: '' });
      if (r.approvedAt) log.push({ at: r.approvedAt, by: 'fin1', action: 'อนุมัติ ออกใบเบิกใช้งบ', ref: r.docNo, detail: '' });
    });
    log.sort((a, b) => a.at.localeCompare(b.at));
    const no = { ['REQ-' + year]: 8, ['INC-' + year]: 1, ['MEMO-' + year]: 1, ['CAPEX-' + year]: 3, ['OPEX-' + year]: 1 };
    return ensureMaster({ seq: { req: 8, id: 200, doc: {}, no }, budgets, requests, changes, log });
  }

  /**
   * รอบข้อมูล: เปลี่ยนค่านี้เมื่อต้องการล้างข้อมูลในทุกเบราว์เซอร์ (ครั้งเดียว) — เช่น ก่อนให้ผู้ใช้ทดสอบ
   * ข้อมูลหลัก (บริษัท หน่วยงาน กลุ่มงบ GL ผู้ลงนาม Memo โลโก้ ฯลฯ) เก็บไว้ ส่วนงบ / คำขอ / เอกสาร / Log ล้างทั้งหมด
   */
  const DATA_EPOCH = '2026-11-10-test';
  const EPOCH_KEY = DB_KEY + '.epoch';
  /** ฐานข้อมูลว่าง (ไม่มีงบ / คำขอ) ใช้ข้อมูลหลักจากข้อมูลตัวอย่าง หรือของเดิมถ้ามี */
  function emptyDb(master) {
    return ensureMaster({ seq: { req: 0, id: 0, doc: {}, no: {} }, master: master || seed().master, budgets: [], requests: [], changes: [], log: [] });
  }
  function load() {
    let sample = false;
    try { sample = localStorage.getItem(DB_KEY + '.sample') === '1'; } catch (e) { /* ignore */ }
    try {
      const raw = localStorage.getItem(DB_KEY);
      const epoch = localStorage.getItem(EPOCH_KEY);
      if (raw && (epoch === DATA_EPOCH || sample)) return migrate(JSON.parse(raw));
      localStorage.setItem(EPOCH_KEY, DATA_EPOCH);
      if (raw && !sample) {
        // เปิดรอบข้อมูลใหม่: ล้างข้อมูลเดิมครั้งเดียว เก็บเฉพาะข้อมูลหลัก
        const old = migrate(JSON.parse(raw));
        const fresh = emptyDb(old.master);
        localStorage.setItem(DB_KEY, JSON.stringify(fresh));
        return fresh;
      }
    } catch (e) { /* ใช้ข้อมูลตั้งต้นแทน */ }
    const d = sample ? seed() : emptyDb();
    try { localStorage.setItem(DB_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
    return d;
  }

  /** คำขอ OPEX แบบเดิม (ออกเอกสารทันที + บัญชีจ่าย) → ขั้นตอนเดียวกับ CAPEX: จ่ายตรง Supplier ตัดงบเมื่อจ่ายแล้ว */
  function upgradeCbsRequest(r) {
    const acc = r.accounting || {};
    const paid = acc.paymentStatus === 'จ่ายแล้ว';
    r.useType = 'direct';
    r.itemId = r.itemId || (r.lines[0] || {}).itemId;
    r.purpose = r.purpose || (r.lines[0] || {}).description || '';
    r.paymentPlan = { mode: 'single', installments: [] };
    r.attachments = r.attachments || [];
    r.events = r.events || [];
    r.cuts = [];
    if (r.status === 'approved') {
      r.steps = [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'approved', by: 'fin1', at: r.approvedAt, comment: '' }];
      if (paid) {
        const date = acc.paidAt || (acc.updatedAt || r.approvedAt || '').slice(0, 10);
        r.cuts = [{ id: 'x' + r.id, kind: 'payment', date, amount: r.amount, ref: '', note: '', by: 'fin1', at: acc.updatedAt || r.approvedAt, attachments: [] }];
        r.status = 'closed';
        r.closed = { at: acc.updatedAt || r.approvedAt, by: 'fin1', actual: r.amount, returned: 0, over: 0, note: '' };
      }
    } else if (r.status === 'pending') {
      r.steps = [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'waiting' }];
    }
    delete r.accounting;
  }

  /** แปลงคำขอรูปแบบเดิม (1 ใบ = 1 บรรทัด) เป็นแบบหลายบรรทัด + งวดจ่าย โดยไม่ทำให้ข้อมูลหาย */
  /** บริษัทเปลี่ยนรหัส (เช่น PSL → PBI): แก้ข้อมูลที่เก็บไว้ให้ตรง · เลขที่เอกสารที่ออกไปแล้วคงเดิม */
  function renameCompany(d, from, to) {
    const m = d.master || {};
    const comps = m.companies || [];
    if (!comps.some((c) => c.code === from) && !(d.budgets || []).some((b) => b.company === from)) return;
    if (comps.some((c) => c.code === to)) m.companies = comps.filter((c) => c.code !== from);
    else comps.forEach((c) => { if (c.code === from) { c.code = to; c.name = String(c.name || '').split(from).join(to); } });
    const fix = (o, k) => { if (o && o[k] === from) o[k] = to; };
    (d.budgets || []).forEach((b) => { fix(b, 'company'); (b.items || []).forEach((it) => fix(it, 'investor')); });
    (d.requests || []).forEach((r) => (r.lines || []).forEach((l) => fix(l, 'investor')));
    (d.changes || []).forEach((c) => (c.lines || []).forEach((l) => fix(l, 'investor')));
  }

  /** OPEX แบบเดิม: Item หลักไม่มีวงเงินของตัวเอง (รวมจากรายการลูก) → ตั้งวงเงิน Item หลัก = ผลรวมของรายการล่างสุดใต้ Item นั้น */
  function rollupCbsMain(b) {
    if (b.type !== 'CBS' || !Array.isArray(b.items) || b.structure === 'project') return;
    b.items.filter((it) => depth(it) === 0 && itemTotal(it) === 0).forEach((it) => {
      const below = b.items.filter((x) => x !== it && x.code.startsWith(it.code + '.') && isLeaf(b, x));
      if (!below.length) return;
      it.amount = round2(below.reduce((sum, x) => sum + Number(x.amount || 0), 0));
      it.vat = round2(below.reduce((sum, x) => sum + Number(x.vat || 0), 0));
    });
  }

  function migrate(d) {
    renameCompany(d, 'PSL', 'PBI');
    ensureMaster(d);
    d.changes = d.changes || [];
    d.log = d.log || [];
    (d.budgets || []).forEach((b) => {
      rollupCbsMain(b);
      b.state = b.state || 'active';
      b.structure = b.structure || 'items';
      b.history = b.history || [];
      b.attachments = b.attachments || [];
      b.revisions = b.revisions || [];
    });
    (d.requests || []).forEach((r) => {
      if (r.lines && r.type === 'CBS' && !r.useType) upgradeCbsRequest(r);
      // Memo ทำครั้งเดียวตอนขอเปิดใช้งบ: คำขอเบิกที่ค้างรอ Memo ไว้ ส่งให้ผู้คุมงบตรวจได้เลย
      if (r.status === 'memo') {
        r.status = 'pending';
        delete r.memo;
        delete r.memoParties;
        r.steps = [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'waiting' }];
      }
      if (r.lines) return;
      const acc = r.accounting || {};
      r.lines = [{
        itemId: r.itemId, description: r.description || '', amountBeforeVat: r.amountBeforeVat, vat: r.vat, amount: r.amount,
        glCode: r.type === 'CBS' ? acc.glCode || '' : undefined, glName: r.type === 'CBS' ? acc.glName || '' : undefined
      }];
      if (r.type === 'CAPEX') {
        const fin = r.finance || {};
        r.paymentTerms = r.installment || '';
        r.payments = [];
        if (r.status === 'approved' && (fin.deliveryDate || fin.paymentDueDate || acc.updatedAt)) {
          r.payments.push({
            id: 'p' + r.id, no: 1, label: r.installment || 'งวดที่ 1', deliveryDate: fin.deliveryDate || '', dueDate: fin.paymentDueDate || '',
            amountBeforeVat: r.amountBeforeVat, vat: r.vat, amount: r.amount, at: r.approvedAt, by: 'fin1',
            asset: acc.assetAmount, expense: acc.expenseAmount, acctAt: acc.updatedAt, acctBy: acc.updatedBy
          });
        }
      }
      delete r.description; delete r.installment; delete r.finance;
      if (r.type === 'CAPEX') delete r.accounting;
    });
    return d;
  }

  let db;
  /** ผู้ใช้ที่ล็อกอินอยู่ ('' = ยังไม่ได้ล็อกอิน) — โหมดทดลองเก็บ id ไว้ในเบราว์เซอร์ */
  let currentUserId = '';
  try { currentUserId = localStorage.getItem(DB_KEY + '.user') || ''; } catch (e) { /* ignore */ }

  // ================================================================ บัญชีผู้ใช้ + ล็อกอิน (โหมดทดลอง)
  //
  // ต้นแบบนี้ไม่มีเซิร์ฟเวอร์ จึงเก็บบัญชีในเบราว์เซอร์ (localStorage คีย์ procurement.v5.users) และเก็บรหัสผ่านเป็น hash (PBKDF2-SHA256 + salt)
  // **ไม่ปลอดภัยจริง** (ใครแก้ localStorage ได้ก็ข้ามได้) — ใช้ทดสอบขั้นตอนเท่านั้น ระบบจริงเปลี่ยนไปใช้ Supabase Auth (js/remote.js) โดยคงขั้นตอนเดิม:
  //   1) Admin เพิ่มอีเมลพร้อมข้อมูลบัญชี (สถานะ "รอตั้งรหัสผ่าน")  2) ผู้ใช้ตั้งรหัสผ่านเองครั้งแรก  3) ลืมรหัสผ่าน → แจ้ง Admin รีเซ็ต → ผู้ใช้ตั้งรหัสผ่านใหม่
  //
  // บัญชี: { id, email, name, title(ตำแหน่ง), department(หน่วยงาน), company(บริษัท), role, active, mustSetPassword, pwHash, pwSalt,
  //          createdAt, createdBy, lastLoginAt, passwordChangedAt, resetRequestedAt, resetAt, resetBy, failCount, lockedUntil }
  const USERS_KEY = DB_KEY + '.users';
  const PW_MIN = 8;
  const PW_ITER = 100000;
  const LOCK_AFTER = 5; // ใส่รหัสผิดติดกันกี่ครั้งจึงพักการล็อกอิน
  const LOCK_MS = 30000;
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  function loadUsers() {
    let list = null;
    try { list = JSON.parse(localStorage.getItem(USERS_KEY) || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.length) {
      list = DEMO_USERS.map((x) => Object.assign({ active: true, mustSetPassword: true, pwHash: '', pwSalt: '', createdAt: '' }, x));
    }
    // บัญชีตัวอย่างที่บันทึกไว้ก่อนมีขอบเขตบริษัท: เติมค่าตั้งต้น และเพิ่มบัญชีตัวอย่างใหม่ (ไม่ทับข้อมูลที่ Admin แก้แล้ว)
    DEMO_USERS.forEach((d) => {
      const cur = list.find((x) => x.id === d.id);
      if (!cur) list.push(Object.assign({ active: true, mustSetPassword: true, pwHash: '', pwSalt: '', createdAt: '' }, d));
      else if (!Array.isArray(cur.companies) && d.companies) cur.companies = d.companies.slice();
    });
    return list;
  }
  function saveUsers() {
    if (AUTH_REMOTE) return true; // บัญชีอยู่บนเซิร์ฟเวอร์
    try { localStorage.setItem(USERS_KEY, JSON.stringify(USERS)); return true; } catch (e) { alert('บันทึกบัญชีผู้ใช้ไม่สำเร็จ (พื้นที่เบราว์เซอร์เต็ม)'); return false; }
  }
  if (!REMOTE && !AUTH_REMOTE) USERS = loadUsers();
  const accountByEmail = (e) => USERS.find((u) => normEmail(u.email) === normEmail(e));
  const b64 = (buf) => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))));
  const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  async function hashPassword(password, saltB64) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: PW_ITER, hash: 'SHA-256' }, key, 256));
  }
  const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
  /** เงื่อนไขรหัสผ่าน: อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข และไม่ซ้ำกับอีเมล — คืนข้อความผิดพลาด หรือ '' ถ้าผ่าน */
  function passwordProblem(pw, email) {
    if (String(pw).length < PW_MIN) return 'รหัสผ่านต้องยาวอย่างน้อย ' + PW_MIN + ' ตัวอักษร';
    if (!/[A-Za-z\u0E00-\u0E7F]/.test(pw) || !/\d/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
    if (email && normEmail(pw) === normEmail(email)) return 'รหัสผ่านต้องไม่ซ้ำกับอีเมล';
    return '';
  }
  const authLog = (u, action, detail) => {
    if (AUTH_REMOTE) return; // โหมด Supabase: บัญชีและ Log อยู่บนเซิร์ฟเวอร์
    // ล็อกอิน/ตั้งรหัสผ่านเกิดก่อนมีผู้ใช้ปัจจุบัน — บันทึกในข้อมูลหลักด้วย id ของบัญชีนั้น
    try {
      const d = db || load();
      d.log = d.log || [];
      d.log.push({ at: new Date().toISOString(), by: u ? u.id : '', action, ref: u ? u.email : '', detail: detail || '' });
      localStorage.setItem(DB_KEY, JSON.stringify(d));
    } catch (e) { /* ignore */ }
  };

  /** ล็อกอินด้วยอีเมล + รหัสผ่าน → { user } หรือ { error: 'invalid' | 'locked' | 'inactive' | 'needs_password', message } */
  async function authLogin(email, password) {
    const u = accountByEmail(email);
    const bad = { error: 'invalid', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };
    if (!u) return bad;
    if (u.lockedUntil && Date.now() < u.lockedUntil) return { error: 'locked', message: 'ใส่รหัสผ่านผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่' };
    if (u.active === false) return { error: 'inactive', message: 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
    if (u.mustSetPassword || !u.pwHash) return { error: 'needs_password', message: 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน (หรือผู้ดูแลระบบรีเซ็ตให้แล้ว) — ตั้งรหัสผ่านใหม่ได้เลย' };
    const h = await hashPassword(password, u.pwSalt);
    if (h !== u.pwHash) {
      u.failCount = (u.failCount || 0) + 1;
      if (u.failCount >= LOCK_AFTER) { u.lockedUntil = Date.now() + LOCK_MS; u.failCount = 0; }
      saveUsers();
      return bad;
    }
    u.failCount = 0; u.lockedUntil = 0; u.lastLoginAt = new Date().toISOString();
    saveUsers();
    authLog(u, 'เข้าสู่ระบบ', '');
    return { user: u };
  }
  /** ตั้งรหัสผ่านเอง (ครั้งแรก หรือหลัง Admin รีเซ็ต) — ทำได้เฉพาะบัญชีที่อยู่ในสถานะ "รอตั้งรหัสผ่าน" */
  async function authSetPassword(email, password) {
    const u = accountByEmail(email);
    if (!u || u.active === false) return { error: 'invalid', message: 'ไม่พบอีเมลนี้ในระบบ — ให้ผู้ดูแลระบบเพิ่มอีเมลของคุณก่อน' };
    if (!u.mustSetPassword && u.pwHash) return { error: 'has_password', message: 'บัญชีนี้ตั้งรหัสผ่านแล้ว — ถ้าลืมรหัสผ่าน ให้แจ้งผู้ดูแลระบบรีเซ็ตให้ก่อน' };
    const problem = passwordProblem(password, email);
    if (problem) return { error: 'weak', message: problem };
    u.pwSalt = newSalt();
    u.pwHash = await hashPassword(password, u.pwSalt);
    Object.assign(u, { mustSetPassword: false, passwordChangedAt: new Date().toISOString(), resetRequestedAt: '', failCount: 0, lockedUntil: 0, lastLoginAt: new Date().toISOString() });
    saveUsers();
    authLog(u, 'ตั้งรหัสผ่าน', '');
    return { user: u };
  }
  /** เปลี่ยนรหัสผ่านของตัวเอง (ต้องใส่รหัสผ่านเดิม) */
  async function authChangePassword(u, current, next) {
    if (AUTH_REMOTE) {
      try { await window.RemoteApi.signIn(u.email, current); } catch (e) { return { error: 'invalid', message: 'รหัสผ่านเดิมไม่ถูกต้อง' }; }
      const pr = passwordProblem(next, u.email);
      if (pr) return { error: 'weak', message: pr };
      if (next === current) return { error: 'same', message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' };
      try { await window.RemoteApi.updatePassword(next); } catch (e) { return { error: 'weak', message: e.message }; }
      return { user: u };
    }
    if (await hashPassword(current, u.pwSalt) !== u.pwHash) return { error: 'invalid', message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
    const problem = passwordProblem(next, u.email);
    if (problem) return { error: 'weak', message: problem };
    if (next === current) return { error: 'same', message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' };
    u.pwSalt = newSalt();
    u.pwHash = await hashPassword(next, u.pwSalt);
    u.passwordChangedAt = new Date().toISOString();
    saveUsers();
    authLog(u, 'เปลี่ยนรหัสผ่าน', '');
    return { user: u };
  }
  /** ลืมรหัสผ่าน: ผู้ใช้แจ้งขอให้ Admin รีเซ็ต (ทำเครื่องหมายบนบัญชี — ตอบเหมือนกันไม่ว่ามีอีเมลนี้หรือไม่) */
  function authRequestReset(email) {
    const u = accountByEmail(email);
    if (u && u.active !== false) {
      u.resetRequestedAt = new Date().toISOString();
      saveUsers();
      authLog(u, 'ขอรีเซ็ตรหัสผ่าน', '');
    }
    return true;
  }

  // ---- ฟังก์ชันสำหรับหน้า Admin (ต้องมีสิทธิ์ user.manage) ----------------------------------
  const requireUserManage = () => { if (!can('user.manage')) throw new Error('ไม่มีสิทธิ์จัดการผู้ใช้'); };
  const nextUserId = () => { let n = USERS.length + 1; while (USERS.some((u) => u.id === 'u' + n)) n += 1; return 'u' + n; };
  /** บทบาททั้งหมดของผู้ใช้ (1 คนมีได้หลายบทบาท — สิทธิ์รวมกัน · บทบาทแรก = บทบาทหลัก) */
  const rolesOf = (u) => (!u ? [] : Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []));
  /** หน่วยงานทั้งหมดของผู้ใช้ (Business มี 1 หน่วยงาน · ธุรการที่ Admin ตั้งให้มีได้หลายหน่วยงาน · หน่วยงานแรก = หน่วยงานหลัก) */
  const deptsOf = (u) => (!u ? [] : Array.isArray(u.departments) && u.departments.length ? u.departments : (u.department ? [u.department] : []));
  const accountClean = (f) => {
    const departments = uniq((Array.isArray(f.departments) ? f.departments : [f.department]).map((k) => String(k || '').trim()).filter(Boolean));
    const roles = uniq((Array.isArray(f.roles) && f.roles.length ? f.roles : [f.role]).map((k) => String(k || '').trim()).filter(Boolean));
    return {
    email: normEmail(f.email), name: String(f.name || '').trim(), title: String(f.title || '').trim(),
    department: departments[0] || '', departments, company: String(f.company || '').trim(), role: roles[0] || '', roles,
    // บริษัทที่ดูงบ/งานได้ (ผู้คุมงบ / จัดซื้อ) — ไม่ส่งมา = คงค่าเดิม
    companies: Array.isArray(f.companies) ? uniq(f.companies.map((c) => String(c).trim()).filter(Boolean)) : undefined
    };
  };
  function accountProblem(a, ignoreId) {
    if (!validEmail(a.email)) return 'รูปแบบอีเมลไม่ถูกต้อง';
    if (USERS.some((u) => u.id !== ignoreId && normEmail(u.email) === a.email)) return 'อีเมลนี้มีอยู่ในระบบแล้ว';
    if (!a.name) return 'กรุณาระบุชื่อ';
    if (!a.roles.length) return 'กรุณาเลือกบทบาทอย่างน้อย 1 บทบาท';
    return '';
  }
  /** เพิ่มบัญชี: Admin ใส่อีเมล + ข้อมูลบัญชี — ผู้ใช้ตั้งรหัสผ่านเอง (สถานะเริ่มต้น "รอตั้งรหัสผ่าน") */
  function accountCreate(f) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteAccountCreate(f);
    const a = accountClean(f);
    const problem = accountProblem(a, '');
    if (problem) throw new Error(problem);
    if (a.companies === undefined) a.companies = a.company ? [a.company] : [];
    const u = Object.assign({ id: nextUserId(), active: true, mustSetPassword: true, pwHash: '', pwSalt: '', createdAt: new Date().toISOString(), createdBy: me().id }, a);
    USERS.push(u);
    saveUsers();
    logAction('เพิ่มบัญชีผู้ใช้', u.email, u.name + ' · ' + roleLabel(u));
    save();
    return u;
  }
  /** แก้ข้อมูลบัญชี (อีเมล ชื่อ ตำแหน่ง หน่วยงาน บริษัท บทบาท) */
  function accountUpdate(id, f) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteAccountUpdate(id, f);
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    const a = accountClean(Object.assign({}, u, f));
    const problem = accountProblem(a, id);
    if (problem) throw new Error(problem);
    if (a.companies === undefined) delete a.companies;
    Object.assign(u, a);
    saveUsers();
    logAction('แก้ไขบัญชีผู้ใช้', u.email, u.name);
    save();
    return u;
  }
  /** เปิด / ปิดการใช้งานบัญชี (ปิดแล้วล็อกอินไม่ได้ และถูกออกจากระบบทันที) — ปิดบัญชีตัวเองไม่ได้ */
  function accountSetActive(id, active) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteAccountSetActive(id, active);
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    if (id === me().id && !active) throw new Error('ปิดบัญชีของตัวเองไม่ได้');
    u.active = !!active;
    saveUsers();
    logAction(active ? 'เปิดใช้งานบัญชี' : 'ปิดการใช้งานบัญชี', u.email, u.name);
    save();
    return u;
  }
  /** รีเซ็ตรหัสผ่าน: ล้างรหัสผ่านเดิม → ผู้ใช้เข้าหน้า "ตั้งรหัสผ่าน" แล้วกรอกอีเมลเพื่อตั้งรหัสผ่านใหม่เอง (Admin ไม่เห็น / ไม่ตั้งรหัสผ่านให้) */
  function accountResetPassword(id) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteAccountReset(id);
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    Object.assign(u, { pwHash: '', pwSalt: '', mustSetPassword: true, resetAt: new Date().toISOString(), resetBy: me().id, resetRequestedAt: '', failCount: 0, lockedUntil: 0 });
    saveUsers();
    logAction('รีเซ็ตรหัสผ่าน', u.email, u.name);
    save();
    return u;
  }

  // ---- โหมด Supabase (เฟส 1): บัญชีและบทบาทอยู่บนเซิร์ฟเวอร์ ----------------------------------------
  // ---- ข้อมูลหลักบนเซิร์ฟเวอร์ (เฟส 2): โหมด Supabase เก็บกลาง ทุกคนเห็นชุดเดียวกัน · key = รายการใน MASTER_NAV
  let masterMeta = {};            // key → updatedAt ล่าสุดจากเซิร์ฟเวอร์ (ใช้กันบันทึกทับกัน) · null = เซิร์ฟเวอร์ยังไม่มีรายการนี้
  let masterOnline = false;       // โหลดจากเซิร์ฟเวอร์สำเร็จหรือยัง (false = ใช้ค่าในเครื่อง ยังไม่ได้รันสคริปต์ล่าสุด หรือออฟไลน์)
  let masterError = '';
  /**
   * โหลดข้อมูลหลักจากเซิร์ฟเวอร์มาแทนค่าในเครื่อง · รายการที่เซิร์ฟเวอร์ยังไม่มี = ใช้ค่าตั้งต้น และถ้าเป็นผู้จัดการข้อมูลหลัก
   * จะบันทึกค่าปัจจุบันขึ้นไปเป็นต้นฉบับ (ครั้งเดียว) · คืน true ถ้าข้อมูลที่แสดงเปลี่ยน · ข้อผิดพลาดอื่นนอกจากหมดเวลาล็อกอินไม่ทำให้ระบบหยุด
   */
  async function loadRemoteMaster() {
    if (!AUTH_REMOTE) return false;
    const before = JSON.stringify(db.master);
    let g;
    try {
      g = await window.RemoteApi.v2MasterGet();
    } catch (e) {
      if (e && e.code === 'AUTH') throw e;
      masterOnline = false;
      masterError = (e && e.message) || 'โหลดข้อมูลหลักจากเซิร์ฟเวอร์ไม่ได้';
      return false;
    }
    masterOnline = true;
    masterError = '';
    g = g || {};
    MASTER_SECTIONS.map((x) => x.key).forEach((k) => {
      if (g[k] && Array.isArray(g[k].items)) { db.master[k] = g[k].items; masterMeta[k] = g[k].updatedAt || null; } else masterMeta[k] = null;
    });
    db = ensureMaster(db);
    if (can('master.manage')) {
      for (const k of MASTER_SECTIONS.map((x) => x.key)) {
        if (masterMeta[k] !== null) continue;
        try {
          const r = await window.RemoteApi.v2MasterSave(k, db.master[k], null);
          masterMeta[k] = r.updatedAt;
        } catch (e) {
          if (e && e.code === 'AUTH') throw e;
          console.warn('บันทึกข้อมูลหลักตั้งต้นขึ้นเซิร์ฟเวอร์ไม่สำเร็จ', k, e && e.message);
        }
      }
    }
    save();
    return JSON.stringify(db.master) !== before;
  }

  let accountsReady = false; // โหมด Supabase: โหลดบัญชี/บทบาทของผู้ใช้ที่ล็อกอินแล้ว
  let remotePermCatalog = null; // สิทธิ์ที่ฐานข้อมูลรู้จัก (ถ้าฐานข้อมูลยังเป็นเวอร์ชันเก่า สิทธิ์ใหม่จะถูกทิ้งตอนบันทึก)
  const remoteRoleSys = {};  // roleKey → true ถ้าเป็นบทบาทตั้งต้นของระบบ (ลบไม่ได้)
  const profileToUser = (p) => Object.assign({}, p, {
    company: p.company || '', companies: Array.isArray(p.companies) ? p.companies : [],
    pwHash: 'x', passwordChangedAt: p.passwordSetAt || '',
    mustSetPassword: !p.passwordSetAt
  });
  async function loadRemoteRoles() {
    const r = await window.RemoteApi.v2ListRoles();
    remotePermCatalog = Array.isArray(r.catalog) ? r.catalog.slice() : null;
    Object.keys(DEMO_ROLE_PERMS).forEach((k) => { delete DEMO_ROLE_PERMS[k]; });
    Object.keys(remoteRoleSys).forEach((k) => { delete remoteRoleSys[k]; });
    r.roles.forEach((x) => { DEMO_ROLE_PERMS[x.key] = x.permissions.slice(); ROLE_LABEL[x.key] = x.name; remoteRoleSys[x.key] = !!x.isSystem; });
  }
  async function refreshAccounts() {
    const list = await (can('user.manage') ? window.RemoteApi.v2ListUsers() : window.RemoteApi.v2Directory());
    const mine = USERS.find((u) => u.id === currentUserId);
    USERS = list.map(profileToUser);
    // รายชื่อ directory ไม่มีอีเมล — คงข้อมูลของตัวเอง (อีเมล ฯลฯ) จากโปรไฟล์ที่ได้ตอนเข้าสู่ระบบ
    if (mine) { const i = USERS.findIndex((u) => u.id === mine.id); if (i < 0) USERS.push(mine); else USERS[i] = Object.assign({}, USERS[i], mine.email ? { email: mine.email } : {}); }
  }
  async function remoteAccountCreate(f) {
    const a = accountClean(f);
    const problem = accountProblem(a, '');
    if (problem) throw new Error(problem);
    const r = await window.RemoteApi.adminUsers({ action: 'create', email: a.email, name: a.name, title: a.title, department: a.department, departments: a.departments, company: a.company, companies: a.companies, roles: a.roles });
    logAction('เพิ่มบัญชีผู้ใช้', a.email, a.name + ' · ' + a.roles.map((k) => ROLE_LABEL[k] || k).join(', '));
    save();
    await refreshAccounts();
    return profileToUser(r.user);
  }
  async function remoteAccountUpdate(id, f) {
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    const a = accountClean(Object.assign({}, u, f, { email: u.email })); // อีเมลเปลี่ยนไม่ได้ (ผูกกับบัญชีล็อกอิน)
    if (!a.name) throw new Error('กรุณาระบุชื่อ');
    if (!a.roles.length) throw new Error('กรุณาเลือกบทบาทอย่างน้อย 1 บทบาท');
    await window.RemoteApi.v2UpdateUser({ id, name: a.name, title: a.title, department: a.department, departments: a.departments, company: a.company, companies: a.companies || [], roles: a.roles });
    logAction('แก้ไขบัญชีผู้ใช้', u.email, a.name);
    save();
    await refreshAccounts();
    return user(id);
  }
  async function remoteAccountSetActive(id, active) {
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    if (id === me().id && !active) throw new Error('ปิดบัญชีของตัวเองไม่ได้');
    await window.RemoteApi.adminUsers({ action: 'set_active', id, active: !!active });
    logAction(active ? 'เปิดใช้งานบัญชี' : 'ปิดการใช้งานบัญชี', u.email, u.name);
    save();
    await refreshAccounts();
    return user(id);
  }
  async function remoteAccountReset(id) {
    const u = user(id);
    if (!u) throw new Error('ไม่พบบัญชี');
    await window.RemoteApi.adminUsers({ action: 'reset', id });
    logAction('รีเซ็ตรหัสผ่าน', u.email, u.name);
    save();
    await refreshAccounts();
    return user(id);
  }
  /** สถานะบัญชีสำหรับแสดงผล */
  function accountState(u) {
    if (u.active === false) return { key: 'inactive', label: 'ปิดการใช้งาน' };
    if (u.mustSetPassword || !u.pwHash) return { key: 'pending', label: u.resetAt && !u.passwordChangedAt ? 'รอตั้งรหัสผ่านใหม่ (รีเซ็ตแล้ว)' : u.resetAt && u.resetAt > (u.passwordChangedAt || '') ? 'รอตั้งรหัสผ่านใหม่ (รีเซ็ตแล้ว)' : 'รอตั้งรหัสผ่าน' };
    if (u.resetRequestedAt) return { key: 'reset_requested', label: 'ขอรีเซ็ตรหัสผ่าน' };
    return { key: 'ok', label: 'ใช้งานได้' };
  }
  /** รายชื่อสำหรับเลือก / แท็กงานถึงคน: ผู้ใช้ที่เปิดใช้งาน พร้อมตำแหน่ง หน่วยงาน บริษัท (filter: ฟังก์ชันกรองเพิ่มได้) */
  const activeUsers = (filter) => USERS.filter((u) => u.active !== false && (!filter || filter(u)));
  const userLabel = (u) => (u ? u.name + (u.title ? ' — ' + u.title : '') + (deptsOf(u).length || u.company ? ' · ' + [deptsOf(u).join(', '), u.company].filter(Boolean).join(' / ') : '') : '-');
  const userOptions = (selectedId, filter) => '<option value="">— เลือก —</option>' + activeUsers(filter).map((u) => '<option value="' + esc(u.id) + '"' + (u.id === selectedId ? ' selected' : '') + '>' + esc(userLabel(u)) + '</option>').join('');
  // เปิดให้หน้า Admin / ชุดทดสอบเรียกใช้ (ทุกฟังก์ชันตรวจสิทธิ์ user.manage เอง)
  window.AppAccounts = { list: () => USERS.slice(), create: accountCreate, update: accountUpdate, setActive: accountSetActive, resetPassword: accountResetPassword, state: accountState };

  // ---- บทบาทและสิทธิ์ (โหมดทดลอง ต้องมีสิทธิ์ user.manage) ----------------------------------------
  /** บันทึกสิทธิ์ของบทบาท: map = { roleKey: [permKey, ...] } (บทบาท admin ต้องมี user.manage เสมอ) */
  function rolesSavePerms(map, names) {
    requireUserManage();
    names = names || {};
    const nm = {};
    Object.keys(map).forEach((k) => { if (DEMO_ROLE_PERMS[k]) nm[k] = String(names[k] != null ? names[k] : ROLE_LABEL[k] || k).trim(); });
    const seen = {};
    Object.keys(DEMO_ROLE_PERMS).forEach((k) => {
      const n = nm[k] != null ? nm[k] : String(ROLE_LABEL[k] || k).trim();
      if (!n) throw new Error('กรุณาระบุชื่อบทบาท');
      if (seen[n]) throw new Error('มีบทบาทชื่อ "' + n + '" อยู่แล้ว');
      seen[n] = true;
    });
    if (AUTH_REMOTE) return remoteRolesSave(map, nm);
    Object.keys(map).forEach((k) => {
      if (!DEMO_ROLE_PERMS[k]) return;
      const perms = PERMISSIONS.map((p) => p.key).filter((x) => map[k].includes(x));
      if (k === 'admin' && !perms.includes('user.manage')) perms.push('user.manage');
      DEMO_ROLE_PERMS[k] = perms;
      ROLE_LABEL[k] = nm[k];
    });
    saveRoles();
    logAction('แก้สิทธิ์ของบทบาท', '', Object.keys(map).map((k) => ROLE_LABEL[k] || k).join(', '));
    save();
  }
  function rolesCreate(name) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteRolesCreate(name);
    const n = String(name || '').trim();
    if (!n) throw new Error('กรุณาระบุชื่อบทบาท');
    if (Object.keys(ROLE_LABEL).some((k) => DEMO_ROLE_PERMS[k] && ROLE_LABEL[k] === n)) throw new Error('มีบทบาทชื่อนี้แล้ว');
    let i = 1; while (DEMO_ROLE_PERMS['role' + i]) i += 1;
    const key = 'role' + i;
    DEMO_ROLE_PERMS[key] = [];
    ROLE_LABEL[key] = n;
    saveRoles();
    logAction('สร้างบทบาท', key, n);
    save();
    return key;
  }
  function rolesRemove(key) {
    requireUserManage();
    if (AUTH_REMOTE) return remoteRolesRemove(key);
    if (BUILTIN_ROLES.includes(key) || !DEMO_ROLE_PERMS[key]) throw new Error('ลบได้เฉพาะบทบาทที่สร้างเพิ่ม');
    if (USERS.some((u) => rolesOf(u).includes(key))) throw new Error('ยังมีผู้ใช้ใช้บทบาทนี้อยู่ ย้ายผู้ใช้ไปบทบาทอื่นก่อน');
    const n = ROLE_LABEL[key];
    delete DEMO_ROLE_PERMS[key];
    delete ROLE_LABEL[key];
    saveRoles();
    logAction('ลบบทบาท', key, n);
    save();
  }
  /** คืนสิทธิ์ของบทบาทตั้งต้นเป็นค่าเริ่มต้น (บทบาทที่สร้างเพิ่มไม่ถูกแตะ) */
  function rolesReset() {
    requireUserManage();
    if (AUTH_REMOTE) throw new Error('โหมดเซิร์ฟเวอร์ไม่มีค่าเริ่มต้นให้คืน — ติ๊กสิทธิ์แล้วบันทึกเอง');
    BUILTIN_ROLES.forEach((k) => { DEMO_ROLE_PERMS[k] = DEFAULT_ROLE_PERMS[k].slice(); ROLE_LABEL[k] = DEFAULT_ROLE_LABEL[k]; });
    saveRoles();
    logAction('คืนค่าเริ่มต้นสิทธิ์ของบทบาท', '', '');
    save();
  }
  const isSystemRole = (k) => (AUTH_REMOTE ? !!remoteRoleSys[k] : BUILTIN_ROLES.includes(k));
  async function remoteRolesSave(map, nm) {
    for (const k of Object.keys(map)) {
      if (!DEMO_ROLE_PERMS[k]) continue;
      const perms = PERMISSIONS.map((p) => p.key).filter((x) => map[k].includes(x));
      if (perms.join() === DEMO_ROLE_PERMS[k].join() && nm[k] === (ROLE_LABEL[k] || k)) continue;
      await window.RemoteApi.v2SaveRole({ key: k, name: nm[k], permissions: perms });
    }
    logAction('แก้สิทธิ์ของบทบาท', '', Object.keys(map).map((k) => ROLE_LABEL[k] || k).join(', '));
    save();
    await loadRemoteRoles();
  }
  async function remoteRolesCreate(name) {
    const n = String(name || '').trim();
    if (!n) throw new Error('กรุณาระบุชื่อบทบาท');
    if (Object.keys(DEMO_ROLE_PERMS).some((k) => ROLE_LABEL[k] === n)) throw new Error('มีบทบาทชื่อนี้แล้ว');
    let i = 1; while (DEMO_ROLE_PERMS['role' + i]) i += 1;
    await window.RemoteApi.v2SaveRole({ key: 'role' + i, name: n, permissions: [] });
    logAction('สร้างบทบาท', 'role' + i, n);
    save();
    await loadRemoteRoles();
    return 'role' + i;
  }
  async function remoteRolesRemove(key) {
    const n = ROLE_LABEL[key];
    await window.RemoteApi.v2DeleteRole(key);
    logAction('ลบบทบาท', key, n);
    save();
    await loadRemoteRoles();
  }
  window.AppRoles = { list: () => Object.keys(DEMO_ROLE_PERMS).map((k) => ({ key: k, name: ROLE_LABEL[k] || k, builtin: isSystemRole(k), perms: DEMO_ROLE_PERMS[k].slice() })), savePerms: rolesSavePerms, create: rolesCreate, remove: rolesRemove, reset: rolesReset };

  function save() {
    if (AUTH_REMOTE) { syncSchedule(); return true; } // โหมด Supabase: ส่งเอกสารที่เปลี่ยนไปเซิร์ฟเวอร์
    if (REMOTE) { console.error('save() ถูกเรียกในโหมด Supabase — ข้อมูลต้องบันทึกผ่านเซิร์ฟเวอร์'); return; }
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      alert('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม (โหมดทดลองเก็บไฟล์แนบในเบราว์เซอร์) — ลบไฟล์แนบบางไฟล์ หรือล้างข้อมูลที่เมนูมุมขวาบน');
      return false;
    }
  }

  function nextId(prefix) {
    if (REMOTE || AUTH_REMOTE) {
      // โหมด Supabase: หลายคนสร้างรายการพร้อมกันได้ จึงใช้รหัสสุ่มแทนตัวนับในเครื่อง
      const a = new Uint8Array(6);
      window.crypto.getRandomValues(a);
      return prefix + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 10);
    }
    db.seq.id += 1;
    return prefix + db.seq.id;
  }

  // ---- โหมด Supabase: โหลดข้อมูลจากเซิร์ฟเวอร์ และเรียกฟังก์ชันที่ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์
  let remoteSnapshot = '';
  let adminCounts = { pending: 0 }; // จำนวนผู้ใช้ที่รอกำหนดบทบาท (เห็นเฉพาะผู้ที่มีสิทธิ์จัดการผู้ใช้)

  async function reloadRemote() {
    const d = await window.RemoteApi.load();
    USERS = d.users || [];
    remoteMe = d.me;
    adminCounts = { pending: d.pendingUsers || 0 };
    db = ensureMaster({ seq: { req: 0, id: 0, doc: {} }, master: d.master || {}, budgets: d.budgets || [], requests: d.requests || [] });
    remoteSnapshot = JSON.stringify([USERS, db]);
  }

  /** เรียกเซิร์ฟเวอร์ ถ้าไม่สำเร็จแจ้งผู้ใช้ (หมดเวลา → กลับหน้าล็อกอิน) แล้วคืน null; สำเร็จคืน { value } */
  async function run(fn) {
    document.body.classList.add('busy');
    try {
      return { value: await fn() };
    } catch (e) {
      if (e && e.code === 'AUTH') signedOut('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่');
      else alert((e && e.message) || 'ทำรายการไม่สำเร็จ');
      return null;
    } finally {
      document.body.classList.remove('busy');
    }
  }

  /** เรียกเซิร์ฟเวอร์แล้วโหลดข้อมูลใหม่ (หลังบันทึก) — คืน { value } หรือ null */
  async function runAndReload(fn) {
    const res = await run(fn);
    if (!res) return null;
    const re = await run(reloadRemote);
    return re ? res : null;
  }

  /**
   * เลขที่เอกสารที่ระบบออกให้: <ตัวย่อเอกสาร>-<ปี ค.ศ.>-<ลำดับ 4 หลัก> เริ่มนับ 0001 ใหม่ทุกปี
   * REQ คำขอเบิกใช้งบ · INC คำขอเพิ่มงบ · MEMO บันทึกข้อความ · CAPEX / OPEX ใบเบิกใช้งบ · TRF โยกงบ · DEC ลดงบ
   * (เลขที่ฝ่ายอื่นเป็นคนออก เช่น รหัสโครงการ / Item No. / PR / PO / เลขที่มติ / ใบเสร็จ ให้ผู้ใช้กรอกเอง)
   */
  function randomToken(len) {
    const a = new Uint8Array(len);
    window.crypto.getRandomValues(a);
    return Array.from(a, (x) => (x % 36).toString(36)).join('');
  }
  const DOC_PREFIX = { req: 'REQ', inc: 'INC', memo: 'MEMO', CAPEX: 'CAPEX', CBS: 'OPEX', trf: 'TRF', dec: 'DEC' };
  function usedNumbers() {
    const out = [];
    db.requests.forEach((r) => { out.push(r.no, r.docNo, r.memo && r.memo.no); });
    (db.changes || []).forEach((c) => out.push(c.no));
    db.budgets.forEach((b) => { (b.history || []).forEach((h) => out.push(h.ref)); if (b.openMemo) out.push(b.openMemo.no); });
    return out.filter(Boolean);
  }
  function nextNo(prefix, at) {
    const year = new Date(at || Date.now()).getFullYear();
    // โหมด Supabase: เซิร์ฟเวอร์ออกเลขจริง (ไม่ซ้ำ ไม่มีช่องว่าง) ตอนบันทึก — ที่นี่ใส่ token ชั่วคราว แล้วเซิร์ฟเวอร์แทนที่เป็นเลขที่
    if (AUTH_REMOTE) return '@@NO:' + prefix + '-' + year + ':' + randomToken(10) + '@@';
    const head = prefix + '-' + year + '-';
    const key = prefix + '-' + year;
    db.seq.no = db.seq.no || {};
    // กันเลขซ้ำกับเลขที่มีอยู่แล้ว (เช่น ข้อมูลเดิม)
    const used = usedNumbers().filter((n) => String(n).startsWith(head)).map((n) => parseInt(String(n).slice(head.length), 10)).filter((n) => n > 0);
    const n = Math.max(db.seq.no[key] || 0, ...used, 0) + 1;
    db.seq.no[key] = n;
    return head + String(n).padStart(4, '0');
  }
  const nextReqNo = () => nextNo(DOC_PREFIX.req);
  const nextMemoNo = () => nextNo(DOC_PREFIX.memo);
  const nextDocNo = (r, b, at) => nextNo(DOC_PREFIX[r.type] || 'DOC', at);

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** ยอดเงิน ถ้าติดลบแสดงเป็นสีแดง */
  function moneyCell(n) {
    return Number(n) < 0 ? '<span class="neg">' + money(n) + '</span>' : money(n);
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtDay(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('th-TH', { dateStyle: 'medium' });
  }

  const today = () => new Date().toISOString().slice(0, 10);
  function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

  const user = (id) => USERS.find((u) => u.id === id);
  const userName = (id) => (user(id) ? user(id).name : '-');
  /** เจ้าของงบ: ผู้ใช้ในระบบ หรือชื่อจากไฟล์ที่ Import (ยังไม่ผูกกับผู้ใช้ — ผู้คุมงบกำหนดทีหลังได้) */
  const ownerText = (b) => (b.ownerId ? userName(b.ownerId) : (b.ownerName || ''));
  const ownerLabel = (b) => (b.ownerId ? userName(b.ownerId) : (b.ownerName ? b.ownerName + ' (ยังไม่ผูกกับผู้ใช้)' : '-'));
  const me = () => (REMOTE ? remoteMe : (user(currentUserId) || USERS[0]));
  /**
   * สิทธิ์ของผู้ใช้ (รวมทุกบทบาท) · ธุรการ (business.proxy) ทำเอกสารแทน Business ได้ → ได้สิทธิ์ขอเบิก / ขอเพิ่มงบ (request.create) โดยอัตโนมัติ
   * (กันตั้งสิทธิ์บทบาทไม่ครบแล้วเมนูงบประมาณ / รายการเบิกหาย ทำเบิกใช้งบไม่ได้) — ฐานข้อมูลตรวจธุรการด้วย business.proxy อยู่แล้ว
   */
  const permsOf = (u) => {
    const base = (u && (u.perms || uniq(rolesOf(u).flatMap((k) => DEMO_ROLE_PERMS[k] || [])))) || [];
    return base.includes('business.proxy') && !base.includes('request.create') ? base.concat('request.create') : base;
  };
  const can = (perm) => permsOf(me()).includes(perm);
  /** เห็นงบและคำขอของทุกคน (สิทธิ์ดูทั้งหมด หรือสิทธิ์ที่ต้องทำงานกับเอกสารของคนอื่น) */
  /**
   * ขอบเขตบริษัทที่ดูได้: ผู้ใช้ที่เห็นงบทั้งหมดได้ (ผู้คุมงบ / จัดซื้อ ฯลฯ) เห็นเฉพาะงบของบริษัทใน companies ของบัญชี (ได้หลายบริษัท)
   * — เห็นทุกงานของบริษัทนั้นแม้ไม่ใช่ผู้รับผิดชอบ · บัญชีที่ไม่มี companies (เช่นโหมด Supabase ที่ฐานข้อมูลคุมสิทธิ์) และ Admin เห็นทุกบริษัท
   * · คืน null = ไม่จำกัด
   */
  const companyScope = () => { const u = me(); return Array.isArray(u.companies) && !rolesOf(u).includes('admin') && roleSeesWork(rolesOf(u)) ? u.companies : null; };
  const scopeOk = (company) => { const sc = companyScope(); return !sc || sc.includes(company); };
  const budgetScoped = (b) => !!b && scopeOk(b.company);
  const reqScoped = (r) => !!r && budgetScoped(budgetById(r.budgetId));
  const chgScoped = (c) => !!c && budgetScoped(budgetById(c.budgetId));
  const canViewAll = () => ['budget.view_all', 'budget.manage', 'budget.verify', 'request.decide', 'cut.record', 'po.record', 'gl.manage'].some(can);
  /** ธุรการ (business.proxy): ทำเอกสารแทน Business ได้ในบริษัทที่มีสิทธิ์ — เปิดใช้งบครั้งแรกทำไม่ได้ (ดู canOpenBudget) */
  const isProxy = () => can('business.proxy');
  /** ทำงานในนามเจ้าของงบ: เจ้าของงบเอง หรือธุรการในขอบเขตบริษัท */
  /**
   * ธุรการเห็น/ทำแทนตาม "หน่วยงาน" ที่ Admin กำหนดให้ (departments ของธุรการ — หลายหน่วยงานได้) — งบของหน่วยงานนั้นไม่ว่าบริษัทของงบจะเป็นบริษัทไหน
   * และเฉพาะงบที่เปิดใช้งานแล้ว (ฐานข้อมูลบังคับเหมือนกัน — v2_docs.department)
   */
  const proxyOf = (b) => !!b && isProxy() && isActive(b) && !!b.department && deptsOf(me()).includes(b.department);
  /** ธุรการล้วน (ไม่ได้ดูงานทั้งบริษัทด้วยบทบาทอื่น): สร้างงบเองไม่ได้ — ให้ Business เจ้าของงบสร้างและเปิดใช้งบเอง */
  const proxyOnly = () => isProxy() && !canViewAll();
  const actsFor = (b) => !!b && (b.ownerId === me().id || proxyOf(b));
  const roleLabel = (u) => (u && (u.roleName || rolesOf(u).map((k) => ROLE_LABEL[k] || k).join(', '))) || '';
  /** เลือกเป็น Business เจ้าของงบได้: ต้องขอเบิกได้ และไม่ใช่ธุรการ (ธุรการเปิดใช้งบไม่ได้) */
  const canRequestUser = (x) => (x.canRequest !== undefined ? x.canRequest : permsOf(x).includes('request.create')) && !permsOf(x).includes('business.proxy');
  const budgetById = (id) => db.budgets.find((b) => b.id === id);
  const requestById = (id) => db.requests.find((r) => r.id === id);
  const itemById = (b, id) => (b ? b.items.find((i) => i.id === id) : null);
  const uniq = (arr) => Array.from(new Set(arr));

  /** เรียงรหัสแบบ 1, 1.2, 1.10 */
  function compareCode(a, b) {
    const pa = String(a).split('.');
    const pb = String(b).split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      if (pa[i] === undefined) return -1;
      if (pb[i] === undefined) return 1;
      const na = Number(pa[i]);
      const nb = Number(pb[i]);
      const c = !isNaN(na) && !isNaN(nb) ? na - nb : pa[i].localeCompare(pb[i]);
      if (c) return c;
    }
    return 0;
  }

  const itemTotal = (it) => round2(Number(it.amount || 0) + Number(it.vat || 0));
  const isLeaf = (b, it) => !b.items.some((x) => x !== it && x.code.startsWith(it.code + '.'));
  const leaves = (b) => b.items.filter((it) => isLeaf(b, it));
  const sortedItems = (b) => (b.type === 'CBS' ? b.items.slice().sort((x, y) => compareCode(x.code, y.code)) : b.items);
  const depth = (it) => String(it.code).split('.').length - 1;

  /** รหัสของรายการนี้และรายการย่อยทุกระดับ (CAPEX ไม่มีรายการย่อย = ตัวเอง) */
  function leafIdsUnder(b, it) {
    return b.items.filter((x) => x === it || x.code.startsWith(it.code + '.')).map((x) => x.id);
  }

  // ---- CBS: Item หลัก (1, 2, 3) มีวงเงินของตัวเอง · Item ย่อย (1.1, 2.1) กำหนดวงเงินหรือไม่ก็ได้ (กันส่วนหนึ่งจาก Item หลัก ไม่เกินยอด Item หลัก)
  const parentOf = (b, it) => b.items.filter((x) => x !== it && String(it.code).startsWith(x.code + '.')).sort((x, y) => y.code.length - x.code.length)[0] || null;
  const isMainItem = (b, it) => b.type !== 'CBS' || depth(it) === 0;
  const hasOwnBudget = (b, it) => isMainItem(b, it) || itemTotal(it) > 0;
  const childrenOf = (b, it) => b.items.filter((x) => parentOf(b, x) === it);
  /** รายการที่รวมเป็นยอดงบ: OPEX = Item หลัก · CAPEX = ทุกรายการย่อย */
  const ledgerItems = (b) => (b.type === 'CBS' ? b.items.filter((x) => isMainItem(b, x)) : leaves(b));
  /** Item ที่ถือวงเงินจริงของรายการนี้ (Item ย่อยที่ไม่กำหนดวงเงิน ใช้ของ Item แม่) */
  function budgetNodeOf(b, it) {
    let n = it;
    while (n && b.type === 'CBS' && !hasOwnBudget(b, n)) n = parentOf(b, n) || null;
    return n || it;
  }
  function rootOf(b, it) {
    let n = it;
    while (b.type === 'CBS' && parentOf(b, n)) n = parentOf(b, n);
    return n;
  }
  /** วงเงินที่จัดสรรให้ Item ย่อยแล้ว (Item ย่อยที่ไม่กำหนดวงเงินโปร่งใส: นับของรายการลูก) */
  function allocatedOf(b, it) {
    return round2(childrenOf(b, it).reduce((sum, c) => sum + (hasOwnBudget(b, c) ? itemTotal(c) : allocatedOf(b, c)), 0));
  }
  /** ตรวจว่าวงเงิน Item ย่อยรวมกันไม่เกิน Item แม่: คืนรายการข้อความผิดพลาด */
  function treeErrors(b) {
    const out = [];
    b.items.forEach((it) => {
      if (!hasOwnBudget(b, it)) return;
      const alloc = allocatedOf(b, it);
      if (alloc > itemTotal(it) + 0.005) out.push('วงเงิน Item ย่อยของ ' + it.code + ' รวม ' + money(alloc) + ' เกินวงเงิน Item ' + money(itemTotal(it)) + ' บาท');
    });
    return out;
  }

  function budgetTotal(b) {
    return round2(ledgerItems(b).reduce((s, i) => s + itemTotal(i), 0));
  }

  function snapshotItems(b) {
    return ledgerItems(b).map((i) => ({ code: i.code, name: i.name, total: itemTotal(i) }));
  }

  /**
   * ยอดงบของทั้งงบ หรือของรายการ (รวมรายการลูก)
   * approved = งบที่ได้รับ
   * used = ตัดงบแล้ว (ตามจังหวะตัดงบของแต่ละประเภทการใช้งบ ทั้ง CAPEX และ OPEX)
   * reserved = จองไว้ (รอผู้คุมงบตรวจสอบ หรือออกเอกสารแล้วแต่ยังไม่ตัดงบ) — ยังหักออกจากยอดคงเหลือเพื่อกันใช้ซ้ำ
   */
  function usage(b, itemId) {
    let ids = null;
    let approved;
    if (itemId) {
      const it0 = itemById(b, itemId);
      if (!it0) return { approved: 0, used: 0, reserved: 0, remaining: 0 };
      const it = budgetNodeOf(b, it0);
      ids = leafIdsUnder(b, it);
      approved = itemTotal(it);
    } else {
      approved = budgetTotal(b);
    }
    return usageCalc(b, ids, approved);
  }
  /** ยอดใช้ / จองของ Item และรายการย่อยทั้งหมดใต้ Item นั้น (ใช้แสดง Item ย่อยที่ไม่กำหนดวงเงิน) */
  function usageOwn(b, it) {
    const u = usageCalc(b, leafIdsUnder(b, it), itemTotal(it));
    return { used: u.used, reserved: u.reserved };
  }
  /** คงเหลือจริงของรายการที่เลือก = ต่ำสุดของ Item ที่มีวงเงินในสายเดียวกัน (เช่น Item ย่อยที่กำหนดวงเงิน และ Item หลัก) ไม่นับยอดที่ ownReq จองไว้เอง */
  function remainingFor(b, itemId, ownReq) {
    let it = itemById(b, itemId);
    if (!it) return 0;
    let best = Infinity;
    while (it) {
      if (hasOwnBudget(b, it)) {
        const own = ownReq && isReserving(ownReq) ? linesAmount(ownReq, leafIdsUnder(b, it)) : 0;
        best = Math.min(best, round2(usage(b, it.id).remaining + own));
      }
      it = b.type === 'CBS' ? parentOf(b, it) : null;
    }
    return best === Infinity ? 0 : best;
  }
  function usageCalc(b, ids, approved) {
    let used = 0;
    let reserved = 0;
    db.requests.forEach((r) => {
      if (r.budgetId !== b.id || !['memo', 'pending', 'approved', 'closed'].includes(r.status)) return;
      const amt = linesAmount(r, ids);
      if (!amt) return;
      // ตัดงบตามรายการตัดงบจริงของแต่ละประเภท · ส่วนที่ยังไม่ตัดยังจองไว้ · ปิดยอดแล้วคืนส่วนต่าง
      // ใบที่มีหลายรายการต้นทุน (OPEX) แบ่งยอดที่ตัดตามสัดส่วนยอดของบรรทัดในรายการนั้น
      const cut = r.amount > 0 ? cutTotal(r) * (amt / r.amount) : 0;
      if (isReserving(r)) reserved += amt;
      else {
        used += cut;
        if (r.status === 'approved') reserved += Math.max(amt - cut, 0);
      }
    });
    used = round2(used);
    reserved = round2(reserved);
    return { approved, used, reserved, remaining: round2(approved - used - reserved) };
  }

  /** ทั้ง CAPEX และ OPEX ต้องผ่านผู้คุมงบตรวจสอบก่อนออกใบเบิกใช้งบ */
  function stepsFor(budget) {
    return [{ key: 'ctl', label: 'ผู้คุมงบตรวจสอบ', role: 'controller', status: 'waiting' }];
  }

  /** คำขอที่ยังรอ (รอแนบ Memo / รอผู้คุมงบตรวจ) — ยอดทั้งใบยังจองไว้ */
  const isReserving = (r) => r.status === 'pending' || r.status === 'memo';
  const currentStep = (r) => (r.status === 'pending' ? r.steps.find((s) => s.status === 'waiting') : null);
  const canAct = (u, step) => !!step && (step.assignee === u.id || permsOf(u).includes('request.decide'));
  const stepAssigneeText = (step) => (step.assignee ? userName(step.assignee) : ROLE_LABEL[step.role]);
  const inbox = (u) => db.requests.filter((r) => reqScoped(r) && canAct(u, currentStep(r)));

  // ---- คำขอเบิก: 1 ใบมีได้หลายบรรทัด (CAPEX ทุกบรรทัดอยู่ใต้รายการย่อยเดียวกัน, OPEX แต่ละบรรทัดเลือกรายการต้นทุนเองได้)
  const lineTotal = (l) => round2(Number(l.amountBeforeVat || 0) + Number(l.vat || 0));
  /** ยอดของบรรทัดที่อยู่ในรายการ ids (null = ทุกบรรทัด) */
  const linesAmount = (r, ids) => round2(r.lines.filter((l) => !ids || ids.includes(l.itemId)).reduce((s, l) => s + l.amount, 0));
  const reqItemIds = (r) => uniq(r.lines.map((l) => l.itemId));
  const paidTotal = (r) => round2((r.payments || []).reduce((s, p) => s + p.amount, 0));
  /** แผนการจ่าย (CAPEX): { mode: 'single' | 'installments', installments: [{ pct, note }] } — คำขอเก่าใช้ข้อความ paymentTerms */
  const isInstallments = (r) => !!(r.paymentPlan && r.paymentPlan.mode === 'installments');
  function planText(r) {
    if (!r.paymentPlan) return r.paymentTerms || '';
    if (!isInstallments(r)) return 'จ่ายครั้งเดียว';
    return r.paymentPlan.installments.length + ' งวด: ' + r.paymentPlan.installments.map((x) => x.pct + '%').join(' / ');
  }
  /** ยอดของแต่ละงวดตามแผน (งวดสุดท้ายรับเศษให้รวมได้ยอดเต็มพอดี) */
  function planAmounts(total, pcts) {
    const out = pcts.map((p) => round2(total * Number(p || 0) / 100));
    const sumPct = round2(pcts.reduce((s, p) => s + Number(p || 0), 0));
    if (out.length && sumPct === 100) out[out.length - 1] = round2(total - out.slice(0, -1).reduce((s, x) => s + x, 0));
    return out;
  }
  function planDetailHtml(r) {
    if (!isInstallments(r)) return esc(planText(r));
    const amts = planAmounts(r.amount, r.paymentPlan.installments.map((x) => x.pct));
    return r.paymentPlan.installments.map((x, i) => 'งวดที่ ' + (i + 1) + ' · ' + x.pct + '% · ' + money(amts[i]) + ' บาท' +
      (x.note ? ' — ' + esc(x.note) : '')).join('<br>');
  }
  function reqSummary(r) {
    const first = r.lines[0] ? r.lines[0].description : '';
    return r.lines.length > 1 ? first + ' และอีก ' + (r.lines.length - 1) + ' รายการ' : first;
  }
  // ---- การตัดงบตามประเภทการใช้งบ (CAPEX และ OPEX)
  const cutTotal = (r) => round2((r.cuts || []).reduce((s, c) => s + Number(c.amount || 0), 0));
  const hasPO = (r) => (r.cuts || []).some((c) => c.kind === 'po');
  /** จัดซื้อต้องบันทึก PO */
  const needsPO = (r) => r.status === 'approved' && r.useType === 'prpo' && !hasPO(r);
  /** ผู้คุมงบต้องบันทึกการตัดงบหรือปิดยอด */
  /** รอ Business / ธุรการ เคลียร์เงินทดรอง (กฎตัดงบใหม่ cutRule 2: ผู้คุมงบอนุมัติ = จ่ายเงินทดรองแล้ว) */
  const needsClear = (r) => r.status === 'approved' && r.cutRule === 2 && r.useType === 'advance';
  /** ผู้คุมงบต้องบันทึกการตัดงบหรือปิดยอด (ใบกฎเก่า + PR/PO ที่จัดซื้อออก PO แล้วรอผู้คุมงบยืนยันยอด) */
  const needsCut = (r) => r.status === 'approved' && !needsPO(r) && !needsClear(r);
  /** ผู้ขอ (Business) หรือธุรการในบริษัทที่มีสิทธิ์ */
  const isRequesterOrProxy = (r) => r.requesterId === me().id || proxyOf(budgetById(r.budgetId));
  /** ข้อความสถานะของเอกสาร */
  function statusText(r) {
    if (r.status === 'approved') return 'ออกใบเบิกใช้งบแล้ว';
    return STATUS_LABEL[r.status] || r.status;
  }
  const isActive = (b) => !b.state || b.state === 'active';
  /** หลักฐานการอนุมัติงบ: CAPEX = มติที่ประชุม (เข้าบอร์ด) · OPEX = เอกสารอนุมัติจากผู้บริหาร (ไม่ต้องเข้าบอร์ด) */
  function apprOf(type) {
    return type === 'CBS'
      ? { exec: true, title: 'การอนุมัติจากผู้บริหาร', file: 'ไฟล์เอกสารอนุมัติ', no: 'เลขที่เอกสารอนุมัติ', noEx: 'เช่น อนุมัติ MD-12/' + new Date().getFullYear(),
          date: 'วันที่ผู้บริหารอนุมัติ', note: 'หมายเหตุจากผู้บริหาร (ถ้ามี)', by: 'ผู้บริหารที่อนุมัติ', byEx: 'ชื่อ / ตำแหน่ง เช่น กรรมการผู้จัดการ',
          step: 'ผู้บริหารอนุมัติ / แนบหลักฐาน', route: 'เสนอผู้บริหารอนุมัติ', empty: 'ยังไม่ได้แนบเอกสารอนุมัติ', none: 'ยังไม่มีข้อมูลการอนุมัติ',
          verify: 'ตรวจเอกสารอนุมัติ', short: 'เอกสารอนุมัติผู้บริหาร', form: 'แบบขออนุมัติงบประมาณ (เสนอผู้บริหาร)', result: 'ผลการพิจารณาของผู้บริหาร',
          meet: 'วันที่ผู้บริหารอนุมัติ' }
      : { exec: false, title: 'มติที่ประชุม', file: 'ไฟล์มติที่ประชุม', no: 'เลขที่มติ', noEx: 'เช่น มติที่ 10/' + new Date().getFullYear(),
          date: 'วันที่ประชุม', note: 'หมายเหตุจากที่ประชุม (ถ้ามี)', step: 'เข้าที่ประชุม / แนบมติ', route: 'เข้าที่ประชุม', empty: 'ยังไม่ได้แนบมติ', none: 'ยังไม่มีข้อมูลมติ',
          verify: 'ตรวจมติ', short: 'มติที่ประชุม', form: 'แบบขออนุมัติงบประมาณ (เข้าที่ประชุม)', result: 'ผลการพิจารณาของที่ประชุม', meet: 'ประชุมวันที่' };
  }
  const apprNoOf = (o) => (o && o.meeting && o.meeting.no) || '';
  const apprMetaText = (a, m) => (m && m.date ? ' · ' + (a.exec ? 'อนุมัติวันที่ ' : 'ประชุมวันที่ ') + fmtDay(m.date) : '') + (m && m.by ? ' · ' + esc(m.by) : '');
  const CHANGE_STATE = { draft: 'ร่าง', review: 'รอผู้คุมงบตรวจสอบ', returned: 'ส่งกลับแก้ไข', approved: 'เพิ่มงบแล้ว', cancelled: 'ยกเลิก' };
  const CHANGE_STATE_BADGE = { draft: 'draft', review: 'pending', returned: 'rejected', approved: 'approved', cancelled: 'cancelled' };
  const changeById = (id) => (db.changes || []).find((c) => c.id === id);
  const changeTotal = (c) => round2((c.lines || []).reduce((s, l) => s + Number(l.amount || 0), 0));
  /** เพิ่ม/ลดวงเงินของรายการ (OPEX ที่มี VAT ปรับตามสัดส่วนเดิม) */
  function adjustItem(it, delta) {
    const total = itemTotal(it);
    if (Number(it.vat) > 0 && total > 0) {
      const ratio = Number(it.amount) / total;
      const amount = round2(Number(it.amount) + delta * ratio);
      it.vat = round2(total + delta - amount);
      it.amount = amount;
    } else {
      it.amount = round2(Number(it.amount || 0) + delta);
    }
  }
  function addRevision(b, note) {
    b.revisions = b.revisions || [];
    b.revisions.push({ no: b.revisions.length, at: new Date().toISOString(), by: me().id, note, total: budgetTotal(b), items: snapshotItems(b) });
  }
  const docTitle = () => 'ใบเบิกใช้งบ';

  // ---- ประวัติและ Log (เพิ่มได้อย่างเดียว)
  function logAction(action, ref, detail) {
    db.log = db.log || [];
    db.log.push({ at: new Date().toISOString(), by: me().id, action, ref: ref || '', detail: detail || '' });
  }
  /** บันทึกเหตุการณ์ลงประวัติของเรื่อง (งบ / คำขอเพิ่มงบ / ใบดำเนินการ) และลง Log */
  function addHistory(obj, action, note, ref) {
    obj.history = obj.history || [];
    obj.history.push({ at: new Date().toISOString(), by: me().id, action, note: note || '' });
    logAction(action, ref, note);
  }
  function addEvent(r, action, note) {
    r.events = r.events || [];
    r.events.push({ at: new Date().toISOString(), by: me().id, action, note: note || '' });
    logAction(action, r.docNo || r.no, note);
  }

  function badge(cls, text) {
    return '<span class="badge ' + esc(cls) + '">' + esc(text) + '</span>';
  }

  function usageBar(u) {
    const pct = (v) => (u.approved > 0 ? Math.min(100, (v / u.approved) * 100) : 0);
    return '<div class="bar" role="img" aria-label="ตัดงบแล้ว ' + money(u.used) + ' จองไว้ ' + money(u.reserved) + '">' +
      '<div class="used" style="width:' + pct(u.used) + '%"></div>' +
      '<div class="reserved" style="width:' + pct(u.reserved) + '%"></div></div>' +
      '<div class="legend"><span><i class="l-used"></i>ตัดงบแล้ว</span>' +
      '<span><i class="l-reserved"></i>จองไว้ (ยังไม่ตัดงบ)</span>' +
      '<span><i class="l-left"></i>คงเหลือ</span></div>';
  }

  function usageKv(u) {
    return '<dl class="kv">' +
      '<dt>งบที่ได้รับอนุมัติ</dt><dd>' + money(u.approved) + '</dd>' +
      '<dt>ตัดงบแล้ว (บัญชีจ่ายแล้ว)</dt><dd>' + money(u.used) + '</dd>' +
      '<dt>จองไว้ (ยังไม่ตัดงบ)</dt><dd>' + money(u.reserved) + '</dd>' +
      '<dt>คงเหลือ</dt><dd class="big">' + moneyCell(u.remaining) + '</dd></dl>';
  }

  let flash = null;
  function setFlash(type, text) { flash = { type, text }; }
  function takeFlash() {
    if (!flash) return '';
    const html = '<div class="alert ' + flash.type + '">' + esc(flash.text) + '</div>';
    flash = null;
    return html;
  }

  function showErrors(errors) {
    document.getElementById('formError').innerHTML = '<div class="alert error">' + errors.map(esc).join('<br>') + '</div>';
    window.scrollTo(0, 0);
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  /** ตัวเลือกจากข้อมูลหลัก — ถ้าค่าปัจจุบันไม่มีในรายการ (เช่น ถูกลบไปแล้ว) ยังคงแสดงไว้ไม่ให้ข้อมูลเดิมหาย */
  function optList(items, key, labelFn, selected) {
    const known = items.some((x) => String(x[key]) === String(selected));
    return (selected && !known ? opt(selected, selected, selected) : '') +
      items.map((x) => opt(x[key], labelFn(x), selected)).join('');
  }
  const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>';

  // ---------------------------------------------------------------- navigation

  function homeFor(u) {
    const has = (p) => permsOf(u).includes(p);
    if (has('budget.view_all')) return '#/budgets';
    if (has('request.create') || has('budget.create')) return '#/my-budgets';
    if (has('user.manage')) return '#/admin';
    if (has('master.manage') || has('log.view')) return '#/master';
    return '#/dashboard';
  }

  /** ไอคอนเมนู (เส้น 24×24) ให้ตรงกับชื่อเมนู */
  const NAV_ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 12l2.2 2.2L15.5 9.5"/><path d="M9 17.5h6"/>',
    budgets: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M15.5 14h4.5"/><circle cx="16" cy="14" r=".8" fill="currentColor"/>',
    requests: '<path d="M6 3h9l3 3v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    master: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v6.5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V5.5"/><path d="M4.5 12v6.5c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V12"/>',
    gl: '<path d="M6 3.5h11a2 2 0 0 1 2 2v15H8a2 2 0 0 1-2-2z"/><path d="M6 18.5a2 2 0 0 1 2-2h11"/><path d="M10 8h6M10 11.5h4"/>',
    log: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/>',
    roles: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    admin: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    export: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 12l6 6M15 12l-6 6"/>',
    report: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx=".8"/><rect x="12.5" y="7" width="3" height="10" rx=".8"/><rect x="17.5" y="13" width="2.5" height="4" rx=".8"/>',
    assumptions: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8v.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>'
  };
  const navIcon = (k) => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (NAV_ICONS[k] || NAV_ICONS.dashboard) + '</svg>';

  function renderNav(route) {
    const u = me();
    const count = (n) => (n ? '<span class="count">' + n + '</span>' : '');
    const links = [];
    // [ไอคอน, href, ข้อความ, เส้นทางที่ให้ไฮไลต์เมนูนี้]
    if (canViewAll()) links.push(['budgets', '#/budgets', 'งบประมาณ', ['#/budgets', '#/budget/', '#/change/', '#/adjust']]);
    else if (can('request.create') || can('budget.create')) links.push(['budgets', '#/my-budgets', 'งบประมาณ', ['#/my-budgets', '#/budget/', '#/request/new', '#/change/', '#/adjust']]);
    const tabs = taskTabs(u);
    if (tabs.length) links.push(['tasks', '#/tasks', 'งานทั้งหมด' + count(tabs.reduce((n, t) => n + (t.act ? t.n : 0), 0)), ['#/tasks', '#/approvals', '#/po', '#/cuts', '#/accounting', '#/payments']]);
    if (canViewAll() || can('request.create')) links.push(['requests', '#/requests', 'รายการเบิกใช้งบ', ['#/requests', '#/request/', '#/doc/']]);
    if (isWorker(u)) links.push(['history', '#/history', 'ประวัติการทำรายการ', ['#/history']]);
    if (can('gl.manage')) links.push(['gl', '#/gl', 'จัดการ GL', ['#/gl']]);
    if (can('data.export')) links.push(['export', '#/export', 'ส่งออกข้อมูล (Excel)', ['#/export']]);
    links.push(['report', '#/dashboard', 'รายงาน', ['#/dashboard']]);
    // ผู้ดูแลระบบ: ต่อจากเมนูรายงาน (แสดงเมนูละรายการตามสิทธิ์)
    if (can('user.manage') || can('master.manage') || can('log.view')) {
      links.push(['group', '', 'ผู้ดูแลระบบ']);
      const onAdmin = route.startsWith('#/admin');
      const rolesTab = /(^|&)tab=roles(&|$)/.test(location.hash.split('?')[1] || '');
      if (can('user.manage')) {
        links.push(['admin', '#/admin', 'ผู้ใช้' + count(REMOTE ? adminCounts.pending : adminResetCount()), ['#/admin'], undefined, onAdmin && !rolesTab]);
        links.push(['roles', '#/admin?tab=roles', 'บทบาทและสิทธิ์', ['#/admin'], undefined, onAdmin && rolesTab]);
      }
      if (can('master.manage')) {
        links.push(['master', '#/master', 'ข้อมูลหลัก', ['#/master']]);
        if (route.startsWith('#/master')) {
          const cur = route.split('/')[2] || MASTER_NAV[0][0];
          MASTER_NAV.forEach(([k, t]) => links.push(['sub', '#/master/' + k, t, [], k === cur]));
        }
      }
      if (can('log.view')) links.push(['log', '#/log', 'Log การทำงาน', ['#/log']]);
    }
    let activeDone = false;
    document.getElementById('nav').innerHTML = links.map(([icon, href, text, prefixes, subActive, override]) => {
      if (icon === 'group') return '<div class="nav-label nav-group">' + text + '</div>';
      if (icon === 'sub') return '<a class="sub' + (subActive ? ' sub-active' : '') + '" href="' + href + '"' + (subActive ? ' aria-current="page"' : '') + '><span>' + text + '</span></a>';
      const active = override !== undefined ? override : (!activeDone && prefixes.some((p) => route.startsWith(p)));
      if (active) activeDone = true;
      return '<a href="' + href + '"' + (active ? ' class="active" aria-current="page"' : '') + '>' + navIcon(icon) + '<span>' + text + '</span></a>';
    }).join('');
  }

  // ---------------------------------------------------------------- budget list

  // ตัวกรอง / การเรียง / หน้า ของรายการงบ จำค่าไว้ตอนสลับแท็บ
  const budgetFilter = { q: '', dept: '', year: '', state: '', type: '', company: '', page: 1, sort: '', dir: 1 };
  const BUDGET_PAGE = 50;

  const ICON_SEARCH = '<svg class="lead" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_CAL = '<svg class="trail" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function budgetSubline(b, mine) {
    const parts = [b.company, b.department, 'ปีงบ ' + b.fiscalYear];
    if (!mine) parts.push(ownerLabel(b));
    return parts.filter(Boolean).map(esc).join(' · ');
  }

  /** คอลัมน์ที่คลิกหัวตารางเพื่อเรียงได้: [คีย์, ข้อความ, คลาส] */
  const BUDGET_COLS = [['code', 'รหัสโครงการ'], ['name', 'ชื่องบ'], ['year', 'บริษัท / ปี'], ['dept', 'หน่วยงาน / Business'],
    ['statelabel', 'สถานะ'], ['total', 'งบอนุมัติ', 'num'], ['used', 'ตัดงบแล้ว', 'num'], ['reserved', 'จองไว้', 'num'], ['remaining', 'คงเหลือ', 'num']];

  function viewBudgets(params, mineRoute) {
    const u = me();
    const mine = !!mineRoute || !canViewAll();
    const all = db.budgets.filter((b) => (mine ? actsFor(b) : budgetScoped(b)));
    if (TYPE_LABEL[params.get('type')]) budgetFilter.type = params.get('type');
    const depts = uniq(all.map((b) => b.department)).sort();
    const years = uniq(all.map((b) => String(b.fiscalYear))).sort().reverse();
    const companies = uniq(all.map((b) => b.company)).sort();
    const states = Object.keys(BUDGET_STATE).filter((s2) => all.some((b) => (b.state || 'active') === s2));
    const selWrap = (id, label, inner) => '<label class="input-wrap select-wrap"><select id="' + id + '" aria-label="' + label + '">' + inner + '</select></label>';

    // ---- หัวหน้า: ชื่อหน้า + ปุ่มหลักชิดขวา
    const actions = can('budget.create') && !proxyOnly() && mine
      ? '<a class="btn primary tall" href="#/budget/new"><span aria-hidden="true">+</span> ขออนุมัติงบใหม่</a>'
      : can('budget.manage') && !mine
        ? '<a class="btn primary tall" href="#/budget/new"><span aria-hidden="true">+</span> สร้างงบประมาณ</a><a class="btn tall" href="#/budget/import">Import งบ</a>'
        : '';
    let html = '<div class="page-head"><h1>งบประมาณ</h1>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>' + takeFlash();

    if (!all.length) {
      return html + '<div class="card empty">' + (mine ? 'ยังไม่มีงบของคุณ — กด "ขออนุมัติงบใหม่" เพื่อเริ่ม' : 'ยังไม่มีงบประมาณ') + '</div>';
    }

    // ---- การ์ดตัวเลข (อัปเดตตามตัวกรองด้านล่าง)
    const tile = (key, label, link) => '<div class="stat-tile" data-tile="' + key + '"><div class="stat-label">' + label + '</div>' +
      '<div class="stat-value" data-v></div><div class="stat-sub" data-s></div>' + (link || '') + '</div>';
    html += '<div class="stat-tiles">' +
      tile('count', 'จำนวนงบทั้งหมด', '<button type="button" class="stat-tile-link" data-filter-state="notactive">ดูงบที่ยังไม่เปิดใช้งบ</button>') +
      tile('approved', 'งบที่ได้รับอนุมัติ (เปิดใช้งบแล้ว)', '<a class="stat-tile-link" href="#/dashboard">ดูรายงาน</a>') +
      tile('used', 'ตัดงบแล้ว + จองไว้', (canViewAll() || can('request.create')) ? '<a class="stat-tile-link" href="#/requests">ดูรายการเบิกใช้งบ</a>' : '') +
      tile('remaining', 'งบคงเหลือ') + '</div>';

    // ---- แผงตารางทะเบียนงบ
    const cols = BUDGET_COLS.map((c) => (mine && c[0] === 'dept' ? ['dept', 'หน่วยงาน'] : c));
    const rows = all.map((b) => {
      const us = usage(b);
      const search = [b.name, b.code, b.parentCode, b.department, b.company, ownerLabel(b)]
        .concat(b.items.map((i) => i.code + ' ' + i.name)).join(' ').toLowerCase();
      const sub = b.structure === 'project' ? 'งบรวมโครงการ' : b.type === 'CAPEX' ? b.items.length + ' รายการย่อย' : ledgerItems(b).length + ' Item หลัก';
      const state = b.state || 'active';
      const active = state === 'active';
      const own = b.ownerId === u.id;
      const acts0 = actsFor(b);
      const total = active ? us.approved : budgetTotal(b);
      const pct = active && us.approved > 0 ? Math.round(((us.used + us.reserved) / us.approved) * 100) : 0;
      const acts = [
        acts0 && (state === 'draft' || state === 'returned') ? '<a class="btn small" href="#/budget/' + b.id + '/edit">แก้ไขร่าง</a>' : '',
        state === 'review' && can('budget.verify') ? '<a class="btn small primary" href="#/budget/' + b.id + '">ตรวจสอบ</a>' : '',
        state === 'open_review' && can('budget.verify') ? '<a class="btn small primary" href="#/budget/' + b.id + '">ตรวจ Memo</a>' : '',
        waitingOpen(b) && own && can('request.create') ? '<a class="btn small primary" href="#/budget/' + b.id + '">ขอดำเนินการใช้งบ</a>' : '',
        active && acts0 && can('request.create') ? '<a class="btn small primary" href="#/request/new/' + b.id + '">เบิกใช้งบ</a>' : '',
        active && can('budget.adjust') ? '<a class="btn small" href="#/adjust?budget=' + b.id + '">ปรับปรุงงบ</a>' : ''
      ].join('');
      return '<tr' + (active ? '' : ' class="not-active"') + ' data-search="' + esc(search) + '" data-dept="' + esc(b.department) + '" data-year="' + esc(b.fiscalYear) + '" data-state="' + state +
        '" data-company="' + esc(b.company) + '" data-type="' + esc(b.type) +
        '" data-code="' + esc(b.code) + '" data-name="' + esc(b.name) + '" data-dept-sort="' + esc(b.department) + '" data-owner="' + esc(ownerText(b)) +
        '" data-statelabel="' + esc(BUDGET_STATE[state]) + '" data-total="' + total + '" data-used="' + (active ? us.used : 0) + '" data-reserved="' + (active ? us.reserved : 0) +
        '" data-remaining="' + (active ? us.remaining : state === 'cancelled' ? 0 : total) + '" data-pct="' + pct + '">' +
        '<td class="nowrap"><a class="mono" href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div>' + badge(b.type, TYPE_SHORT[b.type]) + '</div></td>' +
        '<td class="b-name"><a href="#/budget/' + b.id + '">' + esc(b.name) + '</a><div class="muted">' + esc(sub) + '</div></td>' +
        '<td class="nowrap">' + esc(b.company) + ' · ' + esc(b.fiscalYear) + '</td>' +
        '<td>' + esc(b.department) + (mine ? '' : '<div class="muted">' + esc(ownerLabel(b)) + '</div>') + '</td>' +
        '<td>' + badge(BUDGET_STATE_BADGE[state], BUDGET_STATE[state]) + '</td>' +
        '<td class="num">' + money(total) + (active ? '' : '<div class="muted">' + (b.setup ? 'วงเงินงบ' : 'ที่ขออนุมัติ') + '</div>') + '</td>' +
        (active
          ? '<td class="num">' + money(us.used) + '</td><td class="num">' + money(us.reserved) + '</td><td class="num"><strong>' + moneyCell(us.remaining) + '</strong><div class="muted">ใช้ไป ' + pct + '%</div></td>'
          : '<td class="num muted">–</td><td class="num muted">–</td>' +
            // ยังไม่เปิดใช้งบ: ยังไม่มีการใช้ คงเหลือ = วงเงินทั้งหมด (ยกเลิกแล้วไม่แสดง)
            (state === 'cancelled' ? '<td class="num muted">–</td>' : '<td class="num">' + money(total) + '<div class="muted">ยังไม่ได้ใช้</div></td>')) +
        '<td class="b-acts">' + acts + '</td></tr>';
    }).join('');
    const sortKey = { dept: 'dept-sort' };

    html += '<section class="rr-panel" aria-label="ตารางทะเบียนงบประมาณ">' +
      '<div class="rr-panel-head"><div class="rr-panel-title-row"><h2 class="rr-panel-title">ตารางทะเบียนงบประมาณ</h2><span class="rr-count" id="budgetCount"></span></div>' +
      '<div class="rr-panel-filters">' +
      '<label class="input-wrap"><select id="fYear" aria-label="ปีงบประมาณ">' + opt('', 'ปี: ทั้งหมด', budgetFilter.year) + years.map((y) => opt(y, 'ปี: ' + y, budgetFilter.year)).join('') + '</select>' + ICON_CAL + '</label>' +
      selWrap('fCompany', 'บริษัท', opt('', 'บริษัท: ทั้งหมด', budgetFilter.company) + companies.map((c) => opt(c, 'บริษัท: ' + c, budgetFilter.company)).join('')) +
      '</div></div>' +
      '<div class="rr-filter-row">' +
      '<label class="input-wrap search">' + ICON_SEARCH + '<input id="fSearch" type="search" placeholder="ค้นหาชื่องบ รหัส หรือหน่วยงาน" aria-label="ค้นหา" value="' + esc(budgetFilter.q) + '"></label>' +
      selWrap('fDept', 'หน่วยงาน', opt('', 'หน่วยงาน: ทั้งหมด', budgetFilter.dept) + depts.map((d) => opt(d, 'หน่วยงาน: ' + d, budgetFilter.dept)).join('')) +
      selWrap('fType', 'ประเภทงบ', opt('', 'ประเภทงบ: ทั้งหมด', budgetFilter.type) + ['CAPEX', 'CBS'].map((t) => opt(t, 'ประเภทงบ: ' + TYPE_LABEL[t], budgetFilter.type)).join('')) +
      selWrap('fState', 'สถานะงบ', opt('', 'สถานะ: ทั้งหมด', budgetFilter.state) + opt('notactive', 'สถานะ: ยังไม่เปิดใช้งบ (ทุกสถานะ)', budgetFilter.state) +
        states.map((s2) => opt(s2, 'สถานะ: ' + BUDGET_STATE[s2], budgetFilter.state)).join('')) +
      '</div>' +
      '<div class="rr-table-scroll"><table class="rr-data-table budget-table" id="budgetTable"><thead><tr>' +
      cols.map(([k, label, cls]) => '<th class="' + (cls || '') + '"><button type="button" class="th-sort" data-sort="' + (sortKey[k] || k) + '">' + label + '<span class="sort-ind" aria-hidden="true">↕</span></button></th>').join('') +
      '<th></th></tr></thead><tbody id="budgetBody">' + rows + '</tbody></table></div>' +
      '<div class="pager rr-panel-foot" id="budgetPager"></div>' +
      '<div class="empty" id="noMatch" hidden>ไม่พบงบที่ตรงกับเงื่อนไขที่เลือก</div></section>';
    return html;
  }

  function bindBudgetFilters() {
    const body = document.getElementById('budgetBody');
    const q = document.getElementById('fSearch');
    if (!q) return;
    const dept = document.getElementById('fDept');
    const year = document.getElementById('fYear');
    const st = document.getElementById('fState');
    const typ = document.getElementById('fType');
    const comp = document.getElementById('fCompany');
    const table = document.getElementById('budgetTable');
    const rows = Array.from(body.rows);
    const NUM = ['year', 'total', 'used', 'reserved', 'remaining', 'pct'];
    const camel = (k) => k.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
    const tileEl = (key, part) => document.querySelector('[data-tile="' + key + '"] [data-' + part + ']');
    const setTile = (key, value, sub, bad) => {
      const v = tileEl(key, 'v');
      v.innerHTML = value;
      v.classList.toggle('is-bad', !!bad);
      tileEl(key, 's').textContent = sub;
    };
    const baht = (n) => money(round2(n)) + ' <small>บาท</small>';
    const apply = (resetPage) => {
      budgetFilter.q = q.value;
      budgetFilter.dept = dept.value;
      budgetFilter.year = year.value;
      budgetFilter.state = st.value;
      budgetFilter.type = typ.value;
      budgetFilter.company = comp.value;
      if (resetPage) budgetFilter.page = 1;
      const term = q.value.trim().toLowerCase();
      let match = rows.filter((r) => (!term || r.dataset.search.includes(term)) &&
        (!dept.value || r.dataset.dept === dept.value) &&
        (!year.value || r.dataset.year === year.value) &&
        (!typ.value || r.dataset.type === typ.value) &&
        (!comp.value || r.dataset.company === comp.value) &&
        (!st.value || (st.value === 'notactive' ? r.dataset.state !== 'active' && r.dataset.state !== 'cancelled' : r.dataset.state === st.value)));
      if (budgetFilter.sort) {
        const k = camel(budgetFilter.sort);
        const isNum = NUM.includes(budgetFilter.sort);
        match = match.slice().sort((a, b) => (isNum ? Number(a.dataset[k]) - Number(b.dataset[k]) : String(a.dataset[k]).localeCompare(String(b.dataset[k]), 'th')) * budgetFilter.dir);
        match.forEach((r) => body.appendChild(r));
      }
      const pages = Math.max(1, Math.ceil(match.length / BUDGET_PAGE));
      budgetFilter.page = Math.min(Math.max(1, budgetFilter.page), pages);
      const from = (budgetFilter.page - 1) * BUDGET_PAGE;
      const shown = new Set(match.slice(from, from + BUDGET_PAGE));
      rows.forEach((r) => { r.hidden = !shown.has(r); });

      // การ์ดตัวเลข: ตามตัวกรอง (ทุกหน้า) — ยอดเงินนับเฉพาะงบที่เปิดใช้งบ
      const act = match.filter((r) => r.dataset.state === 'active');
      const sum = { total: 0, used: 0, reserved: 0, remaining: 0 };
      act.forEach((r) => Object.keys(sum).forEach((k) => { sum[k] += Number(r.dataset[k]); }));
      const waiting = match.filter((r) => r.dataset.state !== 'active' && r.dataset.state !== 'cancelled').length;
      setTile('count', match.length.toLocaleString('th-TH') + ' <small>งบ</small>', 'เปิดใช้งบ ' + act.length + ' · ยังไม่เปิดใช้งบ ' + waiting);
      setTile('approved', baht(sum.total), 'รวมเฉพาะงบที่เปิดใช้งบแล้ว (' + act.length + ' งบ)');
      setTile('used', baht(sum.used + sum.reserved), 'ตัดงบแล้ว ' + money(round2(sum.used)) + ' · จองไว้ ' + money(round2(sum.reserved)));
      setTile('remaining', baht(sum.remaining), sum.total > 0 ? 'คงเหลือ ' + (Math.round((sum.remaining / sum.total) * 1000) / 10) + '% ของงบที่ได้รับอนุมัติ' : 'ยังไม่มีงบที่เปิดใช้งบ', sum.remaining < 0);

      document.getElementById('budgetCount').textContent = match.length.toLocaleString('th-TH') + ' รายการ';
      table.querySelectorAll('.th-sort').forEach((b) => {
        const on = b.dataset.sort === budgetFilter.sort;
        b.classList.toggle('on', on);
        b.parentElement.setAttribute('aria-sort', on ? (budgetFilter.dir > 0 ? 'ascending' : 'descending') : 'none');
        b.querySelector('.sort-ind').textContent = on ? (budgetFilter.dir > 0 ? '▲' : '▼') : '↕';
      });
      document.getElementById('noMatch').hidden = match.length > 0;
      table.parentElement.hidden = match.length === 0;
      const pager = document.getElementById('budgetPager');
      pager.hidden = match.length === 0;
      pager.innerHTML = match.length
        ? '<span class="muted">แสดง ' + (from + 1) + '–' + Math.min(from + BUDGET_PAGE, match.length) + ' จาก ' + match.length + ' งบ</span>' +
          (pages > 1 ? '<span class="pager-btns"><button type="button" class="btn small" data-page="' + (budgetFilter.page - 1) + '"' + (budgetFilter.page <= 1 ? ' disabled' : '') + '>‹ ก่อนหน้า</button>' +
            '<span>หน้า ' + budgetFilter.page + ' / ' + pages + '</span>' +
            '<button type="button" class="btn small" data-page="' + (budgetFilter.page + 1) + '"' + (budgetFilter.page >= pages ? ' disabled' : '') + '>ถัดไป ›</button></span>' : '')
        : '';
    };
    q.addEventListener('input', () => apply(true));
    [dept, year, st, typ, comp].forEach((el) => el.addEventListener('change', () => apply(true)));
    document.querySelectorAll('[data-filter-state]').forEach((b) => b.addEventListener('click', () => { st.value = b.dataset.filterState; apply(true); }));
    table.addEventListener('click', (e) => {
      const b = e.target.closest('.th-sort');
      if (!b) return;
      if (budgetFilter.sort === b.dataset.sort) budgetFilter.dir = -budgetFilter.dir; else { budgetFilter.sort = b.dataset.sort; budgetFilter.dir = NUM.includes(b.dataset.sort) ? -1 : 1; }
      apply(false);
    });
    document.getElementById('budgetPager').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      budgetFilter.page = Number(b.dataset.page);
      apply(false);
      table.scrollIntoView({ block: 'start' });
    });
    apply(false);
  }

  // ---------------------------------------------------------------- budget form (finance)

  const usedItemIds = () => new Set([].concat(...db.requests.map(reqItemIds)));

  /** แถวรายการย่อย (CAPEX / OPEX แบบเดียวกัน): รหัส · ชื่อ · วงเงิน (รวม VAT) — เก็บ GL เดิมไว้ในแถว */
  function itemRow(it) {
    const total = it.amount === '' || it.amount === undefined || it.amount === null ? '' : round2(Number(it.amount || 0) + Number(it.vat || 0));
    return '<tr data-item-id="' + esc(it.id || '') + '" data-gl="' + esc(it.glCode || '') + '" data-gl-name="' + esc(it.glName || '') + '">' +
      '<td><input name="itCode" value="' + esc(it.code || '') + '" placeholder="เช่น 1 หรือ 2026-01-XX001" aria-label="รหัสรายการย่อย"></td>' +
      '<td><input name="itName" value="' + esc(it.name || '') + '" placeholder="เช่น ค่าแรงดูแลกล้า" aria-label="ชื่อรายการ"></td>' +
      '<td><input name="itAmount" type="number" min="0" step="0.01" class="right" placeholder="0.00" value="' + esc(total === 0 ? '' : total) + '" aria-label="วงเงิน (รวม VAT)"></td>' +
      '<td class="center"><button type="button" class="row-x" data-remove-item title="ลบรายการ" aria-label="ลบรายการ">×</button></td></tr>';
  }

  /**
   * ใครสร้าง/แก้ฟอร์มงบได้
   * Business = ขอตั้งงบใหม่เอง (ร่าง/ส่งกลับของตน) · ผู้คุมงบ = ลงงบประจำปีให้ Business (แก้ได้จนกว่า Business ส่ง Memo / เปิดใช้)
   */
  function budgetFormMode(b) {
    const u = me();
    if (b) {
      if ((b.state === 'draft' || b.state === 'returned') && actsFor(b)) return 'draft';
      if (b.setup && waitingOpen(b) && can('budget.manage')) return 'setup';
      return null;
    }
    if (can('budget.create') && !proxyOnly()) return 'draft';
    if (can('budget.manage')) return 'setup';
    return null;
  }

  function viewBudgetForm(id, params) {
    const b = id ? budgetById(id) : null;
    if (id && !b) return notFound();
    const mode = budgetFormMode(b);
    if (!mode) {
      return '<div class="alert error">' + (b ? 'แก้ไขได้เฉพาะร่างหรืองบที่ถูกส่งกลับ ของผู้สร้างเท่านั้น — งบที่เปิดใช้แล้วปรับได้ผ่าน "ขอเพิ่มงบ" หรือผู้คุมงบโยก/ลดงบ'
        : 'ไม่มีสิทธิ์สร้างงบ') + '</div>';
    }
    const u = me();
    const setup = mode === 'setup';
    const year = new Date().getFullYear();
    // คัดลอกงบอื่น: Business = งบของตนเอง · ผู้คุมงบ = ทุกงบ
    const copyList = !b ? db.budgets.filter((x) => x.state !== 'cancelled' && (setup ? budgetScoped(x) : actsFor(x)))
      .sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || ''))) : [];
    const copyId = params && params.get ? params.get('copy') : '';
    const copySrc = copyList.find((x) => x.id === copyId) || null;
    const mainItems = (x) => (x.type === 'CBS' ? sortedItems(x).filter((it) => depth(it) === 0) : x.items);
    const v = b || (copySrc ? {
      type: copySrc.type, structure: copySrc.structure || 'items', company: copySrc.company, fiscalYear: copySrc.fiscalYear, code: '', name: copySrc.name,
      department: deptsOf(user(setup || isProxy() ? copySrc.ownerId : u.id)).includes(copySrc.department) ? copySrc.department : '', ownerId: setup || isProxy() ? copySrc.ownerId : u.id, ownerName: setup ? copySrc.ownerName || '' : '', note: copySrc.note || '',
      listGroup: copySrc.listGroup || '', priorityGroup: copySrc.priorityGroup || '', investGroup: copySrc.investGroup || '', priorityReason: copySrc.priorityReason || '', financeOwner: copySrc.financeOwner || '',
      // คัดลอกรายการหลักพร้อมวงเงิน — Item ย่อย / ข้อมูลการอนุมัติ / ไฟล์แนบไม่ติดไป
      items: copySrc.structure === 'project' ? [{ code: '', name: 'งบรวมทั้งโครงการ', amount: budgetTotal(copySrc), vat: 0 }]
        : mainItems(copySrc).map((it) => ({ code: it.code, name: it.name, amount: it.amount, vat: it.vat || 0, glCode: it.glCode || '', glName: it.glName || '' }))
    } : {
      type: 'CAPEX', structure: 'items', company: (db.master.companies.find((c) => scopeOk(c.code)) || {}).code || '', fiscalYear: year + 1, code: '', name: '',
      department: '', ownerId: setup || isProxy() ? '' : u.id, note: '', items: []
    });
    const structure = setup ? (v.structure || 'items') : 'items'; // Business / ธุรการ: แยก Item เสมอ — งบรวมเป็นของผู้คุมงบ (ต้องแตกเป็น Item ก่อนเปิดใช้)
    const projItem = structure === 'project' && v.items[0] ? v.items[0] : {};
    const rows = structure !== 'project' && v.items.length ? mainItems(v) : [{}];
    const requesters = USERS.filter(canRequestUser); // ธุรการที่แท็กแล้วเลือกได้เฉพาะ Business ที่ถูกแท็ก (ยังไม่แท็ก = ทุกคนในบริษัท)
    const field = (label, inner, extra) => '<label class="field"' + (extra || '') + '><span>' + label + '</span>' + inner + '</label>';
    const select = (name, inner, attrs) => '<div class="select-wrap"><select name="' + name + '"' + (attrs || '') + '>' + inner + '</select></div>';
    /** ชื่อช่องตามไฟล์ Governance: CAPEX / OPEX ใช้ชื่อต่างกัน (สลับตามประเภทงบที่เลือก) */
    const dual = (capex, opex) => '<span data-for="CAPEX">' + capex + '</span><span data-for="CBS">' + opex + '</span>';
    const pick = (name, value, title, sub, cur) => '<label class="choice-opt"><input type="radio" name="' + name + '" value="' + value + '"' + (cur === value ? ' checked' : '') + '>' +
      '<span><strong>' + title + '</strong><small>' + sub + '</small></span></label>';
    const finNames = uniq(USERS.filter((x) => permsOf(x).includes('budget.manage')).map((x) => x.name).concat(db.budgets.map((x) => x.financeOwner).filter(Boolean)).concat(v.financeOwner ? [v.financeOwner] : []));
    const introFor = (type) => (setup
      ? 'ผู้คุมงบสร้างงบให้ Business (หรือ Import Excel) — บันทึกแล้วงบรอ Business เจ้าของงบ เปิดใช้งบ' + (type === 'CAPEX' ? ' (ทำ Memo ให้ผู้บริหารเซ็น แล้วผู้คุมงบยืนยัน)' : '')
      : 'เริ่มจากบันทึกร่าง แล้วพิมพ์แบบฟอร์มให้ผู้อนุมัติเซ็นนอกระบบ → แนบเอกสารส่งให้ผู้คุมงบตรวจ (อนุมัติ) → เปิดใช้งบ');
    const flow = setup ? FLOW_CTL : FLOW_BU;
    const stateText = b ? (b.incomplete ? 'ร่าง (ยังกรอกไม่ครบ)' : BUDGET_STATE[b.state] || '') : 'สร้างงบ';
    const title = b ? 'แก้ไขงบ ' + esc(b.code) : 'สร้างงบประมาณ';
    const copyPanel = copyList.length
      ? '<section class="card copy-card" id="copyPanel"' + (copySrc ? '' : ' hidden') + '><div class="copy-row"><label class="field"><span>คัดลอกจากงบที่มีอยู่</span><div class="select-wrap"><select id="copyFrom" aria-label="งบที่จะคัดลอก">' +
        '<option value="">— เลือกงบ —</option>' + copyList.map((x) => opt(x.id, TYPE_SHORT[x.type] + ' · ' + x.code + ' · ' + x.name + ' · ปี ' + x.fiscalYear, copySrc ? copySrc.id : '')).join('') + '</select></div></label>' +
        '<button type="button" class="btn" id="copyBtn" disabled>คัดลอก</button></div>' +
        '<p class="muted small-note">ใช้งบเดิมเป็นต้นแบบ: ดึงประเภทงบ บริษัท หน่วยงาน ข้อมูล Priority ชื่อ และรายการหลักพร้อมวงเงินมาใส่ฟอร์ม · รหัสโครงการต้องกรอกใหม่ · ไม่คัดลอก Item ย่อย / ข้อมูลการอนุมัติ / ไฟล์แนบ</p></section>'
      : '';
    const copyNote = copySrc
      ? '<div class="alert info">คัดลอกจาก <strong>' + esc(copySrc.code) + '</strong> ' + esc(copySrc.name) + ' แล้ว — กรอกรหัสโครงการใหม่ และปรับชื่อ / วงเงินตามงบนี้ได้ · <a href="#/budget/new">เริ่มใหม่โดยไม่คัดลอก</a></div>'
      : '';

    const card1 = '<section class="card form-section">' +
      '<div class="section-head"><div><h2 class="section-title"><span class="step">1</span>ข้อมูลโครงการ</h2><div class="section-sub">ข้อมูลตาม ' + dual('Capex Request', 'Opex Request') + ' (Capex / Opex Governance Framework)</div></div>' +
      '<div class="choice type-pick">' + pick('type', 'CAPEX', 'CAPEX', 'งบลงทุน', v.type) + pick('type', 'CBS', 'OPEX', 'งบดำเนินการ', v.type) + '</div></div>' +
      '<div class="row">' +
      field(dual('Capex ID', 'Opex ID') + ' (รหัสโครงการ)', '<input name="code" required placeholder="ระบุรหัสโครงการ" value="' + esc(v.code) + '">') +
      field(dual('ชื่อโครงการ', 'ชื่อรายการ/โครงการ'), '<input name="name" required placeholder="ระบุชื่อโครงการ" value="' + esc(v.name) + '">') +
      '</div><div class="row">' +
      field('บริษัท', select('company', optList(db.master.companies.filter((c) => scopeOk(c.code) || c.code === v.company), 'code', (c) => c.code + (c.name ? ' — ' + c.name : ''), v.company))) +
      field('หน่วยงานที่ขอ (หน่วยงานของเจ้าของงบ)', select('department', budgetDeptOptions(v.ownerId, v.department), ' required')) +
      '</div><div class="form-divider"></div><div class="row">' +
      field('กลุ่ม Priority', select('priorityGroup', '<option value="">— เลือก —</option>' + optList(db.master.priorityGroups, 'name', (x) => x.name, v.priorityGroup || ''))) +
      field('กลุ่ม Priority การลงทุน (กลุ่มการลงทุน New)', select('investGroup', '<option value="">— เลือก —</option>' + optList(db.master.investGroups, 'name', (x) => x.name, v.investGroup || '')), ' data-for="CAPEX"') +
      '</div>' +
      field('เหตุผลสนับสนุน Priority (ย่อ)', '<textarea name="priorityReason" rows="2" placeholder="อธิบายเหตุผลและความสำคัญของการลงทุน">' + esc(v.priorityReason || '') + '</textarea>') +
      '<div class="form-divider"></div><div class="row row-3">' +
      field(dual('ปีที่ลงทุน', 'ปีงบประมาณ'), '<input name="fiscalYear" type="number" required value="' + esc(v.fiscalYear) + '">') +
      field('เจ้าของฝ่ายการเงิน (ติดตามร่วม)', select('financeOwner', '<option value="">— เลือก —</option>' + finNames.map((n) => opt(n, n, v.financeOwner || '')).join(''))) +
      (setup || isProxy()
        ? field(dual('Owner (หลัก 1 คน)', 'เจ้าของ Action Plan') + ' — Business เจ้าของงบ' + (!v.ownerId && v.ownerName ? ' <small class="muted">(ชื่อในไฟล์: ' + esc(v.ownerName) + ')</small>' : ''),
          select('ownerId', '<option value="">— เลือก —</option>' + requesters.map((x) => opt(x.id, x.name + (x.title ? ' — ' + x.title : ''), v.ownerId)).join('')))
        : '<input type="hidden" name="ownerId" value="' + esc(v.ownerId) + '"><div class="field"><span>' + dual('Owner (หลัก 1 คน)', 'เจ้าของ Action Plan') + ' — Business เจ้าของงบ</span><div class="out left">' + esc(userName(v.ownerId)) + '</div></div>') +
      '</div>' +
      // ค่าที่ไม่มีในฟอร์มนี้แล้ว (มาจาก Import / ข้อมูลเดิม) เก็บไว้ตามเดิม
      '<input type="hidden" name="listGroup" value="' + esc(v.listGroup || '') + '">' +
      '</section>';

    const card2 = '<section class="card form-section">' +
      '<div class="section-head"><div><h2 class="section-title"><span class="step">2</span>โครงสร้างงบและรายการย่อย</h2><div class="section-sub">เลือกรูปแบบการควบคุมวงเงินของโครงการ</div></div>' +
      '<div class="choice type-pick wide">' + pick('structure', 'items', 'แยกรายการย่อย', 'คุมวงเงินรายรายการ เหมาะกับงบที่รู้รายละเอียดแล้ว', structure) +
        (setup ? pick('structure', 'project', 'งบรวมทั้งโครงการ', 'ยังไม่แยกรายการ — Business ต้องลงรายละเอียด Item ให้ครบก่อนเปิดใช้งบ', structure) : '') + '</div></div>' +
      '<div data-structure="items"><div class="groups-box">' +
      '<div class="table-wrap"><table class="edit-table group-table item-table"><colgroup><col class="c-code"><col><col class="c-amt"><col class="c-del"></colgroup>' +
      '<thead><tr><th>รหัสรายการย่อย</th><th>ชื่อรายการ</th><th class="num">วงเงิน (รวม VAT)</th><th></th></tr></thead>' +
      '<tbody id="itemRows">' + rows.map(itemRow).join('') + '</tbody></table></div>' +
      '<button type="button" class="link-add" data-add-row>+ เพิ่มรายการย่อย</button>' +
      '<div class="table-wrap group-sum"><table class="edit-table group-table item-table"><colgroup><col class="c-code"><col><col class="c-amt"><col class="c-del"></colgroup>' +
      '<tbody><tr><td colspan="2" class="right"><strong>รวม</strong></td><td class="num"><strong id="itemsTotal">0.00</strong></td><td></td></tr></tbody></table></div></div>' +
      '<p class="muted small-note" data-for="CBS">OPEX: รหัส Item หลักไม่มีจุด (1, 2, 3 …) · Item ย่อย (1.1) เพิ่มได้หลังเปิดใช้งบ · GL Code ฝ่ายบัญชีใส่ภายหลัง</p></div>' +
      '<div class="row" data-structure="project">' +
      field('วงเงิน (รวม VAT)', '<input name="projAmount" type="number" min="0" step="0.01" class="right" placeholder="0.00" value="' + esc(projItem.amount === undefined ? '' : round2(Number(projItem.amount || 0) + Number(projItem.vat || 0)) || '') + '">') +
      '</div></section>';

    const side = '<aside class="detail-side"><div class="card total-card"><h3 class="side-title">สรุปคำขอ</h3>' +
      '<div class="sum-box"><span>' + dual('มูลค่า Capex รวม (บาท)', 'มูลค่ารวมที่ขออนุมัติ (บาท)') + '</span><div class="total-amount" id="govTotal">0.00</div><small>รวม VAT แล้ว</small></div>' +
      '<dl class="kv compact"><dt>ประเภทงบ</dt><dd id="sumType"></dd><dt>' + dual('ปีที่ลงทุน', 'ปีงบประมาณ') + '</dt><dd id="sumYear"></dd>' +
      '<dt>รายการย่อย</dt><dd id="sumItems"></dd><dt>สถานะ</dt><dd><span class="sum-state">' + esc(stateText) + '</span></dd></dl></div>' +
      '<div class="card"><h3 class="side-title">หมายเหตุ / ความจำเป็นของโครงการ</h3><textarea name="note" rows="5" aria-label="หมายเหตุ / ความจำเป็นของโครงการ" placeholder="ระบุรายละเอียดเพิ่มเติม หรือความจำเป็นของโครงการ">' + esc(v.note || '') + '</textarea></div></aside>';

    const bar = '<div class="card form-bar"><p class="muted bar-hint">กรอกช่องที่มี * และรายการย่อยให้ครบก่อนบันทึก</p><div class="actions">' +
      '<a class="btn" data-back href="' + (b ? '#/budget/' + b.id : setup ? '#/budgets' : '#/my-budgets') + '">ยกเลิก</a>' +
      (setup ? '' : '<button class="btn" type="submit" data-action="draft" formnovalidate>บันทึกแบบร่าง</button>') +
      '<button class="btn primary" type="submit" data-action="create">' + (b ? (setup ? 'บันทึกงบ' : 'บันทึกและสร้างงบ') : 'สร้างงบ') + '</button></div></div>';

    return '<div class="page-head"><div><h1>' + title + '</h1><div class="page-sub" id="budgetIntro" data-capex="' + esc(introFor('CAPEX')) + '" data-cbs="' + esc(introFor('CBS')) + '">' + introFor(v.type) + '</div></div>' +
      (copyList.length ? '<div class="head-actions"><button type="button" class="btn" id="copyToggle">คัดลอกงบอื่น</button></div>' : '') + '</div>' +
      stepperHtml(flow, 0) +
      copyPanel + copyNote +
      '<div id="formError"></div>' +
      '<form id="budgetForm" class="budget-form" data-id="' + esc(id || '') + '" data-mode="' + mode + '">' +
      '<div class="detail-layout"><div class="detail-main form-main">' + card1 + card2 + '</div>' + side + '</div>' + bar + '</form>';
  }

  /** ช่องบังคับที่ยังขาดในฟอร์มสร้างงบ */
  function budgetFormMissing(f) {
    const e = f.elements;
    const m = [];
    const type = (f.querySelector('[name="type"]:checked') || {}).value;
    const structure = (f.querySelector('[name="structure"]:checked') || {}).value;
    if (!filled(e.code)) m.push(type === 'CBS' ? 'Opex ID (รหัสโครงการ)' : 'Capex ID (รหัสโครงการ)');
    if (!filled(e.name)) m.push('ชื่อโครงการ');
    if (!filled(e.company)) m.push('บริษัท');
    if (!filled(e.department)) m.push('หน่วยงานที่ขอ');
    // ช่องเลือกที่ข้อมูลหลักยังว่าง (ยังไม่ได้ใส่ตัวเลือก) ไม่บังคับ
    const hasOpts = (el) => el && el.options && el.options.length > 1;
    if (hasOpts(e.priorityGroup) && !filled(e.priorityGroup)) m.push('กลุ่ม Priority');
    if (type === 'CAPEX' && hasOpts(e.investGroup) && !filled(e.investGroup)) m.push('กลุ่ม Priority การลงทุน');
    if (!filled(e.fiscalYear)) m.push(type === 'CBS' ? 'ปีงบประมาณ' : 'ปีที่ลงทุน');
    if (hasOpts(e.financeOwner) && !filled(e.financeOwner)) m.push('เจ้าของฝ่ายการเงิน');
    if ((f.dataset.mode === 'setup' || isProxy()) && !filled(e.ownerId)) m.push('Owner (Business เจ้าของงบ)');
    if (structure === 'project') {
      if (!(Number(e.projAmount.value) > 0)) m.push('วงเงิน (รวม VAT)');
    } else {
      const rows = Array.from(f.querySelectorAll('#itemRows tr')).map((tr) => ({
        code: filled(tr.querySelector('[name="itCode"]')), dotted: String(tr.querySelector('[name="itCode"]').value).includes('.'),
        name: filled(tr.querySelector('[name="itName"]')), amount: Number(tr.querySelector('[name="itAmount"]').value || 0)
      })).filter((r) => r.code || r.name || r.amount);
      if (!rows.length) m.push('รายการย่อยอย่างน้อย 1 รายการ');
      else {
        if (rows.some((r) => !r.code || !r.name)) m.push('รหัสและชื่อรายการทุกแถว');
        if (rows.some((r) => !(r.amount > 0))) m.push('วงเงินทุกรายการ');
        if (type === 'CBS' && rows.some((r) => r.dotted)) m.push('รหัส Item หลักต้องไม่มีจุด (Item ย่อยเพิ่มภายหลัง)');
      }
    }
    return m;
  }

  /** ตัวเลือกหน่วยงานของงบ: เฉพาะหน่วยงานของเจ้าของงบ (Business มี 1 หน่วยงาน → ใส่ให้เลย) · บริษัทของงบเลือกได้อิสระ ไม่ผูกกับหน่วยงาน */
  function budgetDeptOptions(ownerId, current) {
    const ds = deptsOf(user(ownerId));
    const extra = current && !ds.includes(current) ? [current] : [];
    if (!ds.length && !extra.length) return '<option value="">' + (ownerId ? '— เจ้าของงบยังไม่มีหน่วยงาน —' : '— เลือกเจ้าของงบก่อน —') + '</option>';
    const sel = current || (ds.length === 1 ? ds[0] : '');
    return (ds.length === 1 && !extra.length ? '' : '<option value="">— เลือกหน่วยงาน —</option>') + ds.concat(extra).map((d) => opt(d, d + (ds.includes(d) ? '' : ' (ไม่ตรงกับหน่วยงานของเจ้าของงบ)'), sel)).join('');
  }
  function bindBudgetForm() {
    const form = document.getElementById('budgetForm');
    if (!form) return;
    const toggle = document.getElementById('copyToggle');
    if (toggle) toggle.addEventListener('click', () => { const pnl = document.getElementById('copyPanel'); pnl.hidden = !pnl.hidden; if (!pnl.hidden) document.getElementById('copyFrom').focus(); });
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
      const copySel = document.getElementById('copyFrom');
      copyBtn.disabled = !copySel.value;
      copySel.addEventListener('change', () => { copyBtn.disabled = !copySel.value; });
      copyBtn.addEventListener('click', () => {
        if (!copySel.value) return;
        if (form.elements.code.value.trim() && !confirm('ข้อมูลที่กรอกไว้ในฟอร์มนี้จะถูกแทนที่ด้วยข้อมูลที่คัดลอก ต้องการดำเนินการต่อ?')) return;
        go('#/budget/new?copy=' + copySel.value);
      });
    }
    // ผู้คุมงบเลือกเจ้าของงบ → หน่วยงานของงบตามหน่วยงานของเจ้าของงบนั้น
    if (form.elements.ownerId && form.elements.ownerId.tagName === 'SELECT') {
      form.elements.ownerId.addEventListener('change', () => {
        form.elements.department.innerHTML = budgetDeptOptions(form.elements.ownerId.value, '');
      });
    }
    const curType = () => (form.querySelector('[name="type"]:checked') || {}).value || 'CAPEX';
    // CAPEX / OPEX: แยกรายการ หรือ งบรวมทั้งโครงการ (ของบโดยยังไม่มีรายละเอียด Item)
    const curStructure = () => (form.querySelector('[name="structure"]:checked') || {}).value || 'items';
    const tbody = document.getElementById('itemRows');
    const recalc = () => {
      let sum = 0;
      let n = 0;
      Array.from(tbody.rows).forEach((tr) => {
        sum += Number(tr.querySelector('[name="itAmount"]').value || 0);
        if (tr.querySelector('[name="itCode"]').value.trim() || tr.querySelector('[name="itName"]').value.trim()) n += 1;
      });
      document.getElementById('itemsTotal').textContent = money(sum);
      const project = curStructure() === 'project';
      document.getElementById('govTotal').textContent = money(project ? Number(form.elements.projAmount.value || 0) : sum);
      document.getElementById('sumType').textContent = TYPE_SHORT[curType()];
      document.getElementById('sumYear').textContent = form.elements.fiscalYear.value || '-';
      document.getElementById('sumItems').textContent = project ? 'งบรวมทั้งโครงการ' : n + ' รายการ';
    };
    const sync = () => {
      const t = curType();
      const st = curStructure();
      document.querySelectorAll('#budgetForm [data-for], #budgetForm [data-structure]').forEach((el) => {
        el.hidden = (el.dataset.for && el.dataset.for !== t) || (el.dataset.structure && el.dataset.structure !== st);
      });
      const introEl = document.getElementById('budgetIntro');
      if (introEl) introEl.textContent = t === 'CBS' ? introEl.dataset.cbs : introEl.dataset.capex;
      recalc();
    };
    form.querySelectorAll('[name="type"], [name="structure"]').forEach((el) => el.addEventListener('change', sync));
    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove-item]')) {
        if (tbody.rows.length > 1) e.target.closest('tr').remove();
        else tbody.rows[0].querySelectorAll('input').forEach((el) => { el.value = ''; });
        recalc();
      }
      if (e.target.closest('[data-add-row]')) {
        // OPEX: เสนอรหัสถัดไปจากแถวสุดท้าย เช่น 3 → 4
        let code = '';
        const last = tbody.rows.length ? tbody.rows[tbody.rows.length - 1].querySelector('[name="itCode"]').value.trim() : '';
        if (curType() === 'CBS' && /^\d+$/.test(last)) code = String(Number(last) + 1);
        tbody.insertAdjacentHTML('beforeend', itemRow({ code, name: '', amount: '' }));
        tbody.rows[tbody.rows.length - 1].querySelector(code ? '[name="itName"]' : '[name="itCode"]').focus();
        recalc();
      }
    });
    sync();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const id = form.dataset.id;
      const existing = id ? budgetById(id) : null;
      const mode = form.dataset.mode;
      const type = curType();
      const structure = curStructure();
      // บันทึกแบบร่าง (Business): ต้องมีรหัส + ชื่อเท่านั้น · สร้างงบ: ต้องกรอกครบทุกช่องที่มี *
      const asDraft = e.submitter && e.submitter.dataset.action === 'draft';
      const errors = [];
      const code = f.code.value.trim();
      if (!code) errors.push('กรุณาระบุรหัสโครงการ');
      if (!f.name.value.trim()) errors.push('กรุณาระบุชื่อโครงการ');
      if (db.budgets.some((b) => b.code === code && b.id !== id && b.state !== 'cancelled')) errors.push('รหัส "' + code + '" มีอยู่แล้ว');
      const missing = budgetFormMissing(form);

      const rows = structure === 'project' ? [] : Array.from(form.querySelectorAll('#itemRows tr'));
      const val = (tr, n) => tr.querySelector('[name="' + n + '"]');
      const items = rows.map((tr) => {
        const it = {
          id: tr.dataset.itemId || '',
          code: val(tr, 'itCode').value.trim(),
          name: val(tr, 'itName').value.trim(),
          amount: round2(val(tr, 'itAmount').value)
        };
        if (type !== 'CAPEX') {
          // วงเงินกรอกรวม VAT · Item หลักไม่มีจำนวน / หน่วย (กรอกที่ Item ย่อย) · GL เดิมเก็บไว้ (ฝ่ายบัญชีใส่ / แก้ได้ที่หน้า GL)
          Object.assign(it, { qty: '', unit: '', vat: 0, glCode: tr.dataset.gl || '', glName: tr.dataset.glName || '' });
        }
        return it;
      }).filter((it) => it.code || it.name || it.amount);
      if (structure === 'project') {
        // งบรวมโครงการ = รายการเดียวที่เป็นตัวโครงการ
        const old = existing && existing.structure === 'project' ? existing.items[0] : null;
        items.push(Object.assign({ id: old ? old.id : '', code: code || '-', name: 'งบรวมทั้งโครงการ', amount: round2(f.projAmount.value), vat: 0,
          qty: '', unit: '', glCode: '', glName: '' }, {}));
      }

      if (!asDraft && !items.length) errors.push('ต้องมีรายการอย่างน้อย 1 รายการ');
      if (!asDraft && items.some((it) => !it.code || !it.name)) errors.push('กรุณากรอกรหัสและชื่อรายการให้ครบทุกแถว');
      if (!asDraft && missing.length) errors.push('กรอกให้ครบก่อน: ' + missing.join(' · '));
      const dup = items.map((it) => it.code).filter((c, i, arr) => c && arr.indexOf(c) !== i);
      if (dup.length) errors.push('รหัสรายการซ้ำ: ' + uniq(dup).join(', '));
      const draft = { type, items };
      if (type === 'CBS') {
        if (structure === 'items' && items.some((it) => String(it.code).includes('.'))) errors.push('Item หลักใช้รหัสไม่มีจุด (เช่น 1, 2, 3) — Item ย่อย (1.1) เพิ่มได้ภายหลังเมื่องบเปิดใช้แล้ว');
      } else {
        // CAPEX: รายการแม่ (ถ้าใช้รหัสมีจุด) ไม่มีวงเงินของตัวเอง
        items.forEach((it) => { if (!isLeaf(draft, it)) { it.amount = 0; it.vat = 0; it.qty = ''; } });
      }
      if (items.some((it) => !(it.amount > 0)) && structure === 'items') errors.push(type === 'CBS' ? 'วงเงินของ Item หลักแต่ละรายการต้องมากกว่า 0' : 'วงเงินของแต่ละรายการย่อยต้องมากกว่า 0');
      if (!(budgetTotal(draft) > 0)) errors.push('วงเงินรวมต้องมากกว่า 0');

      items.forEach((it) => { if (!it.id) it.id = nextId('i'); });
      const snapshot = snapshotItems(draft);
      if (errors.length) { showErrors(errors); return; }

      if (type === 'CBS' && existing) {
        const mains = new Set(items.map((it) => it.code));
        existing.items.filter((x) => depth(x) > 0 && mains.has(String(x.code).split('.')[0])).forEach((x) => items.push(x));
      }
      const data = {
        type, code, items, structure,
        company: f.company.value,
        fiscalYear: Number(f.fiscalYear.value),
        name: f.name.value.trim(),
        department: f.department.value.trim(),
        ownerId: f.ownerId.value || (existing ? existing.ownerId : isProxy() ? '' : me().id),
        ownerName: f.ownerId.value ? '' : (existing ? existing.ownerName || '' : ''),
        note: f.note.value.trim(),
        listGroup: f.listGroup.value,
        priorityGroup: f.priorityGroup.value,
        investGroup: type === 'CAPEX' ? f.investGroup.value : '',
        priorityReason: f.priorityReason.value.trim(),
        financeOwner: f.financeOwner.value.trim(),
        incomplete: asDraft && missing.length > 0
      };
      const at = new Date().toISOString();
      let target;
      if (mode === 'setup') data.meeting = existing && existing.meeting ? existing.meeting : { date: '', no: '', note: '', by: '' };
      if (existing) {
        target = existing;
        Object.assign(target, data, { updatedAt: at, updatedBy: me().id });
        addHistory(target, mode === 'setup' ? 'ผู้คุมงบแก้ไขงบ' : 'แก้ไขร่าง', '', 'งบ ' + code);
      } else {
        target = Object.assign({ id: nextId('b'), createdAt: at, createdBy: me().id, attachments: [], history: [], revisions: [] }, data);
        if (mode === 'setup') {
          Object.assign(target, { state: 'pending_open', setup: true });
          addHistory(target, 'ผู้คุมงบลงงบประจำปี — รอ Business ขอดำเนินการใช้งบ', target.meeting.no, 'งบ ' + code);
        } else {
          target.state = 'draft';
          addHistory(target, 'สร้างร่างคำขออนุมัติงบ', '', 'งบ ' + code);
        }
        db.budgets.push(target);
      }
      save();
      setFlash('success', mode === 'setup' ? 'บันทึกงบ ' + code + ' แล้ว — รอ ' + userName(target.ownerId) + ' ขอดำเนินการใช้งบ' + (type === 'CAPEX' ? ' (ทำ Memo ให้ผู้บริหารเซ็น)' : '')
        : asDraft ? 'บันทึกแบบร่าง ' + code + ' แล้ว' + (data.incomplete ? ' — ยังกรอกไม่ครบ กลับมาแก้ไขให้ครบแล้วกด "สร้างงบ" ก่อนส่งอนุมัติ' : '')
        : 'สร้างงบ ' + code + ' แล้ว — พิมพ์แบบฟอร์ม' + (type === 'CBS' ? 'เสนอผู้บริหาร' : 'เข้าที่ประชุม') + 'ได้จากหน้ารายละเอียด เมื่อได้' + (type === 'CBS' ? 'เอกสารอนุมัติ' : 'มติ') + 'แล้วแนบหลักฐานและส่งให้ผู้คุมงบ');
      go('#/budget/' + target.id);
    });
  }

  // ---------------------------------------------------------------- budget detail

  // ---- ไฟล์แนบ (โหมดทดลองเก็บในเบราว์เซอร์ เป็น data URL)
  const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  /** รายการไฟล์แนบ: opts.del = ใส่ปุ่มลบ (data-att-del) */
  /** ไฟล์ที่แสดงอยู่บนหน้า (id → ไฟล์) ใช้เปิดดูในหน้าเว็บ */
  const ATT_REG = new Map();
  const isImageFile = (f) => /^image\//.test(f.type || '') || /^data:image\//.test(f.data || '') || /\.(png|jpe?g)$/i.test(f.name || '');
  function attachList(list, opts) {
    const files = list || [];
    files.forEach((f) => { if (f.id) ATT_REG.set(f.id, f); });
    if (!files.length) return '<p class="muted small-note">' + ((opts && opts.empty) || 'ยังไม่มีไฟล์แนบ') + '</p>';
    return '<ul class="files">' + files.map((f) => '<li><span class="file-ico" aria-hidden="true">' + (isImageFile(f) ? 'IMG' : 'PDF') + '</span><div>' +
      (f.data ? '<a href="#" data-att-view="' + esc(f.id) + '" title="เปิดดูในหน้าเว็บ">' + esc(f.name) + '</a>' +
        ' <a class="file-dl" href="' + f.data + '" download="' + esc(f.name) + '" title="ดาวน์โหลด">ดาวน์โหลด</a>' : '<span>' + esc(f.name) + '</span>') +
      '<small>' + (f.sample ? 'ไฟล์ตัวอย่าง (ไม่มีเนื้อหา)' : fmtSize(f.size)) + ' · ' + esc(userName(f.by)) + ' · ' + fmtDate(f.at) + '</small></div>' +
      (opts && opts.del ? '<button type="button" class="btn small bad" data-att-del="' + esc(f.id) + '" title="ลบไฟล์">×</button>' : '') + '</li>').join('') + '</ul>';
  }
  /** เปิดดูไฟล์แนบในหน้าเว็บ (PDF ด้วยตัวแสดง PDF ของเบราว์เซอร์ · รูปภาพแสดงเต็มกรอบ) */
  function openAttachment(f) {
    if (!f || !f.data) return;
    let url = f.data;
    try {
      const [head, b64] = f.data.split(',');
      const mime = (head.match(/^data:([^;]+)/) || [])[1] || f.type || 'application/pdf';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([arr], { type: mime }));
    } catch (err) { /* ใช้ data URL เดิม */ }
    const box = document.createElement('div');
    box.className = 'viewer';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<div class="viewer-panel"><div class="viewer-head"><strong class="viewer-name">' + esc(f.name) + '</strong>' +
      '<div class="viewer-actions"><a class="btn small" href="' + url + '" target="_blank" rel="noopener">เปิดในแท็บใหม่</a>' +
      '<a class="btn small" href="' + f.data + '" download="' + esc(f.name) + '">ดาวน์โหลด</a>' +
      '<button type="button" class="btn small" data-viewer-close>ปิด ✕</button></div></div>' +
      '<div class="viewer-body">' + (isImageFile(f) ? '<img src="' + url + '" alt="' + esc(f.name) + '">' : '<iframe src="' + url + '" title="' + esc(f.name) + '"></iframe>') + '</div></div>';
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); if (url !== f.data) setTimeout(() => URL.revokeObjectURL(url), 1000); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-viewer-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(box);
    box.querySelector('[data-viewer-close]').focus();
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-att-view]');
    if (!a) return;
    e.preventDefault();
    openAttachment(ATT_REG.get(a.dataset.attView));
  });

  /** อ่านไฟล์จาก input — รับ PDF/รูปภาพ ไม่เกิน ATTACH_MAX (โหมดทดลอง) */
  function readFiles(input, slot) {
    const files = Array.from(input.files || []);
    const bad = files.filter((f) => !/pdf|png|jpe?g/i.test(f.type || f.name));
    const big = files.filter((f) => f.size > ATTACH_MAX);
    if (bad.length) { alert('รับเฉพาะไฟล์ PDF หรือรูปภาพ (PNG/JPG)'); return Promise.resolve([]); }
    if (big.length) { alert('โหมดทดลองเก็บไฟล์ในเบราว์เซอร์ได้ไม่เกิน ' + fmtSize(ATTACH_MAX) + ' ต่อไฟล์ (ระบบจริงรับไฟล์ใหญ่กว่านี้ได้)\n' + big.map((f) => f.name + ' = ' + fmtSize(f.size)).join('\n')); return Promise.resolve([]); }
    return Promise.all(files.map((f) => new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = () => resolve({ id: nextId('f'), slot, name: f.name, size: f.size, type: f.type, data: rd.result, at: new Date().toISOString(), by: me().id });
      rd.readAsDataURL(f);
    })));
  }

  const budgetStateBadge = (b) => badge(BUDGET_STATE_BADGE[b.state || 'active'], BUDGET_STATE[b.state || 'active']);
  const tlItem = (cls, title, sub, note) => '<li class="' + cls + '"><span class="tl-dot"></span><div><strong>' + title + '</strong>' +
    (sub ? '<div class="muted">' + sub + '</div>' : '') + (note ? '<div class="tl-note">' + esc(note) + '</div>' : '') + '</div></li>';
  /** ประวัติการดำเนินการ (ใหม่สุดอยู่บน) */
  function historyCard(list, title) {
    const items = (list || []).slice().reverse();
    return '<div class="card"><h3 class="side-title">' + (title || 'ประวัติการดำเนินการ') + '</h3>' +
      (items.length ? '<ol class="timeline">' + items.map((h) => tlItem('done', esc(h.action), esc(userName(h.by)) + ' · ' + fmtDate(h.at), h.note)).join('') + '</ol>'
        : '<p class="muted">ยังไม่มีประวัติ</p>') + '</div>';
  }
  /** แถบขั้นตอนของวงจรงบ (ชุดเดียวกับหน้าสร้างงบ) */
  const stepperHtml = (labels, idx) => '<ol class="stepper stepper-' + labels.length + '">' + labels.map((label, i) =>
    '<li class="' + (i < idx ? 'done' : i === idx ? 'current' : '') + '"><span>' + (i + 1) + '</span>' + label + '</li>').join('') + '</ol>';
  function budgetStepper(b) {
    const setup = !!b.setup;
    return stepperHtml(setup ? FLOW_CTL : FLOW_BU, flowIndex(b, setup));
  }

  function viewBudgetDetail(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    const u = me();
    const state = b.state || 'active';
    const active = state === 'active';
    const own = b.ownerId === u.id;
    const acts = actsFor(b); // เจ้าของงบ หรือธุรการในบริษัทที่มีสิทธิ์ (เปิดใช้งบครั้งแรกใช้ own / canOpenBudget เท่านั้น)
    const editable = acts && (state === 'draft' || state === 'returned');
    const us = usage(b);
    const reqs = db.requests.filter((r) => r.budgetId === b.id);
    const chgs = (db.changes || []).filter((c) => c.budgetId === b.id);
    const canRequest = active && can('request.create') && acts;
    const manageSub = canManageSubItems(b);
    const isCapex = b.type === 'CAPEX';
    const isProject = b.structure === 'project';
    const first = (b.revisions && b.revisions[0]) ? b.revisions[0].items : [];

    // ---- หัวหน้า + ปุ่มคำสั่ง
    const actions = [];
    if (canRequest) {
      actions.push('<a class="btn primary" href="#/request/new/' + b.id + '">ขอเบิกใช้งบ</a>');
      actions.push('<a class="btn" href="#/change/new/' + b.id + '">ขอเพิ่มงบ</a>');
    }
    if (editable) actions.push('<a class="btn" href="#/budget/' + b.id + '/edit">แก้ไขร่าง</a>');
    // คัดลอกเป็นงบใหม่: Business เจ้าของงบ (ทุกประเภท) · ผู้คุมงบ (ทุกงบ — ลงให้ Business)
    if (state !== 'cancelled' && ((acts && can('budget.create') && !proxyOnly()) || (!can('budget.create') && can('budget.manage')))) actions.push('<a class="btn" href="#/budget/new?copy=' + b.id + '">คัดลอกเป็นงบใหม่</a>');
    const setupEdit = b.setup && waitingOpen(b) && can('budget.manage');
    if (setupEdit) actions.push('<a class="btn" href="#/budget/' + b.id + '/edit">แก้ไขงบ</a>');
    if (openFlow(b) && groupLead(b).openMemo && b.type === 'CAPEX' && (own || canViewAll() || actsFor(b))) actions.push('<a class="btn" href="#/budget/' + b.id + '/memo' + (canEditOpenMemo(groupLead(b)) ? '' : '?view=1') + '">Memo ขอดำเนินการใช้งบ</a>');
    if (!b.setup && (own || canViewAll() || actsFor(b))) actions.push('<a class="btn" href="#/budget/' + b.id + '/form">พิมพ์แบบฟอร์มขออนุมัติ</a>');
    if (manageSub) actions.push('<a class="btn" href="#/budget/' + b.id + '/items">จัดการ Item ย่อย</a>');
    if (canEditGl(b)) actions.push('<a class="btn" href="#/budget/' + b.id + '/gl">ใส่ GL Code</a>');
    if (canPlanCashflow(b)) actions.push('<a class="btn" href="#/budget/' + b.id + '/cashflow">' + (hasCashflow(b) ? 'แก้ไข Plan Cashflow' : 'วาง Plan Cashflow') + '</a>');
    if (active && can('budget.adjust')) actions.push('<a class="btn" href="#/adjust?budget=' + b.id + '">ปรับปรุงงบ</a>');
    if (editable || setupEdit) actions.push('<button type="button" class="btn bad" id="cancelBudget">ยกเลิกงบ</button>');
    let html = '<div class="page-head detail-head"><div>' +
      '<div class="eyebrow">' + (isCapex ? 'งบลงทุน' : 'งบดำเนินงาน') + ' · ' + badge(b.type, TYPE_SHORT[b.type]) + ' ' + esc(b.code) +
      ' · ' + budgetStateBadge(b) + '</div>' +
      '<h1>' + esc(b.name) + '</h1></div>' +
      (actions.length ? '<div class="head-actions">' + actions.join('') + '</div>' : '') + '</div>' + takeFlash();

    if (!active) {
      const owner = ownerLabel(b);
      const msg = {
        draft: acts ? (isCapex ? 'ร่างนี้ยังไม่ได้ส่ง — พิมพ์แบบฟอร์มเข้าที่ประชุม เมื่อผู้อนุมัติเซ็นแล้ว แนบมติและส่งให้ผู้คุมงบตรวจสอบด้านล่าง (ร่างค้างไว้ได้ไม่จำกัดเวลา)'
          : 'ร่างนี้ยังไม่ได้ส่ง — พิมพ์แบบฟอร์มของระบบ หรือใช้เอกสารขออนุมัติของคุณเอง ให้ผู้อนุมัติเซ็น แล้วแนบเอกสารและส่งให้ผู้คุมงบตรวจสอบด้านล่าง (ร่างค้างไว้ได้ไม่จำกัดเวลา)')
          : 'ร่างนี้ยังไม่ได้ส่ง (' + owner + ' ยังกรอกอยู่)',
        returned: 'ผู้คุมงบส่งกลับให้แก้ไข: ' + (b.returnReason || ''),
        review: 'ส่งแล้ว — รอผู้คุมงบตรวจ' + (isCapex ? 'มติ' : 'เอกสารอนุมัติ') + 'ว่าผ่านหรือส่งกลับ (ผู้อนุมัติเซ็นเอกสารนอกระบบ)',
        pending_open: own
          ? (b.setup ? 'ผู้คุมงบสร้างงบนี้ให้คุณแล้ว — ' : 'ผู้คุมงบตรวจผ่านแล้ว — ') + (isCapex ? 'เปิดใช้งบโดยทำ Memo ให้ผู้บริหารเซ็น แนบไฟล์ที่เซ็นแล้ว และส่งให้ผู้คุมงบยืนยัน (ด้านล่าง)' : 'กด "ขอดำเนินการใช้งบ" ด้านล่างเพื่อเปิดใช้งบ')
          : 'รอ ' + owner + ' เปิดใช้งบ' + (isCapex ? ' (ทำ Memo ให้ผู้บริหารเซ็น แล้วส่งให้ผู้คุมงบตรวจ)' : ''),
        open_review: 'แนบ Memo ที่ผู้บริหารเซ็นแล้ว รอผู้คุมงบตรวจ Memo และยืนยันเปิดใช้งบ',
        open_returned: 'ผู้คุมงบส่ง Memo กลับให้แก้ไข: ' + (b.returnReason || ''),
        cancelled: 'งบนี้ถูกยกเลิกแล้ว'
      }[state];
      html += '<div class="card stepper-card">' + budgetStepper(b) + '<p class="' + (state === 'returned' || state === 'open_returned' ? 'neg' : 'muted') + '">' + esc(msg) + '</p></div>';
    }

    // ---- ข้อมูลหลักแบบตาราง
    const fact = (label, value, wide) => (value || value === 0
      ? '<div class="fact' + (wide ? ' wide' : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>' : '');
    const facts = '<section class="card"><div class="facts">' +
      fact('บริษัท', esc(b.company) + '<small>' + esc(companyMap()[b.company] || '') + '</small>') +
      fact('ปีงบประมาณ', esc(b.fiscalYear)) +
      fact('กลุ่มรายการ', esc(b.listGroup)) +
      fact('กลุ่ม Priority', esc(b.priorityGroup)) +
      fact('กลุ่ม Priority การลงทุน', esc(b.investGroup)) +
      fact('เจ้าของฝ่ายการเงิน (ติดตามร่วม)', esc(b.financeOwner)) +
      fact('เหตุผลสนับสนุน Priority', esc(b.priorityReason), true) +
      fact('หน่วยงาน', esc(b.department)) +
      fact('Business เจ้าของงบ', esc(ownerLabel(b))) +
      fact('โครงสร้างงบ', isProject ? 'งบรวมทั้งโครงการ' : (isCapex ? b.items.length + ' รายการย่อย' : ledgerItems(b).length + ' Item หลัก')) +
      fact(apprOf(b.type).short, b.meeting && b.meeting.no ? esc(b.meeting.no) + (b.meeting.date || b.meeting.by ? '<small>' + (b.meeting.date ? fmtDay(b.meeting.date) : '') + (b.meeting.by ? ' · ' + esc(b.meeting.by) : '') + '</small>' : '') : '') +
      fact('หมายเหตุ', esc(b.note), true) +
      '</div></section>';

    // ---- ตารางรายการ
    const reqBtn = (i) => (canRequest ? '<td><a class="btn small" href="#/request/new/' + b.id + '?item=' + i.id + '">ขอใช้</a></td>' : '');
    let items;
    if (isProject) {
      const it = b.items[0] || {};
      const cats = {};
      reqs.filter((r) => ['memo', 'pending', 'approved', 'closed'].includes(r.status)).forEach((r) => r.lines.forEach((l) => {
        const k = l.category || 'ไม่ระบุหมวด';
        cats[k] = round2((cats[k] || 0) + l.amount);
      }));
      items = '<h2>งบรวมทั้งโครงการ</h2><div class="table-wrap"><table><thead><tr><th>รายการ</th><th class="num">งบ</th>' +
        (active ? '<th class="num">ตัดงบแล้ว</th><th class="num">จองไว้</th><th class="num">คงเหลือ</th>' : '') + '</tr></thead><tbody>' +
        '<tr><td>' + esc(it.name || 'งบรวมทั้งโครงการ') + '' + '</td>' +
        '<td class="num">' + money(budgetTotal(b)) + '</td>' +
        (active ? '<td class="num">' + money(us.used) + '</td><td class="num">' + money(us.reserved) + '</td><td class="num"><strong>' + moneyCell(us.remaining) + '</strong></td>' : '') +
        '</tr></tbody></table></div>' +
        (active ? '<h2>สรุปการใช้งบตามรายการ</h2>' + (Object.keys(cats).length
          ? '<div class="table-wrap"><table><thead><tr><th>รายการ</th><th class="num">ยอดที่ขอใช้ (ไม่รวมที่ยกเลิก/ส่งกลับ)</th></tr></thead><tbody>' +
            Object.keys(cats).sort((x, y) => cats[y] - cats[x]).map((k) => '<tr><td>' + esc(k) + '</td><td class="num">' + money(cats[k]) + '</td></tr>').join('') + '</tbody></table></div>'
          : '<p class="muted">ยังไม่มีการเบิกใช้งบ</p>') : '');
    } else if (isCapex) {
      items = '<h2>รายการย่อย (Item No.)</h2><div class="table-wrap"><table><thead><tr>' +
        '<th>รหัสรายการย่อย</th><th>รายการ</th><th class="num">งบ</th>' + (active ? '<th class="num">ตัดงบแล้ว</th><th class="num">จองไว้</th><th class="num">คงเหลือ</th>' : '') +
        (canRequest ? '<th></th>' : '') + '</tr></thead><tbody>' +
        b.items.map((i) => {
          const iu = usage(b, i.id);
          const orig = first.find((x) => x.code === i.code);
          const origNote = !active ? '' : !orig ? '<div class="muted">เพิ่มภายหลัง</div>'
            : orig.total !== iu.approved ? '<div class="muted">เดิม ' + money(orig.total) + '</div>' : '';
          return '<tr><td class="nowrap">' + esc(i.code) + '</td><td>' + esc(i.name) +
            '</td>' +
            '<td class="num">' + money(itemTotal(i)) + origNote + '</td>' +
            (active ? '<td class="num">' + money(iu.used) + '</td><td class="num">' + money(iu.reserved) +
              '</td><td class="num nowrap"><strong>' + moneyCell(iu.remaining) + '</strong>' + (iu.remaining < 0 ? ' <span class="badge rejected">เกินงบรายการ</span>' : '') + '</td>' : '') +
            reqBtn(i) + '</tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      items = '<h2>Item ของงบ (Item หลัก / Item ย่อย)</h2>' +
        '<p class="muted small-note">Item หลักกำหนดตอนตั้งงบ (ไม่มีจำนวน/หน่วย) · Item ย่อย 2 ระดับ (1.1 และ 1.1.1) เพิ่มได้เรื่อย ๆ หลังงบเปิดใช้แล้ว วงเงินรวมไม่เกิน Item หลัก และจะกำหนดวงเงินหรือไม่ก็ได้' +
        (manageSub ? ' — <a href="#/budget/' + b.id + '/items">จัดการ Item ย่อย</a>' : '') + '</p>' +
        '<div class="table-wrap"><table><thead><tr>' +
        '<th>รหัส</th><th style="min-width:14rem">รายการ</th><th>GL</th><th class="num">งบ (รวม VAT)</th>' + (active ? '<th class="num">ตัดงบแล้ว</th><th class="num">จองไว้</th><th class="num">คงเหลือ</th>' : '') +
        (canRequest ? '<th></th>' : '') + '</tr></thead><tbody>' +
        sortedItems(b).map((i) => {
          const own = hasOwnBudget(b, i);
          const main = isMainItem(b, i);
          const iu = own ? usage(b, i.id) : usageOwn(b, i);
          const node = budgetNodeOf(b, i);
          const qty = (i.qty || i.unit) ? '<div class="muted">' + esc((i.qty ? Number(i.qty).toLocaleString('th-TH') : '') + ' ' + (i.unit || '')) + '</div>' : '';
          const alloc = childrenOf(b, i).length && own ? '<div class="muted">จัดสรรให้ Item ย่อย ' + money(allocatedOf(b, i)) + ' · ยังไม่จัดสรร ' + money(round2(itemTotal(i) - allocatedOf(b, i))) + '</div>' : '';
          return '<tr class="' + (main ? 'parent-row' : '') + '"><td class="nowrap">' + esc(i.code) + '</td>' +
            '<td style="padding-left:' + (0.75 + depth(i) * 1.1) + 'rem">' + esc(i.name) + qty + alloc + '</td>' +
            '<td>' + (i.glCode ? esc(i.glCode) + '<div class="muted">' + esc(i.glName) + '</div>' : itemGl(b, i).code ? '<span class="muted">ตาม ' + esc(itemGl(b, i).code) + '</span>' : isMainItem(b, i) ? '<span class="muted">รอบัญชี</span>' : '') + '</td>' +
            '<td class="num">' + (own ? money(itemTotal(i)) : '<span class="muted">ไม่กำหนดวงเงิน</span>') + '</td>' +
            (active ? '<td class="num">' + money(iu.used) + '</td><td class="num">' + money(iu.reserved) + '</td>' +
              '<td class="num nowrap">' + (own ? moneyCell(iu.remaining) + (iu.remaining < 0 ? ' <span class="badge rejected">เกินงบ</span>' : '') : '<span class="muted">ใช้วงเงิน Item ' + esc(node.code) + '</span>') + '</td>' : '') +
            (canRequest ? reqBtn(i) : '') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    // ---- GL Code ที่ยังรอฝ่ายบัญชี (OPEX)
    if (missingGl(b).length) {
      items = '<div class="alert ' + (canEditGl(b) ? 'warn' : 'info') + '">ยังไม่มี GL Code ' + missingGl(b).length + ' Item หลัก (' + missingGl(b).map((x) => esc(x.code)).join(', ') + ') — ฝ่ายบัญชีใส่ทีหลังได้' +
        (canEditGl(b) ? ' · <a href="#/budget/' + b.id + '/gl">ใส่ GL Code</a>' : '') + '</div>' + items;
    }

    // ---- Plan Cashflow (CAPEX ที่เปิดใช้แล้ว)
    if (isCapex && active) {
      items += '<h2>Plan Cashflow (ประมาณการใช้เงินรายเดือน)</h2>' + (hasCashflow(b)
        ? (cashflowDue(b) && canPlanCashflow(b) ? '<div class="alert warn">เดือน ' + esc(monthLabel(curYm())) + ' ยังไม่มีแผน Cashflow — <a href="#/budget/' + b.id + '/cashflow">วางแผน</a> หรือกด "เดือนนี้ไม่มีแผน" ที่งานทั้งหมด</div>' : '') +
          '<section class="card">' + cashflowSummary(b) + '</section>'
        : '<div class="alert ' + (canPlanCashflow(b) && actsFor(b) ? 'warn' : 'info') + '">ยังไม่ได้วาง Plan Cashflow' +
          (canPlanCashflow(b) ? ' — <a href="#/budget/' + b.id + '/cashflow">วางแผนว่าแต่ละ Item จะใช้เงินเดือนไหนเท่าไร</a>' : '') + '</div>');
    }

    // ---- หลักฐานการอนุมัติ (CAPEX: มติที่ประชุม · CBS: เอกสารอนุมัติผู้บริหาร)
    const ap = apprOf(b.type);
    let evidence = '<h2>' + ap.title + ' / หลักฐานการอนุมัติ</h2><section class="card evidence-card">';
    if (editable && b.incomplete) {
      evidence += '<div class="alert warn">ร่างนี้ยังกรอกไม่ครบ — <a href="#/budget/' + b.id + '/edit">แก้ไขร่าง</a> ให้ครบแล้วกด "บันทึกและสร้างงบ" ก่อน จึงจะแนบหลักฐานและส่งอนุมัติได้</div>';
    } else if (editable) {
      evidence += '<form id="submitBudget" data-id="' + b.id + '"><div class="form-grid">' +
        '<label class="field"><span>' + ap.date + '</span><input name="meetingDate" type="date" value="' + esc((b.meeting && b.meeting.date) || '') + '"></label>' +
        '<label class="field"><span>' + ap.no + '</span><input name="meetingNo" placeholder="' + ap.noEx + '" value="' + esc((b.meeting && b.meeting.no) || '') + '"></label>' +
        (ap.exec ? '<label class="field full"><span>' + ap.by + '</span><input name="meetingBy" placeholder="' + ap.byEx + '" value="' + esc((b.meeting && b.meeting.by) || '') + '"></label>' : '') +
        '<label class="field full"><span>' + ap.note + '</span><input name="meetingNote" placeholder="เช่น อนุมัติเต็มจำนวน / อนุมัติบางส่วน" value="' + esc((b.meeting && b.meeting.note) || '') + '"></label></div>' +
        '<div class="field"><span>' + ap.file + ' (PDF หรือรูปภาพ)</span>' + attachList(b.attachments, { del: true, empty: ap.empty }) +
        '<label class="btn small file-btn">+ แนบไฟล์<input type="file" id="budgetFiles" accept="application/pdf,image/png,image/jpeg" multiple hidden></label></div>' +
        '<div class="actions"><button class="btn primary" type="submit">ส่งให้ผู้คุมงบตรวจสอบ</button><button class="btn" type="button" id="saveMeeting">บันทึกข้อมูล' + (ap.exec ? 'การอนุมัติ' : 'มติ') + 'ไว้ก่อน</button></div></form>';
    } else {
      evidence += (b.meeting && b.meeting.no
        ? '<p>' + esc(b.meeting.no) + apprMetaText(ap, b.meeting) + (b.meeting.note ? ' · ' + esc(b.meeting.note) : '') + '</p>'
        : '<p class="muted">' + ap.none + '</p>') + attachList(b.attachments, { empty: ap.empty });
    }
    evidence += '</section>';
    // ขั้น "เปิดใช้": งบที่ผู้คุมงบสร้าง แสดงเฉพาะส่วนเปิดใช้ · งบที่ Business สร้าง แสดงหลักฐานการอนุมัติควบคู่ด้วย
    if (b.setup) evidence = openSection(b, own);
    else if (b.opening && !active) evidence = evidence + openSection(b, own);

    const chgList = chgs.length
      ? '<h2>คำขอเพิ่มงบ <span class="muted count-note">(' + chgs.length + ')</span></h2><div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>เหตุผล</th><th class="num">ขอเพิ่ม</th><th>สถานะ</th></tr></thead><tbody>' +
        chgs.map((c) => '<tr><td class="nowrap"><a href="#/change/' + c.id + '">' + esc(c.no) + '</a><div class="muted">' + fmtDay(c.createdAt) + '</div></td><td>' + esc(c.reason) + '</td>' +
          '<td class="num">' + money(changeTotal(c)) + '</td><td>' + badge(CHANGE_STATE_BADGE[c.state], CHANGE_STATE[c.state]) + '</td></tr>').join('') + '</tbody></table></div>'
      : '';
    const main = (active ? '' : evidence) + facts + items + (active ? evidence : '') + chgList +
      (active ? '<h2>ประวัติการเบิกใช้งบ <span class="muted count-note">(' + reqs.length + ')</span></h2>' + requestTable(reqs, false) : '');

    // ---- คอลัมน์ขวา
    let side = '';
    if (active) {
      side += '<div class="card total-card"><span class="muted">งบคงเหลือ</span>' +
        '<div class="total-amount' + (us.remaining < 0 ? ' neg' : '') + '">' + money(us.remaining) + ' <small>บาท</small></div>' +
        '<div style="margin:.75rem 0 .9rem">' + usageBar(us) + '</div>' +
        '<dl class="kv compact"><dt>งบที่ได้รับอนุมัติ</dt><dd>' + money(us.approved) + '</dd>' +
        '<dt>ตัดงบแล้ว</dt><dd>' + money(us.used) + '</dd>' +
        '<dt>จองไว้ (ยังไม่ตัดงบ)</dt><dd>' + money(us.reserved) + '</dd></dl></div>';
      const count = (st) => reqs.filter((r) => r.status === st).length;
      const stat = (label, n, cls) => '<div class="stat' + (cls ? ' ' + cls : '') + '"><strong>' + n + '</strong><span>' + label + '</span></div>';
      side += '<div class="card"><h3 class="side-title">ภาพรวมการเบิกใช้งบ</h3><div class="stats">' +
        stat('รอผู้คุมงบตรวจสอบ', count('pending'), count('pending') ? 'warn' : '') +
        stat('ออกเอกสารแล้ว (ยังไม่ปิดยอด)', count('approved')) +
        stat('ปิดยอดแล้ว', count('closed')) +
        stat('ส่งกลับ / ยกเลิก', count('rejected') + count('cancelled')) + '</div></div>';
    } else {
      side += '<div class="card total-card"><span class="muted">' + (b.setup ? 'วงเงินงบ' : 'วงเงินที่ขออนุมัติ') + '</span>' +
        '<div class="total-amount">' + money(budgetTotal(b)) + ' <small>บาท</small></div>' +
        '<p class="muted small-note" style="margin:var(--s-2) 0 0">สถานะ: ' + esc(BUDGET_STATE[state]) + '</p></div>';
    }
    if (state === 'review' && can('budget.verify')) {
      side += '<div class="card decision"><h3 class="side-title">' + ap.verify + ' (อนุมัติงบ)</h3>' +
        '<p class="muted small-note" style="margin:0 0 var(--s-3)">ตรวจว่า' + (ap.exec ? 'เอกสารอนุมัติของผู้บริหาร' : 'มติ') + 'ตรงกับวงเงินและรายการในคำขอ ผู้คุมงบแก้ตัวงบไม่ได้ ถ้าไม่ตรงให้ส่งกลับ</p>' +
        '<form id="verifyBudget" data-id="' + b.id + '"><label class="field"><span>หมายเหตุ (จำเป็นเมื่อส่งกลับ)</span><textarea name="comment" rows="3"></textarea></label>' +
        '<div class="actions"><button class="btn primary" type="submit" data-verify="active">' + (b.type === 'CBS' ? 'ตรวจผ่านและเปิดใช้งบ' : 'ตรวจผ่าน (อนุมัติ)') + '</button>' +
        '<button class="btn bad" type="submit" data-verify="returned">ส่งกลับให้แก้ไข</button></div></form></div>';
    }
    if (state === 'open_review' && can('budget.verify')) {
      side += '<div class="card decision"><h3 class="side-title">ตรวจ Memo ขอดำเนินการใช้งบ</h3>' +
        '<p class="muted small-note" style="margin:0 0 var(--s-3)">ตรวจว่า Memo ที่แนบมีผู้บริหารลงนามครบ และวงเงิน / รายการตรงกับงบ ถ้าไม่ครบให้ส่งกลับให้ Business แก้ไข</p>' +
        '<form id="verifyBudget" data-id="' + b.id + '"><label class="field"><span>หมายเหตุ (จำเป็นเมื่อส่งกลับ)</span><textarea name="comment" rows="3"></textarea></label>' +
        '<div class="actions"><button class="btn primary" type="submit" data-verify="active">ยืนยัน Memo และเปิดใช้งบ</button>' +
        '<button class="btn bad" type="submit" data-verify="returned">ส่งกลับให้แก้ไข</button></div></form></div>';
    }
    if (active && b.revisions.length) {
      side += '<div class="card"><h3 class="side-title">ประวัติการปรับงบ' + (isCapex ? '' : ' (Revise OPEX)') + '</h3><ol class="timeline">' +
        b.revisions.slice().reverse().map((rv, idx, arr) => {
          const prevRv = arr[idx + 1];
          const diff = prevRv ? round2(rv.total - prevRv.total) : 0;
          return tlItem(rv.no === 0 ? 'done' : 'approved',
            (rv.no === 0 ? 'เปิดใช้งบ' : 'ปรับครั้งที่ ' + rv.no) + ' · ' + money(rv.total) +
              (diff ? ' <span class="' + (diff > 0 ? 'pos' : 'neg') + '">(' + (diff > 0 ? '+' : '') + money(diff) + ')</span>' : ''),
            esc(userName(rv.by)) + ' · ' + fmtDate(rv.at), rv.note);
        }).join('') + '</ol></div>';
    }
    side += historyCard(b.history);

    return html + '<div class="detail-layout"><div class="detail-main">' + main + '</div><aside class="detail-side">' + side + '</aside></div>';
  }

  function bindBudgetDetail() {
    bindOpenSection();
    const sub = document.getElementById('submitBudget');
    const cancel = document.getElementById('cancelBudget');
    const verify = document.getElementById('verifyBudget');
    if (cancel) {
      cancel.addEventListener('click', () => {
        const b = budgetById(location.hash.split('/')[2]);
        const what = 'งบ';
        if (!b || !confirm('ยกเลิก' + what + ' ' + b.code + ' ?')) return;
        b.state = 'cancelled';
        addHistory(b, 'ยกเลิก' + what, '', 'งบ ' + b.code);
        save();
        setFlash('info', 'ยกเลิก' + what + ' ' + b.code + ' แล้ว');
        go('#/budget/' + b.id);
      });
    }
    if (sub) {
      const b = budgetById(sub.dataset.id);
      const keepMeeting = () => {
        b.meeting = { date: sub.elements.meetingDate.value, no: sub.elements.meetingNo.value.trim(), note: sub.elements.meetingNote.value.trim(),
          by: sub.elements.meetingBy ? sub.elements.meetingBy.value.trim() : '' };
      };
      sub.querySelector('#budgetFiles').addEventListener('change', async (e) => {
        const files = await readFiles(e.target, 'resolution');
        if (!files.length) return;
        keepMeeting();
        b.attachments = (b.attachments || []).concat(files);
        addHistory(b, apprOf(b.type).exec ? 'แนบไฟล์เอกสารอนุมัติ' : 'แนบไฟล์มติ', files.map((f) => f.name).join(', '), 'งบ ' + b.code);
        if (!save()) return;
        go('#/budget/' + b.id);
      });
      sub.addEventListener('click', (e) => {
        const del = e.target.closest('[data-att-del]');
        if (!del) return;
        const f = b.attachments.find((x) => x.id === del.dataset.attDel);
        if (!f || !confirm('ลบไฟล์ ' + f.name + ' ?')) return;
        keepMeeting();
        b.attachments = b.attachments.filter((x) => x !== f);
        addHistory(b, apprOf(b.type).exec ? 'ลบไฟล์เอกสารอนุมัติ' : 'ลบไฟล์มติ', f.name, 'งบ ' + b.code);
        save();
        go('#/budget/' + b.id);
      });
      sub.querySelector('#saveMeeting').addEventListener('click', () => {
        keepMeeting();
        addHistory(b, apprOf(b.type).exec ? 'บันทึกข้อมูลการอนุมัติ' : 'บันทึกข้อมูลมติ', b.meeting.no, 'งบ ' + b.code);
        save();
        setFlash('success', 'บันทึกข้อมูล' + (apprOf(b.type).exec ? 'การอนุมัติ' : 'มติ') + 'ไว้แล้ว (ยังไม่ได้ส่งตรวจ)');
        go('#/budget/' + b.id);
      });
      sub.addEventListener('submit', (e) => {
        e.preventDefault();
        keepMeeting();
        const errors = [];
        const ap = apprOf(b.type);
        if (!b.meeting.no) errors.push('กรุณาระบุ' + ap.no);
        if (ap.exec && !b.meeting.by) errors.push('กรุณาระบุ' + ap.by);
        if (!b.attachments.length) errors.push('กรุณาแนบ' + ap.file);
        if (errors.length) { alert(errors.join('\n')); return; }
        b.state = 'review';
        b.submittedAt = new Date().toISOString();
        addHistory(b, ap.exec ? 'แนบเอกสารอนุมัติผู้บริหารและส่งให้ผู้คุมงบตรวจสอบ' : 'แนบมติที่ประชุมและส่งให้ผู้คุมงบตรวจสอบ', b.meeting.no, 'งบ ' + b.code);
        save();
        setFlash('success', 'ส่งงบ ' + b.code + ' ให้ผู้คุมงบตรวจสอบแล้ว');
        go('#/budget/' + b.id);
      });
    }
    if (verify) {
      let decision = 'active';
      verify.querySelectorAll('[data-verify]').forEach((btn) => btn.addEventListener('click', () => { decision = btn.dataset.verify; }));
      verify.addEventListener('submit', (e) => {
        e.preventDefault();
        const b = budgetById(verify.dataset.id);
        const comment = verify.elements.comment.value.trim();
        if (decision === 'returned' && !comment) { alert('กรุณาระบุเหตุผลที่ส่งกลับ'); return; }
        const at = new Date().toISOString();
        if (b.state === 'open_review') {
          const lead = groupLead(b);
          const members = groupMembers(lead);
          const memoNo = lead.openMemo.no;
          const codes = members.map((x) => x.code).join(', ');
          if (decision === 'active') {
            members.forEach((m) => {
              activateBudget(m, me().id, 'ขอดำเนินการใช้งบตาม Memo ' + memoNo + (comment ? ' — ' + comment : ''));
              addHistory(m, 'ผู้คุมงบยืนยัน Memo และเปิดใช้งบ', comment, memoNo);
            });
            setFlash('success', 'ยืนยัน Memo และเปิดใช้งบ ' + codes + ' แล้ว — Business ขอเบิกใช้งบได้');
          } else {
            members.forEach((m) => {
              Object.assign(m, { state: 'open_returned', returnReason: comment });
              addHistory(m, 'ส่ง Memo ขอดำเนินการใช้งบกลับให้แก้ไข', comment, memoNo);
            });
            setFlash('info', 'ส่ง Memo ขอดำเนินการใช้งบ ' + codes + ' กลับให้ Business แก้ไขแล้ว');
          }
          save();
          go('#/budget/' + b.id);
          return;
        }
        if (decision === 'active' && b.type === 'CBS') {
          // OPEX ที่ Business สร้าง: ผู้คุมงบตรวจเอกสารอนุมัติ (ไม่มี Memo) แล้วยืนยันเปิดใช้งบเลย — ขั้นเดียว
          Object.assign(b, { approvedAt: at, approvedBy: me().id });
          activateBudget(b, me().id, 'ผู้คุมงบตรวจเอกสารอนุมัติและยืนยันเปิดใช้งบ' + (comment ? ' — ' + comment : ''));
          addHistory(b, 'ผู้คุมงบตรวจเอกสารอนุมัติและยืนยันเปิดใช้งบ', comment, 'งบ ' + b.code);
          setFlash('success', 'ตรวจผ่านและเปิดใช้งบ ' + b.code + ' แล้ว — ' + userName(b.ownerId) + ' ขอเบิกใช้งบได้');
        } else if (decision === 'active') {
          // ตรวจผ่าน = อนุมัติ → เข้าขั้น "เปิดใช้" (CAPEX: Business ทำ Memo ให้ผู้บริหารเซ็น ส่งให้ผู้คุมงบยืนยัน)
          Object.assign(b, { state: 'pending_open', opening: true, approvedAt: at, approvedBy: me().id, returnReason: '' });
          addHistory(b, 'ผู้คุมงบตรวจผ่าน (อนุมัติ) — รอ Business เปิดใช้งบ', comment, 'งบ ' + b.code);
          setFlash('success', 'ตรวจผ่านงบ ' + b.code + ' แล้ว — รอ ' + userName(b.ownerId) + ' เปิดใช้งบ' + (b.type === 'CAPEX' ? ' (ทำ Memo ให้ผู้บริหารเซ็น)' : ''));
        } else {
          Object.assign(b, { state: 'returned', returnReason: comment });
          addHistory(b, 'ส่งกลับให้แก้ไข', comment, 'งบ ' + b.code);
          setFlash('info', 'ส่งงบ ' + b.code + ' กลับให้ Business แก้ไขแล้ว');
        }
        save();
        go('#/budget/' + b.id);
      });
    }
  }

  // ---------------------------------------------------------------- ขอดำเนินการใช้งบครั้งแรก (งบที่ผู้คุมงบลงไว้)

  /** เปิดใช้งบ: บันทึกวงเงินตั้งต้น (ครั้งที่ 0) ไว้เทียบเมื่อปรับงบภายหลัง */
  function activateBudget(b, by, note) {
    const at = new Date().toISOString();
    Object.assign(b, { state: 'active', activatedAt: at, activatedBy: by, returnReason: '' });
    b.revisions = [{ no: 0, at, by, note, total: budgetTotal(b), items: snapshotItems(b) }];
  }
  /** Business เจ้าของงบทำ Memo / กดขอดำเนินการใช้งบได้ */
  /** เปิดใช้งบครั้งแรก: Business เจ้าของงบเท่านั้น — ธุรการ (business.proxy) ทำแทนไม่ได้ */
  /**
   * งบที่ผู้คุมงบลงเป็น "งบรวมทั้งโครงการ" ต้องลงรายละเอียด Item ให้ครบ (ผลรวม = วงเงินรวม) ก่อน Business ทำ Memo / ขอเปิดใช้งบ
   * Business เจ้าของงบหรือธุรการลงรายละเอียดได้ที่ #/budget/:id/breakdown
   */
  const needsItems = (b) => b.structure === 'project' && openFlow(b) && waitingOpen(b);
  const canBreakdown = (b) => needsItems(b) && actsFor(b) && can('request.create');
  /** Memo รวมหลายงบ (CAPEX): งบหลัก (lead) เก็บ Memo ทั้งใบใน openMemo (มี group = รายการ id) · งบที่รวมเก็บ openGroup { lead, no } */
  const groupLead = (b) => (b.openGroup && budgetById(b.openGroup.lead)) || b;
  const groupMembers = (lead) => ((lead.openMemo && lead.openMemo.group) || [lead.id]).map(budgetById).filter(Boolean);
  const canOpenBudget = (b) => openFlow(b) && waitingOpen(b) && b.ownerId === me().id && can('request.create') && !isProxy() && !needsItems(b) && groupLead(b) === b;
  const canEditOpenMemo = (b) => b.type === 'CAPEX' && canOpenBudget(b);

  /** ส่วน "ขอดำเนินการใช้งบครั้งแรก" ในหน้างบ */
  function openSection(b, own) {
    const capex = b.type === 'CAPEX';
    const m = b.openMemo;
    let h = '<h2>ขอดำเนินการใช้งบครั้งแรก</h2><section class="card evidence-card open-card">';
    if (needsItems(b)) {
      h += '<div class="alert warn">งบนี้ผู้คุมงบลงเป็น "งบรวมทั้งโครงการ" — ต้องลงรายละเอียด Item ให้ครบ (ผลรวมเท่ากับวงเงิน ' + money(budgetTotal(b)) + ' บาท) ก่อน' +
        (capex ? 'ทำ Memo ขอดำเนินการใช้งบ' : 'ขอดำเนินการใช้งบ') + '</div>' +
        (canBreakdown(b) ? '<div class="actions"><a class="btn primary" href="#/budget/' + b.id + '/breakdown">ลงรายละเอียด Item</a></div>'
          : '<p class="muted">รอ ' + esc(ownerLabel(b)) + ' (หรือธุรการ) ลงรายละเอียด Item</p>');
      return h + '</section>';
    }
    const lead = groupLead(b);
    if (lead !== b) {
      return h + '<p>งบนี้รวมอยู่ใน Memo เลขที่ ' + esc((lead.openMemo || {}).no || (b.openGroup || {}).no) + ' ร่วมกับงบ <a href="#/budget/' + lead.id + '">' + esc(lead.code) +
        '</a> — ทำ Memo แนบไฟล์ และส่งให้ผู้คุมงบที่งบหลักนั้น (สถานะ: ' + esc(BUDGET_STATE[b.state]) + ')</p></section>';
    }
    const members = capex ? groupMembers(b) : [b];
    if (members.length > 1) {
      h += '<div class="alert info">Memo เลขที่ ' + esc(b.openMemo.no) + ' รวม ' + members.length + ' งบ: ' + members.map((x) => '<a href="#/budget/' + x.id + '">' + esc(x.code) + '</a> (' + money(budgetTotal(x)) + ')').join(' · ') +
        ' · รวมวงเงิน ' + money(members.reduce((n, x) => n + budgetTotal(x), 0)) + ' บาท' +
        (canOpenBudget(b) ? ' <button type="button" class="btn small" id="ungroupMemo" data-id="' + b.id + '">ยกเลิกการรวม Memo</button>' : '') + '</div>';
    }
    if (!capex) {
      if (b.state === 'active') h += '<p>เปิดใช้งบแล้วโดย ' + esc(userName(b.activatedBy)) + ' · ' + fmtDate(b.activatedAt) + '</p>';
      else if (canOpenBudget(b)) {
        h += '<p class="muted small-note">ตรวจรายการและวงเงินด้านล่าง ถ้าถูกต้องกด "ขอดำเนินการใช้งบ" เพื่อเริ่มขอเบิกใช้งบ (OPEX ไม่ต้องทำ Memo) · ถ้าวงเงิน / Item ไม่ถูกต้อง แจ้งผู้คุมงบให้แก้ก่อน</p>' +
          '<div class="actions"><button type="button" class="btn primary" id="openBudget" data-id="' + b.id + '">ขอดำเนินการใช้งบ</button></div>';
      } else h += '<p class="muted">รอ ' + esc(ownerLabel(b)) + ' กดขอดำเนินการใช้งบ</p>';
      return h + '</section>';
    }
    // CAPEX: Memo ขอดำเนินการใช้งบ
    if (canOpenBudget(b)) {
      const files = (m && m.files) || [];
      h += '<ol class="open-steps">' +
        '<li class="' + (m ? 'done' : 'current') + '"><strong>1. กรอก Memo ขอดำเนินการใช้งบ</strong><span>' + (m ? 'เลขที่ ' + esc(m.no) + ' · ' : '') +
          '<a href="#/budget/' + b.id + '/memo">' + (m ? 'แก้ไข Memo' : 'ทำ Memo') + '</a>' + (m ? ' · <a href="#/budget/' + b.id + '/memo?view=1">ฉบับพิมพ์</a>' : '') + '</span></li>' +
        '<li class="' + (m && !files.length ? 'current' : m ? 'done' : '') + '"><strong>2. พิมพ์ให้ผู้บริหารเซ็น แล้วแนบไฟล์ที่เซ็นแล้ว</strong>' +
          (m ? '<div id="openMemoFiles" data-id="' + b.id + '">' + attachList(files, { del: true, empty: 'ยังไม่ได้แนบ Memo ที่เซ็นแล้ว' }) +
            '<label class="btn small file-btn">+ แนบ Memo ที่เซ็นแล้ว<input type="file" id="openMemoFile" accept="application/pdf,image/png,image/jpeg" multiple hidden></label></div>' : '') + '</li>' +
        '<li class="' + (m && files.length ? 'current' : '') + '"><strong>3. ส่งให้ผู้คุมงบตรวจ Memo และยืนยันขอดำเนินการใช้งบ</strong>' +
          (m ? '<div class="actions"><button type="button" class="btn primary" id="submitOpenMemo" data-id="' + b.id + '"' + (files.length ? '' : ' disabled') + '>ส่ง Memo ให้ผู้คุมงบ</button>' +
            (files.length ? '' : '<span class="guard-hint">ต้องแนบ Memo ที่ผู้บริหารเซ็นแล้วก่อน</span>') + '</div>' : '') + '</li></ol>';
    } else if (m) {
      h += '<p>Memo เลขที่ ' + esc(m.no) + (m.signers ? ' · ผู้บริหารที่ลงนาม: ' + esc(m.signers) : '') +
        (m.submittedAt ? ' · ส่งเมื่อ ' + fmtDate(m.submittedAt) : '') + ' · <a href="#/budget/' + b.id + '/memo?view=1">เปิด Memo</a></p>' +
        attachList(m.files, { empty: 'ยังไม่ได้แนบ Memo ที่เซ็นแล้ว' }) +
        (b.state === 'active' ? '<p class="muted small-note">เปิดใช้งบแล้วโดย ' + esc(userName(b.activatedBy)) + ' · ' + fmtDate(b.activatedAt) + '</p>' : '');
    } else {
      h += '<p class="muted">รอ ' + esc(ownerLabel(b)) + ' ทำ Memo ขอดำเนินการใช้งบ ให้ผู้บริหารเซ็น แล้วส่งให้ผู้คุมงบตรวจ</p>';
    }
    return h + '</section>';
  }

  function bindOpenSection() {
    const openBtn = document.getElementById('openBudget');
    if (openBtn) openBtn.addEventListener('click', () => {
      const b = budgetById(openBtn.dataset.id);
      if (!canOpenBudget(b) || !confirm('ขอดำเนินการใช้งบ ' + b.code + ' วงเงิน ' + money(budgetTotal(b)) + ' บาท ?')) return;
      activateBudget(b, me().id, 'Business ขอดำเนินการใช้งบ');
      addHistory(b, 'Business ขอดำเนินการใช้งบ', '', 'งบ ' + b.code);
      save();
      setFlash('success', 'ขอดำเนินการใช้งบ ' + b.code + ' แล้ว — ขอเบิกใช้งบได้');
      go('#/budget/' + b.id);
    });
    const box = document.getElementById('openMemoFiles');
    if (box) {
      const b = budgetById(box.dataset.id);
      box.querySelector('#openMemoFile').addEventListener('change', async (e) => {
        const files = await readFiles(e.target, 'openMemo');
        if (!files.length) return;
        b.openMemo.files = (b.openMemo.files || []).concat(files);
        addHistory(b, 'แนบ Memo ขอดำเนินการใช้งบที่เซ็นแล้ว', files.map((f) => f.name).join(', '), b.openMemo.no);
        if (!save()) return;
        render();
      });
      box.addEventListener('click', (e) => {
        const del = e.target.closest('[data-att-del]');
        if (!del) return;
        const f = b.openMemo.files.find((x) => x.id === del.dataset.attDel);
        if (!f || !confirm('ลบไฟล์ ' + f.name + ' ?')) return;
        b.openMemo.files = b.openMemo.files.filter((x) => x !== f);
        addHistory(b, 'ลบไฟล์ Memo ขอดำเนินการใช้งบ', f.name, b.openMemo.no);
        save();
        render();
      });
    }
    const ungroup = document.getElementById('ungroupMemo');
    if (ungroup) ungroup.addEventListener('click', () => {
      const lead = budgetById(ungroup.dataset.id);
      if (!canOpenBudget(lead) || !confirm('ยกเลิกการรวม Memo ' + lead.openMemo.no + ' ? (งบที่รวมไว้จะกลับไปรอทำ Memo แยก และ Memo ใบนี้จะถูกลบ)')) return;
      groupMembers(lead).forEach((m) => { delete m.openGroup; addHistory(m, 'ยกเลิกการรวม Memo ขอดำเนินการใช้งบ', '', lead.openMemo.no); });
      delete lead.openMemo;
      save();
      setFlash('info', 'ยกเลิกการรวม Memo แล้ว');
      go('#/budget/' + lead.id);
    });
    const send = document.getElementById('submitOpenMemo');
    if (send) send.addEventListener('click', () => {
      const b = budgetById(send.dataset.id);
      if (!canOpenBudget(b) || !(b.openMemo.files || []).length) return;
      const members = groupMembers(b);
      b.openMemo.signers = openMemoDocOf(b).approvers.join(' / ');
      b.openMemo.submittedAt = new Date().toISOString();
      members.forEach((m) => {
        m.state = 'open_review';
        m.submittedAt = b.openMemo.submittedAt;
        addHistory(m, 'ส่ง Memo ขอดำเนินการใช้งบให้ผู้คุมงบตรวจ' + (members.length > 1 ? ' (Memo รวม ' + members.length + ' งบ)' : ''), b.openMemo.signers, b.openMemo.no);
      });
      save();
      setFlash('success', 'ส่ง Memo ' + b.openMemo.no + (members.length > 1 ? ' (รวม ' + members.length + ' งบ)' : '') + ' ให้ผู้คุมงบตรวจแล้ว — รอยืนยันขอดำเนินการใช้งบ');
      go('#/budget/' + b.id);
    });
  }

  /** ค่าเริ่มต้นของ Memo ขอดำเนินการใช้งบ (CAPEX) */
  function openMemoModel(b) {
    const cname = (c) => companyMap()[c] || c;
    const mp = defaultMemoParties(b, b.company);
    const m = b.meeting || {};
    const members = groupMembers(groupLead(b));
    const multi = members.length > 1;
    const total = round2(members.reduce((n, x) => n + budgetTotal(x), 0));
    const amt = (v) => money(v) + ' บาท (' + bahtText(v) + ')';
    const items = multi
      ? members.reduce((arr, x) => arr.concat((x.structure === 'project' ? [] : leaves(x)).map((it) => Object.assign({}, it, { code: x.code + ' / ' + it.code }))), [])
      : (b.structure === 'project' ? [] : leaves(b));
    const defaults = {
      to: (mp.to.length ? mp.to : ['ผู้บริหาร']).concat([cname(b.company)]).join('\n'),
      date: fmtDay(new Date().toISOString()),
      cc: mp.cc.join(' , '),
      subject: 'ขออนุมัติดำเนินการใช้งบประมาณ ' + (multi ? members.map((x) => x.code).join(', ') : b.code + ' ' + b.name),
      ref: m.no ? m.no + (m.date ? ' วันที่ ' + fmtDay(m.date) : '') : 'งบประมาณลงทุน (CAPEX) ประจำปี ' + b.fiscalYear,
      background: 'ตามที่' + cname(b.company) + ' ได้รับการจัดสรรงบประมาณลงทุน (CAPEX) ประจำปี ' + b.fiscalYear + ' ' + (multi ? members.length + ' โครงการ ได้แก่ ' + members.map((x) => x.code + ' ' + x.name).join(' , ')
          : 'โครงการ ' + b.code + ' ' + b.name + ' ' + (b.department ? 'ของ' + b.department + ' ' : '')) + ' กรอบวงเงินรวมทั้งสิ้น ' + amt(total) + (!multi && b.note ? '\n\n' + b.note : ''),
      consider: 'เพื่อให้สามารถดำเนินโครงการตามแผนได้ จึงขออนุมัติดำเนินการใช้งบประมาณโครงการ ' + (multi ? members.map((x) => x.code).join(', ') : b.code) + ' ทั้งโครงการ ตามรายการดังนี้',
      signerName: ownerText(b),
      signerTitle: mp.proposer || '',
      reviewers: mp.reviewers.slice(),
      approvers: mp.approvers.slice()
    };
    return { b, r: { memoDoc: (b.openMemo || {}).doc }, total, items, amt, defaults };
  }
  const openMemoDocOf = (b) => memoDocOf(openMemoModel(b));

  /** Memo ขอดำเนินการใช้งบ — โครงเดียวกับ Memo ขอเบิกใช้งบ (หัวกระดาษ / ตารางหัว / ตารางผู้ลงนาม) */
  function openMemoHtml(b, edit) {
    const M = openMemoModel(b);
    const d = memoDocOf(M);
    const text = (v) => esc(v || '').replace(/\n/g, '<br>');
    const paras = (v) => String(v || '').split(/\n\s*\n/).map((p) => '<p>' + text(p.trim()) + '</p>').join('');
    const inp = (k, ph, cls) => (edit ? '<input class="mf' + (cls ? ' ' + cls : '') + '" name="md_' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || k) + '">' : text(d[k]));
    const area = (k, rows, ph) => '<textarea class="mf" name="md_' + k + '" rows="' + rows + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || k) + '">' + esc(d[k]) + '</textarea>';
    const signRows = (k) => (d[k].length ? d[k] : ['']).map((x) => '<tr>' + (edit
      ? '<td><div class="mf-row"><input class="mf" name="md_' + k + '" value="' + esc(x) + '" placeholder="ชื่อ / ตำแหน่ง" aria-label="ชื่อ / ตำแหน่ง">' +
        '<button type="button" class="btn small bad no-print" data-mf-del title="ลบแถว">×</button></div></td>'
      : '<td>' + esc(x) + '</td>') + '<td>☐ อนุมัติ &nbsp; ☐ ไม่อนุมัติ</td><td></td><td></td></tr>').join('');
    const signTable = (k, title) => '<h2 class="memo-h">' + title + '</h2>' +
      '<table class="memo-sign"><thead><tr><th>ชื่อ / ตำแหน่ง</th><th style="width:9rem">ผลการพิจารณา</th><th style="width:11rem">ลงนามอนุมัติ</th><th style="width:6rem">วันที่</th></tr></thead>' +
      '<tbody data-mf-list="' + k + '">' + signRows(k) + '</tbody></table>' +
      (edit ? '<button type="button" class="btn small no-print mf-add" data-mf-add="' + k + '">+ เพิ่มผู้ลงนาม</button>' : '');
    const rows = M.items.length ? M.items : [{ code: b.code, name: 'งบรวมทั้งโครงการ', amount: M.total }];
    return '<article class="doc memo-doc' + (edit ? ' memo-edit' : '') + '">' +
      memoLetterhead(b.company) +
      '<table class="memo-head"><tbody>' +
      '<tr><td><div class="mh-row"><span class="lbl">เรียน</span><div class="mh-val">' + (edit ? area('to', 2, 'ชื่อ (ตำแหน่ง) และบริษัท — บรรทัดละรายการ') : String(d.to || '').split('\n').map(esc).join('<br>')) + '</div></div></td>' +
      '<td class="memo-date"><div class="mh-row"><span class="lbl lbl-s">วันที่</span><div class="mh-val">' + inp('date', 'วันที่', 'mf-date') + '</div></div>' +
        '<div class="mh-row"><span class="lbl lbl-s">เลขที่</span><div class="mh-val">' + esc((b.openMemo || {}).no || '........') + '</div></div>' +
        '<div class="mh-row mh-sub"><span class="lbl lbl-s">งบ</span><div class="mh-val">' + esc(groupMembers(groupLead(b)).map((x) => x.code).join(', ')) + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">เรื่อง</span><div class="mh-val">' + inp('subject', 'เรื่อง') + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">สำเนาถึง</span><div class="mh-val">' + inp('cc', 'ผู้รับสำเนา (คั่นด้วย ,)') + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">อ้างอิง</span><div class="mh-val">' + (edit ? area('ref', 1, 'มติ / เอกสารอนุมัติงบประจำปี') : text(d.ref)) + '</div></div></td></tr>' +
      '</tbody></table>' +
      '<h2 class="memo-h">1. เรื่องสืบเนื่อง</h2>' +
      (edit ? area('background', 6, 'ที่มาของงบและกรอบวงเงินที่ได้รับจัดสรร') : '<div class="memo-text">' + paras(d.background) + '</div>') +
      '<h2 class="memo-h">2. เรื่องเพื่อพิจารณาลงนาม</h2>' +
      (edit ? area('consider', 3, 'ความประสงค์ในการขอดำเนินการใช้งบ') : '<div class="memo-text">' + paras(d.consider) + '</div>') +
      '<table class="memo-sum"><thead><tr><th style="width:3rem">ลำดับ</th><th>รายการ</th><th class="num" style="width:9rem">วงเงิน (บาท)</th></tr></thead><tbody>' +
      rows.map((it, i) => '<tr><td class="center">' + (i + 1) + '</td><td>' + esc(it.code + ' ' + it.name) +
        '</td>' +
        '<td class="num">' + money(it.amount !== undefined && M.items.length ? itemTotal(it) : it.amount) + '</td></tr>').join('') +
      '<tr><td></td><td><strong>รวมวงเงินที่ขอดำเนินการใช้งบ</strong></td><td class="num"><strong>' + money(M.total) + '</strong></td></tr></tbody></table>' +
      '<p>จึงขออนุมัติดำเนินการใช้งบประมาณ รวมเป็นเงินทั้งสิ้น ' + esc(M.amt(M.total)) + '</p>' +
      (edit ? '<p class="mf-note no-print">รายการและวงเงินดึงจากงบที่ผู้คุมงบลงไว้ — ถ้าไม่ถูกต้องให้แจ้งผู้คุมงบแก้ไขงบ</p>' : '') +
      '<p class="memo-close">จึงเรียนมาเพื่อโปรดพิจารณาลงนาม</p>' +
      '<div class="memo-signoff"><div>ขอแสดงความนับถือ</div><div class="memo-sig-line"></div>' +
      '<div>(' + inp('signerName', 'ชื่อผู้ลงนามเสนอ', 'mf-center') + ')</div><div>' + inp('signerTitle', 'ตำแหน่ง', 'mf-center') + '</div></div>' +
      signTable('reviewers', 'ทบทวน และให้ความเห็นชอบ') +
      signTable('approvers', 'ผู้พิจารณาอนุมัติ') +
      (edit ? '' : '<p class="note no-print">เมื่อผู้บริหารลงนามแล้ว ให้สแกน / ถ่ายรูป แนบในหน้างบ (ขอดำเนินการใช้งบครั้งแรก) แล้วส่งให้ผู้คุมงบตรวจ</p>') +
      '</article>';
  }

  /** หน้า Memo ขอดำเนินการใช้งบ (#/budget/:id/memo) — ?view=1 = ฉบับพิมพ์ */
  function viewOpenMemo(id, params) {
    const b0 = budgetById(id);
    if (!b0) return notFound();
    const b = groupLead(b0); // งบที่รวม Memo ใช้ Memo ของงบหลัก
    if (!openFlow(b) || b.type !== 'CAPEX') return '<div class="alert error">Memo ขอดำเนินการใช้งบใช้กับงบ CAPEX ที่ถึงขั้นเปิดใช้งบแล้วเท่านั้น</div>';
    const editable = canEditOpenMemo(b);
    if (!b.openMemo && !editable) return '<div class="alert info">ยังไม่มี Memo ขอดำเนินการใช้งบ</div>';
    if (editable && !(params && params.get('view'))) {
      return '<div class="page-head no-print"><div><h1>Memo ขอดำเนินการใช้งบ · ' + esc(b.code) + '</h1>' +
        '<div class="page-sub">ขอดำเนินการใช้งบ CAPEX ครั้งแรกต้องมี Memo ที่ผู้บริหารเซ็น — กรอกในช่องตามโครงแบบฟอร์ม Memo ของบริษัท แล้วกด "บันทึกและดูฉบับพิมพ์"' +
        (b.openMemo ? '' : ' (ระบบออกเลขที่ Memo เมื่อบันทึกครั้งแรก)') + '</div></div></div>' +
        takeFlash() +
        '<form id="memoDocForm" data-kind="budget" data-id="' + b.id + '">' +
        '<div class="actions no-print memo-toolbar"><button class="btn primary" type="submit" data-mf-go="view">บันทึกและดูฉบับพิมพ์</button>' +
        '<button class="btn" type="submit" data-mf-go="stay">บันทึก</button>' +
        (b.openMemo && b.openMemo.doc ? '<button class="btn" type="button" id="memoDocReset">ใช้ค่าเริ่มต้นจากระบบ</button>' : '') +
        '<a class="btn" href="#/budget/' + b.id + '">กลับไปที่งบ</a></div>' +
        openMemoHtml(b, true) + '</form>';
    }
    return '<div class="actions no-print" style="margin:0 0 1rem"><button class="btn primary" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>' +
      (editable ? '<a class="btn" href="#/budget/' + b.id + '/memo">แก้ไข Memo</a>' : '') +
      '<a class="btn" href="#/budget/' + b.id + '">กลับไปที่งบ</a></div>' + takeFlash() + openMemoHtml(b, false);
  }

  // ---------------------------------------------------------------- ลงรายละเอียด Item ของงบรวมทั้งโครงการ · เลือกเปิดใช้งบหลายตัวพร้อมกัน

  /** ลงรายละเอียด Item (#/budget/:id/breakdown): งบรวมทั้งโครงการที่ผู้คุมงบลงไว้ → แบ่งเป็น Item ผลรวมเท่าวงเงินเดิม */
  function viewBreakdown(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    if (!canBreakdown(b)) return '<div class="alert error">ลงรายละเอียด Item ได้เฉพาะงบรวมทั้งโครงการที่รอเปิดใช้งบ โดย Business เจ้าของงบหรือธุรการ</div>';
    const total = budgetTotal(b);
    const row = '<tr><td><input name="bdCode" aria-label="รหัสรายการ" placeholder="' + (b.type === 'CBS' ? '1' : 'รหัส') + '"></td>' +
      '<td><input name="bdName" aria-label="ชื่อรายการ"></td>' +
      '<td><input name="bdAmt" type="number" min="0" step="0.01" class="right" aria-label="วงเงิน (รวม VAT)"></td>' +
      '<td><button type="button" class="btn small bad" data-bd-del title="ลบแถว" aria-label="ลบแถว">×</button></td></tr>';
    return '<div class="page-head"><div><h1>ลงรายละเอียด Item · ' + esc(b.code) + '</h1><div class="page-sub">' + esc(b.name) +
      ' — ผู้คุมงบลงงบนี้เป็น "งบรวมทั้งโครงการ" วงเงิน ' + money(total) + ' บาท · แบ่งเป็นรายการ (Item) ให้ผลรวมเท่ากับวงเงินนี้ ก่อน' + (b.type === 'CAPEX' ? 'ทำ Memo ขอดำเนินการใช้งบ' : 'ขอดำเนินการใช้งบ') + '</div></div></div>' +
      '<div id="formError"></div>' +
      '<form id="bdForm" data-id="' + b.id + '" data-total="' + total + '"><section class="card form-section"><div class="table-wrap"><table class="edit-table"><thead><tr>' +
      '<th style="width:9rem">รหัสรายการ' + (b.type === 'CBS' ? ' (ไม่มีจุด เช่น 1, 2)' : '') + '</th><th>ชื่อรายการ</th><th class="num" style="width:12rem">วงเงิน (รวม VAT)</th><th style="width:3rem"></th></tr></thead>' +
      '<tbody id="bdRows">' + row + row + '</tbody></table></div>' +
      '<button type="button" class="link-add" id="bdAdd">+ เพิ่มรายการ</button><p id="bdSum" class="muted"></p></section>' +
      '<div class="actions"><button class="btn primary" type="submit">บันทึกรายการ</button><a class="btn" data-back href="#/budget/' + b.id + '">ยกเลิก</a></div></form>';
  }

  function bindBreakdown() {
    const form = document.getElementById('bdForm');
    if (!form) return;
    const b = budgetById(form.dataset.id);
    const total = Number(form.dataset.total);
    const tbody = document.getElementById('bdRows');
    const rows = () => Array.from(tbody.querySelectorAll('tr'));
    const val = (tr, n) => tr.querySelector('[name="' + n + '"]').value;
    const sum = () => round2(rows().reduce((n, tr) => n + Number(val(tr, 'bdAmt') || 0), 0));
    const refresh = () => {
      const sm = sum();
      const diff = round2(total - sm);
      const el = document.getElementById('bdSum');
      el.className = diff === 0 ? 'muted' : 'neg';
      el.textContent = 'รวม ' + money(sm) + ' จากวงเงิน ' + money(total) + ' บาท' + (diff === 0 ? ' ✓ ครบ' : diff > 0 ? ' — ยังขาด ' + money(diff) : ' — เกิน ' + money(-diff));
    };
    form.addEventListener('input', refresh);
    document.getElementById('bdAdd').addEventListener('click', () => {
      const tr = rows()[0].cloneNode(true);
      tr.querySelectorAll('input').forEach((i) => { i.value = ''; });
      tbody.appendChild(tr);
      refresh();
    });
    tbody.addEventListener('click', (e) => {
      const del = e.target.closest('[data-bd-del]');
      if (!del) return;
      if (rows().length > 1) del.closest('tr').remove();
      refresh();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const list = rows().map((tr) => ({ code: val(tr, 'bdCode').trim(), name: val(tr, 'bdName').trim(), amount: round2(val(tr, 'bdAmt')) })).filter((x) => x.code || x.name || x.amount);
      const errors = [];
      if (!list.length) errors.push('ต้องมีรายการอย่างน้อย 1 รายการ');
      if (list.some((x) => !x.code || !x.name)) errors.push('กรอกรหัสและชื่อรายการให้ครบทุกแถว');
      if (list.some((x) => !(x.amount > 0))) errors.push('วงเงินของแต่ละรายการต้องมากกว่า 0');
      const dup = list.map((x) => x.code).filter((c, i, arr) => c && arr.indexOf(c) !== i);
      if (dup.length) errors.push('รหัสรายการซ้ำ: ' + uniq(dup).join(', '));
      if (b.type === 'CBS' && list.some((x) => x.code.includes('.'))) errors.push('Item หลักใช้รหัสไม่มีจุด (เช่น 1, 2, 3) — Item ย่อยเพิ่มได้หลังเปิดใช้งบ');
      if (round2(total - sum()) !== 0) errors.push('ผลรวมวงเงินของรายการต้องเท่ากับวงเงินงบ ' + money(total) + ' บาท (ตอนนี้ ' + money(sum()) + ')');
      if (errors.length) { showErrors(errors); return; }
      b.items = list.map((x) => Object.assign({ id: nextId('i'), code: x.code, name: x.name, amount: x.amount, vat: 0 }, b.type === 'CBS' ? { qty: '', unit: '', glCode: '', glName: '' } : {}));
      b.structure = 'items';
      addHistory(b, 'ลงรายละเอียด Item ของงบรวมทั้งโครงการ', list.length + ' รายการ · รวม ' + money(total) + ' บาท', 'งบ ' + b.code);
      save();
      setFlash('success', 'บันทึกรายการของ ' + b.code + ' แล้ว — ' + (b.type === 'CAPEX' ? 'ทำ Memo ขอดำเนินการใช้งบได้' : 'ขอดำเนินการใช้งบได้'));
      go('#/budget/' + b.id);
    });
    refresh();
  }

  /** ตารางงบรอเปิดใช้ของ Business พร้อมช่องเลือก — CAPEX รวม Memo ใบเดียว · OPEX เปิดใช้หลายตัวในครั้งเดียว (แยกประเภทกัน) */
  function openPickTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div id="openPick"><p class="muted small-note">เลือกงบที่ต้องการเปิดใช้พร้อมกัน — <b>CAPEX</b> ทำ Memo ใบเดียวรวมหลายงบ (บริษัทเดียวกัน) · <b>OPEX</b> ขอดำเนินการใช้งบหลายตัวในครั้งเดียว · CAPEX กับ OPEX แยกกัน</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-open-capex disabled>ทำ Memo รวม (CAPEX ที่เลือก)</button>' +
      '<button type="button" class="btn primary" data-open-opex disabled>ขอดำเนินการใช้งบที่เลือก (OPEX)</button><span class="muted" id="openPickNote"></span></div>' +
      '<div class="table-wrap"><table><thead><tr><th style="width:2.5rem"></th><th>งบ</th><th>บริษัท / ปี</th><th class="num">วงเงิน</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      list.map((b) => {
        const reason = needsItems(b) ? '' : b.openGroup ? 'รวมอยู่ใน Memo ' + esc(b.openGroup.no)
          : b.type === 'CAPEX' && b.openMemo ? 'มี Memo ของตัวเองแล้ว (เปิดที่หน้างบ)' : '';
        const blocked = needsItems(b) || !!reason;
        return '<tr><td><input type="checkbox" data-open-pick="' + b.id + '" aria-label="เลือก ' + esc(b.code) + '"' + (blocked ? ' disabled' : '') + '></td>' +
          '<td>' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div class="muted">' + esc(b.name) + '</div></td>' +
          '<td class="nowrap">' + esc(b.company) + ' · ' + esc(b.fiscalYear) + '</td><td class="num">' + money(budgetTotal(b)) + '</td>' +
          '<td>' + (needsItems(b) ? '<a href="#/budget/' + b.id + '/breakdown">ต้องลงรายละเอียด Item ก่อน</a>' : reason ? '<span class="muted">' + reason + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function bindOpenPick() {
    const box = document.getElementById('openPick');
    if (!box) return;
    const picked = () => Array.from(box.querySelectorAll('[data-open-pick]:checked')).map((x) => budgetById(x.dataset.openPick)).filter(Boolean);
    const split = () => { const sel = picked(); return { cap: sel.filter((x) => x.type === 'CAPEX'), opx: sel.filter((x) => x.type === 'CBS') }; };
    const refresh = () => {
      const { cap, opx } = split();
      const sameCo = cap.every((x) => x.company === cap[0].company);
      box.querySelector('[data-open-capex]').disabled = !(cap.length >= 2 && sameCo);
      box.querySelector('[data-open-opex]').disabled = !opx.length;
      document.getElementById('openPickNote').textContent = cap.length >= 2 && !sameCo ? 'Memo รวมได้เฉพาะงบของบริษัทเดียวกัน' : cap.length === 1 ? 'เลือก CAPEX อย่างน้อย 2 งบถึงจะรวม Memo ได้ (งบเดียวทำ Memo ที่หน้างบ)' : '';
    };
    box.addEventListener('change', refresh);
    box.querySelector('[data-open-capex]').addEventListener('click', () => {
      const sel = split().cap.filter((x) => canOpenBudget(x) && !x.openMemo && !x.openGroup);
      if (sel.length < 2 || !sel.every((x) => x.company === sel[0].company)) return;
      const lead = sel[0];
      const no = nextMemoNo();
      lead.openMemo = { no, files: [], createdAt: new Date().toISOString(), group: sel.map((x) => x.id) };
      sel.slice(1).forEach((x) => { x.openGroup = { lead: lead.id, no }; });
      sel.forEach((x) => addHistory(x, 'รวม Memo ขอดำเนินการใช้งบ ' + sel.length + ' งบ', sel.map((y) => y.code).join(', '), no));
      save();
      setFlash('success', 'รวม ' + sel.length + ' งบเป็น Memo เดียว — กรอก Memo แล้วพิมพ์ให้ผู้บริหารเซ็น');
      go('#/budget/' + lead.id + '/memo');
    });
    box.querySelector('[data-open-opex]').addEventListener('click', () => {
      const sel = split().opx.filter((x) => canOpenBudget(x));
      if (!sel.length) return;
      const tot = round2(sel.reduce((n, x) => n + budgetTotal(x), 0));
      if (!confirm('ขอดำเนินการใช้งบ ' + sel.length + ' งบ (' + sel.map((x) => x.code).join(', ') + ') รวมวงเงิน ' + money(tot) + ' บาท ?')) return;
      sel.forEach((x) => {
        activateBudget(x, me().id, 'Business ขอดำเนินการใช้งบ (เปิดพร้อมกัน ' + sel.length + ' งบ)');
        addHistory(x, 'Business ขอดำเนินการใช้งบ', sel.length > 1 ? 'เปิดพร้อมกัน ' + sel.length + ' งบ' : '', 'งบ ' + x.code);
      });
      save();
      setFlash('success', 'ขอดำเนินการใช้งบ ' + sel.length + ' งบแล้ว — ขอเบิกใช้งบได้');
      go('#/tasks?tab=toopen');
    });
    refresh();
  }

  // ---------------------------------------------------------------- Import งบจาก Excel (ผู้คุมงบ)

  /** คอลัมน์ของไฟล์ Import (1 แถว = 1 Item · แถวที่รหัสโครงการเดียวกัน = งบเดียวกัน) */
  const IMPORT_COLS = [
    { k: 'type', h: 'ประเภทงบ (CAPEX/OPEX)', w: 14 }, { k: 'year', h: 'ปีงบประมาณ', w: 11, num: true },
    { k: 'code', h: 'รหัสโครงการ', w: 14 }, { k: 'name', h: 'ชื่อโครงการ / ชื่องบ', w: 30 },
    { k: 'dept', h: 'หน่วยงาน', w: 16 }, { k: 'owner', h: 'Business เจ้าของงบ', w: 18 }, { k: 'itCode', h: 'รหัส Item', w: 12 },
    { k: 'itName', h: 'ชื่อ Item', w: 28 }, { k: 'amount', h: 'วงเงิน (รวม VAT)', w: 18, num: true },
    { k: 'ref', h: 'อ้างอิงการอนุมัติ (ถ้ามี)', w: 20 }, { k: 'note', h: 'หมายเหตุ', w: 24 }
  ];
  let importPreview = null; // { file, company, budgets: [{ data, errors, rows }] }
  let importCompany = ''; // บริษัทที่เลือกก่อนนำเข้า (ไฟล์ไม่ได้ระบุบริษัท — บัญชีแต่ละบริษัททำงบของบริษัทตัวเอง)
  let importRaw = null; // { file, sheets } ไฟล์ที่อ่านแล้ว — เปลี่ยนบริษัทแล้วตรวจใหม่ได้โดยไม่ต้องเลือกไฟล์อีก
  function runImport() {
    if (!importRaw || !importCompany) { importPreview = null; return; }
    try {
      const res = govImport(importRaw.sheets, importCompany) || importBudgets(importRaw.sheets[0].rows, importCompany);
      importPreview = Object.assign({ file: importRaw.file, company: importCompany }, res.error ? { error: res.error } : res);
      if (!res.error && !res.budgets.length) importPreview.error = 'ไม่พบข้อมูลในไฟล์';
    } catch (err) {
      importPreview = { file: importRaw.file, error: err.message || 'อ่านไฟล์ไม่ได้' };
    }
  }

  /** อ่านไฟล์ ZIP (xlsx) — รองรับไฟล์ที่บีบอัดแบบ deflate ด้วย DecompressionStream ของเบราว์เซอร์ */
  async function readZip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e -= 1;
    if (e < 0) throw new Error('ไฟล์ไม่ใช่ .xlsx');
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder();
    const out = {};
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true);
      const xl = dv.getUint16(p + 30, true);
      const cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      out[name] = { method, data: u8.subarray(start, start + csize) };
      p += 46 + nl + xl + cl;
    }
    const text = async (name) => {
      const f = out[name];
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้อ่านไฟล์ .xlsx ที่บีบอัดไม่ได้ — บันทึกเป็น .csv แล้ว Import แทน');
      const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(stream).arrayBuffer());
    };
    return { names: Object.keys(out), text };
  }

  /** ทุกแผ่นงานของ .xlsx → [{ name, rows }] (rows = array ของ array ข้อความ/ตัวเลข · แถวว่างคงตำแหน่งไว้ให้เลขแถวตรงกับ Excel) */
  async function readXlsxSheets(buf) {
    const zip = await readZip(buf);
    const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
    const tags = (node, name) => Array.from(node.getElementsByTagName(name));
    const wb = xml(await zip.text('xl/workbook.xml') || '');
    const list = tags(wb, 'sheet');
    if (!list.length) throw new Error('ไม่พบแผ่นงานในไฟล์');
    const rels = xml(await zip.text('xl/_rels/workbook.xml.rels') || '<x/>');
    const ssText = await zip.text('xl/sharedStrings.xml');
    const shared = ssText ? tags(xml(ssText), 'si').map((si) => tags(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent).join('')) : [];
    const colIdx = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const out = [];
    for (let k = 0; k < list.length; k++) {
      const sh = list[k];
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      const rel = tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
      let target = rel ? rel.getAttribute('Target') : 'worksheets/sheet' + (k + 1) + '.xml';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const sheet = xml(await zip.text(target) || '<x/>');
      const rows = [];
      tags(sheet, 'row').forEach((row, ri) => {
        const cells = [];
        tags(row, 'c').forEach((c, i) => {
          const t = c.getAttribute('t');
          const v = (tags(c, 'v')[0] || {}).textContent;
          let val = '';
          if (t === 's') val = shared[Number(v)] || '';
          else if (t === 'inlineStr') val = tags(c, 't').map((x) => x.textContent).join('');
          else if (t === 'str' || t === 'b' || t === 'e') val = v || '';
          else if (v !== undefined && v !== '') val = Number(v);
          cells[c.getAttribute('r') ? colIdx(c.getAttribute('r')) : i] = val;
        });
        const rn = Number(row.getAttribute('r')) || ri + 1;
        if (rn > 0 && rn < 200000) rows[rn - 1] = Array.from(cells, (x) => (x === undefined ? '' : x));
      });
      out.push({ name: sh.getAttribute('name') || 'Sheet' + (k + 1), rows: Array.from(rows, (x) => x || []) });
    }
    return out;
  }
  /** แผ่นงานแรกของ .xlsx → แถว */
  async function readXlsxRows(buf) { return (await readXlsxSheets(buf))[0].rows; }

  /** CSV (UTF-8) → แถว */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let q = false;
    const t = text.replace(/^﻿/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"' && t[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && t[i + 1] === '\n') i += 1;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /** แถวจากไฟล์ → งบ (จัดกลุ่มตามรหัสโครงการ) พร้อมตรวจความถูกต้อง */
  function importBudgets(rows, company) {
    const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
    const head = (rows[0] || []).map(norm);
    const idx = {};
    IMPORT_COLS.forEach((c) => {
      const full = norm(c.h);
      const short = norm(c.h.replace(/\s*\(.*$/, ''));
      let i = head.indexOf(full);
      if (i < 0) i = head.findIndex((h) => h && (h === short || h.startsWith(short)));
      idx[c.k] = i;
    });
    const missingCols = ['type', 'code', 'name', 'owner', 'itCode', 'itName', 'amount'].filter((k) => idx[k] < 0)
      .map((k) => IMPORT_COLS.find((c) => c.k === k).h);
    if (missingCols.length) return { error: 'ไม่พบคอลัมน์: ' + missingCols.join(', ') + ' — ใช้ไฟล์ตัวอย่าง (Template) เป็นแบบ' };
    const get = (r, k) => (idx[k] >= 0 && r[idx[k]] !== undefined ? String(r[idx[k]]).trim() : '');
    const num = (v) => Number(String(v).replace(/[,\s฿]/g, ''));
    const groups = [];
    rows.slice(1).forEach((r, i) => {
      if (!r.some((x) => String(x).trim())) return;
      const code = get(r, 'code');
      let g = groups.find((x) => x.code === code);
      if (!g) { g = { code, rows: [] }; groups.push(g); }
      g.rows.push({ line: i + 2, r });
    });
    const owners = USERS.filter(canRequestUser);
    const findOwner = (v) => owners.find((x) => [x.id, x.name, x.email].filter(Boolean).map(norm).includes(norm(v)));
    const year = new Date().getFullYear();
    const budgets = groups.map((g) => {
      const r0 = g.rows[0].r;
      const errors = [];
      const typeRaw = get(r0, 'type').toUpperCase();
      const type = typeRaw === 'CAPEX' ? 'CAPEX' : '';
      if (!type) errors.push(typeRaw === 'OPEX' || typeRaw === 'CBS' ? 'งบ OPEX ให้ Business เป็นผู้สร้างและส่งอนุมัติเอง — Import ได้เฉพาะ CAPEX' : 'ประเภทงบต้องเป็น CAPEX');
      const fy = num(get(r0, 'year')) || year + 1;
      const owner = findOwner(get(r0, 'owner'));
      if (!owner) errors.push('ไม่พบ Business เจ้าของงบ "' + get(r0, 'owner') + '" (ใส่ชื่อ หรือรหัสผู้ใช้)');
      const dept = get(r0, 'dept');
      if (dept && !db.master.departments.some((d) => d.name === dept)) errors.push('ไม่พบหน่วยงาน "' + dept + '" ในข้อมูลหลัก');
      if (!dept) errors.push('ไม่ได้ระบุหน่วยงาน');
      if (!g.code) errors.push('ไม่ได้ระบุรหัสโครงการ');
      else if (db.budgets.some((b) => b.code === g.code && b.state !== 'cancelled')) errors.push('รหัสโครงการ "' + g.code + '" มีอยู่แล้วในระบบ');
      if (!get(r0, 'name')) errors.push('ไม่ได้ระบุชื่อโครงการ');
      const items = g.rows.map(({ line, r }) => {
        const amount = round2(num(get(r, 'amount')));
        const it = { id: '', code: get(r, 'itCode'), name: get(r, 'itName'), amount, line };
        if (!it.code || !it.name) errors.push('แถว ' + line + ': ไม่ได้ระบุรหัส / ชื่อ Item');
        if (!(amount > 0)) errors.push('แถว ' + line + ': วงเงินต้องมากกว่า 0');
        return it;
      });
      const dup = items.map((x) => x.code).filter((c, i, a) => c && a.indexOf(c) !== i);
      if (dup.length) errors.push('รหัส Item ซ้ำ: ' + uniq(dup).join(', '));
      const data = {
        type: type || 'CAPEX', code: g.code, name: get(r0, 'name'), company, fiscalYear: fy, department: dept,
        ownerId: owner ? owner.id : '', structure: 'items', note: get(r0, 'note'), items,
        meeting: { date: '', no: get(r0, 'ref'), note: '', by: '' }
      };
      return { data, errors: uniq(errors), lines: g.rows.length };
    });
    // รหัสโครงการซ้ำในไฟล์เดียวกันแต่คนละประเภท/ชื่อ ถือว่าเป็นงบเดียวกัน (ใช้ข้อมูลแถวแรก)
    return { budgets };
  }

  function importTemplate() {
    const y = new Date().getFullYear() + 1;
    const ownerA = (USERS.filter(canRequestUser)[0] || {}).name || '';
    const dept = (db.master.departments[0] || {}).name || '';
    const rows = [
      ['CAPEX', y, 'CP-' + y + '-01', 'ตัวอย่าง: เครื่องจักรสายการผลิตใหม่', dept, ownerA, 'CP-' + y + '-01-01', 'เครื่องจักรหลัก', 1500000, '', ''],
      ['CAPEX', y, 'CP-' + y + '-01', 'ตัวอย่าง: เครื่องจักรสายการผลิตใหม่', dept, ownerA, 'CP-' + y + '-01-02', 'งานติดตั้ง', 300000, '', ''],
      ['CAPEX', y, 'CP-' + y + '-02', 'ตัวอย่าง: ปรับปรุงอาคารคลังสินค้า', dept, ownerA, 'CP-' + y + '-02-01', 'งานก่อสร้าง', 500000, '', '']
    ];
    const guide = [
      ['1 แถว = 1 Item · แถวที่ "รหัสโครงการ" เดียวกันรวมเป็นงบเดียวกัน (ข้อมูลระดับงบใช้จากแถวแรกของโครงการ)'],
      ['ประเภทงบ: CAPEX เท่านั้น (OPEX ใช้ไฟล์รูปแบบ Governance) · ไม่ต้องใส่บริษัทในไฟล์ — เลือกบริษัทที่หน้า Import ก่อนเลือกไฟล์ ทุกงบในไฟล์จะเป็นบริษัทที่เลือก'],
      ['Business เจ้าของงบ: ชื่อ หรือรหัสผู้ใช้ (' + USERS.filter(canRequestUser).map((u) => u.name).join(', ') + ')'],
      ['หน่วยงาน: ตามข้อมูลหลัก (' + db.master.departments.map((d) => d.name).join(', ') + ')'],
      ['วงเงินรวม VAT'],
      ['หลัง Import งบจะอยู่สถานะ "ยังไม่เปิดใช้งบ" — Business ต้องทำ Memo ให้ผู้บริหารเซ็น แนบไฟล์ แล้วผู้คุมงบตรวจและยืนยัน'],
      ['บันทึกเป็น .xlsx หรือ .csv (UTF-8) ก็ได้']
    ];
    return buildXlsx([
      { name: 'งบประจำปี', cols: IMPORT_COLS.map((c) => ({ h: c.h, w: c.w, num: c.num })), rows },
      { name: 'คำอธิบาย', cols: [{ h: 'วิธีกรอก', w: 120 }], rows: guide }
    ]);
  }

  function viewImport() {
    if (!can('budget.manage')) return '<div class="alert error">Import งบได้เฉพาะผู้คุมงบ</div>';
    const cos = (db.master.companies || []).filter((c) => scopeOk(c.code));
    if (!importCompany && cos.length === 1) importCompany = cos[0].code;
    if (importCompany && !cos.some((c) => c.code === importCompany)) importCompany = '';
    let html = '<div class="page-head"><div><h1>Import งบประจำปีจาก Excel</h1><div class="page-sub">ลงงบ CAPEX / OPEX หลายงบพร้อมกันจากไฟล์ Governance Framework — งบที่ Import จะรอ Business เจ้าของงบ ขอดำเนินการใช้งบครั้งแรก</div></div></div>' +
      takeFlash() +
      '<section class="card form-section"><ol class="import-steps"><li><strong>เลือกบริษัทที่จะนำเข้า</strong> (ในไฟล์ไม่ต้องระบุบริษัท — ทุกงบในไฟล์จะเป็นบริษัทที่เลือก)</li>' +
      '<li>เลือกไฟล์ .xlsx หรือ .csv (ใช้ไฟล์ Governance Framework ตัวจริงได้เลย หรือดาวน์โหลดไฟล์ตัวอย่างไปกรอก) ระบบจะแสดงตัวอย่างและตรวจข้อมูลก่อน</li><li>กด "นำเข้า" — งบที่มีข้อผิดพลาดจะไม่ถูกนำเข้า</li></ol>' +
      '<div class="alert info">รองรับ 2 รูปแบบ: <strong>ไฟล์ Capex / Opex Governance Framework</strong> (แผ่นที่มีหัวตาราง "Capex ID" / "Opex ID" — ระบบรู้เองจากหัวตาราง ชื่อแผ่นอะไรก็ได้) และรูปแบบรายการ Item เดิม (1 แถว = 1 Item, CAPEX เท่านั้น)</div>' +
      '<div class="form-grid import-company"><label class="field req"><span>บริษัทที่นำเข้า</span><div class="select-wrap"><select id="importCompany" aria-label="บริษัทที่นำเข้า">' +
      '<option value="">— เลือกบริษัท —</option>' + cos.map((c) => opt(c.code, c.code + (c.name ? ' — ' + c.name : ''), importCompany)).join('') + '</select></div></label></div>' +
      '<div class="actions"><button type="button" class="btn" id="importTemplateGov">ไฟล์ตัวอย่างรูปแบบ Governance (.xlsx)</button>' +
      '<button type="button" class="btn" id="importTemplate">ไฟล์ตัวอย่างรูปแบบรายการ Item (.xlsx)</button>' +
      '<label class="btn primary file-btn" id="importFileBtn"' + (importCompany ? '' : ' aria-disabled="true" title="เลือกบริษัทก่อน"') + '>เลือกไฟล์ Excel / CSV<input type="file" id="importFile"' + (importCompany ? '' : ' disabled') + ' accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden></label>' +
      '<a class="btn" href="#/budgets">กลับ</a></div>' + (importCompany ? '' : '<p class="guard-hint">เลือกบริษัทก่อน แล้วจึงเลือกไฟล์ที่นำเข้า</p>') + '</section>';
    const pv = importPreview;
    if (!pv) return html;
    if (pv.error) return html + '<div class="alert error">' + esc(pv.file) + ': ' + esc(pv.error) + '</div>';
    const okList = pv.budgets.filter((x) => !x.errors.length);
    html += '<div class="alert info">นำเข้าเป็นบริษัท <strong>' + esc(pv.company || importCompany) + '</strong> ทุกงบในไฟล์</div>';
    if (pv.kind === 'gov') {
      html += '<div class="alert info">อ่านไฟล์รูปแบบ Governance: พบ ' + pv.sheets + ' แผ่นรายการ' + (pv.skipped.length ? ' · <strong>ข้าม ' + pv.skipped.length + ' แถวที่สถานะไม่ใช่ "' + GOV_APPROVED + '"</strong> (' +
        esc(pv.skipped.slice(0, 8).map((x) => x.code || 'แถว ' + x.line).join(', ')) + (pv.skipped.length > 8 ? ' …' : '') + ')' : '') + '</div>' +
        pv.notes.map((n) => '<div class="alert info">' + esc(n) + '</div>').join('');
    }
    html += '<h2>ตรวจข้อมูลจาก ' + esc(pv.file) + ' <span class="muted count-note">(' + pv.budgets.length + ' งบ · พร้อมนำเข้า ' + okList.length + ')</span></h2>' +
      '<div class="table-wrap"><table class="import-table"><thead><tr><th>งบ</th><th>บริษัท / ปี</th><th>Business</th><th class="num">Item</th><th class="num">วงเงิน (รวม VAT)</th><th>ผลตรวจ</th></tr></thead><tbody>' +
      pv.budgets.map((x) => {
        const d = x.data;
        return '<tr class="' + (x.errors.length ? 'row-bad' : '') + '"><td>' + badge(d.type, TYPE_SHORT[d.type]) + ' <strong>' + esc(d.code || '-') + '</strong><div class="muted">' + esc(d.name) + '</div></td>' +
          '<td class="nowrap">' + esc(d.company) + ' · ' + esc(d.fiscalYear) + '<div class="muted">' + esc(d.department) + '</div></td>' +
          '<td class="nowrap">' + esc(d.ownerId ? userName(d.ownerId) : d.ownerName || '-') + '</td><td class="num">' + (d.structure === 'project' ? 'งบรวม' : d.items.length) + '</td>' +
          '<td class="num">' + money(budgetTotal(d)) + '</td>' +
          '<td>' + (x.errors.length ? '<ul class="err-list">' + x.errors.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '<span class="badge approved">พร้อมนำเข้า</span>') +
          (x.warnings || []).map((w) => '<div class="muted">' + esc(w) + '</div>').join('') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="actions"><button type="button" class="btn primary" id="importGo"' + (okList.length ? '' : ' disabled') + '>นำเข้า ' + okList.length + ' งบ (ยังไม่เปิดใช้งบ)</button>' +
      '<button type="button" class="btn" id="importClear">ล้าง</button>' +
      (okList.length < pv.budgets.length ? '<span class="guard-hint">งบที่มีข้อผิดพลาด ' + (pv.budgets.length - okList.length) + ' งบจะไม่ถูกนำเข้า — แก้ในไฟล์แล้วเลือกไฟล์ใหม่</span>' : '') + '</div>';
    return html;
  }

  function bindImport() {
    const tpl = document.getElementById('importTemplate');
    if (!tpl) return;
    const download = (bytes, name) => {
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    tpl.addEventListener('click', () => download(importTemplate(), 'budget-import-template.xlsx'));
    document.getElementById('importTemplateGov').addEventListener('click', () => download(govTemplate(), 'budget-governance-template.xlsx'));
    document.getElementById('importCompany').addEventListener('change', (e) => {
      importCompany = e.target.value;
      runImport(); // เปลี่ยนบริษัทแล้วตรวจไฟล์เดิมใหม่ให้เลย
      render();
    });
    document.getElementById('importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f || !importCompany) return;
      try {
        importRaw = { file: f.name, sheets: /\.csv$/i.test(f.name) ? [{ name: f.name, rows: parseCsv(await f.text()) }] : await readXlsxSheets(await f.arrayBuffer()) };
        runImport();
      } catch (err) {
        importRaw = null;
        importPreview = { file: f.name, error: err.message || 'อ่านไฟล์ไม่ได้' };
      }
      render();
    });
    const clear = document.getElementById('importClear');
    if (clear) clear.addEventListener('click', () => { importPreview = null; importRaw = null; render(); });
    const goBtn = document.getElementById('importGo');
    if (goBtn) goBtn.addEventListener('click', () => {
      const ok = importPreview.budgets.filter((x) => !x.errors.length && !db.budgets.some((b) => b.code === x.data.code && b.state !== 'cancelled'));
      if (!ok.length || !confirm('นำเข้า ' + ok.length + ' งบ ?')) return;
      const at = new Date().toISOString();
      ok.forEach((x) => {
        const items = x.data.items.map((it) => { const c = Object.assign({}, it, { id: nextId('i') }); delete c.line; return c; });
        const b = Object.assign({ id: nextId('b'), createdAt: at, createdBy: me().id, attachments: [], history: [], revisions: [] }, x.data,
          { items, state: 'pending_open', setup: true });
        addHistory(b, 'ผู้คุมงบลงงบประจำปี (Import Excel' + (importPreview.kind === 'gov' ? ' รูปแบบ Governance' : '') + ') — รอ Business ขอดำเนินการใช้งบ', importPreview.file, 'งบ ' + b.code);
        db.budgets.push(b);
      });
      ensureMaster(db);
      logAction('Import งบจาก Excel', '', importPreview.file + ' · บริษัท ' + importPreview.company + ' · ' + ok.length + ' งบ');
      save();
      const co = importPreview.company;
      importPreview = null;
      importRaw = null;
      setFlash('success', 'นำเข้า ' + ok.length + ' งบของบริษัท ' + co + ' แล้ว — รอ Business เจ้าของงบ เปิดใช้งบ');
      go('#/budgets');
    });
  }

  // ---------------------------------------------------------------- Item ย่อยของ OPEX (เพิ่มทีหลังได้เมื่องบเปิดใช้แล้ว)

  /** เพิ่ม/แก้ Item ย่อยได้: งบ OPEX ที่เปิดใช้แล้ว โดย Business เจ้าของงบ หรือผู้คุมงบ */
  const canManageSubItems = (b) => b.type === 'CBS' && b.structure !== 'project' && isActive(b) && ((actsFor(b) && can('request.create')) || can('budget.manage'));
  /** มีคำขอใช้ Item นี้ (หรือ Item ย่อยใต้ Item นี้) แล้ว: แก้รหัส / ลบไม่ได้ */
  const itemInUse = (b, it) => db.requests.some((r) => r.budgetId === b.id && r.lines.some((l) => leafIdsUnder(b, it).includes(l.itemId)));

  /** แถว Item ย่อย (ระดับ 2 = 1.1, ระดับ 3 = 1.1.1) */
  function subItemRow(b, it, locked) {
    const lv = it.code ? depth(it) : 1;
    return '<tr data-item-id="' + esc(it.id || '') + '" data-level="' + lv + '" class="lv' + lv + '">' +
      '<td><div class="si-code"><input name="siCode" value="' + esc(it.code || '') + '" placeholder="1.1" aria-label="รหัส Item ย่อย"' +
        (locked ? ' readonly class="locked" title="มีการขอใช้แล้ว แก้รหัสไม่ได้"' : '') + '></div></td>' +
      '<td><input name="siName" value="' + esc(it.name || '') + '" aria-label="ชื่อรายการ"></td>' +
      '<td><input name="siQty" type="number" min="0" step="any" value="' + esc(it.qty || '') + '" aria-label="จำนวน"></td>' +
      '<td><input name="siUnit" value="' + esc(it.unit || '') + '" aria-label="หน่วย"></td>' +
      '<td><input name="siAmount" type="number" min="0" step="0.01" class="right" value="' + esc(it.amount || '') + '" placeholder="ไม่กำหนด" aria-label="วงเงินก่อน VAT เว้นว่าง = ไม่กำหนด"></td>' +
      '<td class="center"><input name="siVat" type="checkbox"' + (Number(it.vat) > 0 ? ' checked' : '') + ' aria-label="VAT 7%"></td>' +
      '<td><input name="siGl" value="' + esc(it.glCode || '') + '" aria-label="GL Code"></td>' +
      '<td class="nowrap">' + (lv === 1 ? '<button type="button" class="btn small" data-add-child title="เพิ่ม Item ย่อยระดับถัดไป (เช่น 1.1.1)">+ ย่อย</button> ' : '') +
      (locked ? '<span class="muted" title="มีการขอใช้แล้ว ลบไม่ได้">🔒</span>' : '<button type="button" class="btn small bad" data-remove-sub title="ลบ">×</button>') + '</td></tr>';
  }

  function viewSubItems(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    if (b.type !== 'CBS' || b.structure === 'project') return '<div class="alert error">Item ย่อยใช้กับงบ OPEX ที่แยก Item เท่านั้น</div>';
    if (!canManageSubItems(b)) return '<div class="alert error">เพิ่ม Item ย่อยได้เมื่องบเปิดใช้งบแล้ว โดย Business เจ้าของงบหรือผู้คุมงบ</div>';
    const mains = sortedItems(b).filter((x) => depth(x) === 0);
    const sections = mains.map((m) => {
      const subs = sortedItems(b).filter((x) => depth(x) >= 1 && depth(x) <= 2 && rootOf(b, x) === m);
      return '<section class="card form-section sub-sec" data-main="' + esc(m.id) + '" data-code="' + esc(m.code) + '" data-total="' + itemTotal(m) + '">' +
        '<div class="section-head"><div><h2 class="section-title">' + esc(m.code + ' ' + m.name) + '</h2>' +
        '<div class="muted section-hint">วงเงิน Item หลัก <strong>' + money(itemTotal(m)) + '</strong> บาท · จัดสรรให้ Item ย่อยแล้ว <strong data-alloc>0.00</strong> · ยังไม่จัดสรร <strong data-free>0.00</strong></div></div>' +
        '<button type="button" class="btn" data-add-sub="' + esc(m.id) + '">+ เพิ่ม Item ย่อย</button></div>' +
        '<div class="table-wrap"><table class="edit-table"><thead><tr><th style="width:8.5rem">รหัส</th><th style="min-width:12rem">รายการ</th><th style="width:6rem">จำนวน</th><th style="width:5.5rem">หน่วย</th>' +
        '<th class="num" style="width:9rem">วงเงินก่อน VAT</th><th style="width:4rem">VAT 7%</th><th style="width:7rem">GL Code <small class="muted">(ไม่บังคับ)</small></th><th style="width:6.5rem"></th></tr></thead>' +
        '<tbody>' + subs.map((x) => subItemRow(b, x, itemInUse(b, x))).join('') + '</tbody></table></div>' +
        '</section>';
    }).join('');
    return '<div class="page-head"><div><h1>จัดการ Item ย่อย · ' + esc(b.code) + '</h1><div class="page-sub">' + esc(b.name) +
      ' — เพิ่ม Item ย่อยได้ 2 ระดับใต้ Item หลัก (1 → 1.1 → 1.1.1) และเพิ่มได้เรื่อย ๆ · เงื่อนไข: วงเงินรวมของ Item ย่อยต้องไม่เกิน Item หลัก · จะกำหนดวงเงินของ Item ย่อยหรือไม่ก็ได้ (เว้นว่าง = ใช้วงเงินของ Item แม่) · จำนวน / หน่วย กรอกที่ Item ย่อย</div></div></div>' +
      '<div id="formError"></div>' +
      '<form id="subItemsForm" data-id="' + b.id + '"><div class="form-main">' + sections +
      '<div class="actions"><button class="btn primary" type="submit">บันทึก Item ย่อย</button><a class="btn" data-back href="#/budget/' + b.id + '">ยกเลิก</a></div></div>' +
      '<template id="subTpl">' + subItemRow(b, {}, false) + '</template></form>';
  }

  function bindSubItems() {
    const form = document.getElementById('subItemsForm');
    if (!form) return;
    const b = budgetById(form.dataset.id);
    const tpl = document.getElementById('subTpl').innerHTML;
    const sections = () => Array.from(form.querySelectorAll('[data-main]'));
    const mainOf = (sec) => itemById(b, sec.dataset.main);
    const readRows = (sec) => Array.from(sec.querySelectorAll('tbody tr')).map((tr) => {
      const q = (n) => tr.querySelector('[name="' + n + '"]');
      const amount = round2(q('siAmount').value);
      return { tr, id: tr.dataset.itemId || '', code: q('siCode').value.trim(), name: q('siName').value.trim(), qty: q('siQty').value === '' ? '' : Number(q('siQty').value),
        unit: q('siUnit').value.trim(), amount, vat: q('siVat').checked ? round2(amount * VAT_RATE) : 0, glCode: q('siGl').value.trim() };
    }).filter((r) => r.code || r.name || r.amount);
    /** งบทั้งหมดหลังแก้: Item หลัก + Item ย่อยทุกระดับจากฟอร์ม */
    const draftItems = () => {
      const out = b.items.filter((x) => depth(x) === 0).map((x) => Object.assign({}, x));
      sections().forEach((sec) => readRows(sec).forEach((r) => out.push({ id: r.id || '(new)' + r.code, code: r.code, name: r.name, amount: r.amount, vat: r.vat })));
      return out;
    };
    const errorsNow = () => {
      const out = [];
      const all = draftItems();
      sections().forEach((sec) => {
        const m = mainOf(sec);
        const rows = readRows(sec);
        const codes = new Set(rows.map((r) => r.code));
        rows.forEach((r) => {
          const parts = r.code.split('.');
          const okFmt = r.code.startsWith(m.code + '.') && /^\d+(\.\d+){1,2}$/.test(r.code) && parts.length <= 3;
          if (!okFmt) out.push('รหัส ' + (r.code || '(ว่าง)') + ' ต้องเป็น ' + m.code + '.1 หรือ ' + m.code + '.1.1 (ไม่เกิน 3 ระดับ)');
          else if (parts.length === 3 && !codes.has(parts.slice(0, 2).join('.'))) out.push('ยังไม่มี Item ' + parts.slice(0, 2).join('.') + ' สำหรับ ' + r.code);
          if (!r.name) out.push('กรุณากรอกชื่อรายการของ ' + (r.code || 'Item ย่อย'));
        });
      });
      const dup = all.map((x) => x.code).filter((c, i, arr) => c && arr.indexOf(c) !== i);
      if (dup.length) out.push('รหัสซ้ำ: ' + uniq(dup).join(', '));
      return uniq(out.concat(treeErrors({ type: 'CBS', items: all })));
    };
    const recalc = () => {
      const tmp = { type: 'CBS', items: draftItems() };
      sections().forEach((sec) => {
        const m = tmp.items.find((x) => x.id === sec.dataset.main);
        const alloc = m ? allocatedOf(tmp, m) : 0;
        const total = Number(sec.dataset.total);
        sec.querySelector('[data-alloc]').textContent = money(alloc);
        const free = sec.querySelector('[data-free]');
        free.textContent = money(round2(total - alloc));
        free.classList.toggle('neg', alloc > total + 0.005);
        // ระดับของแถวตามรหัส (เยื้องให้เห็นลำดับชั้น)
        sec.querySelectorAll('tbody tr').forEach((tr) => {
          const lv = Math.min(2, Math.max(1, tr.querySelector('[name="siCode"]').value.split('.').length - 1));
          tr.className = 'lv' + lv;
          tr.dataset.level = lv;
        });
      });
    };
    const nextChildCode = (sec, parentCode) => {
      const nums = readRows(sec).map((r) => r.code).filter((c) => c.startsWith(parentCode + '.') && c.split('.').length === parentCode.split('.').length + 1)
        .map((c) => Number(c.split('.').pop())).filter((x) => !isNaN(x));
      return parentCode + '.' + ((nums.length ? Math.max.apply(null, nums) : 0) + 1);
    };
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add-sub]');
      if (add) {
        const sec = form.querySelector('[data-main="' + add.dataset.addSub + '"]');
        const tbody = sec.querySelector('tbody');
        tbody.insertAdjacentHTML('beforeend', tpl);
        const row = tbody.lastElementChild;
        row.querySelector('[name="siCode"]').value = nextChildCode(sec, mainOf(sec).code);
        row.querySelector('[name="siName"]').focus();
        recalc();
        return;
      }
      const child = e.target.closest('[data-add-child]');
      if (child) {
        const tr = child.closest('tr');
        const sec = tr.closest('[data-main]');
        const pcode = tr.querySelector('[name="siCode"]').value.trim();
        if (!pcode) return;
        // แทรกต่อจากแถวสุดท้ายที่อยู่ใต้ Item นี้
        let after = tr;
        Array.from(sec.querySelectorAll('tbody tr')).forEach((x) => { if (x.querySelector('[name="siCode"]').value.trim().startsWith(pcode + '.')) after = x; });
        after.insertAdjacentHTML('afterend', tpl);
        const row = after.nextElementSibling;
        row.querySelector('[name="siCode"]').value = nextChildCode(sec, pcode);
        row.querySelector('[name="siName"]').focus();
        recalc();
        return;
      }
      if (e.target.matches('[data-remove-sub]')) {
        const tr = e.target.closest('tr');
        const code = tr.querySelector('[name="siCode"]').value.trim();
        const sec = tr.closest('[data-main]');
        const kids = code ? Array.from(sec.querySelectorAll('tbody tr')).filter((x) => x !== tr && x.querySelector('[name="siCode"]').value.trim().startsWith(code + '.')) : [];
        if (kids.some((x) => x.querySelector('.locked'))) { alert('ลบไม่ได้ — มี Item ย่อยใต้ ' + code + ' ที่มีการขอใช้แล้ว'); return; }
        if (kids.length && !confirm('ลบ ' + code + ' พร้อม Item ย่อยข้างใต้อีก ' + kids.length + ' รายการ?')) return;
        kids.forEach((x) => x.remove());
        tr.remove();
        recalc();
      }
    });
    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    guard(form, [{ btn: 'button[type="submit"]', missing: () => errorsNow() }], '.actions');
    recalc();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errors = errorsNow();
      if (errors.length) { showErrors(errors); return; }
      let added = 0;
      let edited = 0;
      let removed = 0;
      const keepIds = new Set(b.items.filter((x) => depth(x) === 0).map((x) => x.id));
      const apply = (target, r) => {
        Object.assign(target, { code: r.code, name: r.name, qty: r.qty, unit: r.unit, amount: r.amount, vat: r.vat, glCode: r.glCode });
        target.glName = target.glName || '';
      };
      sections().forEach((sec) => {
        readRows(sec).forEach((r) => {
          const ex = r.id ? itemById(b, r.id) : null;
          if (ex) { apply(ex, r); edited += 1; keepIds.add(ex.id); } else {
            const it = { id: nextId('i') };
            apply(it, r);
            b.items.push(it);
            keepIds.add(it.id);
            added += 1;
          }
        });
      });
      // ลบ Item ย่อยที่เอาออกจากฟอร์ม (ที่ยังไม่มีการขอใช้)
      const before = b.items.length;
      b.items = b.items.filter((x) => keepIds.has(x.id) || itemInUse(b, x));
      removed = before - b.items.length;
      addHistory(b, 'จัดการ Item ย่อย', 'เพิ่ม ' + added + ' · แก้ไข ' + edited + ' · ลบ ' + removed + ' รายการ (งบรวมไม่เปลี่ยน)', 'งบ ' + b.code);
      save();
      setFlash('success', 'บันทึก Item ย่อยของ ' + b.code + ' แล้ว (เพิ่ม ' + added + ' · แก้ไข ' + edited + ' · ลบ ' + removed + ')');
      go('#/budget/' + b.id);
    });
  }

  // ---------------------------------------------------------------- Plan Cashflow (CAPEX): ประมาณการใช้เงินรายเดือนหลังงบอนุมัติแล้ว

  /** เดือนของปีงบประมาณ: ['2026-01', … '2026-12'] */
  const fyMonths = (b) => Array.from({ length: 12 }, (_, i) => b.fiscalYear + '-' + String(i + 1).padStart(2, '0'));
  /** วาง Plan Cashflow ได้: งบ CAPEX ที่เปิดใช้แล้ว โดย Business เจ้าของงบ หรือผู้คุมงบ */
  const canPlanCashflow = (b) => b.type === 'CAPEX' && isActive(b) && ((actsFor(b) && can('request.create')) || can('budget.manage'));
  const planOf = (b, itemId, ym) => Number(((b.cashflow || {})[itemId] || {})[ym] || 0);
  const planItemTotal = (b, itemId) => round2(Object.values((b.cashflow || {})[itemId] || {}).reduce((s, v) => s + Number(v || 0), 0));
  const hasCashflow = (b) => Object.values(b.cashflow || {}).some((m) => Object.values(m).some((v) => Number(v) > 0));
  /** เดือนปัจจุบัน 'YYYY-MM' */
  const curYm = () => today().slice(0, 7);
  /**
   * ถึงเวลาวาง Plan Cashflow: งบ CAPEX ที่เปิดใช้แล้ว เดือนปัจจุบันอยู่ในปีงบ แต่ยังไม่มีแผนของเดือนนี้เลย (ทุก Item เป็น 0)
   * และยังไม่ได้กด "เดือนนี้ไม่มีแผน" → ขึ้นเป็นงานของ Business เจ้าของงบ (ธุรการเห็นแทน)
   */
  const cashflowDue = (b) => {
    const ym = curYm();
    return b.type === 'CAPEX' && isActive(b) && fyMonths(b).includes(ym) && !ledgerItems(b).some((it) => planOf(b, it.id, ym) > 0) && !(b.cashflowSkip || {})[ym];
  };
  /** งบที่ผู้ใช้ต้องวาง Plan Cashflow เดือนนี้ (เจ้าของงบ / ธุรการ) */
  const cashflowTodo = () => db.budgets.filter((b) => actsFor(b) && can('request.create') && canPlanCashflow(b) && cashflowDue(b));
  function cashflowTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div class="table-wrap"><table><thead><tr><th>งบ</th><th>บริษัท / ปี</th><th class="num">วงเงิน</th><th>เดือนนี้</th><th></th></tr></thead><tbody>' +
      list.map((b) => '<tr><td>' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div class="muted">' + esc(b.name) + '</div></td>' +
        '<td class="nowrap">' + esc(b.company) + ' · ' + esc(b.fiscalYear) + '</td><td class="num">' + money(budgetTotal(b)) + '</td>' +
        '<td class="nowrap">' + esc(monthLabel(curYm())) + '<div class="muted">ยังไม่มีแผน</div></td>' +
        '<td class="num nowrap"><a class="btn small primary" href="#/budget/' + b.id + '/cashflow">วาง Plan Cashflow</a> ' +
        '<button type="button" class="btn small" data-cf-skip="' + b.id + '">เดือนนี้ไม่มีแผน</button></td></tr>').join('') + '</tbody></table></div>';
  }
  function bindCashflowTask() {
    document.querySelectorAll('[data-cf-skip]').forEach((btn) => btn.addEventListener('click', () => {
      const b = budgetById(btn.dataset.cfSkip);
      const ym = curYm();
      if (!b || !canPlanCashflow(b) || !confirm('ยืนยันว่า ' + b.code + ' เดือน ' + monthLabel(ym) + ' ไม่มีแผนใช้เงิน? (งานนี้จะหายไป)')) return;
      b.cashflowSkip = Object.assign({}, b.cashflowSkip, { [ym]: { by: me().id, at: new Date().toISOString() } });
      addHistory(b, 'ยืนยันเดือน ' + monthLabel(ym) + ' ไม่มีแผน Cashflow', '', 'งบ ' + b.code);
      save();
      setFlash('success', 'บันทึกแล้ว — ' + b.code + ' เดือน ' + monthLabel(ym) + ' ไม่มีแผน Cashflow');
      go(location.hash);
    }));
  }
  /** ยอดตัดงบจริงรายเดือนของงบ (แยก Item ได้): ใบที่มีหลาย Item แบ่งตามสัดส่วนยอดของบรรทัด */
  function actualByMonth(b, itemId) {
    const out = {};
    db.requests.forEach((r) => {
      if (r.budgetId !== b.id || !['approved', 'closed'].includes(r.status) || !(r.amount > 0)) return;
      const share = itemId ? linesAmount(r, leafIdsUnder(b, itemById(b, itemId) || { code: '' })) / r.amount : 1;
      if (!share) return;
      (r.cuts || []).forEach((c) => {
        const ym = String(c.date || c.at || '').slice(0, 7);
        if (ym) out[ym] = round2((out[ym] || 0) + Number(c.amount || 0) * share);
      });
    });
    return out;
  }

  /** ตารางสรุป Plan Cashflow ในหน้ารายละเอียดงบ */
  function cashflowSummary(b) {
    const months = fyMonths(b);
    const items = ledgerItems(b);
    const actual = actualByMonth(b);
    const planM = (ym) => round2(items.reduce((s, it) => s + planOf(b, it.id, ym), 0));
    const totalPlan = round2(items.reduce((s, it) => s + planItemTotal(b, it.id), 0));
    const totalActual = round2(months.reduce((s, ym) => s + (actual[ym] || 0), 0));
    return '<div class="table-wrap"><table class="cf-table"><thead><tr><th>เดือน</th>' + months.map((ym) => '<th class="num">' + monthLabel(ym) + '</th>').join('') + '<th class="num">รวม</th></tr></thead><tbody>' +
      '<tr><td class="nowrap">ประมาณการ (Plan)</td>' + months.map((ym) => '<td class="num">' + (planM(ym) ? money(planM(ym)) : '<span class="muted">-</span>') + '</td>').join('') + '<td class="num"><strong>' + money(totalPlan) + '</strong></td></tr>' +
      '<tr><td class="nowrap">ใช้จริง (ตัดงบ)</td>' + months.map((ym) => '<td class="num">' + (actual[ym] ? money(actual[ym]) : '<span class="muted">-</span>') + '</td>').join('') + '<td class="num"><strong>' + money(totalActual) + '</strong></td></tr>' +
      '</tbody></table></div>' +
      '<p class="muted small-note">วางแผนแล้ว ' + money(totalPlan) + ' จากงบ ' + money(budgetTotal(b)) + ' บาท' +
      (round2(budgetTotal(b) - totalPlan) > 0.005 ? ' · ยังไม่ได้วางแผน ' + money(round2(budgetTotal(b) - totalPlan)) + ' บาท' : '') +
      (b.cashflowAt ? ' · ปรับปรุงล่าสุด ' + fmtDate(b.cashflowAt) + ' โดย ' + esc(userName(b.cashflowBy)) : '') + '</p>';
  }

  function viewCashflow(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    if (b.type !== 'CAPEX') return '<div class="alert error">Plan Cashflow ใช้กับงบ CAPEX</div>';
    if (!canPlanCashflow(b)) return '<div class="alert error">วาง Plan Cashflow ได้เมื่องบได้รับอนุมัติและเปิดใช้งบแล้ว โดย Business เจ้าของงบหรือผู้คุมงบ</div>';
    const months = fyMonths(b);
    const items = ledgerItems(b);
    const rows = items.map((it) => '<tr data-item="' + esc(it.id) + '" data-total="' + itemTotal(it) + '"><td class="cf-item"><strong>' + esc(it.code) + '</strong><div class="muted">' + esc(it.name) + '</div>' +
        '<div class="muted">งบ ' + money(itemTotal(it)) + '</div></td>' +
      months.map((ym) => '<td><input name="cf" data-ym="' + ym + '" type="number" min="0" step="0.01" class="right" value="' + (planOf(b, it.id, ym) || '') + '" aria-label="' + esc(it.code + ' ' + monthLabel(ym)) + '"></td>').join('') +
      '<td class="num" data-row-total>0.00</td><td class="num" data-row-left>0.00</td></tr>').join('');
    return '<div class="page-head"><div><h1>Plan Cashflow · ' + esc(b.code) + '</h1><div class="page-sub">' + esc(b.name) +
      ' — ประมาณการว่าแต่ละ Item จะใช้เงินเดือนไหนเท่าไร (รวม VAT) ในปีงบประมาณ ' + esc(b.fiscalYear) + ' · รวมของแต่ละ Item ต้องไม่เกินวงเงินของ Item</div></div></div>' +
      '<div id="formError"></div>' +
      '<form id="cashflowForm" data-id="' + b.id + '"><section class="card form-section">' +
      '<div class="table-wrap"><table class="edit-table cf-edit"><thead><tr><th style="min-width:12rem">Item</th>' +
      months.map((ym) => '<th class="num">' + monthLabel(ym) + '</th>').join('') + '<th class="num">รวมแผน</th><th class="num">ยังไม่วางแผน</th></tr></thead>' +
      '<tbody>' + rows + '</tbody><tfoot><tr><td><strong>รวมทุก Item</strong></td>' + months.map((ym) => '<td class="num" data-col="' + ym + '">0.00</td>').join('') +
      '<td class="num" data-sum>0.00</td><td class="num" data-left>0.00</td></tr></tfoot></table></div>' +
      '<div class="actions"><button type="button" class="btn small" data-spread title="แบ่งยอดที่ยังไม่วางแผนของแต่ละ Item เท่า ๆ กันในเดือนที่เหลือของปี">เกลี่ยยอดที่เหลือเท่า ๆ กัน</button>' +
      '<button type="button" class="btn small" data-clear>ล้างทั้งหมด</button></div></section>' +
      '<div class="actions"><button class="btn primary" type="submit">บันทึก Plan Cashflow</button><a class="btn" data-back href="#/budget/' + b.id + '">ยกเลิก</a></div></form>';
  }

  function bindCashflow() {
    const form = document.getElementById('cashflowForm');
    if (!form) return;
    const b = budgetById(form.dataset.id);
    const months = fyMonths(b);
    const rows = () => Array.from(form.querySelectorAll('tbody tr'));
    const rowSum = (tr) => round2(Array.from(tr.querySelectorAll('[name="cf"]')).reduce((s, i) => s + Number(i.value || 0), 0));
    const over = () => rows().filter((tr) => rowSum(tr) > Number(tr.dataset.total) + 0.005).map((tr) => tr.querySelector('strong').textContent);
    const recalc = () => {
      let sum = 0;
      let left = 0;
      rows().forEach((tr) => {
        const s = rowSum(tr);
        const l = round2(Number(tr.dataset.total) - s);
        sum += s;
        left += l;
        tr.querySelector('[data-row-total]').textContent = money(s);
        const lc = tr.querySelector('[data-row-left]');
        lc.innerHTML = moneyCell(l);
      });
      months.forEach((ym) => {
        const v = round2(Array.from(form.querySelectorAll('[name="cf"][data-ym="' + ym + '"]')).reduce((s, i) => s + Number(i.value || 0), 0));
        form.querySelector('[data-col="' + ym + '"]').textContent = money(v);
      });
      form.querySelector('[data-sum]').textContent = money(sum);
      form.querySelector('[data-left]').innerHTML = moneyCell(round2(left));
    };
    form.addEventListener('input', recalc);
    form.addEventListener('click', (e) => {
      if (e.target.matches('[data-clear]')) {
        form.querySelectorAll('[name="cf"]').forEach((i) => { i.value = ''; });
        recalc();
      }
      if (e.target.matches('[data-spread]')) {
        // เดือนที่เหลือของปี (ถ้าปีงบผ่านไปแล้ว/ยังไม่ถึง ใช้ทั้ง 12 เดือน)
        const now = new Date().toISOString().slice(0, 7);
        const rest = months.filter((ym) => ym >= now);
        const use = rest.length ? rest : months;
        rows().forEach((tr) => {
          const left = round2(Number(tr.dataset.total) - rowSum(tr));
          if (left <= 0) return;
          const per = Math.floor((left / use.length) * 100) / 100;
          use.forEach((ym, i) => {
            const inp = tr.querySelector('[name="cf"][data-ym="' + ym + '"]');
            const add = i === use.length - 1 ? round2(left - per * (use.length - 1)) : per;
            inp.value = round2(Number(inp.value || 0) + add) || '';
          });
        });
        recalc();
      }
    });
    guard(form, [{ btn: 'button[type="submit"]', missing: () => over().map((c) => 'แผนของ ' + c + ' เกินวงเงิน Item') }]);
    recalc();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const bad = over();
      if (bad.length) { showErrors(bad.map((c) => 'แผนของ ' + c + ' เกินวงเงิน Item')); return; }
      const plan = {};
      rows().forEach((tr) => {
        const m = {};
        tr.querySelectorAll('[name="cf"]').forEach((i) => { const v = round2(i.value); if (v > 0) m[i.dataset.ym] = v; });
        if (Object.keys(m).length) plan[tr.dataset.item] = m;
      });
      const first = !hasCashflow(b);
      b.cashflow = plan;
      b.cashflowAt = new Date().toISOString();
      b.cashflowBy = me().id;
      const total = round2(Object.values(plan).reduce((s, m) => s + Object.values(m).reduce((x, v) => x + v, 0), 0));
      addHistory(b, first ? 'วาง Plan Cashflow' : 'ปรับ Plan Cashflow', 'รวมแผน ' + money(total) + ' จากงบ ' + money(budgetTotal(b)) + ' บาท', 'งบ ' + b.code);
      save();
      setFlash('success', 'บันทึก Plan Cashflow ของ ' + b.code + ' แล้ว');
      go('#/budget/' + b.id);
    });
  }

  // ---------------------------------------------------------------- ส่งออกข้อมูลการเงิน / บัญชี เป็นไฟล์ Excel (.xlsx) — เขียนไฟล์เองในเบราว์เซอร์ ไม่ใช้ไลบรารีภายนอก

  /** สร้างไฟล์ .xlsx จาก [{ name, cols: [{ h, w, num }], rows: [[...]] }] คืน Uint8Array */
  function buildXlsx(sheets) {
    const enc = new TextEncoder();
    const xmlEsc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const cell = (ref, v, num, style) => {
      if (v === null || v === undefined || v === '') return '';
      if (num && typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="1"><v>' + v + '</v></c>';
      return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    };
    /** เซลล์ของแผ่นงานแบบกริด: ค่าธรรมดา หรือ { v, s: สไตล์, f: สูตร }  สไตล์: m เงิน · h หัวตารางอ่อน · H หัวตารางเข้ม · t ชื่อเรื่อง · b ตัวหนา · B ตัวหนา+เงิน */
    const STY = { m: 1, h: 2, H: 3, t: 4, b: 5, B: 6 };
    const cellG = (ref, spec) => {
      if (spec === null || spec === undefined || spec === '') return '';
      let v = spec;
      let sid = 0;
      let f = '';
      if (typeof spec === 'object') { v = spec.v; sid = STY[spec.s] || 0; f = spec.f || ''; }
      const sa = sid ? ' s="' + sid + '"' : '';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + sa + '>' + (f ? '<f>' + xmlEsc(f) + '</f>' : '') + '<v>' + v + '</v></c>';
      if (v === null || v === undefined || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"' + sa + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
    };
    const gridXml = (sh) => {
      const fr = sh.freeze;
      const pane = fr ? '<pane' + (fr.x ? ' xSplit="' + fr.x + '"' : '') + ' ySplit="' + fr.y + '" topLeftCell="' + colName(fr.x || 0) + (fr.y + 1) + '" activePane="' + (fr.x ? 'bottomRight' : 'bottomLeft') + '" state="frozen"/>' : '';
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">' + pane + '</sheetView></sheetViews>' +
        '<cols>' + (sh.widths || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
        '<sheetData>' + sh.grid.map((row, ri) => {
          const cells = row.map((spec, ci) => cellG(colName(ci) + (ri + 1), spec)).join('');
          return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
        }).join('') + '</sheetData>' + (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '') + '</worksheet>';
    };
    const filterOf = (sh) => (sh.grid ? sh.filter || '' : (sh.rows.length ? 'A1:' + colName(sh.cols.length - 1) + (sh.rows.length + 1) : ''));
    const absRef = (r) => r.replace(/([A-Z]+)(\d+)/g, (m, c, n) => '$' + c + '$' + n);
    const sheetXml = (sh) => {
      if (sh.grid) return gridXml(sh);
      const last = colName(Math.max(sh.cols.length - 1, 0)) + (sh.rows.length + 1);
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
        '<cols>' + sh.cols.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 14) + '" customWidth="1"/>').join('') + '</cols>' +
        '<sheetData><row r="1">' + sh.cols.map((c, i) => cell(colName(i) + '1', c.h, false, 2)).join('') + '</row>' +
        sh.rows.map((r, ri) => '<row r="' + (ri + 2) + '">' + r.map((v, ci) => cell(colName(ci) + (ri + 2), v, sh.cols[ci] && sh.cols[ci].num)).join('') + '</row>').join('') +
        '</sheetData>' + (sh.rows.length ? '<autoFilter ref="A1:' + last + '"/>' : '') + '</worksheet>';
    };
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
        (sheets.some((s) => filterOf(s)) ? '<definedNames>' + sheets.map((s, i) => filterOf(s) ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + xmlEsc(s.name.slice(0, 31)) + '\'!' + absRef(filterOf(s)) + '</definedName>' : '').join('') + '</definedNames>' : '') +
        '</workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
        '<fonts count="4"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font>' +
        '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="14"/><name val="Tahoma"/></font></fonts>' +
        '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>']
    ].concat(sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)]));
    // ZIP แบบไม่บีบอัด (stored)
    const crcTable = buildXlsx.crc || (buildXlsx.crc = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
    const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const parts = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(([name, text]) => {
      const nameB = enc.encode(name);
      const data = enc.encode(text);
      const crc = crc32(data);
      const head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
      parts.push(new Uint8Array(head), nameB, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length),
        u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nameB);
      offset += head.length + nameB.length + data.length;
    });
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    const all = parts.concat(central, [end]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    all.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }


  // ---------------------------------------------------------------- รูปแบบไฟล์ Capex / Opex Governance Framework (ใช้ทั้ง Export และไฟล์ตัวอย่าง Import)

  /** สถานะอนุมัติของงบ ตามคอลัมน์ "สถานะอนุมัติ" ในไฟล์ */
  const govStatus = (b) => {
    const st = b.state || 'active';
    if (st === 'cancelled') return 'ยกเลิก';
    return ['active', 'pending_open', 'open_review', 'open_returned'].includes(st) ? 'อนุมัติแล้ว' : 'รออนุมัติ';
  };
  const GOV_HEAD_CAPEX = ['Capex ID', 'ชื่อโครงการ', 'หน่วยงานที่ขอ', 'กลุ่ม Priority', 'กลุ่ม Priority การลงทุน\n(กลุ่มการลงทุน New)', 'เหตุผลสนับสนุน Priority (ย่อ)',
    'มูลค่า Capex รวม (บาท)', 'เฉลี่ยปีที่ลงทุน', 'Owner \n(หลัก 1 คน)', 'เจ้าของฝ่ายการเงิน \n(ติดตามร่วม)', 'สถานะอนุมัติ'];
  const GOV_HEAD_OPEX = ['Opex ID', 'ชื่อรายการ/โครงการ', 'หน่วยงานที่ขอ', 'กลุ่ม Priority', 'เหตุผลสนับสนุน Priority (ย่อ)', 'มูลค่ารวมที่ขออนุมัติ (บาท)',
    'ปีงบประมาณ', 'เจ้าของ Action Plan (หน่วยงาน)', 'เจ้าของฝ่ายการเงิน (ติดตามร่วม)', 'สถานะอนุมัติ'];
  const GOV_HEAD_SUMMARY = ['กลุ่มรายการ', 'ID', 'หน่วยงานที่ขอ', 'ชื่อรายการ/โครงการ', 'มูลค่า', 'ประเภทงบประมาณ'];
  const GOV_NO_GROUP = '(ไม่ระบุกลุ่ม)';

  /** ระเบียนกลางของแต่ละงบสำหรับเขียนลงไฟล์ */
  const govRec = (b) => ({
    type: b.type, code: b.code, name: b.name, dept: b.department || '', prio: b.priorityGroup || '', invest: b.investGroup || '', reason: b.priorityReason || '',
    total: budgetTotal(b), year: b.fiscalYear, owner: ownerText(b), fin: b.financeOwner || '', status: govStatus(b), group: b.listGroup || ''
  });

  /** แผ่น Capex Request / Opex Request: แถว 1 ชื่อเรื่อง · แถว 2 คำอธิบาย + ยอดรวม (SUBTOTAL) · แถว 3 หัวตาราง · แถว 4 เป็นต้นไป ข้อมูล */
  function govListSheet(kind, co, recs, subtitle) {
    const capex = kind === 'CAPEX';
    const head = capex ? GOV_HEAD_CAPEX : GOV_HEAD_OPEX;
    const n = recs.length;
    const totalCol = 6; // G (CAPEX) / F (OPEX)
    const tc = capex ? 'G' : 'F';
    const total = round2(recs.reduce((x, r) => x + r.total, 0));
    const title = [{ v: capex ? 'CAPEX REQUEST & FINANCIAL STATEMENT LINKAGE' : 'OPEX REQUEST & FINANCIAL STATEMENT LINKAGE', s: 't' }];
    const sub = [subtitle];
    const tcIdx = capex ? 6 : 5;
    while (sub.length < tcIdx) sub.push(null);
    sub.push({ v: total, f: 'SUBTOTAL(9,' + tc + '4:' + tc + (3 + n) + ')', s: 'B' });
    const grid = [title, sub, head.map((h) => ({ v: h, s: 'H' }))];
    recs.forEach((r) => grid.push(capex
      ? [r.code, r.name, r.dept, r.prio, r.invest, r.reason, { v: r.total, s: 'm' }, r.year, r.owner, r.fin, r.status]
      : [r.code, r.name, r.dept, r.prio, r.reason, { v: r.total, s: 'm' }, r.year, r.owner, r.fin, r.status]));
    return {
      name: co + (capex ? ' Capex Request' : ' Opex Request'), grid, gov: true, kind: capex ? 'capex' : 'opex', count: n,
      widths: capex ? [22, 41, 14, 27, 30, 43, 19, 15, 16, 18, 14] : [18, 39, 14, 24, 41, 19, 12, 22, 22, 14],
      freeze: { x: 3, y: 3 }, filter: 'A3:' + colName(head.length - 1) + (3 + Math.max(n, 1)), totalCol
    };
  }
  const colName = (i) => { let t = ''; let k = i + 1; while (k > 0) { const m = (k - 1) % 26; t = String.fromCharCode(65 + m) + t; k = Math.floor((k - 1) / 26); } return t; };

  /** แผ่น "สรุปโปรเจ็ค": ตารางรายโครงการจัดกลุ่มตามกลุ่มรายการ (คอลัมน์ B–G) + ตารางสรุปหน่วยงาน × CAPEX / OPEX (คอลัมน์ J–N เป็นค่าคงที่ ไม่ใช่ Pivot Table) */
  function govSummarySheet(co, recs, subtitle) {
    const grpOf = (r) => r.group || GOV_NO_GROUP;
    const sorted = recs.slice().sort((x, y) => (grpOf(x) === GOV_NO_GROUP) - (grpOf(y) === GOV_NO_GROUP) || grpOf(x).localeCompare(grpOf(y), 'th', { numeric: true }) || String(x.code).localeCompare(String(y.code), 'th', { numeric: true }));
    const years = uniq(recs.map((r) => r.year)).sort().join(', ');
    const rows = [];
    rows[0] = [null, { v: 'List โครงการ ' + co + (years ? ' ' + years : ''), s: 't' }];
    rows[1] = [null, subtitle];
    rows[3] = [null].concat(GOV_HEAD_SUMMARY.map((h) => ({ v: h, s: 'H' })));
    const row = (i) => { if (!rows[i]) rows[i] = []; return rows[i]; };
    sorted.forEach((r, k) => {
      const t = row(4 + k);
      t[1] = grpOf(r); t[2] = r.code; t[3] = r.dept; t[4] = r.name; t[5] = { v: r.total, s: 'm' }; t[6] = T_GOV(r.type);
    });
    // ตารางสรุป
    const put = (i, c, v) => { row(i)[c] = v; };
    put(3, 9, { v: 'Sum of มูลค่า', s: 'H' }); put(3, 10, { v: '', s: 'H' }); put(3, 11, { v: 'Column Labels', s: 'H' }); put(3, 12, { v: '', s: 'H' }); put(3, 13, { v: '', s: 'H' });
    ['Row Labels', 'หน่วยงานที่ขอ', 'CAPEX', 'OPEX', 'Grand Total'].forEach((h, k) => put(4, 9 + k, { v: h, s: 'H' }));
    let pr = 5;
    const sum = (list, t) => round2(list.filter((r) => !t || r.type === t).reduce((x, r) => x + r.total, 0));
    uniq(sorted.map(grpOf)).forEach((g) => {
      const inG = sorted.filter((r) => grpOf(r) === g);
      uniq(inG.map((r) => r.dept || '(ไม่ระบุ)')).sort().forEach((d, k) => {
        const inD = inG.filter((r) => (r.dept || '(ไม่ระบุ)') === d);
        if (k === 0) put(pr, 9, g);
        put(pr, 10, d); put(pr, 11, { v: sum(inD, 'CAPEX'), s: 'm' }); put(pr, 12, { v: sum(inD, 'CBS'), s: 'm' }); put(pr, 13, { v: sum(inD), s: 'm' });
        pr += 1;
      });
      put(pr, 9, { v: g + ' Total', s: 'b' }); put(pr, 11, { v: sum(inG, 'CAPEX'), s: 'B' }); put(pr, 12, { v: sum(inG, 'CBS'), s: 'B' }); put(pr, 13, { v: sum(inG), s: 'B' });
      pr += 1;
    });
    put(pr, 9, { v: 'Grand Total', s: 'b' }); put(pr, 11, { v: sum(sorted, 'CAPEX'), s: 'B' }); put(pr, 12, { v: sum(sorted, 'CBS'), s: 'B' }); put(pr, 13, { v: sum(sorted), s: 'B' });
    const grid = [];
    for (let i = 0; i < rows.length; i++) grid.push(rows[i] || []);
    return {
      name: co + ' สรุปโปรเจ็ค', grid, gov: true, kind: 'summary', count: sorted.length,
      widths: [4, 28, 18, 14, 60, 17, 16, 4, 4, 30, 16, 16, 14, 16], freeze: { x: 0, y: 4 }, filter: 'B4:G' + (4 + Math.max(sorted.length, 1))
    };
  }
  const T_GOV = (t) => (t === 'CAPEX' ? 'CAPEX' : 'OPEX');

  /** แผ่นงาน Governance จากระเบียนที่จัดตามบริษัท { บริษัท: [govRec] } : สรุปโปรเจ็ค · Capex Request · Opex Request */
  function govSheetsOf(byCo, subtitle) {
    const out = [];
    Object.keys(byCo).sort().forEach((co) => {
      const mine = byCo[co];
      out.push(govSummarySheet(co, mine, subtitle));
      const caps = mine.filter((r) => r.type === 'CAPEX');
      const ops = mine.filter((r) => r.type === 'CBS');
      if (caps.length) out.push(govListSheet('CAPEX', co, caps, 'รายการคำขอ CAPEX · ' + subtitle));
      if (ops.length) out.push(govListSheet('OPEX', co, ops, 'รายการคำขอ OPEX · ' + subtitle));
    });
    return out;
  }
  /** แผ่นงาน Governance ของงบทั้งหมด แยกตามบริษัท */
  function govSheets(budgets) {
    const byCo = {};
    budgets.slice().sort((x, y) => String(x.code).localeCompare(String(y.code), 'th', { numeric: true })).forEach((b) => { (byCo[b.company] = byCo[b.company] || []).push(govRec(b)); });
    return govSheetsOf(byCo, 'ส่งออกจากระบบขอเบิกใช้งบประมาณ ณ ' + new Date().toISOString().slice(0, 10) + ' · สถานะอนุมัติคำนวณจากสถานะงบในระบบ');
  }

  // ---------------------------------------------------------------- Import รูปแบบ Governance (ไฟล์ Capex / Opex Governance Framework)

  const normTxt = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const GOV_APPROVED = 'อนุมัติแล้ว';

  /** ไฟล์ตัวอย่างรูปแบบ Governance (ข้อมูลสมมติทั้งหมด) */
  function govTemplate() {
    const co = (db.master.companies[0] || {}).code || 'PBI';
    const y = new Date().getFullYear() + 1;
    const dept = (db.master.departments[0] || {}).name || 'ฝ่ายตัวอย่าง';
    const owner = (USERS.filter(canRequestUser)[0] || {}).name || 'ชื่อ นามสกุล';
    const pg = (db.master.priorityGroups || []).map((x) => x.name);
    const rec = (type, n, name, total, group, prio, invest) => ({ type, code: (type === 'CAPEX' ? 'CX-' : 'OX-') + y + '-' + String(n).padStart(3, '0'), name, dept, prio: prio || pg[0] || '', invest: invest || '', reason: 'ตัวอย่างเหตุผลสนับสนุน',
      total, year: y, owner, fin: 'ชื่อ นามสกุล (การเงิน)', status: GOV_APPROVED, group });
    const recs = [
      rec('CAPEX', 1, 'ตัวอย่าง: เครื่องจักรสายการผลิตใหม่', 1800000, 'กลุ่มรายการ ก', pg[0], 'กลุ่มการลงทุน ก'),
      rec('CAPEX', 2, 'ตัวอย่าง: ปรับปรุงอาคารคลังสินค้า', 500000, 'กลุ่มรายการ ข', pg[1], 'กลุ่มการลงทุน ข'),
      rec('CBS', 1, 'ตัวอย่าง: ค่าใช้จ่ายดำเนินงานประจำปี', 240000, 'กลุ่มรายการ ก', pg[3])
    ];
    const guide = [
      ['รูปแบบเดียวกับไฟล์ Capex / Opex Governance Framework และไฟล์ที่ระบบ Export (เลือก "รูปแบบไฟล์ Governance")'],
      ['ไม่ต้องระบุบริษัทในไฟล์ — เลือกบริษัทที่หน้า Import ก่อนเลือกไฟล์ ทุกงบในไฟล์จะเป็นบริษัทที่เลือก · ชื่อแผ่นงานอะไรก็ได้ (ระบบหาแผ่นรายการจากหัวตาราง "Capex ID" / "Opex ID")'],
      ['หัวตารางอยู่แถวที่ 3 ข้อมูลเริ่มแถวที่ 4 (ระบบหาแถวหัวตารางจาก "Capex ID" / "Opex ID" ให้เอง) · แถวที่ไม่มี ID (เช่น แถวรวม) จะถูกข้าม'],
      ['นำเข้าเฉพาะแถวที่ "สถานะอนุมัติ" = "' + GOV_APPROVED + '" · แถวอื่นถูกข้าม และแจ้งในหน้าตรวจข้อมูล'],
      ['แผ่น "สรุปโปรเจ็ค" (ถ้ามี) ใช้อ่าน "กลุ่มรายการ" ของแต่ละ ID · ตาราง Pivot ด้านขวาไม่ถูกนำเข้า'],
      ['มูลค่า = วงเงินรวมต่อโครงการ (ไม่แยก Item) · CAPEX นำเข้าเป็น "งบรวมทั้งโครงการ" · OPEX ก็นำเข้าเป็น "งบรวมทั้งโครงการ" เช่นกัน (ไม่มีรายละเอียด Item)'],
      ['Owner / ชื่อเจ้าของ: ถ้าตรงกับชื่อผู้ใช้ในระบบจะผูกให้อัตโนมัติ ถ้าไม่ตรงจะเก็บเป็นชื่อตามไฟล์ แล้วผู้คุมงบเลือกผู้ใช้ที่หน้าแก้ไขงบ'],
      ['หลัง Import งบอยู่สถานะ "ยังไม่เปิดใช้งบ" — Business ขอดำเนินการใช้งบ (CAPEX: ผู้คุมงบยืนยัน · OPEX: เปิดใช้ทันที)']
    ];
    return buildXlsx(govSheetsOf({ [co]: recs }, 'ไฟล์ตัวอย่าง (ข้อมูลสมมติ)').concat([{ name: 'คำอธิบาย', cols: [{ h: 'วิธีกรอก', w: 130 }], rows: guide }]));
  }

  /**
   * อ่านไฟล์รูปแบบ Governance → { budgets, skipped, notes } · คืน null ถ้าไฟล์นี้ไม่ใช่รูปแบบ Governance
   * sheets = [{ name, rows }]
   */
  function govImport(sheets, company) {
    const headOf = (sh, test) => {
      for (let i = 0; i < Math.min(sh.rows.length, 12); i++) {
        const h = (sh.rows[i] || []).map(normTxt);
        const r = test(h);
        if (r) return { i, h, r };
      }
      return null;
    };
    const lists = [];
    const summaries = [];
    sheets.forEach((sh) => {
      const l = headOf(sh, (h) => (h.includes('capexid') ? 'CAPEX' : h.includes('opexid') ? 'CBS' : ''));
      if (l) { lists.push({ sh, i: l.i, h: l.h, type: l.r }); return; }
      const sm = headOf(sh, (h) => h.includes('กลุ่มรายการ') && h.includes('id'));
      if (sm) summaries.push({ sh, i: sm.i, h: sm.h });
    });
    if (!lists.length) return null;
    const groupOf = {};
    summaries.forEach(({ sh, i, h }) => {
      const gi = h.indexOf('กลุ่มรายการ');
      const ii = h.indexOf('id');
      sh.rows.slice(i + 1).forEach((r) => {
        const id = String(r[ii] == null ? '' : r[ii]).trim();
        const g = String(r[gi] == null ? '' : r[gi]).trim();
        if (id && g && g !== GOV_NO_GROUP && !(id in groupOf)) groupOf[id] = g;
      });
    });
    const owners = USERS.filter(canRequestUser);
    const findOwner = (v) => (normTxt(v) ? owners.find((x) => [x.id, x.name, x.email].filter(Boolean).map(normTxt).includes(normTxt(v))) : null);
    const num = (v) => (typeof v === 'number' ? v : Number(String(v).replace(/[,\s฿]/g, '')));
    const asYear = (v) => {
      const m = String(v == null ? '' : v).match(/(\d{4})/);
      if (!m) return 0;
      const y = Number(m[1]);
      return y >= 2400 ? y - 543 : y;
    };
    const budgets = [];
    const skipped = [];
    const notes = [];
    const seen = new Set();
    const newDepts = new Set();
    lists.forEach(({ sh, i, h, type }) => {
      const col = (test) => h.findIndex((x) => x && test(x));
      const ix = {
        id: col((x) => x === 'capexid' || x === 'opexid'), name: col((x) => x.startsWith('ชื่อโครงการ') || x.startsWith('ชื่อรายการ')),
        dept: col((x) => x.startsWith('หน่วยงานที่ขอ')), prio: col((x) => x === 'กลุ่มpriority'), invest: col((x) => x.startsWith('กลุ่มpriorityการลงทุน')),
        reason: col((x) => x.startsWith('เหตุผลสนับสนุน')), amount: col((x) => x.startsWith('มูลค่า')), year: col((x) => x.startsWith('เฉลี่ยปี') || x === 'ปีงบประมาณ'),
        owner: col((x) => x.startsWith('owner') || x.startsWith('เจ้าของactionplan')), fin: col((x) => x.startsWith('เจ้าของฝ่ายการเงิน')), status: col((x) => x.startsWith('สถานะอนุมัติ'))
      };
      // ชื่อแผ่นงานที่ขึ้นต้นด้วยรหัสบริษัทอื่น (เช่น ไฟล์ที่ระบบ Export) — ใช้บริษัทที่เลือกไว้เสมอ แต่แจ้งเตือน
      const m = String(sh.name).match(/^(.*?)\s*(capex|opex)\s*request/i);
      const prefix = m ? m[1].trim() : '';
      if (prefix && normTxt(prefix) !== normTxt(company)) notes.push('แผ่น "' + sh.name + '" ระบุบริษัท ' + prefix + ' — นำเข้าเป็นบริษัท ' + company + ' ตามที่เลือก');
      const get = (r, k) => (ix[k] >= 0 && r[ix[k]] !== undefined && r[ix[k]] !== null ? String(r[ix[k]]).trim() : '');
      sh.rows.slice(i + 1).forEach((r, k) => {
        const line = i + k + 2;
        const code = get(r, 'id');
        const name = get(r, 'name');
        if (!code && !name) return;
        const errors = [];
        const warnings = [];
        if (!code) errors.push('แถว ' + line + ' ไม่มี ID');
        if (ix.status >= 0 && normTxt(get(r, 'status')) !== normTxt(GOV_APPROVED)) {
          skipped.push({ sheet: sh.name, line, code, status: get(r, 'status') });
          return;
        }
        if (!name) errors.push('ไม่ได้ระบุชื่อโครงการ');
        const amount = round2(num(get(r, 'amount')));
        if (!(amount > 0)) errors.push('มูลค่าต้องมากกว่า 0 (ถ้าเป็นสูตร ให้เปิดไฟล์ใน Excel แล้วบันทึกอีกครั้ง เพื่อให้มีค่าที่คำนวณแล้ว)');
        if (code) {
          if (seen.has(code)) errors.push('ID "' + code + '" ซ้ำในไฟล์'); else seen.add(code);
          if (db.budgets.some((b) => b.code === code && b.state !== 'cancelled')) errors.push('ID "' + code + '" มีอยู่แล้วในระบบ');
        }
        const dept = get(r, 'dept');
        if (!dept) warnings.push('ไม่ได้ระบุหน่วยงานที่ขอ');
        else if (!db.master.departments.some((d) => d.name === dept)) newDepts.add(dept);
        const ownerRaw = get(r, 'owner');
        const owner = findOwner(ownerRaw);
        if (!ownerRaw) warnings.push('ไม่ได้ระบุ Owner');
        else if (!owner) warnings.push('ยังไม่พบผู้ใช้ชื่อ "' + ownerRaw + '" ในระบบ — เก็บเป็นชื่อตามไฟล์ (ผู้คุมงบผูกกับผู้ใช้ได้ที่หน้าแก้ไขงบ)');
        const fy = asYear(get(r, 'year'));
        if (!fy) warnings.push('ไม่พบปีงบประมาณ — ใช้ปี ' + (new Date().getFullYear() + 1));
        const item = Object.assign({ id: '', code: code || '-', name: 'งบรวมทั้งโครงการ', amount, vat: 0, qty: '', unit: '', glCode: '', glName: '' },
          {});
        const data = {
          type, code, name, company, fiscalYear: fy || new Date().getFullYear() + 1, department: dept,
          ownerId: owner ? owner.id : '', ownerName: owner ? '' : ownerRaw, structure: 'project', note: '', items: [item],
          listGroup: groupOf[code] || '', priorityGroup: get(r, 'prio'), investGroup: type === 'CAPEX' ? get(r, 'invest') : '',
          priorityReason: get(r, 'reason'), financeOwner: get(r, 'fin'), meeting: { date: '', no: '', note: '', by: '' }
        };
        budgets.push({ data, errors, warnings, lines: 1, sheet: sh.name });
      });
    });
    if (newDepts.size) notes.push('หน่วยงานที่ยังไม่มีในข้อมูลหลัก (จะเพิ่มให้อัตโนมัติ): ' + Array.from(newDepts).join(', '));
    return { kind: 'gov', budgets, skipped, notes, sheets: lists.length };
  }

  const EXPORT_SHEETS = [
    ['gov', 'รูปแบบไฟล์ Governance', 'เหมือนไฟล์ Capex / Opex Governance Framework: แยกตามบริษัท ได้ แผ่น "สรุปโปรเจ็ค", "Capex Request", "Opex Request" — นำกลับเข้าระบบด้วย Import ได้'],
    ['budgets', 'งบประมาณ', 'สรุปรายงบ: งบอนุมัติ ตัดงบแล้ว จองไว้ คงเหลือ'],
    ['items', 'Item', 'รายการ Item ของแต่ละงบ พร้อม GL และยอดคงเหลือ'],
    ['requests', 'เบิกใช้งบ', 'คำขอ / ใบเบิกใช้งบ: เลขที่ ประเภท สถานะ ยอดเงิน ยอดตัดงบ ปิดยอด'],
    ['lines', 'รายการในใบ', 'บรรทัดในใบเบิกใช้งบ: Item / หมวด / GL / บริษัทที่ลงทุน / ยอดเงิน'],
    ['cuts', 'ตัดงบ-จ่ายเงิน', 'การตัดงบ: PO / เคลียร์เงินทดรอง / จ่ายคืนพนักงาน / จ่าย Supplier'],
    ['changes', 'ปรับงบ', 'ขอเพิ่มงบ (INC) โยกงบ (TRF) ลดงบ (DEC)'],
    ['cashflow', 'Plan Cashflow', 'แผนการใช้เงินรายเดือนของ CAPEX เทียบยอดตัดงบจริง']
  ];
  const canExport = () => can('data.export');

  function exportData(f) {
    const inB = (b) => b && (!f.year || String(b.fiscalYear) === f.year) && (!f.company || b.company === f.company) && (!f.type || b.type === f.type);
    const budgets = db.budgets.filter((b) => inB(b) && budgetScoped(b));
    const bIds = new Set(budgets.map((b) => b.id));
    const reqs = db.requests.filter((r) => bIds.has(r.budgetId));
    const day = (v) => (v ? String(v).slice(0, 10) : '');
    const T = (t) => TYPE_SHORT[t] || t;
    const sheets = [];
    if (f.sheets.includes('gov')) govSheets(budgets).forEach((g) => sheets.push(g));
    const add = (key, cols, rows) => { if (f.sheets.includes(key)) sheets.push({ name: EXPORT_SHEETS.find((x) => x[0] === key)[1], cols, rows }); };
    const N = (h, w) => ({ h, w: w || 15, num: true });
    const S = (h, w) => ({ h, w: w || 14 });

    add('budgets', [S('บริษัท', 8), S('ประเภทงบ', 9), S('ปีงบประมาณ', 10), S('รหัสโครงการ'), S('ชื่อโครงการ', 34), S('หน่วยงาน', 16), S('Business เจ้าของงบ', 18),
      S('สถานะ', 12), S('โครงสร้าง', 14), S('เลขที่มติ / อนุมัติ', 22), S('วันที่อนุมัติ', 12), N('งบอนุมัติ (รวม VAT)', 17), N('ตัดงบแล้ว'), N('จองไว้'), N('คงเหลือ')],
    budgets.map((b) => { const u = usage(b); return [b.company, T(b.type), b.fiscalYear, b.code, b.name, b.department, ownerText(b), BUDGET_STATE[b.state || 'active'] || '',
      b.structure === 'project' ? 'งบรวมทั้งโครงการ' : 'แยก Item', (b.meeting || {}).no || '', day((b.meeting || {}).date), budgetTotal(b), u.used, u.reserved, u.remaining]; }));

    const itemRows = [];
    budgets.forEach((b) => sortedItems(b).forEach((it) => {
      const own = b.type !== 'CBS' || hasOwnBudget(b, it);
      const u = own ? usage(b, it.id) : null;
      itemRows.push([b.company, T(b.type), b.code, it.code, it.name, b.type === 'CBS' ? depth(it) + 1 : 1, itemGl(b, it).code, itemGl(b, it).name,
        it.qty === '' || it.qty == null ? '' : Number(it.qty), it.unit || '', own ? round2(Number(it.amount || 0)) : '', own ? round2(Number(it.vat || 0)) : '', own ? itemTotal(it) : '',
        u ? u.used : '', u ? u.reserved : '', u ? u.remaining : '', own ? '' : 'ใช้วงเงิน Item ' + (budgetNodeOf(b, it) || {}).code]);
    }));
    add('items', [S('บริษัท', 8), S('ประเภทงบ', 9), S('รหัสโครงการ'), S('รหัส Item', 16), S('ชื่อรายการ', 32), { h: 'ระดับ', w: 7, num: true },
      S('GL Code', 10), S('GL Name', 20), { h: 'จำนวน', w: 9, num: true }, S('หน่วย', 8), N('ก่อน VAT'), N('VAT'), N('งบ (รวม VAT)'), N('ตัดงบแล้ว'), N('จองไว้'), N('คงเหลือ'), S('หมายเหตุ', 20)], itemRows);

    add('requests', [S('เลขที่คำขอ', 15), S('เลขที่เอกสาร', 16), S('เลขที่ Memo', 16), S('บริษัท', 8), S('ประเภทงบ', 9), S('รหัสโครงการ'), S('ประเภทการใช้งบ', 22), S('สถานะ', 20),
      S('ผู้ขอ', 16), S('วันที่ขอ', 11), S('วันที่ส่งมอบ/วางบิล', 13), S('วันที่กำหนดจ่ายเงิน', 13), S('วันที่อนุมัติ', 11), S('วัตถุประสงค์', 34), S('Supplier / ผู้รับเงิน', 22), S('PO No.', 14), N('ก่อน VAT'), N('VAT'), N('รวม'),
      N('ตัดงบแล้ว'), N('ปิดยอด: ใช้จริง'), N('ปิดยอด: คืนงบ'), S('วันที่ปิดยอด', 11), S('Note ผู้คุมงบ', 24)],
    reqs.map((r) => { const b = budgetById(r.budgetId); return [r.no, r.docNo || '', (r.memo || {}).no || '', b.company, T(r.type), b.code, (USE_TYPES[r.useType] || {}).label || '', STATUS_LABEL[r.status] || r.status,
      userName(r.requesterId), day(r.createdAt), r.deliveryDate || '', r.payDueDate || '', day(r.approvedAt), r.purpose || '', r.payee || '', r.poNo && r.poNo !== 'N/A' ? r.poNo : '', r.amountBeforeVat, r.vat, r.amount,
      cutTotal(r), r.closed ? r.closed.actual : '', r.closed ? r.closed.returned : '', r.closed ? day(r.closed.at) : '', r.approverNote || '']; }));

    const lineRows = [];
    reqs.forEach((r) => { const b = budgetById(r.budgetId); r.lines.forEach((l, i) => { const it = itemById(b, l.itemId) || {};
      lineRows.push([r.no, r.docNo || '', b.code, i + 1, b.structure === 'project' ? '' : it.code || '', b.structure === 'project' ? '' : it.name || '', l.category || '', lineGl(b, l).code, lineGl(b, l).name,
        lineInvestor(b, l), l.description || '', l.supplier || '', l.purpose || '', l.amountBeforeVat, l.vat, l.amount, STATUS_LABEL[r.status] || r.status]); }); });
    add('lines', [S('เลขที่คำขอ', 15), S('เลขที่เอกสาร', 16), S('รหัสโครงการ'), { h: 'บรรทัด', w: 7, num: true }, S('รหัส Item', 16), S('ชื่อ Item', 26), S('รายการ (งบรวมโครงการ)', 22), S('GL Code', 10), S('GL Name', 20),
      S('บริษัทที่ลงทุน', 12), S('รายละเอียด', 34), S('Supplier', 22), S('วัตถุประสงค์', 30), N('ก่อน VAT'), N('VAT'), N('รวม'), S('สถานะ', 20)], lineRows);

    const cutRows = [];
    reqs.forEach((r) => { const b = budgetById(r.budgetId); (r.cuts || []).forEach((c) => cutRows.push([r.docNo || '', r.no, b.company, T(r.type), b.code, CUT_KIND[c.kind] || c.kind, day(c.date || c.at), c.amount,
      c.prNo || '', c.poNo || '', c.ref || '', c.note || '', userName(c.by)])); });
    add('cuts', [S('เลขที่เอกสาร', 16), S('เลขที่คำขอ', 15), S('บริษัท', 8), S('ประเภทงบ', 9), S('รหัสโครงการ'), S('ประเภทการตัดงบ', 18), S('วันที่', 11), N('จำนวนเงิน'), S('PR No.', 12), S('PO No.', 12),
      S('อ้างอิง', 18), S('หมายเหตุ', 24), S('บันทึกโดย', 16)], cutRows);

    const chRows = [];
    (db.changes || []).filter((c) => bIds.has(c.budgetId)).forEach((c) => { const b = budgetById(c.budgetId);
      chRows.push([c.no, 'ขอเพิ่มงบ', b.company, T(b.type), b.code, day(c.createdAt), CHANGE_STATE[c.state] || c.state, changeTotal(c), (c.meeting || {}).no || '', c.reason || '', userName(c.createdBy)]); });
    budgets.forEach((b) => (b.history || []).filter((h) => /^(TRF|DEC)-/.test(h.ref || '') && h.action !== 'รับงบที่โยกเข้า').forEach((h) => {
      const amt = Number(String(h.note || '').replace(/^[A-Z]+-\d+-\d+ · /, '').split(' บาท')[0].replace(/,/g, '')) || '';
      chRows.push([h.ref, h.ref.startsWith('TRF') ? 'โยกงบ' : 'ลดงบ', b.company, T(b.type), b.code, day(h.at), 'บันทึกแล้ว', h.ref.startsWith('DEC') && amt ? -amt : amt, '', h.note || '', userName(h.by)]);
    }));
    add('changes', [S('เลขที่', 15), S('ประเภท', 11), S('บริษัท', 8), S('ประเภทงบ', 9), S('รหัสโครงการ (ต้นทาง)'), S('วันที่', 11), S('สถานะ', 14), N('จำนวนเงิน'), S('เลขที่มติ / อนุมัติ', 20),
      S('เหตุผล / รายละเอียด', 44), S('โดย', 16)], chRows);

    const cfRows = [];
    budgets.filter((b) => b.type === 'CAPEX' && isActive(b)).forEach((b) => ledgerItems(b).forEach((it) => {
      const act = actualByMonth(b, it.id);
      fyMonths(b).forEach((ym) => {
        const plan = planOf(b, it.id, ym);
        const a = act[ym] || 0;
        if (plan || a) cfRows.push([b.company, b.code, it.code, it.name, itemTotal(it), ym, plan, round2(a), round2(plan - a)]);
      });
    }));
    add('cashflow', [S('บริษัท', 8), S('รหัสโครงการ'), S('รหัส Item', 16), S('ชื่อ Item', 28), N('งบ Item'), S('เดือน (ปี-เดือน)', 12), N('แผน (Plan)'), N('ใช้จริง (ตัดงบ)'), N('ผลต่าง')], cfRows);
    return sheets;
  }

  function viewExport() {
    if (!canExport()) return '<div class="alert error">ไม่มีสิทธิ์ส่งออกข้อมูล</div>';
    const years = uniq(db.budgets.filter(budgetScoped).map((b) => String(b.fiscalYear))).sort().reverse();
    const sel = (name, label, opts) => '<label class="field"><span>' + label + '</span><div class="select-wrap"><select name="' + name + '">' + opts + '</select></div></label>';
    return '<div class="page-head"><div><h1>ส่งออกข้อมูล (Excel)</h1><div class="page-sub">ข้อมูลการเงินและบัญชีสำหรับทำรายงาน / บันทึกบัญชี — ไฟล์ .xlsx เปิดด้วย Excel ได้ทันที แต่ละหัวข้อเป็นแผ่นงาน (Sheet) แยกกัน</div></div></div>' +
      '<form id="exportForm" class="form-main"><section class="card form-section"><div class="form-grid">' +
      sel('year', 'ปีงบประมาณ', '<option value="">ทุกปี</option>' + years.map((y) => opt(y, y, String(new Date().getFullYear()))).join('')) +
      sel('company', 'บริษัท', '<option value="">ทุกบริษัท</option>' + optList(db.master.companies, 'code', (c) => c.code + (c.name ? ' — ' + c.name : ''), '')) +
      sel('type', 'ประเภทงบ', '<option value="">ทั้ง CAPEX และ OPEX</option>' + opt('CAPEX', TYPE_LABEL.CAPEX, '') + opt('CBS', TYPE_LABEL.CBS, '')) +
      '</div></section><section class="card form-section"><h2 class="section-title">ข้อมูลที่ต้องการ</h2><div class="export-list">' +
      EXPORT_SHEETS.map(([k, t, hint]) => '<label class="export-opt"><input type="checkbox" name="sheet" value="' + k + '" checked><span><strong>' + t + '</strong><small>' + hint + '</small></span><em data-count="' + k + '"></em></label>').join('') +
      '</div></section><div class="actions"><button class="btn primary" type="submit">ดาวน์โหลดไฟล์ Excel</button></div></form>';
  }

  function bindExport() {
    const form = document.getElementById('exportForm');
    if (!form) return;
    const filters = () => ({ year: form.elements.year.value, company: form.elements.company.value, type: form.elements.type.value,
      sheets: Array.from(form.querySelectorAll('[name="sheet"]:checked')).map((x) => x.value) });
    const counts = () => {
      const all = exportData(Object.assign(filters(), { sheets: EXPORT_SHEETS.map((x) => x[0]) }));
      EXPORT_SHEETS.forEach(([k, t]) => {
        const n = k === 'gov' ? all.filter((x) => x.gov && x.kind !== 'summary').reduce((c, x) => c + x.count, 0) : ((all.find((x) => x.name === t) || {}).rows || []).length;
        form.querySelector('[data-count="' + k + '"]').textContent = n.toLocaleString('th-TH') + (k === 'gov' ? ' งบ' : ' แถว');
      });
    };
    form.addEventListener('change', counts);
    counts();
    guard(form, [{ btn: 'button[type="submit"]', missing: (f) => [!f.querySelector('[name="sheet"]:checked') && 'เลือกข้อมูลอย่างน้อย 1 หัวข้อ'] }]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fl = filters();
      if (!fl.sheets.length) return;
      const bytes = buildXlsx(exportData(fl));
      const name = 'budget-export-' + [fl.year || 'all', fl.company, fl.type ? TYPE_SHORT[fl.type] : ''].filter(Boolean).join('-') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      logAction('ส่งออกข้อมูล (Excel)', '', name + ' · ' + fl.sheets.length + ' หัวข้อ');
      save();
    });
  }

  // ---------------------------------------------------------------- GL Code (OPEX): ฝ่ายบัญชีใส่ทีหลังได้

  /** GL ของ Item: ของตัวเอง หรือของ Item แม่ที่ใกล้ที่สุด (Item ย่อยใช้ GL ของ Item หลักได้) */
  function itemGl(b, it) {
    let n = it;
    while (n) {
      if (n.glCode) return { code: n.glCode, name: n.glName || '', own: n === it };
      n = b.type === 'CBS' ? parentOf(b, n) : null;
    }
    return { code: '', name: '', own: false };
  }
  /** GL ของบรรทัด: ที่บันทึกในบรรทัด หรือ GL ปัจจุบันของ Item (บัญชีใส่ทีหลัง) */
  const lineGl = (b, l) => (l.glCode ? { code: l.glCode, name: l.glName || '' }
    : b.structure === 'project' && l.category ? { code: '', name: '' } : itemGl(b, itemById(b, l.itemId) || { code: '' }));
  /** Item หลักของ OPEX ที่ยังไม่มี GL */
  const missingGl = (b) => (b.type === 'CBS' && b.structure !== 'project' ? b.items.filter((it) => isMainItem(b, it) && !it.glCode) : []);
  /**
   * บัญชี (gl.manage — ไม่ใช่ผู้คุมงบ) ใส่ / แก้ GL ของ OPEX ได้ตั้งแต่ Business ขอเปิดงบ (ส่งขอเปิดแล้ว) จนถึงหลังเปิดใช้งบ
   * งบที่ผู้คุมงบลงไว้ให้ (setup) ยังไม่ถึงขั้น Business ขอเปิด → ใส่ได้เมื่อเปิดใช้งบแล้ว · ร่าง / ส่งกลับแก้ / ยกเลิก ยังใส่ไม่ได้
   */
  const glStateOk = (b) => { const st = b.state || 'active'; return st === 'active' || (!b.setup && ['review', 'pending_open', 'open_review', 'open_returned'].includes(st)); };
  const isGlBudget = (b) => b.type === 'CBS' && b.structure !== 'project';
  const canEditGl = (b) => isGlBudget(b) && glStateOk(b) && can('gl.manage');
  /** งบ OPEX ในขอบเขตของบัญชีที่ใส่ GL ได้ (หน้าจัดการ GL / งานของบัญชี) */
  const glBudgets = () => db.budgets.filter((b) => budgetScoped(b) && isGlBudget(b) && glStateOk(b));

  function glTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div class="table-wrap"><table><thead><tr><th>งบ</th><th>บริษัท / ปี</th><th>Business เจ้าของ</th><th>สถานะ</th><th class="num">Item หลักที่ยังไม่มี GL</th><th></th></tr></thead><tbody>' +
      list.map((b) => {
        const miss = missingGl(b).length;
        const total = b.items.filter((it) => isMainItem(b, it)).length;
        return '<tr><td>' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div class="muted">' + esc(b.name) + '</div></td>' +
          '<td class="nowrap">' + esc(b.company) + ' · ' + esc(b.fiscalYear) + '</td><td>' + esc(ownerLabel(b)) + '</td>' +
          '<td>' + budgetStateBadge(b) + '</td><td class="num">' + (miss ? '<b>' + miss + '</b> / ' + total : '<span class="muted">ครบ (' + total + ')</span>') + '</td>' +
          '<td class="num"><a class="btn small' + (miss ? ' primary' : '') + '" href="#/budget/' + b.id + '/gl">ใส่ GL Code</a></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** หน้าจัดการ GL (#/gl) — งบ OPEX ที่ใส่ GL ได้ แยกที่ยังไม่ครบ / ครบแล้ว */
  function viewGlQueue() {
    if (!can('gl.manage')) return '<div class="alert error">หน้านี้สำหรับบัญชีที่มีสิทธิ์ใส่ GL</div>';
    const all = glBudgets().sort((x, y) => compareCode(x.code, y.code));
    const todo = all.filter((b) => missingGl(b).length);
    const done = all.filter((b) => !missingGl(b).length);
    return '<div class="page-head"><div><h1>จัดการ GL</h1><div class="page-sub">งบ OPEX ที่ใส่ GL Code ได้ — ตั้งแต่ Business ขอเปิดงบ ไม่ต้องรอเปิดใช้งบ · เลือกงบแล้วใส่ GL ของแต่ละ Item หลัก</div></div></div>' + takeFlash() +
      '<h2>ยังมี Item หลักไม่มี GL <span class="muted">(' + todo.length + ')</span></h2>' + glTable(todo) +
      '<h2>ใส่ GL ครบแล้ว <span class="muted">(' + done.length + ')</span></h2>' + glTable(done);
  }


  function viewGl(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    if (!canEditGl(b)) return '<div class="alert error">ใส่ GL Code ได้เฉพาะงบ OPEX ที่ Business ขอเปิดแล้ว โดยบัญชี (สิทธิ์ใส่ GL)</div>';
    const rows = sortedItems(b).map((it) => {
      const inh = itemGl(b, it);
      const ph = !it.glCode && inh.code ? 'ตาม Item แม่ (' + inh.code + ')' : '';
      return '<tr data-item="' + esc(it.id) + '" class="' + (isMainItem(b, it) ? 'parent-row' : '') + '"><td class="nowrap">' + esc(it.code) + '</td>' +
        '<td style="padding-left:' + (0.75 + depth(it) * 1.1) + 'rem">' + esc(it.name) + '</td>' +
        '<td><input name="gl" value="' + esc(it.glCode || '') + '" placeholder="' + esc(ph || (isMainItem(b, it) ? 'ยังไม่มี' : '')) + '" aria-label="GL Code ' + esc(it.code) + '"></td>' +
        '<td><input name="glName" value="' + esc(it.glName || '') + '" aria-label="GL Name ' + esc(it.code) + '"></td></tr>';
    }).join('');
    return '<div class="page-head"><div><h1>ใส่ GL Code · ' + esc(b.code) + '</h1><div class="page-sub">' + esc(b.name) +
      ' — ฝ่ายบัญชีใส่ GL ของแต่ละ Item ได้ทุกเมื่อ (ตอนตั้งงบไม่ต้องกรอก) · Item ย่อยที่เว้นว่างใช้ GL ของ Item แม่ · ใบเบิกใช้งบที่ยังไม่มี GL จะใช้ GL ล่าสุดของ Item</div></div></div>' +
      '<div id="formError"></div>' +
      '<form id="glForm" data-id="' + b.id + '"><section class="card form-section"><div class="table-wrap"><table class="edit-table"><thead><tr><th style="width:6rem">รหัส</th><th>รายการ</th>' +
      '<th style="width:11rem">GL Code</th><th style="width:16rem">GL Name</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>' +
      '<div class="actions"><button class="btn primary" type="submit">บันทึก GL Code</button><a class="btn" data-back href="#/budget/' + b.id + '">ยกเลิก</a></div></form>';
  }

  function bindGl() {
    const form = document.getElementById('glForm');
    if (!form) return;
    const b = budgetById(form.dataset.id);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      let changed = 0;
      form.querySelectorAll('tbody tr').forEach((tr) => {
        const it = itemById(b, tr.dataset.item);
        const code = tr.querySelector('[name="gl"]').value.trim();
        const name = code ? tr.querySelector('[name="glName"]').value.trim() : '';
        if ((it.glCode || '') !== code || (it.glName || '') !== name) changed += 1;
        it.glCode = code;
        it.glName = name;
      });
      addHistory(b, 'บัญชีใส่ / แก้ GL Code', changed + ' รายการ', 'งบ ' + b.code);
      save();
      setFlash('success', 'บันทึก GL Code ของ ' + b.code + ' แล้ว (' + changed + ' รายการ)');
      go('#/gl');
    });
  }

  /** แบบฟอร์มขออนุมัติงบสำหรับเข้าที่ประชุม (ฟอร์มชั่วคราว รอแบบฟอร์มจริงจากทีมผู้ใช้) */
  function viewBudgetRequestForm(id) {
    const b = budgetById(id);
    if (!b) return notFound();
    const isCapex = b.type === 'CAPEX';
    const tr = (k, v) => '<tr><th style="width:30%">' + k + '</th><td>' + v + '</td></tr>';
    const rows = b.structure === 'project'
      ? '<tr><td>1</td><td>งบรวมทั้งโครงการ (ยังไม่แยกรายการย่อย)</td><td class="num">' + money(budgetTotal(b)) + '</td></tr>'
      : ledgerItems(b).map((i, n) => '<tr><td>' + (n + 1) + '</td><td>' + esc(i.code + ' ' + i.name) +
        '</td><td class="num">' + money(itemTotal(i)) + '</td></tr>').join('');
    return '<div class="actions no-print" style="margin:0 0 1rem"><button class="btn primary" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>' +
      '<div class="alert info no-print">แบบฟอร์มชั่วคราว — จะปรับตามแบบฟอร์มจริงที่ทีมผู้ใช้ส่งมา</div>' +
      '<article class="doc"><header><div><h1>' + esc(companyMap()[b.company] || b.company) + '</h1><div class="doc-sub">' + (isCapex ? 'แบบขออนุมัติงบประมาณ ' : 'แบบขออนุมัติงบประมาณ (เสนอผู้บริหาร) ') +
      (isCapex ? '(งบลงทุน CAPEX)' : '(งบดำเนินงาน OPEX)') + '</div></div><div class="docno">ปีงบประมาณ <strong>' + esc(b.fiscalYear) + '</strong><br>พิมพ์วันที่ ' + fmtDay(new Date().toISOString()) + '</div></header>' +
      '<div class="section"><table><tbody>' + tr('รหัสโครงการ', esc(b.code)) + tr('ชื่อโครงการ', esc(b.name)) + tr('หน่วยงาน', esc(b.department)) +
      tr('ผู้ขออนุมัติ (Business)', esc(ownerLabel(b))) + tr('ความจำเป็น / หมายเหตุ', esc(b.note || '-')) + '</tbody></table></div>' +
      '<div class="section"><h2>รายการที่ขออนุมัติ</h2><table><thead><tr><th style="width:2rem">#</th><th>รายการ</th><th class="num">วงเงิน (รวม VAT)</th></tr></thead><tbody>' + rows +
      '<tr><th colspan="2" class="right">รวมทั้งสิ้น</th><td class="num"><strong>' + money(budgetTotal(b)) + '</strong></td></tr></tbody></table></div>' +
      '<div class="section"><h2>' + apprOf(b.type).result + '</h2><table><tbody>' +
      tr(isCapex ? 'มติ' : 'ผลการพิจารณา', '☐ อนุมัติเต็มจำนวน &nbsp; ☐ อนุมัติบางส่วน จำนวน ........................ บาท &nbsp; ☐ ไม่อนุมัติ') +
      tr(isCapex ? 'ครั้งที่ / วันที่ประชุม' : 'วันที่อนุมัติ', '.......................................') + tr('หมายเหตุ', '<br><br>') + '</tbody></table></div>' +
      '<div class="signs"><div><div class="line"></div>ผู้ขออนุมัติ<br>' + esc(ownerLabel(b)) + '</div><div><div class="line"></div>ผู้บังคับบัญชา</div><div><div class="line"></div>' + (isCapex ? 'ประธานที่ประชุม' : 'ผู้บริหารผู้อนุมัติ') + '</div></div>' +
      '</article>';
  }

  // ---------------------------------------------------------------- request form

  /** Supplier ในช่อง: ใช้สะกดตามข้อมูลหลักถ้ามีชื่อเดียวกันอยู่แล้ว · ชื่อใหม่เพิ่มเข้าข้อมูลหลักตอนบันทึกคำขอ */
  const canonSupplier = (name) => {
    const n = String(name || '').trim();
    const hit = n ? (db.master.suppliers || []).find((x) => normTxt(x.name) === normTxt(n)) : null;
    return hit ? hit.name : n;
  };
  const rememberSupplier = (name) => {
    if (!name) return;
    db.master.suppliers = db.master.suppliers || [];
    if (!db.master.suppliers.some((x) => x.name === name)) db.master.suppliers.push({ name });
    // โหมด Supabase: เพิ่มเข้าข้อมูลหลักกลางด้วย (ทุกคนเลือกชื่อนี้ได้) — เบื้องหลัง ไม่ขวางการส่งคำขอ
    if (AUTH_REMOTE) {
      window.RemoteApi.v2MasterAddSupplier(name).then((r) => {
        if (r && Array.isArray(r.items)) { db.master.suppliers = r.items; masterMeta.suppliers = r.updatedAt; save(); }
      }).catch((e) => console.warn('เพิ่ม Supplier เข้าข้อมูลหลักบนเซิร์ฟเวอร์ไม่สำเร็จ', e && e.message));
    }
  };

  /** ตัวเลือกรายการ (เฉพาะรายการล่างสุด) พร้อมยอดคงเหลือ ไม่นับยอดที่คำขอนี้จองไว้เอง */
  function itemOptions(b, existing, selected, isCapex) {
    return sortedItems(b).filter((i) => b.type === 'CBS' || isLeaf(b, i)).map((i) => {
      const remaining = remainingFor(b, i.id, existing);
      const node = budgetNodeOf(b, i);
      const note = node !== i ? ' (ใช้วงเงิน Item ' + node.code + ')' : '';
      return '<option value="' + i.id + '" data-remaining="' + remaining + '"' + (i.id === selected ? ' selected' : '') + '>' +
        (b.type === 'CBS' ? '\u00a0\u00a0'.repeat(depth(i)) : '') + esc(i.code + ' ' + i.name) + ' — คงเหลือ ' + money(remaining) + ' บาท' + note + '</option>';
    }).join('');
  }

  // ---- ฟอร์มขอเบิก (CAPEX / OPEX): จัดกลุ่มตาม Item — หรือตามหมวดค่าใช้จ่าย + บริษัทที่ลงทุน สำหรับงบรวมทั้งโครงการ
  //      แต่ละกลุ่มมีหลายบรรทัด (Supplier · รายละเอียด · จำนวนเงิน · VAT)
  const SUP_NEW = '__new';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const GROUP_COLS = '<colgroup><col class="c-no"><col class="c-sup"><col><col class="c-amt"><col class="c-vat"><col class="c-tot"><col class="c-del"></colgroup>';
  function supplierOptions(selected) {
    const names = (db.master.suppliers || []).map((x) => x.name).sort((x, y) => x.localeCompare(y, 'th'));
    if (selected && !names.includes(selected)) names.unshift(selected);
    return '<option value="">— เลือก —</option>' + names.map((n) => '<option value="' + esc(n) + '"' + (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>').join('') +
      '<option value="' + SUP_NEW + '">+ เพิ่มชื่อใหม่…</option>';
  }
  function supRow(line, capex) {
    const vat = line.vat === undefined ? !!capex : Number(line.vat) > 0;
    return '<tr class="line-row"><td class="line-no"></td>' +
      '<td><div class="select-wrap"><select name="lnSupplier" aria-label="Supplier">' + supplierOptions(line.supplier || '') + '</select></div></td>' +
      '<td><input name="lnDesc" value="' + esc(line.description || '') + '" aria-label="รายละเอียด" placeholder="' + (capex ? 'เช่น เครื่องชั่งดิจิตอล 1 mg' : 'เช่น ค่าแรงดูแลกล้า') + '"></td>' +
      '<td><input name="lnAmount" type="number" min="0" step="0.01" class="right" placeholder="0.00" value="' + esc(line.amountBeforeVat || '') + '" aria-label="จำนวนก่อน VAT"></td>' +
      '<td class="center"><input name="lnVat" type="checkbox"' + (vat ? ' checked' : '') + ' aria-label="VAT 7%"></td>' +
      '<td class="num ln-total">0.00</td>' +
      '<td class="center"><button type="button" class="row-x" data-remove-line title="ลบบรรทัด" aria-label="ลบบรรทัด">×</button></td></tr>';
  }
  function itemGroup(b, existing, key, rows) {
    const capex = b.type === 'CAPEX';
    const pick = b.structure === 'project'
      ? '<div class="group-pick"><input name="lnCat" class="group-title" value="' + esc(key.category || '') + '" aria-label="ชื่อรายการ" placeholder="พิมพ์ชื่อรายการ เช่น งานติดตั้งระบบไฟ" autocomplete="off">' +
        (capex ? '<label class="group-inv"><span>บริษัทที่ลงทุน</span>' + investorSelect('lnInv', key.investor || b.company) + '</label>' : '') + '</div>'
      : '<div class="select-wrap"><select name="lnItem" aria-label="' + (capex ? 'รายการย่อย (Item No.)' : 'รายการต้นทุน (Item)') + '"><option value="">— เลือก Item —</option>' +
        itemOptions(b, existing, key.itemId || '', false) + '</select></div>';
    return '<div class="item-group">' +
      '<div class="item-group-head">' + pick +
      '<button type="button" class="group-del" data-remove-group title="ลบรายการนี้" aria-label="ลบรายการนี้">' + ICON_TRASH + '</button></div>' +
      (capex ? '<label class="field group-purpose req"><span>วัตถุประสงค์ของรายการนี้</span><input name="grpPurpose" required value="' + esc(rows.map((l) => l.purpose).find(Boolean) || '') + '" aria-label="วัตถุประสงค์ของรายการนี้" placeholder="วัตถุประสงค์ของรายการนี้ เช่น จัดซื้อเครื่องชั่งสำหรับห้องปฏิบัติการ"></label>' : '') +
      '<div class="table-wrap"><table class="edit-table group-table">' + GROUP_COLS +
      '<thead><tr><th>No.</th><th data-sup>Supplier</th><th class="req">รายละเอียด</th><th class="num req">จำนวนก่อน VAT</th><th class="center">VAT 7%</th><th class="num">รวม</th><th></th></tr></thead>' +
      '<tbody class="group-rows">' + rows.map((l) => supRow(l, capex)).join('') + '</tbody></table></div>' +
      '<button type="button" class="link-add" data-add-row>+ เพิ่ม Supplier</button></div>';
  }
  /** บรรทัดเดิม → กลุ่ม (เรียงตามที่พบก่อน): ตาม Item หรือ ตามหมวด + บริษัทที่ลงทุน (งบรวมโครงการ) */
  const groupLines = (b, lines) => {
    const project = b.structure === 'project';
    const keyOf = (l) => (project ? { category: l.category || '', investor: l.investor || b.company } : { itemId: l.itemId || '' });
    const out = [];
    lines.forEach((l) => {
      const key = keyOf(l);
      const id = JSON.stringify(key);
      let g = out.find((x) => x.id === id);
      if (!g) { g = { id, key, rows: [] }; out.push(g); }
      g.rows.push(l);
    });
    return out.length ? out : [{ key: keyOf({}), rows: [{}] }];
  };

  function viewRequestForm(budgetId, requestId, params) {
    const existing = requestId ? requestById(requestId) : null;
    if (requestId && !existing) return notFound();
    const b = budgetById(existing ? existing.budgetId : budgetId);
    if (!b) return notFound();
    const u = me();
    if (!actsFor(b) || !can('request.create')) return '<div class="alert error">ขอเบิกใช้งบได้เฉพาะ Business ผู้สร้างงบนี้หรือธุรการ</div>';
    if (!isActive(b)) return '<div class="alert error">งบนี้ยังไม่เปิดใช้งบ (สถานะ: ' + esc(BUDGET_STATE[b.state]) + ') — ต้องให้ผู้คุมงบยืนยันเปิดใช้ก่อน</div>';
    if (existing && existing.status !== 'rejected' && existing.status !== 'memo') return '<div class="alert error">แก้ไขได้เฉพาะคำขอที่ถูกส่งกลับเท่านั้น</div>';
    const isProject = b.structure === 'project';
    // งบที่แยก Item (CAPEX / OPEX): เลือก Item ทีละบรรทัด ใบเดียวใช้ได้หลาย Item · งบรวมโครงการ: เลือกหมวดค่าใช้จ่ายแทน
    const perLine = !isProject;
    const single = !perLine;
    // ทำซ้ำรายการเบิก: คัดลอกคำขอเดิมของตนเอง (งบเดียวกัน) มาเป็นร่างฟอร์มใหม่ — ได้เลขที่คำขอใหม่เมื่อส่ง
    const src = !existing && params.get('copy') ? requestById(params.get('copy')) : null;
    const dup = src && src.budgetId === b.id && (src.requesterId === u.id || proxyOf(b)) ? src : null;
    const dupLines = dup ? dup.lines.map((l) => Object.assign({}, l, { itemId: perLine && !itemById(b, l.itemId) ? '' : l.itemId }, { supplier: l.supplier || dup.payee || '' })) : null;
    const v = existing || (dup ? { itemId: isProject ? b.items[0].id : '', useType: dup.useType || 'prpo', purpose: dup.purpose, payee: dup.payee, paymentPlan: dup.paymentPlan }
      : { itemId: params.get('item') || (isProject ? b.items[0].id : ''), useType: 'prpo' });
    const lines = existing ? existing.lines : dupLines && dupLines.length ? dupLines : [{ itemId: perLine ? params.get('item') || '' : '' }];
    const val = (k) => ' value="' + esc(v[k] == null ? '' : v[k]) + '"';
    const field = (label, inner, extra) => '<label class="field"' + (extra || '') + '><span>' + label + '</span>' + inner + '</label>';
    const lastReject = existing ? existing.steps.find((s) => s.status === 'rejected') : null;
    const mv = (existing && existing.memo) || {};
    const mp = (existing && existing.memoParties) || defaultMemoParties(b, b.company);

    const remaining = usage(b).remaining;
    const step = (n, title, extra) => '<div class="section-head"><h2 class="section-title"><span class="step">' + n + '</span>' + title + '</h2>' + (extra || '') + '</div>';
    const opex = b.type === 'CBS';
    const typeCard = (k) => '<label class="choice-opt"><input type="radio" name="useType" value="' + k + '"' + (v.useType === k ? ' checked' : '') + '>' +
      '<span><strong>' + USE_TYPES[k].label + '</strong><small>' + (USE_TYPES[k].hint || USE_TYPES[k].cut) + '</small></span></label>';
    const typeSub = (k) => (USE_TYPES[k] ? USE_TYPES[k].label + ': ' + USE_TYPES[k].cut : '');
    const projOwn = existing && isReserving(existing) ? existing.amount : 0;
    const general = '<section class="card form-section">' +
        '<div class="section-head"><div><h2 class="section-title"><span class="step">1</span>ประเภทการเบิกใช้งบ</h2><div class="section-sub" id="useTypeSub">' + esc(typeSub(v.useType)) + '</div></div></div>' +
        '<div class="choice choice-4">' + Object.keys(USE_TYPES).map(typeCard).join('') + '</div></section>';

    const today = new Date().toISOString().slice(0, 10);
    // คำขอ CAPEX เดิมที่มีวัตถุประสงค์ระดับใบ (ยังไม่แยกรายกลุ่ม): ใช้เป็นวัตถุประสงค์ตั้งต้นของทุกกลุ่ม
    const oldSrc = existing || dup;
    const oldPurpose = (ls) => (b.type === 'CAPEX' && oldSrc && oldSrc.purpose ? ls.map((l) => (l.purpose ? l : Object.assign({}, l, { purpose: oldSrc.purpose }))) : ls);
    const projRemain = round2(usage(b).remaining + projOwn);
    const itemsCard = '<section class="card form-section">' +
      step(2, 'ข้อมูลการดำเนินการ', '<button type="button" class="btn" id="addGroup">+ เพิ่มรายการใหม่</button>') +
      '<div class="form-grid req-dates">' +
        field('วันที่ส่งมอบ/วางบิล', '<input type="date" name="deliveryDate" required value="' + esc((existing && existing.deliveryDate) || today) + '">') +
        field('วันที่กำหนดจ่ายเงิน', '<input type="date" name="payDueDate" required value="' + esc((existing && existing.payDueDate) || today) + '">') + '</div>' +
      (isProject ? '<input type="hidden" name="itemId" value="' + esc(b.items[0].id) + '" data-remaining="' + projRemain + '">' +
        '<p class="group-note">งบรวมทั้งโครงการ ' + esc(b.code) + ' — คงเหลือ <strong>' + money(projRemain) + '</strong> บาท · แต่ละกลุ่มพิมพ์ชื่อรายการ' + (opex ? '' : ' และเลือกบริษัทที่ลงทุน') + '</p>' : '') +
      '<div class="groups-box"><div id="itemGroups">' + groupLines(b, oldPurpose(lines)).map((g) => itemGroup(b, existing, g.key, g.rows)).join('') + '</div>' +
      '<div class="table-wrap group-sum"><table class="edit-table group-table">' + GROUP_COLS +
      '<tbody><tr><td colspan="3" class="right"><strong>รวม</strong></td><td class="num"><strong id="sumBefore">0.00</strong></td><td class="num"><strong id="sumVat">0.00</strong></td><td class="num"><strong id="sumTotal">0.00</strong></td><td></td></tr></tbody></table></div></div>' +
      '<template id="groupTpl">' + itemGroup(b, existing, {}, [{}]) + '</template><template id="supRowTpl">' + supRow({}, b.type === 'CAPEX') + '</template>' +
      '<div class="req-meta"><div class="field"><span>เอกสารประกอบ</span><div class="attach-box"><label class="btn small file-btn">+ แนบไฟล์<input type="file" id="reqFileInput" accept="application/pdf,image/png,image/jpeg" multiple hidden></label>' +
      '<div id="reqFiles">' + attachList(v.attachments, { del: true, empty: 'ยังไม่มีไฟล์แนบ' }) + '</div></div></div></div>' +
      '<div id="overBudget" hidden>' +
      '<div class="alert warn" id="overText"></div>' +
          field('เหตุผลที่ต้องใช้เกินงบ (ถ้ามี — ผู้คุมงบใช้ประกอบการพิจารณา)', '<textarea name="requesterReason" rows="2">' + esc(v.requesterReason || '') + '</textarea>') +
      '</div></section>';

    const side = '<div class="card total-card"><h3 class="side-title">สรุปคำขอเบิก</h3><span class="muted">ยอดขอใช้ครั้งนี้ (รวม VAT)</span>' +
      '<div class="total-amount"><span id="sideTotal">0.00</span> <small>บาท</small></div>' +
      '<dl class="kv compact"><dt>งบคงเหลือทั้งโครงการ</dt><dd>' + moneyCell(projRemain) + '</dd>' +
      '<dt>คงเหลือหลังขอใช้</dt><dd id="sideAfter">' + moneyCell(projRemain) + '</dd></dl>' +
      '<div class="actions side-actions">' +
      '<button class="btn primary tall" type="submit" data-action="send"' + '>' + (existing && existing.status === 'rejected' ? 'ส่งให้ผู้คุมงบตรวจสอบอีกครั้ง' : 'ส่งให้ผู้คุมงบตรวจสอบ') + '</button>' +
      '<a class="btn" data-back href="' + (existing ? '#/request/' + existing.id : '#/budget/' + b.id) + '">ยกเลิก</a></div>' +
      '</div>' +
      '<div class="card form-tip"><h3 class="side-title">คำแนะนำในการเบิก</h3><p class="tip-head">กรณีขอเกินงบประมาณ</p><p class="muted">' + (opex
          ? 'OPEX ขอเกินวงเงินของแต่ละ Item (หรืองบรวมทั้งโครงการ) ไม่ได้ — ถ้าไม่พอ ต้องขอเพิ่มงบ หรือให้ผู้คุมงบโยกงบก่อน'
          : 'CAPEX ขอเกินวงเงินรายการย่อยได้ โดยผู้คุมงบต้องใส่ Note แต่ห้ามเกินยอดคงเหลือของงบรวมโครงการ — ถ้าไม่พอ ต้องขอเพิ่มงบ / โยกงบก่อน') + '</p>' +
        '<p class="tip-head">หลาย Supplier ในรายการเดียว</p><p class="muted">กด "+ เพิ่ม Supplier" ใต้รายการ' + (opex ? ' เช่น ค่าแรงคนงานหลายคน' : '') + ' · Supplier ใหม่เลือก "+ เพิ่มชื่อใหม่…" ในช่อง Supplier</p>' +
        (isProject ? '<p class="tip-head">งบรวมทั้งโครงการ</p><p class="muted">ไม่มี Item ให้เลือก — แต่ละกลุ่มพิมพ์ชื่อรายการเอง' +
          (opex ? '' : ' และเลือกบริษัทที่ลงทุน (ใช้เงินข้ามบริษัทกับ PCC ต้องทำ Memo ให้ผู้บริหารเซ็นก่อนส่ง)') + '</p>' : '') + '</div>';

    return '<div class="page-head"><div><h1>' + (existing ? 'แก้ไขคำขอ ' + esc(existing.no) : 'ขอเบิกใช้งบ') + '</h1>' +
      '<div class="page-sub">' + badge(b.type, TYPE_SHORT[b.type]) + ' ' + esc(b.code + ' ' + b.name) + '</div></div>' +
      '<div class="head-actions">' + (existing ? badge(existing.status, statusText(existing)) : badge('draft', 'แบบร่าง')) + '</div></div>' +
      (lastReject ? '<div class="alert error">เหตุผลที่ส่งกลับ: ' + esc(lastReject.comment) + '</div>' : '') +
      (dup ? '<div class="alert info">ทำซ้ำจากคำขอ <strong>' + esc(dup.no) + '</strong> — เพิ่ม ลด หรือแก้รายการและจำนวนเงินได้ · ได้เลขที่คำขอใหม่เมื่อส่ง · ไม่คัดลอกไฟล์แนบและ Memo · <a href="#/request/new/' + b.id + '">เริ่มใหม่โดยไม่คัดลอก</a></div>' : '') +
      '<div id="formError"></div>' +
      '<form id="requestForm" class="req-form" data-budget="' + b.id + '" data-request="' + esc(requestId || '') + '" data-remaining="' + projRemain + '">' +
      '<div class="detail-layout"><div class="detail-main form-main">' + general + itemsCard +
      '<div id="planWrap">' + planFieldset(existing ? existing.paymentPlan : dup && dup.paymentPlan, 3) + '</div>' +
      '</div><aside class="detail-side">' + side + '</aside></div></form>';
  }

  function planRow(x) {
    return '<tr><td class="line-no"></td>' +
      '<td><input name="planPct" type="number" min="0.01" max="100" step="0.01" class="right" value="' + esc(x.pct || '') + '" aria-label="% ของยอดรวม"></td>' +
      '<td class="num plan-amt">0.00</td>' +
      '<td><input name="planNote" value="' + esc(x.note || '') + '" placeholder="เช่น เมื่อส่งมอบเครื่อง / หลังติดตั้งแล้วเสร็จ" aria-label="เงื่อนไขของงวด"></td>' +
      '<td><button type="button" class="btn small bad" data-remove-plan title="ลบงวด">×</button></td></tr>';
  }

  /** เงื่อนไขการจ่าย (CAPEX): จ่ายครั้งเดียว หรือแบ่งเป็นงวดตาม % */
  function planFieldset(plan, stepNo) {
    const mode = plan && plan.mode === 'installments' ? 'installments' : 'single';
    const rows = mode === 'installments' ? plan.installments : [{}, {}];
    const opt2 = (value, title, sub) => '<label class="choice-opt"><input type="radio" name="payMode" value="' + value + '"' +
      (mode === value ? ' checked' : '') + '><span><strong>' + title + '</strong><small>' + sub + '</small></span></label>';
    return '<section class="card form-section"><div class="section-head"><h2 class="section-title"><span class="step">' + (stepNo || 3) + '</span>เงื่อนไขการจ่าย</h2></div><div class="choice">' +
      opt2('single', 'จ่ายครั้งเดียว', 'จ่ายเต็มจำนวนในงวดเดียว') +
      opt2('installments', 'แบ่งจ่ายเป็นงวด', 'กำหนด % ของแต่ละงวด รวมต้องได้ 100%') + '</div>' +
      '<div id="planBox"' + (mode === 'installments' ? '' : ' hidden') + '>' +
      '<div class="table-wrap"><table class="edit-table lines-table plan-table"><thead><tr><th style="width:3.5rem">งวด</th>' +
      '<th class="num" style="width:9rem">% ของยอดรวม</th><th class="num" style="width:10rem">ยอดโดยประมาณ</th><th>เงื่อนไขของงวด</th><th style="width:3rem"></th></tr></thead>' +
      '<tbody id="planRows">' + rows.map(planRow).join('') + '</tbody>' +
      '<tfoot><tr><td class="right"><strong>รวม</strong></td><td class="num" id="planPctSum">0%</td><td class="num" id="planAmtSum">0.00</td>' +
      '<td><div class="plan-tools"><button type="button" class="btn small" id="addPlan">+ เพิ่มงวด</button><span class="muted">แบบสำเร็จรูป:</span>' +
      ['50,50', '40,60', '30,70', '30,40,30'].map((p) => '<button type="button" class="btn small" data-preset="' + p + '">' + p.replace(/,/g, '/') + '</button>').join('') +
      '</div></td><td></td></tr></tfoot></table></div></div>' +
      '<template id="planTpl">' + planRow({}) + '</template></section>';
  }

  function readPlan(form) {
    if (!form.querySelector('[name="payMode"]')) return null;
    const mode = form.querySelector('[name="payMode"]:checked').value;
    if (mode !== 'installments') return { mode: 'single', installments: [] };
    return {
      mode,
      installments: Array.from(form.querySelectorAll('#planRows tr')).map((tr) => ({
        pct: round2(tr.querySelector('[name="planPct"]').value),
        note: tr.querySelector('[name="planNote"]').value.trim()
      })).filter((x) => x.pct || x.note)
    };
  }

  /** บรรทัดรายการในฟอร์มขอเบิก และช่องเลือก Item ของบรรทัด (ในบรรทัดเอง หรือหัวกลุ่ม) */
  const lineTrs = (form) => Array.from(form.querySelectorAll('tr.line-row'));
  const rowField = (tr, name) => tr.querySelector('[name="' + name + '"]') || (tr.closest('.item-group') ? tr.closest('.item-group').querySelector('[name="' + name + '"]') : null);
  const rowItemSel = (tr) => rowField(tr, 'lnItem');
  const rowSupplier = (tr) => {
    const el = tr.querySelector('[name="lnSupplier"]');
    if (!el) return undefined;
    return el.value === SUP_NEW ? '' : canonSupplier(el.value);
  };

  /** อ่านบรรทัดจากตาราง (ข้ามบรรทัดว่าง) */
  function readLines(form, isCapex) {
    return lineTrs(form).map((tr) => {
      const before = round2(tr.querySelector('[name="lnAmount"]').value);
      const vat = tr.querySelector('[name="lnVat"]').checked ? round2(before * VAT_RATE) : 0;
      return {
        tr,
        itemId: isCapex ? form.elements.itemId.value : (rowItemSel(tr) || {}).value || '',
        category: rowField(tr, 'lnCat') ? rowField(tr, 'lnCat').value.trim() : undefined,
        investor: rowField(tr, 'lnInv') ? rowField(tr, 'lnInv').value : undefined,
        description: tr.querySelector('[name="lnDesc"]').value.trim(),
        supplier: rowSupplier(tr),
        purpose: rowField(tr, 'grpPurpose') ? rowField(tr, 'grpPurpose').value.trim() : '',
        amountBeforeVat: before, vat, amount: round2(before + vat)
      };
    }).filter((l) => l.description || l.amountBeforeVat);
  }

  /** ยอดที่เกินคงเหลือ แยกตามรายการ: [{ item, remaining, amount }] */
  function overItems(form, b, lines, isCapex) {
    const remainingOf = (id) => {
      const sel = isCapex ? form.elements.itemId : form.querySelector('[name="lnItem"]');
      if (sel && sel.type === 'hidden') return Number(sel.dataset.remaining);
      const o = sel && Array.from(sel.options).find((x) => x.value === id);
      return o ? Number(o.dataset.remaining) : 0;
    };
    const byItem = {};
    lines.forEach((l) => { if (l.itemId) byItem[l.itemId] = round2((byItem[l.itemId] || 0) + l.amount); });
    return Object.keys(byItem).map((id) => ({ item: itemById(b, id), remaining: remainingOf(id), amount: byItem[id] }))
      .filter((x) => x.amount > x.remaining);
  }

  /**
   * ตรวจวงเงินของคำขอเบิก
   *   OPEX: เกินวงเงินต่อ Item ไม่ได้ (งบรวมทั้งโครงการ = เกินยอดคงเหลือรวมไม่ได้) — ต้องขอเพิ่มงบ / โยกงบก่อน
   *   CAPEX: เกินวงเงินต่อรายการได้ (ผู้คุมงบต้องใส่ Note) แต่ห้ามเกินยอดคงเหลือของงบรวม
   * คืน { block: [ข้อความที่ส่งไม่ได้], note: [ข้อความเตือน] }
   */
  function requestLimitIssues(form) {
    const b = budgetById(form.dataset.budget);
    const project = b.structure === 'project';
    const lines = readLines(form, project);
    const total = round2(lines.reduce((x, l) => x + l.amount, 0));
    const projRem = Number(form.dataset.remaining);
    const out = { block: [], note: [] };
    const overTotal = round2(total - projRem);
    const itemOver = !project ? overItems(form, b, lines, false) : [];
    if (b.type === 'CBS') {
      itemOver.forEach((x) => out.block.push('เกินวงเงินรายการ ' + (x.item ? x.item.code + ' ' + x.item.name : '') + ' อยู่ ' + money(round2(x.amount - x.remaining)) + ' บาท'));
      if (project && overTotal > 0) out.block.push('เกินวงเงินงบรวมทั้งโครงการ ' + money(overTotal) + ' บาท');
      if (!project && overTotal > 0 && !itemOver.length) out.block.push('เกินงบคงเหลือของโครงการ ' + money(overTotal) + ' บาท');
    } else {
      if (overTotal > 0) out.block.push('เกินงบคงเหลือของโครงการ ' + money(overTotal) + ' บาท');
      itemOver.forEach((x) => out.note.push('เกินงบรายการ ' + (x.item ? x.item.code : '') + ' อยู่ ' + money(round2(x.amount - x.remaining)) + ' บาท' + (overTotal > 0 ? '' : ' — ไม่เกินงบรวมของโครงการ ขอได้ แต่ผู้คุมงบต้องใส่ Note เมื่ออนุมัติ')));
    }
    return out;
  }

  function bindRequestForm() {
    const form = document.getElementById('requestForm');
    if (!form) return;
    const f = form.elements;
    const b = budgetById(form.dataset.budget);
    const perLine = b.structure !== 'project'; // เลือก Item ทีละบรรทัด (ใบเดียวหลาย Item)
    const isCapex = !perLine; // ชื่อเดิม: = งบรวมโครงการ (ใช้ f.itemId ที่ซ่อนไว้)
    const existing = form.dataset.request ? requestById(form.dataset.request) : null;
    let files = existing ? (existing.attachments || []).slice() : [];
    const fileInput = document.getElementById('reqFileInput');
    const showFiles = () => { document.getElementById('reqFiles').innerHTML = attachList(files, { del: true, empty: 'ยังไม่มีไฟล์' }); };
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        files = files.concat(await readFiles(e.target, 'request'));
        e.target.value = '';
        showFiles();
      });
      document.getElementById('reqFiles').addEventListener('click', (e) => {
        const del = e.target.closest('[data-att-del]');
        if (del) { files = files.filter((x) => x.id !== del.dataset.attDel); showFiles(); }
      });
    }
    const useType = () => (form.querySelector('[name="useType"]:checked') || {}).value;
    const syncType = () => {
      const t = useType();
      const payee = { prpo: 'Supplier ที่จะสั่งซื้อ (ถ้าทราบ)', advance: 'ผู้รับเงินทดรอง', reimburse: 'พนักงานผู้สำรองจ่าย', direct: 'Supplier ผู้รับเงิน' }[t];
      const pl = document.getElementById('payeeLabel');
      if (pl) pl.textContent = payee || 'Supplier / ผู้รับเงิน';
      if (f.payee) f.payee.required = t !== 'prpo';
      form.querySelectorAll('th[data-sup]').forEach((th) => {
        th.classList.toggle('req', t !== 'prpo');
        th.textContent = { prpo: 'Supplier (ถ้าทราบ)', advance: 'ผู้รับเงินทดรอง', reimburse: 'พนักงานผู้สำรองจ่าย' }[t] || 'Supplier';
      });
      const sub = document.getElementById('useTypeSub');
      if (sub && USE_TYPES[t]) sub.textContent = USE_TYPES[t].label + ': ' + USE_TYPES[t].cut;
      document.getElementById('planWrap').hidden = !(t === 'prpo' || t === 'direct');
    };
    form.querySelectorAll('[name="useType"]').forEach((el) => el.addEventListener('change', syncType));
    syncType();

    const update = () => {
      let sb = 0;
      let sv = 0;
      const groupsEl = form.querySelectorAll('.item-group');
      if (groupsEl.length) groupsEl.forEach((g) => g.querySelectorAll('tr.line-row').forEach((tr, i) => { tr.querySelector('.line-no').textContent = i + 1; }));
      lineTrs(form).forEach((tr, i) => {
        if (!groupsEl.length) tr.querySelector('.line-no').textContent = i + 1;
        const before = round2(tr.querySelector('[name="lnAmount"]').value);
        const vat = tr.querySelector('[name="lnVat"]').checked ? round2(before * VAT_RATE) : 0;
        tr.querySelector('.ln-total').textContent = money(before + vat);
        sb += before;
        sv += vat;
      });
      document.getElementById('sumBefore').textContent = money(sb);
      document.getElementById('sumVat').textContent = money(sv);
      document.getElementById('sumTotal').textContent = money(sb + sv);
      document.getElementById('sideTotal').textContent = money(sb + sv);
      const after = round2(Number(form.dataset.remaining) - (sb + sv));
      const afterEl = document.getElementById('sideAfter');
      afterEl.innerHTML = moneyCell(after);
      const lim = requestLimitIssues(form);
      const box = document.getElementById('overBudget');
      const txt = document.getElementById('overText');
      box.hidden = !(lim.block.length || lim.note.length);
      txt.className = lim.block.length ? 'alert error' : 'alert warn';
      txt.innerHTML = lim.block.length
        ? lim.block.map(esc).join('<br>') + '<br><strong>ขอเกินวงเงินไม่ได้</strong> — ต้องขอเพิ่มงบ / ให้ผู้คุมงบโยกงบก่อน แล้วจึงขอเบิกได้'
        : lim.note.map(esc).join('<br>');
      const reason = box.querySelector('.field');
      if (reason) reason.hidden = !!lim.block.length || !lim.note.length;
    };
    const planRows = document.getElementById('planRows');
    const updatePlan = () => {
      if (!planRows) return;
      const mode = form.querySelector('[name="payMode"]:checked').value;
      document.getElementById('planBox').hidden = mode !== 'installments';
      const total = round2(readLines(form, isCapex).reduce((s, l) => s + l.amount, 0));
      const pcts = Array.from(planRows.rows).map((tr) => tr.querySelector('[name="planPct"]').value);
      const amts = planAmounts(total, pcts);
      Array.from(planRows.rows).forEach((tr, i) => {
        tr.querySelector('.line-no').textContent = i + 1;
        tr.querySelector('.plan-amt').textContent = money(amts[i]);
      });
      const sumPct = round2(pcts.reduce((s, p) => s + Number(p || 0), 0));
      const sumEl = document.getElementById('planPctSum');
      sumEl.textContent = sumPct + '%';
      sumEl.className = 'num ' + (sumPct === 100 ? 'pos' : 'neg');
      document.getElementById('planAmtSum').textContent = money(amts.reduce((s, x) => s + x, 0));
    };
    if (planRows) {
      document.getElementById('addPlan').addEventListener('click', () => {
        planRows.insertAdjacentHTML('beforeend', document.getElementById('planTpl').innerHTML);
        updatePlan();
      });
      form.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
        const pcts = btn.dataset.preset.split(',');
        const notes = Array.from(planRows.rows).map((tr) => tr.querySelector('[name="planNote"]').value);
        planRows.innerHTML = pcts.map((p, i) => planRow({ pct: p, note: notes[i] || '' })).join('');
        updatePlan();
      }));
      planRows.addEventListener('click', (e) => {
        if (e.target.matches('[data-remove-plan]') && planRows.rows.length > 1) {
          e.target.closest('tr').remove();
          updatePlan();
        }
      });
    }
    form.addEventListener('input', () => { update(); updatePlan(); });
    form.addEventListener('change', () => { update(); updatePlan(); });
    updatePlan();
    const groupsBox = document.getElementById('itemGroups');
    if (groupsBox) {
      const addGroup = () => {
        groupsBox.insertAdjacentHTML('beforeend', document.getElementById('groupTpl').innerHTML);
        syncType();
        update();
      };
      document.getElementById('addGroup').addEventListener('click', () => {
        addGroup();
        groupsBox.lastElementChild.querySelector('.item-group-head select').focus();
      });
      groupsBox.addEventListener('click', (e) => {
        const g = e.target.closest('.item-group');
        if (e.target.closest('[data-add-row]')) {
          g.querySelector('.group-rows').insertAdjacentHTML('beforeend', document.getElementById('supRowTpl').innerHTML);
          g.querySelector('.group-rows').lastElementChild.querySelector('[name="lnSupplier"]').focus();
          update();
        } else if (e.target.closest('[data-remove-group]')) {
          g.remove();
          if (!groupsBox.querySelector('.item-group')) addGroup();
          update();
        } else if (e.target.closest('[data-remove-line]')) {
          e.target.closest('tr').remove();
          if (!g.querySelector('tr.line-row')) g.remove();
          if (!groupsBox.querySelector('.item-group')) addGroup();
          update();
        }
      });
      // Supplier ใหม่: พิมพ์ชื่อ → เพิ่มเป็นตัวเลือกในทุกช่อง (บันทึกเข้าข้อมูลหลักเมื่อส่งคำขอ)
      groupsBox.addEventListener('change', (e) => {
        const sel = e.target.closest('select[name="lnSupplier"]');
        if (!sel || sel.value !== SUP_NEW) return;
        const name = canonSupplier(window.prompt('ชื่อ Supplier ใหม่') || '');
        if (!name) { sel.value = ''; return; }
        const addOpt = (el) => {
          if (Array.from(el.options).some((o) => o.value === name)) return;
          const o = document.createElement('option');
          o.value = name; o.textContent = name;
          el.insertBefore(o, el.querySelector('option[value="' + SUP_NEW + '"]'));
        };
        form.querySelectorAll('select[name="lnSupplier"]').forEach(addOpt);
        const tpl = document.getElementById('supRowTpl');
        tpl.content.querySelectorAll('select[name="lnSupplier"]').forEach(addOpt);
        document.getElementById('groupTpl').content.querySelectorAll('select[name="lnSupplier"]').forEach(addOpt);
        sel.value = name;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    update();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = readLines(form, isCapex);
      const errors = [];
      if (!useType()) errors.push('กรุณาเลือกประเภทการเบิกใช้งบ');
      if (f.payee && f.payee.required && !f.payee.value.trim()) errors.push('กรุณาระบุผู้รับเงิน');
      if (!lines.length) errors.push('กรุณาใส่รายการที่ขอเบิกอย่างน้อย 1 บรรทัด');
      requestLimitIssues(form).block.forEach((m) => errors.push(m + ' — ขอเกินวงเงินไม่ได้ ต้องขอเพิ่มงบ / ให้ผู้คุมงบโยกงบก่อน'));
      if (f.deliveryDate && !f.deliveryDate.value) errors.push('กรุณาระบุวันที่ส่งมอบ/วางบิล');
      if (f.payDueDate && !f.payDueDate.value) errors.push('กรุณาระบุวันที่กำหนดจ่ายเงิน');
      lines.forEach((l, i) => {
        const no = 'บรรทัดที่ ' + (lineTrs(form).indexOf(l.tr) + 1) + ': ';
        if (perLine && !l.itemId) errors.push(no + (b.type === 'CAPEX' ? 'กรุณาเลือกรายการย่อย (Item No.)' : 'กรุณาเลือกรายการต้นทุน'));
        if (l.category === '') errors.push(no + 'กรุณาพิมพ์ชื่อรายการ');
        if (!l.description) errors.push(no + 'กรุณาระบุรายการ');
        if (!(l.amountBeforeVat > 0)) errors.push(no + 'จำนวนเงินต้องมากกว่า 0');
        if (l.supplier !== undefined && useType() !== 'prpo' && !l.supplier) errors.push(no + 'กรุณาระบุ Supplier');
        if (rowField(l.tr, 'grpPurpose') && !l.purpose) errors.push(no + 'กรุณาระบุวัตถุประสงค์ของรายการ');
      });
      const plan = useType() === 'prpo' || useType() === 'direct' ? readPlan(form) : { mode: 'single', installments: [] };
      if (plan && plan.mode === 'installments') {
        const sumPct = round2(plan.installments.reduce((s, x) => s + x.pct, 0));
        if (plan.installments.length < 2) errors.push('แบ่งจ่ายเป็นงวดต้องมีอย่างน้อย 2 งวด');
        if (plan.installments.some((x) => !(x.pct > 0))) errors.push('กรุณาระบุ % ของทุกงวด');
        if (sumPct !== 100) errors.push('เปอร์เซ็นต์รวมของทุกงวดต้องเท่ากับ 100% (ตอนนี้ ' + sumPct + '%)');
      }
      if (errors.length) { showErrors(errors); return; }

      const now = new Date().toISOString();
      const clean = lines.map((l) => Object.assign({ itemId: l.itemId, description: l.description, amountBeforeVat: l.amountBeforeVat, vat: l.vat, amount: l.amount },
        l.category !== undefined ? { category: l.category } : {}, l.investor !== undefined ? { investor: l.investor } : {}, l.supplier ? { supplier: l.supplier } : {}, l.purpose ? { purpose: l.purpose } : {}));
      const fields = {
        itemId: isCapex ? f.itemId.value : (clean[0] || {}).itemId,
        lines: clean,
        payee: (f.payee ? f.payee.value.trim() : '') || ((names) => (names.length > 3 ? 'Supplier ' + names.length + ' ราย (ดูรายการ)' : names.join(', ')))(uniq(clean.map((l) => l.supplier).filter(Boolean))),
        poNo: 'N/A',
        amountBeforeVat: round2(clean.reduce((s, l) => s + l.amountBeforeVat, 0)),
        vat: round2(clean.reduce((s, l) => s + l.vat, 0)),
        amount: round2(clean.reduce((s, l) => s + l.amount, 0))
      };
      fields.purpose = uniq(clean.map((l) => l.purpose).filter(Boolean)).join(' · ');
      if (f.deliveryDate) fields.deliveryDate = f.deliveryDate.value;
      if (f.payDueDate) fields.payDueDate = f.payDueDate.value;
      clean.forEach((l) => { if (l.supplier) rememberSupplier(l.supplier); });
      fields.memoBackground = f.memoBackground ? f.memoBackground.value.trim() : '';
      fields.useType = useType();
      fields.paymentPlan = plan;
      fields.paymentTerms = planText({ paymentPlan: plan });
      fields.payments = [];
      fields.cuts = [];
      fields.attachments = files;
      fields.requesterReason = f.requesterReason ? f.requesterReason.value.trim() : '';

      let r;
      if (existing) {
        // แก้ไขแล้วส่งใหม่: เก็บผลตรวจสอบรอบก่อนไว้เป็นประวัติ
        r = existing;
        if (existing.status === 'rejected') r.history = (r.history || []).concat(r.steps);
        Object.assign(r, fields, { status: 'pending', steps: stepsFor(b), resubmittedAt: now });
      } else {
        r = Object.assign({
          id: nextId('r'), no: nextReqNo(), budgetId: b.id, type: b.type,
          requesterId: b.ownerId || me().id, createdAt: now, status: 'pending', steps: stepsFor(b), history: [], events: []
        }, isProxy() && b.ownerId !== me().id ? { proxyBy: me().id } : {}, fields);
        db.requests.push(r);
      }
      addEvent(r, existing ? 'แก้ไขและส่งใหม่' : 'ส่งขอเบิกใช้งบ (' + USE_TYPES[r.useType].short + ')', '');

      if (!r.steps.length) {
        issueDocument(r, b, now);
        setFlash('success', 'จัดทำเอกสารเรียบร้อย เลขที่ ' + r.docNo + (r.overBudget ? ' (ใช้เกินงบ — บันทึกเหตุผลแล้ว)' : ''));
      } else {
        setFlash('success', (existing ? 'ส่งคำขอ ' + r.no + ' อีกครั้ง' : 'ส่งคำขอ ' + r.no) + ' เรียบร้อยแล้ว รอผู้คุมงบตรวจสอบ');
      }
      save();
      go('#/request/' + r.id);
    });
  }

  function issueDocument(r, b, at) {
    r.status = 'approved';
    r.approvedAt = at;
    r.docNo = nextDocNo(r, b, at);
    // กฎตัดงบ (cutRule 2): PR/PO = จัดซื้อบันทึก PO · เงินทดรอง = ผู้คุมงบอนุมัติ = จ่ายเงินทดรอง แล้ว Business/ธุรการเคลียร์ตามใบเสร็จ ·
    // สำรองจ่าย / จ่ายตรง Supplier = ตัดงบและปิดยอดทันทีด้วยยอดที่อนุมัติ (ไม่ต้องให้ผู้ใดบันทึกอีก)
    r.cutRule = 2;
    const nowIso = new Date().toISOString();
    if (r.useType === 'advance') {
      r.advance = { date: nowIso.slice(0, 10), amount: r.amount, by: me().id, at: nowIso, auto: true };
      addEvent(r, 'จ่ายเงินทดรอง (ผู้คุมงบอนุมัติ)', money(r.amount) + ' บาท — รอ Business / ธุรการเคลียร์ตามใบเสร็จ');
    } else if (r.useType === 'reimburse' || r.useType === 'direct') {
      const kind = CUT_FOR_TYPE[r.useType];
      r.cuts = (r.cuts || []).concat({ id: nextId('x'), kind, date: nowIso.slice(0, 10), amount: r.amount, note: 'ตัดงบอัตโนมัติเมื่อผู้คุมงบตรวจผ่าน', by: me().id, at: nowIso, attachments: [], asset: 0, expense: 0, ref: '', auto: true });
      addEvent(r, 'ตัดงบอัตโนมัติ (' + CUT_KIND[kind] + ')', money(r.amount) + ' บาท');
      closeRequest(r, 'ตัดงบและปิดยอดอัตโนมัติเมื่อผู้คุมงบตรวจผ่าน');
    }
    if (r.type === 'CBS') {
      // GL ตั้งต้นจากรายการต้นทุน (งบรวมทั้งโครงการ: จากหมวดค่าใช้จ่าย)
      r.lines.forEach((l) => {
        const g = lineGl(b, Object.assign({}, l, { glCode: '' }));
        l.glCode = g.code;
        l.glName = g.name;
      });
    }
  }

  // ---------------------------------------------------------------- request lists

  /** Item ที่คำขอนี้ใช้ (ใบเดียวใช้ได้หลาย Item ทั้ง CAPEX และ OPEX) */
  const reqItems = (b, r) => reqItemIds(r).map((id) => itemById(b, id)).filter(Boolean);
  function itemCodesCell(b, r) {
    const items = reqItems(b, r);
    if (!items.length) return '-';
    if (items.length === 1) return '<span class="nowrap">' + esc(items[0].code) + '</span><div class="muted">' + esc(items[0].name) + '</div>';
    return esc(items.map((i) => i.code).join(', ')) + '<div class="muted">' + items.length + ' รายการ</div>';
  }

  function requestTable(list, showBudget) {
    if (!list.length) return '<div class="card empty">ยังไม่มีคำขอเบิกใช้งบ</div>';
    list = list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return '<div class="table-wrap"><table><thead><tr><th>เลขที่คำขอ</th>' +
      (showBudget ? '<th>งบ</th>' : '') +
      '<th>รายการ</th><th>รายละเอียด</th><th>ผู้ขอ</th><th class="num">จำนวนเงิน</th><th>สถานะ</th><th>เอกสาร</th></tr></thead><tbody>' +
      list.map((r) => {
        const b = budgetById(r.budgetId);
        const step = currentStep(r);
        return '<tr><td class="nowrap"><a href="#/request/' + r.id + '">' + esc(r.no) + '</a><div class="muted">' + fmtDate(r.createdAt) + '</div></td>' +
          (showBudget ? '<td>' + badge(r.type, TYPE_SHORT[r.type]) + ' ' + esc(b ? b.code : '-') + (r.useType && USE_TYPES[r.useType] ? '<div class="muted">' + esc(USE_TYPES[r.useType].short) + '</div>' : '') + '</td>' : '') +
          '<td>' + itemCodesCell(b, r) + '</td>' +
          '<td>' + esc(reqSummary(r)) + (r.overBudget ? ' <span class="badge rejected">เกินงบ</span>' : '') + '</td>' +
          '<td class="nowrap">' + esc(userName(r.requesterId)) + '</td>' +
          '<td class="num">' + money(r.amount) +
          ((r.status === 'approved' || r.status === 'closed') ? '<div class="muted">ตัดงบ ' + money(cutTotal(r)) + '</div>' : '') + '</td>' +
          '<td>' + badge(r.status, statusText(r)) + (needsPO(r) ? '<div class="muted">รอจัดซื้อออก PO</div>' : '') +
          '</td>' +
          '<td class="nowrap">' + (!r.docNo ? '-' : r.status === 'cancelled' ? '<s>' + esc(r.docNo) + '</s> <span class="muted">(ยกเลิก)</span>'
            : '<a href="#/doc/' + r.id + '">' + esc(r.docNo) + '</a>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewRequests() {
    const u = me();
    const list = canViewAll() ? db.requests.filter(reqScoped) : db.requests.filter((r) => r.requesterId === u.id || proxyOf(budgetById(r.budgetId)));
    return '<div class="page-head"><h1>' + 'รายการเบิกใช้งบ' + '</h1></div>' + takeFlash() + requestTable(list, true);
  }


  // ---------------------------------------------------------------- request detail

  function linesTable(b, r, withGl) {
    const isCapex = r.type === 'CAPEX';
    const withCat = r.lines.some((l) => l.category !== undefined);
    const withSup = r.lines.some((l) => l.supplier);
    const withItem = !withCat && b.structure !== 'project';
    return '<div class="table-wrap"><table><thead><tr><th style="width:2.5rem">#</th>' +
      (withCat ? '<th>รายการ</th>' : withItem ? '<th>' + (isCapex ? 'รายการย่อย (Item No.)' : 'รายการต้นทุน') + '</th>' : '') + (withGl ? '<th>GL</th>' : '') +
      '<th>บริษัทที่ลงทุน</th>' + (withSup ? '<th>Supplier</th>' : '') + '<th>' + (isCapex ? 'รายการที่ซื้อ / จ่าย' : 'รายละเอียด') + '</th><th class="num">ก่อน VAT</th><th class="num">VAT 7%</th><th class="num">รวม</th></tr></thead><tbody>' +
      r.lines.map((l, i) => {
        const it = itemById(b, l.itemId) || {};
        return '<tr><td>' + (i + 1) + '</td>' +
          (withCat ? '<td>' + esc(l.category || '-') + '</td>' : withItem ? '<td>' + esc(it.code) + '<div class="muted">' + esc(it.name) + '</div></td>' : '') +
          (withGl ? '<td>' + esc(lineGl(b, l).code || '-') + '<div class="muted">' + esc(lineGl(b, l).code ? lineGl(b, l).name : 'รอบัญชีใส่ GL') + '</div></td>' : '') +
          '<td>' + investorCell(lineInvestor(b, l)) + '</td>' + (withSup ? '<td>' + esc(l.supplier || '-') + '</td>' : '') +
          '<td>' + esc(l.description) + '</td><td class="num">' + money(l.amountBeforeVat) + '</td><td class="num">' + money(l.vat) +
          '</td><td class="num">' + money(l.amount) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td colspan="' + (3 + (withSup ? 1 : 0) + (withCat || withItem ? 1 : 0) + (withGl ? 1 : 0)) + '" class="right"><strong>รวม</strong></td>' +
      '<td class="num">' + money(r.amountBeforeVat) + '</td><td class="num">' + money(r.vat) + '</td><td class="num"><strong>' + money(r.amount) + '</strong></td></tr></tfoot></table></div>';
  }

  /**
   * ยอดที่เกินงบรายการ / เกินงบคงเหลือของโครงการ (คำขอที่รออยู่ไม่นับตัวเองซ้ำ)
   * items = รายการที่เกิน (ใบ OPEX มีได้หลายรายการต้นทุน) · item = ยอดเกินรวมของรายการเหล่านั้น
   */
  function capexOver(r) {
    const b = budgetById(r.budgetId);
    const own = isReserving(r) ? r.amount : 0;
    const projRem = round2(usage(b).remaining + own);
    const items = [];
    if (b.structure !== 'project') {
      // ตรวจทุก Item ที่มีวงเงินในสายของแต่ละบรรทัด (เช่น Item ย่อยที่กำหนดวงเงิน และ Item หลัก)
      const seen = new Set();
      reqItemIds(r).forEach((id) => {
        let it = itemById(b, id);
        while (it) {
          if (hasOwnBudget(b, it) && !seen.has(it.id)) {
            seen.add(it.id);
            const amt = linesAmount(r, leafIdsUnder(b, it));
            const rem = round2(usage(b, it.id).remaining + (isReserving(r) ? amt : 0));
            if (amt > rem) items.push({ item: it, remaining: rem, over: round2(amt - rem), root: rootOf(b, it) });
          }
          it = b.type === 'CBS' ? parentOf(b, it) : null;
        }
      });
    }
    // ยอดเกินรวม: แต่ละสาย (Item หลัก) นับค่าสูงสุดของสายนั้น แล้วรวมทุกสาย
    const perRoot = {};
    items.forEach((x) => { perRoot[x.root.id] = Math.max(perRoot[x.root.id] || 0, x.over); });
    const itemRem = items.length === 1 ? items[0].remaining : projRem;
    return { itemRem, projRem, items, item: round2(Object.values(perRoot).reduce((x, i) => x + i, 0)), project: Math.max(0, round2(r.amount - projRem)) };
  }

  const CUT_KIND = { po: 'ใบสั่งซื้อ (PO)', clear: 'เคลียร์เงินทดรอง', reimburse: 'จ่ายคืนพนักงาน', payment: 'จ่ายเงิน Supplier' };
  const CUT_FOR_TYPE = { prpo: 'po', advance: 'clear', reimburse: 'reimburse', direct: 'payment' };
  /** ประเภทที่บันทึกครั้งเดียวแล้วปิดยอดทันที (ยอดจริงชัดเจนจากใบเสร็จ) */
  const CUT_CLOSES = { clear: true, reimburse: true };
  const cutPerm = (r) => (r.useType === 'prpo' ? 'po.record' : 'cut.record');

  /** การตัดงบของใบเบิกใช้งบ CAPEX ตามประเภท */
  function cutPanel(r) {
    const t = r.useType || 'direct';
    const kind = CUT_FOR_TYPE[t];
    const closed = r.status === 'closed';
    const cut = cutTotal(r);
    // กฎใหม่: เงินทดรองเคลียร์โดย Business / ธุรการ (ผู้ขอ) · กฎเก่า / PR-PO ใช้สิทธิ์เดิม
    const clearByBusiness = r.cutRule === 2 && t === 'advance';
    const canCut = !closed && (clearByBusiness ? isRequesterOrProxy(r) && !!r.advance : can(cutPerm(r)) && (t !== 'advance' || r.advance));
    let html = '<h2>การตัดงบ · ' + esc(USE_TYPES[t].label) + '</h2><section class="card cut-card">' +
      '<p class="muted small-note" style="margin:0 0 var(--s-3)">' + esc(USE_TYPES[t].cut) + ' · ผู้บันทึก: ' + esc(USE_TYPES[t].who) + '</p>' +
      '<div class="cut-summary"><div><span>ขอไว้</span><strong>' + money(r.amount) + '</strong></div>' +
      '<div><span>ตัดงบแล้ว</span><strong>' + money(cut) + '</strong></div>' +
      '<div><span>' + (closed ? 'คืนเข้างบ' : 'ยังจองไว้') + '</span><strong>' + money(closed ? r.closed.returned : Math.max(0, round2(r.amount - cut))) + '</strong></div></div>';
    if (cut > r.amount) html += '<div class="alert warn">ยอดจริงเกินที่ขอ ' + money(round2(cut - r.amount)) + ' บาท</div>';

    if (t === 'advance') {
      if (r.advance) {
        html += '<p class="cut-step done">✓ จ่ายเงินทดรองแล้ว ' + money(r.advance.amount) + ' บาท · ' + fmtDay(r.advance.date) + ' · ' + esc(userName(r.advance.by)) + (r.advance.auto ? ' (ผู้คุมงบอนุมัติ = จ่ายเงินทดรอง)' : '') + '</p>' +
          (clearByBusiness && !closed ? '<div class="alert ' + (isRequesterOrProxy(r) ? 'warn' : 'info') + '">รอ ' + esc(userName(r.requesterId)) + ' (หรือธุรการ) เคลียร์เงินทดรองตามใบเสร็จ — งบจะถูกตัดตามยอดที่เคลียร์</div>' : '');
      } else if (!closed && can('cut.record')) {
        html += '<form id="advForm" class="cut-form" data-id="' + r.id + '"><h3>ขั้นที่ 1: จ่ายเงินทดรอง</h3><div class="row">' +
          '<label class="field"><span>วันที่จ่าย</span><input name="date" type="date" required value="' + today() + '"></label>' +
          '<label class="field"><span>ยอดเงินทดรอง (บาท)</span><input name="amount" type="number" min="0.01" step="0.01" class="right" required value="' + r.amount + '"></label></div>' +
          '<p class="muted small-note">จ่ายเงินทดรองยังไม่ตัดงบ — ตัดงบเมื่อเคลียร์ตามใบเสร็จ</p>' +
          '<div class="actions"><button class="btn primary" type="submit">บันทึกการจ่ายเงินทดรอง</button></div></form>';
      } else {
        html += '<p class="cut-step">รอผู้คุมงบจ่ายเงินทดรอง</p>';
      }
    }

    if ((r.cuts || []).length) {
      html += '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>รายการ</th><th>เลขที่อ้างอิง</th><th class="num">ยอด (รวม VAT)</th><th>ไฟล์</th><th>ผู้บันทึก</th></tr></thead><tbody>' +
        r.cuts.map((c) => '<tr><td class="nowrap">' + fmtDay(c.date) + '</td><td>' + esc(CUT_KIND[c.kind] || c.kind) +
          (c.asset || c.expense ? '<div class="muted">Asset ' + money(c.asset || 0) + ' · Expense ' + money(c.expense || 0) + '</div>' : '') +
          (c.note ? '<div class="muted">' + esc(c.note) + '</div>' : '') + '</td>' +
          '<td>' + (c.prNo ? 'PR ' + esc(c.prNo) + '<br>' : '') + (c.poNo ? 'PO ' + esc(c.poNo) : esc(c.ref || '-')) + '</td>' +
          '<td class="num">' + money(c.amount) + '</td><td>' + ((c.attachments || []).length ? attachList(c.attachments) : '<span class="muted">-</span>') + '</td>' +
          '<td class="nowrap">' + esc(userName(c.by)) + '</td></tr>').join('') + '</tbody></table></div>';
    } else if (!(t === 'advance' && !r.advance)) {
      html += '<p class="muted">ยังไม่มีการตัดงบ' + (t === 'prpo' ? ' — รอจัดซื้อบันทึก PO' : '') + '</p>';
    }

    if (canCut) {
      const isPo = kind === 'po';
      const left = Math.max(0, round2(r.amount - cut));
      const title = { po: 'บันทึก PR / PO (ตัดงบตามยอด PO)', clear: 'ขั้นที่ 2: เคลียร์เงินทดรอง (ตัดงบตามใบเสร็จและปิดยอด)', reimburse: 'จ่ายคืนพนักงาน (ตัดงบตามใบเสร็จและปิดยอด)', payment: 'บันทึกการจ่ายเงิน Supplier' }[kind];
      html += '<form id="cutForm" class="cut-form" data-id="' + r.id + '" data-kind="' + kind + '"><h3>' + title + '</h3><div class="row">' +
        (isPo ? '<label class="field"><span>เลขที่ PR</span><input name="prNo" required></label><label class="field"><span>เลขที่ PO</span><input name="poNo" required></label>'
          : '<label class="field"><span>เลขที่ใบเสร็จ / ใบแจ้งหนี้</span><input name="ref"></label>') +
        '<label class="field"><span>' + (isPo ? 'วันที่ PO' : 'วันที่จ่าย') + '</span><input name="date" type="date" required value="' + today() + '"></label>' +
        '<label class="field"><span>' + (isPo ? 'ยอด PO (รวม VAT)' : kind === 'clear' ? 'ยอดใช้จริงตามใบเสร็จ' : 'ยอดจ่าย (รวม VAT)') + '</span>' +
        '<input name="amount" type="number" min="0.01" step="0.01" class="right" required value="' + (left || '') + '"></label></div>' +
        (isPo || r.type !== 'CAPEX' || clearByBusiness ? '' : '<div class="row"><label class="field"><span>Asset (บัญชี — ไม่บังคับ)</span><input name="asset" type="number" min="0" step="0.01" class="right"></label>' +
          '<label class="field"><span>Expenses (บัญชี — ไม่บังคับ)</span><input name="expense" type="number" min="0" step="0.01" class="right"></label></div>') +
        '<label class="field"><span>หมายเหตุ (จำเป็นถ้ายอดรวมเกินที่ขอ)</span><input name="note"></label>' +
        '<div class="field"><span>แนบไฟล์ ' + (isPo ? 'PO' : 'ใบเสร็จ / หลักฐานการจ่าย') + '</span><input type="file" name="files" accept="application/pdf,image/png,image/jpeg" multiple></div>' +
        '<div class="actions"><button class="btn primary" type="submit">' + (CUT_CLOSES[kind] ? 'บันทึกและปิดยอด' : 'บันทึก') + '</button></div></form>';
    }
    if (!closed && cut > 0 && !CUT_CLOSES[kind] && (can(cutPerm(r)) || can('cut.record'))) {
      html += '<form id="closeForm" class="cut-form" data-id="' + r.id + '"><h3>ยืนยันยอดจริงและปิดยอด</h3>' +
        '<p class="muted small-note">ปิดแล้วจะคืนส่วนต่าง ' + money(Math.max(0, round2(r.amount - cut))) + ' บาทเข้างบ และบันทึกการตัดงบเพิ่มไม่ได้อีก</p>' +
        '<label class="field"><span>หมายเหตุ (จำเป็นถ้ายอดจริงเกินที่ขอ)</span><input name="note"></label>' +
        '<div class="actions"><button class="btn ok" type="submit">ปิดยอด</button></div></form>';
    }
    if (closed) {
      html += '<div class="alert ok">ปิดยอดแล้ว · ยอดจริง ' + money(r.closed.actual) + ' บาท' + (r.closed.returned ? ' · คืนเข้างบ ' + money(r.closed.returned) + ' บาท' : '') +
        (r.closed.over ? ' · เกินที่ขอ ' + money(r.closed.over) + ' บาท' : '') + '<br><small>' + esc(userName(r.closed.by)) + ' · ' + fmtDate(r.closed.at) +
        (r.closed.note ? ' · ' + esc(r.closed.note) : '') + '</small>' +
        (t === 'advance' && r.advance ? '<br><small>' + (r.advance.amount > r.closed.actual ? 'พนักงานต้องคืนเงินทดรองส่วนที่เหลือ ' + money(round2(r.advance.amount - r.closed.actual)) + ' บาท'
          : r.advance.amount < r.closed.actual ? 'บริษัทต้องจ่ายเพิ่มให้พนักงาน ' + money(round2(r.closed.actual - r.advance.amount)) + ' บาท' : 'ยอดเคลียร์เท่ากับเงินทดรอง') + '</small>' : '') + '</div>';
    }
    return html + '</section>';
  }

  /** ปิดยอด: ยืนยันยอดจริง คืนส่วนต่างเข้างบ */
  function closeRequest(r, note) {
    const actual = cutTotal(r);
    r.status = 'closed';
    r.closed = { at: new Date().toISOString(), by: me().id, actual, returned: Math.max(0, round2(r.amount - actual)), over: Math.max(0, round2(actual - r.amount)), note: note || '' };
    addEvent(r, 'ปิดยอด (ยืนยันยอดจริง)', 'ยอดจริง ' + money(actual) + (r.closed.returned ? ' · คืนเข้างบ ' + money(r.closed.returned) : '') +
      (r.closed.over ? ' · เกินที่ขอ ' + money(r.closed.over) : '') + (note ? ' · ' + note : ''));
  }

  function bindCuts() {
    const adv = document.getElementById('advForm');
    if (adv) {
      adv.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = requestById(adv.dataset.id);
        const amount = round2(adv.elements.amount.value);
        if (!(amount > 0)) { alert('จำนวนเงินต้องมากกว่า 0'); return; }
        r.advance = { date: adv.elements.date.value, amount, by: me().id, at: new Date().toISOString() };
        addEvent(r, 'จ่ายเงินทดรอง', money(amount) + ' บาท');
        save();
        setFlash('success', 'บันทึกการจ่ายเงินทดรอง ' + money(amount) + ' บาทแล้ว — ตัดงบเมื่อเคลียร์ตามใบเสร็จ');
        go('#/request/' + r.id);
      });
    }
    const cf = document.getElementById('cutForm');
    if (cf) {
      cf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = requestById(cf.dataset.id);
        const f = cf.elements;
        const kind = cf.dataset.kind;
        const amount = round2(f.amount.value);
        const note = f.note.value.trim();
        if (!(amount > 0)) { alert('จำนวนเงินต้องมากกว่า 0'); return; }
        if (round2(cutTotal(r) + amount) > r.amount + 0.005 && !note) { alert('ยอดรวมเกินที่ขอ ' + money(round2(cutTotal(r) + amount - r.amount)) + ' บาท — กรุณาระบุหมายเหตุ'); return; }
        const asset = f.asset && f.asset.value !== '' ? round2(f.asset.value) : 0;
        const expense = f.expense && f.expense.value !== '' ? round2(f.expense.value) : 0;
        if (asset + expense > amount + 0.005) { alert('Asset + Expenses เกินยอดที่บันทึก'); return; }
        const files = await readFiles(f.files, kind);
        if (f.files.files.length && !files.length) return;
        const c = { id: nextId('x'), kind, date: f.date.value, amount, note, by: me().id, at: new Date().toISOString(), attachments: files, asset, expense };
        if (kind === 'po') Object.assign(c, { prNo: f.prNo.value.trim(), poNo: f.poNo.value.trim() });
        else c.ref = f.ref.value.trim();
        r.cuts = (r.cuts || []).concat(c);
        if (kind === 'po') r.poNo = r.cuts.filter((x) => x.kind === 'po').map((x) => x.poNo).join(', ');
        addEvent(r, 'บันทึก' + CUT_KIND[kind], money(amount) + ' บาท' + (c.poNo ? ' · PO ' + c.poNo : c.ref ? ' · ' + c.ref : ''));
        if (CUT_CLOSES[kind]) closeRequest(r, note);
        if (!save()) return;
        setFlash('success', 'บันทึก' + CUT_KIND[kind] + ' ' + money(amount) + ' บาทแล้ว' + (CUT_CLOSES[kind] ? ' และปิดยอดเรียบร้อย' : ''));
        go('#/request/' + r.id);
      });
    }
    const cl = document.getElementById('closeForm');
    if (cl) {
      cl.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = requestById(cl.dataset.id);
        const note = cl.elements.note.value.trim();
        if (cutTotal(r) > r.amount + 0.005 && !note) { alert('ยอดจริงเกินที่ขอ — กรุณาระบุหมายเหตุ'); return; }
        if (!confirm('ยืนยันยอดจริง ' + money(cutTotal(r)) + ' บาท และปิดยอด?')) return;
        closeRequest(r, note);
        save();
        setFlash('success', 'ปิดยอด ' + (r.docNo || r.no) + ' แล้ว' + (r.closed.returned ? ' คืน ' + money(r.closed.returned) + ' บาทเข้างบ' : ''));
        go('#/request/' + r.id);
      });
    }
  }

  function viewRequestDetail(id) {
    const r = requestById(id);
    if (!r) return notFound();
    const b = budgetById(r.budgetId);
    const u = me();
    const step = currentStep(r);
    const isCapex = true; // ชื่อเดิม: OPEX ใช้ขั้นตอนเดียวกับ CAPEX จึงเป็น true เสมอ
    const isOwner = r.requesterId === u.id || proxyOf(b);

    // ---- ปุ่มคำสั่งของหน้า (อยู่บนหัวหน้า เห็นได้ทันที)
    const actions = [];
    if (r.docNo && (r.status === 'approved' || r.status === 'closed')) actions.push('<a class="btn primary" href="#/doc/' + r.id + '">เปิดเอกสาร ' + esc(r.docNo) + '</a>');
    if (r.status === 'rejected' && isOwner) actions.push('<a class="btn primary" href="#/request/' + r.id + '/edit">แก้ไขและส่งใหม่</a>');
    if (r.status === 'memo' && isOwner) actions.push('<a class="btn" href="#/request/' + r.id + '/edit">แก้ไขคำขอ</a>');
    if (r.memo && r.memo.no) actions.push('<a class="btn' + (r.status === 'memo' ? ' primary' : '') + '" href="#/request/' + r.id + '/memo">พิมพ์ Memo ' + esc(r.memo.no) + '</a>');
    if (isOwner && can('request.create') && b && isActive(b)) actions.push('<a class="btn" href="#/request/new/' + b.id + '?copy=' + r.id + '">ทำซ้ำรายการเบิก (Duplicate)</a>');
    if ((r.status === 'pending' || r.status === 'rejected' || r.status === 'memo') && isOwner) {
      actions.push('<button class="btn bad" id="cancelRequest" data-id="' + r.id + '">ยกเลิกคำขอ</button>');
    }

    let html = '<div class="page-head detail-head"><div>' +
      '<div class="eyebrow">เบิกใช้งบ · ' + esc(USE_TYPES[r.useType || 'direct'].label) + ' · ' + badge(b.type, TYPE_SHORT[b.type]) +
      ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a> ' + esc(b.name) + '</div>' +
      '<h1>' + esc(r.no) + ' ' + badge(r.status, statusText(r)) + '</h1></div>' +
      (actions.length ? '<div class="head-actions">' + actions.join('') + '</div>' : '') + '</div>' + takeFlash();

    if (r.status === 'cancelled') {
      html += '<div class="alert error">ยกเลิกโดย ' + esc(userName(r.cancelledBy || r.requesterId)) + ' เมื่อ ' + fmtDate(r.cancelledAt) +
        (r.docNo ? ' · เอกสารเลขที่ ' + esc(r.docNo) + ' ใช้ไม่ได้แล้ว และคืนยอดเข้างบเรียบร้อย' : '') +
        (r.cancelReason ? '<br>เหตุผล: ' + esc(r.cancelReason) : '') + '</div>';
    }
    if (r.overBudget) html += '<div class="alert warn">ใช้เกินงบของรายการต้นทุน · เหตุผล: ' + esc(r.overBudgetReason) + '</div>';
    if (r.status === 'pending') {
      const ov = capexOver(r);
      if (ov.project > 0) html += '<div class="alert error">เกินงบคงเหลือของโครงการ ' + money(ov.project) + ' บาท (คงเหลือ ' + money(ov.projRem) + ') — ผู้คุมงบต้องโยกงบเข้าก่อนจึงอนุมัติได้ หรือส่งกลับให้ขอเพิ่มงบ</div>';
      else if (ov.item > 0) html += '<div class="alert warn">ขอเกินงบ' + (ov.items.length === 1 && b.type === 'CAPEX' ? 'รายการย่อย' : 'รายการ ') + ov.items.map((x) => (x.item ? esc(x.item.code) + ' ' : '') + 'อยู่ ' + money(x.over) + ' บาท (คงเหลือ ' + money(x.remaining) + ')').join(' · ') + ' แต่ยังไม่เกินงบรวมของโครงการ — ผู้คุมงบต้องใส่ Note เมื่ออนุมัติ</div>';
    }
    if (isCapex && r.approverNote) html += '<div class="alert info">Note ผู้คุมงบ' + (r.overItem ? ' (อนุมัติเกินงบรายการ ' + money(r.overItem) + ' บาท)' : '') + ': ' + esc(r.approverNote) + '</div>';

    // ---- ข้อมูลหลักแบบตาราง (ประหยัดพื้นที่)
    const fact = (label, value, wide) => (value || value === 0
      ? '<div class="fact' + (wide ? ' wide' : '') + '"><span>' + label + '</span><strong>' + value + '</strong></div>' : '');
    const facts = '<section class="card"><div class="facts">' +
      (isCapex ? fact('ประเภท', esc(USE_TYPES[r.useType || 'direct'].label) + '<small>' + esc(USE_TYPES[r.useType || 'direct'].cut) + '</small>') : '') +
      fact(b.structure === 'project' ? 'งบที่ใช้' : b.type === 'CBS' ? 'รายการต้นทุน' : 'รายการย่อย', b.structure === 'project' ? 'งบรวมทั้งโครงการ'
        : itemCodesCell(b, r)) +
      fact('ผู้ขอ', esc(userName(r.requesterId)) + '<small>' + esc(b.department) + '</small>' + (r.proxyBy ? '<small>ทำแทนโดย ' + esc(userName(r.proxyBy)) + '</small>' : '')) +
      fact(isCapex ? 'วันที่ขอ' : 'วันที่เบิก', isCapex ? fmtDate(r.createdAt) : fmtDay(r.expenseDate)) +
      fact(isCapex ? (r.useType === 'advance' || r.useType === 'reimburse' ? 'ผู้รับเงิน (พนักงาน)' : 'Supplier (ผู้รับเงิน)') : 'ผู้รับเงิน', esc(r.payee)) +
      fact('PO No.', isCapex && r.useType === 'prpo' ? (hasPO(r) ? esc(r.poNo) : '<span class="muted">' + (r.status === 'approved' ? 'รอจัดซื้อออก PO' : 'ออกหลังผู้คุมงบอนุมัติ') + '</span>')
        : isCapex ? '<span class="muted">ไม่ต้องออก PO</span>' : esc(r.poNo)) +
      (isCapex && (r.useType === 'prpo' || r.useType === 'direct') ? fact('เงื่อนไขการจ่าย', esc(planText(r))) : '') +
      (r.deliveryDate ? fact('วันที่ส่งมอบ/วางบิล', fmtDay(r.deliveryDate)) : '') +
      (r.payDueDate ? fact('วันที่กำหนดจ่ายเงิน', fmtDay(r.payDueDate)) : '') +
      (r.requestDate ? fact('วันที่เบิก', fmtDay(r.requestDate)) : '') +
      (isCapex && r.purpose ? fact('วัตถุประสงค์', esc(r.purpose), true) : '') +
      (r.memoBackground ? fact('เรื่องสืบเนื่อง / ความเป็นมา (Memo)', esc(r.memoBackground).replace(/\n/g, '<br>'), true) : '') +
      (r.memo ? fact('Memo', esc(r.memo.no) + '<small><a href="#/request/' + r.id + '/memo' + (canEditMemo(r) ? '' : '?view=1') + '">' + (canEditMemo(r) ? 'กรอก / แก้ไข Memo' : 'เปิด Memo') + '</a></small>') : '') +
      (isCapex && r.requesterReason ? fact('เหตุผลที่ขอเกินงบ (ผู้ขอ)', esc(r.requesterReason), true) : '') +
      '</div></section>';

    // ---- คอลัมน์ขวา: ยอดเงิน + สถานะ + ฟอร์มตัดสินใจ
    let side = '<div class="card total-card"><span class="muted">รวมจำนวนเงิน</span>' +
      '<div class="total-amount">' + money(r.amount) + ' <small>บาท</small></div>' +
      '<div class="total-split"><span>ก่อน VAT ' + money(r.amountBeforeVat) + '</span><span>VAT ' + money(r.vat) + '</span><span>' + r.lines.length + ' บรรทัด</span></div>';
    if (isCapex && (r.status === 'approved' || r.status === 'closed')) {
      const cut = cutTotal(r);
      const pct = r.amount > 0 ? Math.min(100, (cut / r.amount) * 100) : 0;
      side += '<div class="paid-bar"><div class="bar"><div class="used" style="width:' + pct + '%"></div></div>' +
        '<div class="muted small-note" style="margin:.4rem 0 0">ตัดงบแล้ว ' + money(cut) + (r.status === 'closed' ? ' · ปิดยอดแล้ว' : ' · ยังจองไว้ ' + money(Math.max(0, round2(r.amount - cut)))) + '</div></div>';
    }
    side += '</div>';

    const tl = (cls, title, sub, note) => '<li class="' + cls + '"><span class="tl-dot"></span><div><strong>' + title + '</strong>' +
      (sub ? '<div class="muted">' + sub + '</div>' : '') + (note ? '<div class="tl-note">“' + esc(note) + '”</div>' : '') + '</div></li>';
    const stepLi = (s) => tl(s.status === 'waiting' ? (s === step ? 'current' : '') : s.status,
      esc(s.label) + (s.status === 'rejected' ? ' — ไม่อนุมัติ' : ''),
      s.by ? esc(userName(s.by)) + ' · ' + fmtDate(s.at) : s === step ? 'กำลังรอ ' + esc(stepAssigneeText(s)) : esc(stepAssigneeText(s)),
      s.comment);
    let timeline = tl('done', r.memo && r.memo.no ? 'บันทึกคำขอ / ออก Memo ' + esc(r.memo.no) : 'ส่งคำขอ', esc(userName(r.requesterId)) + ' · ' + fmtDate(r.createdAt));
    if (r.memo && r.memo.no) {
      timeline += r.status === 'memo'
        ? tl('current', 'รอผู้บริหารเซ็น Memo', 'ผู้ขอพิมพ์ Memo ไปให้ผู้บริหารเซ็น แล้วแนบกลับเข้าระบบ')
        : tl('done', 'แนบ Memo ที่เซ็นแล้ว', (r.memo.by ? 'เซ็นโดย ' + esc(r.memo.by) : '') + (r.memo.at ? ' · ' + fmtDate(r.memo.at) : ''));
    }
    if (r.history && r.history.length) {
      timeline += r.history.map(stepLi).join('') + tl('done', 'แก้ไขและส่งใหม่', fmtDate(r.resubmittedAt));
    }
    timeline += r.steps.map(stepLi).join('');
    if (r.status === 'approved' || r.status === 'closed') timeline += tl('approved', 'ออก' + docTitle(r) + ' ' + esc(r.docNo), fmtDate(r.approvedAt));
    if (r.status === 'closed') timeline += tl('approved', 'ปิดยอดแล้ว', esc(userName(r.closed.by)) + ' · ' + fmtDate(r.closed.at));
    if (r.status === 'cancelled') timeline += tl('rejected', 'ยกเลิก', esc(userName(r.cancelledBy || r.requesterId)) + ' · ' + fmtDate(r.cancelledAt));

    side += '<div class="card"><h3 class="side-title">สถานะ</h3><ol class="timeline">' + timeline + '</ol>';
    if (canAct(u, step)) {
      const ov = isCapex ? capexOver(r) : { item: 0, project: 0 };
      side += '<form id="decisionForm" class="decision" data-id="' + r.id + '">' +
        (ov.project > 0
          ? '<div class="alert error small">เกินงบโครงการ ' + money(ov.project) + ' บาท — โยกงบเข้าก่อน หรือส่งกลับให้ขอเพิ่มงบ</div>' +
            '<a class="btn" style="width:100%;margin-bottom:var(--s-3)" href="#/adjust?to=' + b.id + '&item=' + r.itemId + '&amount=' + ov.project + '">โยกงบเข้าโครงการนี้</a>'
          : '') +
        '<label class="field"><span>' + (ov.item > 0 && ov.project <= 0 ? 'Note เหตุผลที่ให้ผ่าน (จำเป็น — ขอเกินงบรายการ ' + money(ov.item) + ' บาท)' : 'Note / เหตุผล (จำเป็นเมื่อส่งกลับ)') + '</span>' +
        '<textarea name="comment" rows="2" placeholder="เช่น ควรใช้งบตัวไหนแทน"></textarea></label>' +
        '<div class="decision-actions"><button class="btn ok" type="submit" data-decision="approved"' + (ov.project > 0 ? ' disabled title="เกินงบโครงการ"' : '') + '>' +
        (isCapex ? 'อนุมัติ ออกใบเบิกใช้งบ' : 'อนุมัติเอกสาร') + '</button>' +
        '<button class="btn bad" type="submit" data-decision="rejected">ส่งกลับให้แก้ไข</button></div></form>';
    }
    side += '</div>';
    if (isCapex) side += historyCard(r.events, 'บันทึกการดำเนินการ');

    let main = facts + '<h2>' + (isCapex ? 'รายการที่ขอใช้' : 'รายการที่ขอเบิก') + '</h2>' + linesTable(b, r, r.type === 'CBS');
    if (r.status === 'memo') {
      main = (isOwner
        ? '<section class="card memo-card"><h2 class="section-title">ขั้นถัดไป: ให้ผู้บริหารเซ็น Memo แล้วแนบกลับเข้าระบบ</h2>' +
          '<ol class="memo-steps"><li class="done">บันทึกคำขอและออก Memo เลขที่ <strong>' + esc(r.memo.no) + '</strong> แล้ว (จองงบไว้ ' + money(r.amount) + ' บาท)</li>' +
          '<li class="current"><a href="#/request/' + r.id + '/memo">กรอก / พิมพ์ Memo</a>' + (r.memoDoc ? ' (กรอกแล้ว)' : '') + ' แล้วนำไปให้ผู้บริหารเซ็น</li>' +
          '<li>แนบไฟล์ Memo ที่เซ็นแล้วด้านล่าง แล้วส่งให้ผู้คุมงบตรวจสอบ</li></ol>' +
          '<form id="memoSubmit" data-id="' + r.id + '"><div class="form-grid">' +
          '<div class="field full"><span>ไฟล์ Memo ที่เซ็นแล้ว (PDF หรือรูปภาพ)</span>' + attachList(r.memo.files, { del: true, empty: 'ยังไม่ได้แนบ Memo' }) +
          '<label class="btn small file-btn">+ แนบไฟล์ Memo<input type="file" id="memoFileInput" accept="application/pdf,image/png,image/jpeg" multiple hidden></label></div></div>' +
          '<div class="actions"><button class="btn primary" type="submit">ส่งให้ผู้คุมงบตรวจสอบ</button></div></form></section>'
        : '<div class="alert info">รอผู้ขอนำ Memo เลขที่ ' + esc(r.memo.no) + ' ไปให้ผู้บริหารเซ็นและแนบกลับเข้าระบบ — ผู้คุมงบจะตรวจสอบได้เมื่อแนบแล้ว</div>') + main;
    } else if (r.memo && (r.memo.files || []).length) {
      main += '<h2>Memo ผู้บริหารเซ็น</h2><section class="card"><p class="memo-meta">เลขที่ <strong>' + esc(r.memo.no) + '</strong>' + (r.memo.by ? ' · เซ็นโดย <strong>' + esc(r.memo.by) + '</strong>' : '') + '</p>' +
        attachList(r.memo.files, { empty: 'ยังไม่ได้แนบ Memo' }) + '</section>';
    }
    if ((r.attachments || []).length) main += '<h2>เอกสารประกอบ</h2><section class="card">' + attachList(r.attachments) + '</section>';
    if (r.status === 'approved' || r.status === 'closed') main += cutPanel(r);

    return html + '<div class="detail-layout"><div class="detail-main">' + main + '</div><aside class="detail-side">' + side + '</aside></div>';
  }

  function bindRequestDetail() {
    const ms = document.getElementById('memoSubmit');
    if (ms) {
      const r = requestById(ms.dataset.id);
      // ผู้บริหารที่เซ็น = ผู้พิจารณาอนุมัติที่กรอกไว้ใน Memo (ไม่ต้องพิมพ์ซ้ำ)
      const keepBy = () => { r.memo.by = memoSigners(r); };
      document.getElementById('memoFileInput').addEventListener('change', async (e) => {
        const files = await readFiles(e.target, 'memo');
        if (!files.length) return;
        keepBy();
        r.memo.files = (r.memo.files || []).concat(files);
        addEvent(r, 'แนบไฟล์ Memo ที่เซ็นแล้ว', files.map((x) => x.name).join(', '));
        if (save()) go('#/request/' + r.id);
      });
      ms.addEventListener('click', (e) => {
        const del = e.target.closest('[data-att-del]');
        if (!del) return;
        keepBy();
        r.memo.files = r.memo.files.filter((x) => x.id !== del.dataset.attDel);
        save();
        go('#/request/' + r.id);
      });
      ms.addEventListener('submit', (e) => {
        e.preventDefault();
        keepBy();
        const errors = [];
        if (!(r.memo.files || []).length) errors.push('กรุณาแนบไฟล์ Memo ที่ผู้บริหารเซ็นแล้ว');
        if (errors.length) { alert(errors.join('\n')); return; }
        r.memo.at = new Date().toISOString();
        r.status = 'pending';
        addEvent(r, 'แนบ Memo ที่เซ็นแล้วและส่งให้ผู้คุมงบตรวจสอบ', r.memo.no + (r.memo.by ? ' · ' + r.memo.by : ''));
        save();
        setFlash('success', 'ส่งคำขอ ' + r.no + ' พร้อม Memo ที่เซ็นแล้วให้ผู้คุมงบตรวจสอบแล้ว');
        go('#/request/' + r.id);
      });
    }
    const form = document.getElementById('decisionForm');
    if (form) {
      let decision = 'approved';
      form.querySelectorAll('[data-decision]').forEach((btn) =>
        btn.addEventListener('click', () => { decision = btn.dataset.decision; }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        let r = requestById(form.dataset.id);
        const b = budgetById(r.budgetId);
        const step = currentStep(r);
        const u = me();
        if (!canAct(u, step)) return;
        const comment = form.elements.comment.value.trim();
        if (decision === 'rejected' && !comment) {
          alert('กรุณาแจ้งเหตุผลที่ส่งกลับ');
          return;
        }
        let ov = { item: 0, project: 0 };
        if (decision === 'approved') {
          ov = capexOver(r);
          if (ov.project > 0) { alert('เกินงบคงเหลือของโครงการ ' + money(ov.project) + ' บาท — โยกงบเข้าก่อน หรือส่งกลับให้ขอเพิ่มงบ'); return; }
          if (ov.item > 0 && !comment) { alert('ขอเกินงบรายการ ' + money(ov.item) + ' บาท — กรุณาใส่ Note เหตุผลที่ให้ผ่าน'); return; }
        }
        if (REMOTE) {
          if (!(await runAndReload(() => window.RemoteApi.decide(r.id, decision, comment)))) return;
          r = requestById(r.id);
          setFlash(decision === 'rejected' ? 'info' : 'success', decision === 'rejected'
            ? 'ไม่อนุมัติคำขอ ' + r.no + ' แล้ว แจ้งเหตุผลให้ผู้ขอแก้ไขหรือยกเลิก งบที่จองไว้ถูกคืนเรียบร้อย'
            : 'อนุมัติเอกสารแล้ว ออกใบเบิกงบประมาณเลขที่ ' + r.docNo);
          go('#/request/' + r.id);
          return;
        }
        Object.assign(step, { status: decision, by: u.id, at: new Date().toISOString(), comment });
        if (decision === 'rejected') {
          r.status = 'rejected';
          addEvent(r, 'ส่งกลับให้แก้ไข', comment);
          setFlash('info', 'ส่งคำขอ ' + r.no + ' กลับให้ผู้ขอแก้ไขแล้ว งบที่จองไว้ถูกคืนเรียบร้อย');
        } else {
          Object.assign(r, { approverNote: comment, overItem: ov.item });
          issueDocument(r, b, step.at);
          addEvent(r, 'อนุมัติ ออก' + docTitle(r) + ' ' + r.docNo, comment);
          setFlash('success', 'อนุมัติแล้ว ออก' + docTitle(r) + 'เลขที่ ' + r.docNo + (r.useType === 'prpo' ? ' — รอจัดซื้อบันทึก PO' : ''));
        }
        save();
        go('#/request/' + r.id);
      });
    }

    const cancel = document.getElementById('cancelRequest');
    if (cancel) {
      cancel.addEventListener('click', async () => {
        let r = requestById(cancel.dataset.id);
        let reason = '';
        if (r.status === 'approved') {
          // เอกสารที่ออกไปแล้วต้องระบุเหตุผลการยกเลิกไว้ตรวจสอบย้อนหลัง
          reason = (prompt('ระบุเหตุผลที่ยกเลิกเอกสาร ' + r.docNo + ' (เช่น เลือกตัวงบผิด / ยอดผิด)') || '').trim();
          if (!reason) return;
        } else if (!confirm('ยืนยันการยกเลิกคำขอนี้?')) {
          return;
        }
        const wasIssued = r.status === 'approved';
        if (REMOTE) {
          if (!(await runAndReload(() => window.RemoteApi.cancel(r.id, reason)))) return;
          r = requestById(r.id);
        } else {
          r.status = 'cancelled';
          r.cancelledAt = new Date().toISOString();
          r.cancelledBy = me().id;
          r.cancelReason = reason;
          addEvent(r, 'ยกเลิกคำขอ', reason);
          save();
        }
        setFlash('info', wasIssued
          ? 'ยกเลิกเอกสาร ' + r.docNo + ' แล้ว คืนยอด ' + money(r.amount) + ' บาทเข้างบเรียบร้อย'
          : 'ยกเลิกคำขอ ' + r.no + ' แล้ว');
        go('#/request/' + r.id);
      });
    }
  }

  // ---------------------------------------------------------------- documents

  // ---- ยอดเงินเป็นตัวอักษรไทย เช่น 4,300,000 → สี่ล้านสามแสนบาทถ้วน
  const TH_DIGIT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const TH_POS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function thaiGroup(str, prefixed) {
    const t = str.replace(/^0+/, '');
    let out = '';
    for (let i = 0; i < t.length; i += 1) {
      const d = Number(t[i]);
      const pos = t.length - 1 - i;
      if (!d) continue;
      if (pos === 0) out += d === 1 && (t.length > 1 || prefixed) ? 'เอ็ด' : TH_DIGIT[d];
      else if (pos === 1) out += (d === 1 ? '' : d === 2 ? 'ยี่' : TH_DIGIT[d]) + 'สิบ';
      else out += TH_DIGIT[d] + TH_POS[pos];
    }
    return out;
  }
  function thaiInt(str) {
    const t = String(str).replace(/^0+/, '');
    if (!t) return 'ศูนย์';
    if (t.length <= 6) return thaiGroup(t, false);
    return thaiInt(t.slice(0, -6)) + 'ล้าน' + thaiGroup(t.slice(-6), true);
  }
  function bahtText(n) {
    const v = Math.round(Math.abs(Number(n) || 0) * 100);
    const baht = Math.floor(v / 100);
    const sat = v % 100;
    if (!baht && sat) return thaiInt(String(sat)) + 'สตางค์';
    return thaiInt(String(baht)) + 'บาท' + (sat ? thaiInt(String(sat)) + 'สตางค์' : 'ถ้วน');
  }

  /** ข้อมูลที่ระบบคำนวณให้ใน Memo (ยอดเงิน ครั้งที่ ฯลฯ) และค่าเริ่มต้นของช่องที่ผู้ขอกรอกเองได้ */
  function memoModel(b, r) {
    const cname = (c) => companyMap()[c] || c;
    const t = USE_TYPES[r.useType] || {};
    const perLine = b.structure !== 'project';
    // CAPEX: กรอบวงเงินใน Memo = Item ที่ขอใช้ (ใบเดียวมีได้หลาย Item) · OPEX / งบรวมโครงการ = ทั้งโครงการ
    const capexItems = b.type === 'CAPEX' && perLine ? reqItems(b, r) : [];
    const ids = capexItems.length ? uniq([].concat(...capexItems.map((x) => leafIdsUnder(b, x)))) : null;
    const scopeCodes = capexItems.map((x) => x.code).join(', ');
    const scopeNames = capexItems.map((x) => x.code + ' ' + x.name).join(', ');

    // บริษัทที่ลงทุน (ถ้ามีหลายบริษัท ใช้บริษัทที่ลงทุนมากที่สุดเป็นผู้พิจารณา)
    const byInv = {};
    r.lines.forEach((l) => { const c = lineInvestor(b, l); byInv[c] = round2((byInv[c] || 0) + l.amount); });
    const invCodes = Object.keys(byInv).sort((x, y) => byInv[y] - byInv[x]);
    const investor = invCodes[0] || b.company;
    const mp = r.memoParties || defaultMemoParties(b, investor);

    // ครั้งที่ และยอดที่เบิกไปแล้วก่อนหน้า
    const live = ['memo', 'pending', 'approved', 'closed'];
    const prior = db.requests.filter((x) => x.budgetId === b.id && x.id !== r.id && live.includes(x.status) && x.createdAt < r.createdAt)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    const seq = prior.length + 1;
    const approved = ids ? round2(b.items.filter((x) => ids.includes(x.id)).reduce((s2, x) => s2 + itemTotal(x), 0)) : budgetTotal(b);
    const share = (x) => { const a = linesAmount(x, ids); return x.status === 'closed' && x.amount > 0 ? cutTotal(x) * a / x.amount : a; };
    const priorRows = prior.map((x, i) => ({ label: 'ครั้งที่ ' + (i + 1) + ' (' + (x.docNo || x.no) + ')' + (x.purpose ? ' — ' + x.purpose : ''), amount: round2(share(x)) })).filter((x) => x.amount > 0);
    const priorSum = round2(priorRows.reduce((s2, x) => s2 + x.amount, 0));
    const now = ids ? linesAmount(r, ids) : r.amount;
    const after = round2(approved - priorSum - now);

    // รายการที่ขอใช้ครั้งนี้ จัดกลุ่มตามหมวด / รายการ
    const groups = [];
    r.lines.forEach((l) => {
      const it = itemById(b, l.itemId) || {};
      const key = l.category || (perLine ? ((it.code || '') + ' ' + (it.name || '')).trim() : b.name);
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, amount: 0, descs: [] }; groups.push(g); }
      g.amount = round2(g.amount + l.amount);
      g.descs.push(l.description + (invCodes.length > 1 ? ' [ลงทุนโดย ' + lineInvestor(b, l) + ']' : ''));
    });

    // อ้างอิงหลักฐานการอนุมัติงบ (มติที่ประชุม / เอกสารอนุมัติผู้บริหาร)
    const m = b.meeting || {};
    const ap = apprOf(b.type);
    const refText = m.no
      ? (ap.exec ? 'เอกสารอนุมัติจากผู้บริหาร เลขที่ ' + m.no + (m.by ? ' (ผู้อนุมัติ: ' + m.by + ')' : '') : 'มติที่ประชุม ' + m.no) + (m.date ? ' วันที่ ' + fmtDay(m.date) : '')
      : 'งบ ' + b.code + ' ' + b.name;

    const amt = (v) => money(v) + ' บาท (' + bahtText(v) + ')';
    const items = b.structure === 'project' ? [] : leaves(b);
    const background = 'สืบเนื่องจาก' + refText + ' ได้อนุมัติงบ ' + b.code + ' ' + b.name + ' กรอบวงเงิน' +
      (capexItems.length ? 'ของรายการ ' + scopeNames + ' ' : 'รวมทั้งสิ้น ') + amt(approved) +
      (r.memoBackground ? '\n\n' + r.memoBackground : '') +
      (items.length ? '\n\nโดยมีกรอบวงเงินแยกตามรายการ ดังนี้:\n' + items.map((it, i) => '1.' + (i + 1) + ' ' + it.code + ' ' + it.name + ' จำนวน ' +
        money(itemTotal(it)) + ' บาท').join('\n') : '');
    const consider = (r.purpose ? 'เพื่อ' + r.purpose + ' ' : '') + cname(b.company) + ' จึงมีความประสงค์ขอเบิกใช้งบ ครั้งที่ ' + seq + ' (' + (t.label || '') + ')' +
      (r.payee ? ' ผู้รับเงิน / Supplier: ' + r.payee : '') + ' ในหมวด';
    const defaults = {
      to: (mp.to.length ? mp.to : ['ผู้บริหาร']).concat([cname(investor)]).join('\n'),
      date: fmtDay(r.createdAt),
      cc: mp.cc.join(' , '),
      subject: 'ขอเบิกใช้งบ ' + b.name + ' ครั้งที่ ' + seq,
      ref: refText,
      background,
      consider,
      signerName: userName(r.requesterId),
      signerTitle: mp.proposer || '',
      reviewers: mp.reviewers.slice(),
      approvers: mp.approvers.slice()
    };
    return { b, r, cname, seq, approved, priorRows, after, groups, invCodes, byInv, scopeCodes, capexItems, amt, defaults };
  }
  const MEMO_DOC_KEYS = ['to', 'date', 'cc', 'subject', 'ref', 'background', 'consider', 'signerName', 'signerTitle', 'reviewers', 'approvers'];
  /** ค่าที่ใช้ใน Memo: ค่าที่ผู้ขอกรอกไว้ (r.memoDoc) ทับค่าเริ่มต้นจากระบบ */
  function memoDocOf(model) {
    const saved = model.r.memoDoc || {};
    const out = {};
    MEMO_DOC_KEYS.forEach((k) => { out[k] = saved[k] !== undefined ? saved[k] : model.defaults[k]; });
    return out;
  }

  /**
   * Memo ตามโครงแบบฟอร์มจริงของบริษัท — edit = แสดงเป็นช่องกรอกในตำแหน่งเดียวกับเอกสาร
   * ช่องที่กรอกได้: เรียน · วันที่ · สำเนาถึง · เรื่อง · อ้างอิง · 1. เรื่องสืบเนื่อง · 2. เรื่องเพื่อพิจารณาลงนาม ·
   * ผู้ลงนามเสนอ · ผู้ทบทวน · ผู้พิจารณาอนุมัติ — ส่วนยอดเงินและตารางสรุประบบคำนวณจากคำขอ (แก้ที่คำขอ)
   */
  function memoHtml(b, r, edit) {
    const M = memoModel(b, r);
    const d = memoDocOf(M);
    const text = (v) => esc(v || '').replace(/\n/g, '<br>');
    const paras = (v) => String(v || '').split(/\n\s*\n/).map((p) => '<p>' + text(p.trim()) + '</p>').join('');
    const inp = (k, ph, cls) => (edit ? '<input class="mf' + (cls ? ' ' + cls : '') + '" name="md_' + k + '" value="' + esc(d[k]) + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || k) + '">' : text(d[k]));
    const area = (k, rows, ph) => (edit ? '<textarea class="mf" name="md_' + k + '" rows="' + rows + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(ph || k) + '">' + esc(d[k]) + '</textarea>' : null);
    const cell = (v) => '<td class="num">' + v + '</td>';
    const paren = (v) => '(' + money(v) + ')';
    const signRows = (k) => {
      const list = d[k].length ? d[k] : [''];
      return list.map((x) => '<tr>' + (edit
        ? '<td><div class="mf-row"><input class="mf" name="md_' + k + '" value="' + esc(x) + '" placeholder="ชื่อ / ตำแหน่ง" aria-label="ชื่อ / ตำแหน่ง">' +
          '<button type="button" class="btn small bad no-print" data-mf-del title="ลบแถว">×</button></div></td>'
        : '<td>' + esc(x) + '</td>') + '<td>☐ อนุมัติ &nbsp; ☐ ไม่อนุมัติ</td><td></td><td></td></tr>').join('');
    };
    const signTable = (k, title) => '<h2 class="memo-h">' + title + '</h2>' +
      '<table class="memo-sign"><thead><tr><th>ชื่อ / ตำแหน่ง</th><th style="width:9rem">ผลการพิจารณา</th><th style="width:11rem">ลงนามอนุมัติ</th><th style="width:6rem">วันที่</th></tr></thead>' +
      '<tbody data-mf-list="' + k + '">' + signRows(k) + '</tbody></table>' +
      (edit ? '<button type="button" class="btn small no-print mf-add" data-mf-add="' + k + '">+ เพิ่มผู้ลงนาม</button>' : '');
    const toLines = String(d.to || '').split('\n');
    const g = M.groups;

    return '<article class="doc memo-doc' + (edit ? ' memo-edit' : '') + '">' +
      memoLetterhead(b.company) +
      '<table class="memo-head"><tbody>' +
      '<tr><td><div class="mh-row"><span class="lbl">เรียน</span><div class="mh-val">' +
        (edit ? area('to', 2, 'ชื่อ (ตำแหน่ง) และบริษัท — บรรทัดละรายการ') : toLines.map(esc).join('<br>')) + '</div></div></td>' +
      '<td class="memo-date"><div class="mh-row"><span class="lbl lbl-s">วันที่</span><div class="mh-val">' + inp('date', 'วันที่', 'mf-date') + '</div></div>' +
        '<div class="mh-row"><span class="lbl lbl-s">เลขที่</span><div class="mh-val">' + esc((r.memo || {}).no || '........') + '</div></div>' +
        '<div class="mh-row mh-sub"><span class="lbl lbl-s">คำขอ</span><div class="mh-val">' + esc(r.no) + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">เรื่อง</span><div class="mh-val">' + inp('subject', 'เรื่อง') + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">สำเนาถึง</span><div class="mh-val">' + inp('cc', 'ผู้รับสำเนา (คั่นด้วย ,)') + '</div></div></td></tr>' +
      '<tr><td colspan="2"><div class="mh-row"><span class="lbl">อ้างอิง</span><div class="mh-val">' + (edit ? area('ref', 1, 'มติ / เอกสารอนุมัติที่อ้างอิง') : text(d.ref)) + '</div></div></td></tr>' +
      '</tbody></table>' +

      '<h2 class="memo-h">1. เรื่องสืบเนื่อง</h2>' +
      (edit ? area('background', 9, 'ที่มา เหตุผลความจำเป็น และกรอบวงเงินที่ได้รับอนุมัติ') : '<div class="memo-text">' + paras(d.background) + '</div>') +

      '<h2 class="memo-h">2. เรื่องเพื่อพิจารณาลงนาม</h2>' +
      (edit ? area('consider', 3, 'วัตถุประสงค์และความประสงค์ในการขอเบิกใช้งบครั้งนี้') : '<div class="memo-text">' + paras(d.consider) + '</div>') +
      '<ol class="memo-list">' + g.map((x, i) => '<li>' + (i + 1) + '. ' + esc(x.key) + ' เป็นจำนวนเงิน ' + esc(M.amt(x.amount)) +
        '<br><small>' + x.descs.map(esc).join(' · ') + '</small></li>').join('') +
      '<li class="memo-total">รวมเป็นจำนวนเงินทั้งสิ้น ' + esc(M.amt(r.amount)) + '</li></ol>' +
      (M.invCodes.length > 1 ? '<p class="memo-inv">บริษัทที่ลงทุน: ' + M.invCodes.map((c) => esc(c) + ' ' + money(M.byInv[c]) + ' บาท').join(' · ') + '</p>' : '') +
      (edit ? '<p class="mf-note no-print">ยอดเงินในรายการด้านบนและตารางด้านล่างระบบคำนวณจากคำขอ — ถ้าต้องการเปลี่ยนยอด ให้แก้ที่คำขอ</p>' : '') +

      '<table class="memo-sum"><thead><tr><th style="width:3rem">ลำดับ</th><th>รายการงบประมาณ</th><th class="num" style="width:9rem">จำนวนเงิน (บาท)</th></tr></thead><tbody>' +
      '<tr><td class="center">1</td><td>กรอบวงเงินงบที่ได้รับอนุมัติ' + (M.capexItems.length ? ' (' + esc(M.scopeCodes) + ')' : ' (' + esc(b.code) + ')') + '</td>' + cell(money(M.approved)) + '</tr>' +
      '<tr><td class="center">2</td><td>หัก : เบิกใช้งบไปแล้ว' + (M.priorRows.length ? M.priorRows.map((x) => '<br><small>- ' + esc(x.label) + '</small>').join('') : '<br><small>- ยังไม่มี</small>') + '</td>' +
      cell(M.priorRows.length ? M.priorRows.map((x) => paren(x.amount)).join('<br><br>') : '-') + '</tr>' +
      '<tr><td class="center">3</td><td>ขอเบิกใช้ ครั้งที่ ' + M.seq + ' :' + g.map((x) => '<br><small>- ' + esc(x.key) + '</small>').join('') + '</td>' +
      cell(g.map((x) => money(x.amount)).join('<br>')) + '</tr>' +
      '<tr><td></td><td><strong>งบประมาณคงเหลือหลังการเบิกใช้ ครั้งที่ ' + M.seq + '</strong></td>' + cell('<strong>' + moneyCell(M.after) + '</strong>') + '</tr></tbody></table>' +
      '<p>จึงขอเบิกใช้งบ ครั้งที่ ' + M.seq + ' รวมเป็นเงินทั้งสิ้น ' + esc(M.amt(r.amount)) + '</p>' +

      '<p class="memo-close">จึงเรียนมาเพื่อโปรดพิจารณาลงนาม</p>' +
      '<div class="memo-signoff"><div>ขอแสดงความนับถือ</div><div class="memo-sig-line"></div>' +
      '<div>(' + inp('signerName', 'ชื่อผู้ลงนามเสนอ', 'mf-center') + ')</div><div>' + inp('signerTitle', 'ตำแหน่ง', 'mf-center') + '</div></div>' +

      signTable('reviewers', 'ทบทวน และให้ความเห็นชอบ') +
      signTable('approvers', 'ผู้พิจารณาอนุมัติ') +
      (edit ? '' : '<p class="note no-print">เมื่อผู้บริหารลงนามแล้ว ให้สแกน / ถ่ายรูป แนบในคำขอเบิกใช้งบ พร้อมชื่อผู้บริหารที่ลงนาม ก่อนส่งให้ผู้คุมงบตรวจสอบ</p>') +
      '</article>';
  }

  const MEMO_LOGO = 'img/logo-precise.png?v=1';
  /** หัวกระดาษ Memo: โลโก้ของบริษัท (ตั้งที่ ข้อมูลหลัก > บริษัท) หรือโลโก้กลุ่มบริษัท และคำว่า Memo ชิดขวา */
  function memoLetterhead(code) {
    const c = db.master.companies.find((x) => x.code === code) || { code };
    // โลโก้ตั้งต้น = โลโก้กลุ่มบริษัท (img/logo-precise.png) · อัปโหลดโลโก้เฉพาะบริษัทได้ที่ข้อมูลหลัก
    const src = c.logo && /^data:image\//.test(c.logo) ? c.logo : MEMO_LOGO;
    const logo = '<img class="lh-img" src="' + esc(src) + '" alt="' + esc(c.name || c.code || 'โลโก้บริษัท') + '">';
    return '<div class="memo-letterhead"><div class="lh-logo">' + logo + '</div><div class="lh-title">Memo</div></div>';
  }
  /** ผู้บริหารที่ลงนามอนุมัติ Memo = รายชื่อผู้พิจารณาอนุมัติใน Memo */
  const memoSigners = (r) => memoDocOf(memoModel(budgetById(r.budgetId), r)).approvers.join(' / ');
  /** ผู้ขอแก้ไข Memo ได้ระหว่างรอแนบ Memo ที่เซ็นแล้ว */
  const canEditMemo = (r) => r.status === 'memo' && (r.requesterId === me().id || proxyOf(budgetById(r.budgetId))) && can('request.create');

  /** หน้า Memo ของคำขอ (#/request/:id/memo) — กรอกตามโครงเอกสาร · ?view=1 = ฉบับพิมพ์ */
  function viewRequestMemo(id, params) {
    const r = requestById(id);
    if (!r) return notFound();
    const b = budgetById(r.budgetId);
    const editable = canEditMemo(r);
    if (editable && !(params && params.get('view'))) {
      return '<div class="page-head no-print"><div><h1>กรอก Memo · ' + esc((r.memo || {}).no || r.no) + '</h1>' +
        '<div class="page-sub">กรอกข้อมูลในช่องตามโครงแบบฟอร์ม Memo ของบริษัท (ค่าเริ่มต้นดึงจากคำขอและข้อมูลหลัก) แล้วกด "บันทึกและดูฉบับพิมพ์"</div></div></div>' +
        takeFlash() +
        '<form id="memoDocForm" data-id="' + r.id + '">' +
        '<div class="actions no-print memo-toolbar"><button class="btn primary" type="submit" data-mf-go="view">บันทึกและดูฉบับพิมพ์</button>' +
        '<button class="btn" type="submit" data-mf-go="stay">บันทึก</button>' +
        (r.memoDoc ? '<button class="btn" type="button" id="memoDocReset">ใช้ค่าเริ่มต้นจากระบบ</button>' : '') +
        '<a class="btn" href="#/request/' + r.id + '">กลับไปที่คำขอ</a></div>' +
        memoHtml(b, r, true) + '</form>';
    }
    return '<div class="actions no-print" style="margin:0 0 1rem"><button class="btn primary" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>' +
      (editable ? '<a class="btn" href="#/request/' + r.id + '/memo">แก้ไข Memo</a>' : '') +
      '<a class="btn" href="#/request/' + r.id + '">กลับไปที่คำขอ</a></div>' + takeFlash() + memoHtml(b, r, false);
  }

  function bindMemoDoc() {
    const form = document.getElementById('memoDocForm');
    if (!form) return;
    const isBudget = form.dataset.kind === 'budget';
    const r = isBudget ? null : requestById(form.dataset.id);
    const ob = isBudget ? budgetById(form.dataset.id) : null;
    let goView = true;
    form.querySelectorAll('[data-mf-go]').forEach((btn) => btn.addEventListener('click', () => { goView = btn.dataset.mfGo === 'view'; }));
    // ช่องข้อความยืดตามเนื้อหา
    const grow = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
    form.querySelectorAll('textarea.mf').forEach(grow);
    form.addEventListener('input', (e) => { if (e.target.matches('textarea.mf')) grow(e.target); });
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-mf-add]');
      if (add) {
        const k = add.dataset.mfAdd;
        const tb = form.querySelector('[data-mf-list="' + k + '"]');
        tb.insertAdjacentHTML('beforeend', '<tr><td><div class="mf-row"><input class="mf" name="md_' + k + '" placeholder="ชื่อ / ตำแหน่ง" aria-label="ชื่อ / ตำแหน่ง">' +
          '<button type="button" class="btn small bad no-print" data-mf-del title="ลบแถว">×</button></div></td><td>☐ อนุมัติ &nbsp; ☐ ไม่อนุมัติ</td><td></td><td></td></tr>');
        tb.lastElementChild.querySelector('input').focus();
      }
      if (e.target.matches('[data-mf-del]')) e.target.closest('tr').remove();
    });
    const reset = document.getElementById('memoDocReset');
    if (reset) reset.addEventListener('click', () => {
      if (!confirm('ล้างข้อความที่กรอกไว้ แล้วใช้ค่าเริ่มต้นจากคำขอและข้อมูลหลัก?')) return;
      if (isBudget) delete ob.openMemo.doc; else delete r.memoDoc;
      save();
      render();
    });
    guard(form, [{ btn: 'button[type="submit"]', missing: (f) => [
      !filled(f.elements.md_to) && 'เรียน',
      !filled(f.elements.md_subject) && 'เรื่อง',
      !filled(f.elements.md_background) && 'เรื่องสืบเนื่อง',
      !Array.from(form.querySelectorAll('[name="md_approvers"]')).some((x) => x.value.trim()) && 'ผู้พิจารณาอนุมัติอย่างน้อย 1 คน'
    ] }], '.memo-toolbar');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = (k) => (form.elements['md_' + k] ? form.elements['md_' + k].value.trim() : '');
      const list = (k) => Array.from(form.querySelectorAll('[name="md_' + k + '"]')).map((x) => x.value.trim()).filter(Boolean);
      const doc = {};
      MEMO_DOC_KEYS.forEach((k) => { doc[k] = k === 'reviewers' || k === 'approvers' ? list(k) : val(k); });
      if (isBudget) {
        const first = !ob.openMemo;
        if (first) ob.openMemo = { no: nextNo(DOC_PREFIX.memo), files: [], createdAt: new Date().toISOString() };
        ob.openMemo.doc = doc;
        addHistory(ob, (first ? 'ทำ' : 'แก้ไข') + ' Memo ขอดำเนินการใช้งบ', '', ob.openMemo.no);
        save();
        setFlash('success', 'บันทึก Memo ' + ob.openMemo.no + ' แล้ว' + (goView ? ' — พิมพ์ให้ผู้บริหารเซ็น แล้วแนบไฟล์ที่เซ็นแล้วในหน้างบ' : ''));
        if (goView) go('#/budget/' + ob.id + '/memo?view=1'); else render();
        return;
      }
      r.memoDoc = doc;
      addEvent(r, 'กรอก / แก้ไข Memo ' + ((r.memo || {}).no || ''), '');
      save();
      setFlash('success', 'บันทึก Memo แล้ว' + (goView ? ' — พิมพ์ให้ผู้บริหารเซ็น แล้วแนบไฟล์ที่เซ็นแล้วในหน้าคำขอ' : ''));
      if (goView) go('#/request/' + r.id + '/memo?view=1'); else render();
    });
  }

  /** ยอด ณ วันที่ออกเอกสาร ของทั้งโครงการ (ids = null) หรือของรายการที่ระบุ: งบ / ใช้ก่อนหน้า / ครั้งนี้ / คงเหลือ */
  function balanceAt(r, b, ids, approvedOverride) {
    const approved = approvedOverride !== undefined ? approvedOverride : ids ? round2(b.items.filter((x) => ids.includes(x.id)).reduce((s, x) => s + itemTotal(x), 0)) : budgetTotal(b);
    const before = round2(db.requests
      .filter((x) => x.budgetId === b.id && x.id !== r.id && (x.status === 'approved' || x.status === 'closed') && x.approvedAt <= r.approvedAt)
      .reduce((s, x) => s + (x.status === 'closed' ? (linesAmount(x, ids) ? cutTotal(x) * linesAmount(x, ids) / x.amount : 0) : linesAmount(x, ids)), 0));
    const now = linesAmount(r, ids);
    return { approved, before, now, after: round2(approved - before - now) };
  }

  function viewDocument(id) {
    const r = requestById(id);
    if (!r) return notFound();
    if (r.status === 'cancelled' && r.docNo) return '<div class="alert error">เอกสารเลขที่ ' + esc(r.docNo) + ' ถูกยกเลิกแล้ว ใช้แนบขอซื้อไม่ได้</div>';
    if (r.status !== 'approved' && r.status !== 'closed') return '<div class="alert error">คำขอนี้ยังไม่ผ่านการตรวจสอบของผู้คุมงบ จึงยังไม่มีเอกสาร</div>';
    const b = budgetById(r.budgetId);
    const isCapex = r.type === 'CAPEX';
    const perItem = b.structure !== 'project';
    const proj = balanceAt(r, b, null);
    const tr = (k, v) => '<tr><th style="width:34%">' + k + '</th><td>' + v + '</td></tr>';
    const balanceTable = (title, bal) => '<table><thead><tr><th colspan="2">' + title + '</th></tr></thead><tbody>' +
      tr('จำนวนเงินงบประมาณ (รวม VAT)', '<span class="num-cell">' + money(bal.approved) + ' บาท</span>') +
      tr('ใช้/จองงบประมาณไปแล้วก่อนหน้า', '<span class="num-cell">' + money(bal.before) + ' บาท</span>') +
      tr('จำนวนงบประมาณที่ขอใช้ครั้งนี้ (รวม VAT)', '<span class="num-cell"><strong>' + money(bal.now) + ' บาท</strong></span>') +
      tr('งบประมาณคงเหลือ (หลังใช้ครั้งนี้)', '<span class="num-cell">' + moneyCell(bal.after) + ' บาท</span>') + '</tbody></table>';

    const head = '<header><div><h1>' + esc(companyMap()[b.company] || b.company) + '</h1><div class="doc-sub">' +
      'ใบเบิกใช้งบ (' + (isCapex ? 'งบลงทุน CAPEX' : 'งบดำเนินงาน OPEX') + ')</div></div>' +
      '<div class="docno">เลขที่เบิกใช้งบ <strong>' + esc(r.docNo) + '</strong><br>วันที่ออกเอกสาร ' + fmtDay(r.approvedAt) +
      '<br><span class="stamp">ผู้คุมงบตรวจสอบแล้ว</span>' + (r.status === 'closed' ? '<br><span class="stamp">ปิดยอดแล้ว</span>' : '') + '</div></header>';
    const poCuts = (r.cuts || []).filter((c) => c.kind === 'po');
    const poText = r.useType !== 'prpo' ? '- (ไม่ต้องออก PO)' : poCuts.length
      ? poCuts.map((c) => esc((c.prNo ? 'PR ' + c.prNo + ' / ' : '') + 'PO ' + c.poNo) + ' · ' + money(c.amount) + ' บาท').join('<br>') : 'รอจัดซื้อออก PO';

    const info = '<div class="section"><table><tbody>' +
      tr('รหัสโครงการ (Project No.)', esc(b.code + ' ' + b.name)) +
      (isCapex && perItem ? tr('รหัสรายการย่อย (Item No.)', reqItems(b, r).map((x) => esc(x.code + ' ' + x.name)).join('<br>')) : '') +
      tr('ประเภทการใช้งบ', esc((USE_TYPES[r.useType] || {}).label || '-') + '<br><small>' + esc((USE_TYPES[r.useType] || {}).cut || '') + '</small>') +
      tr('วันที่ขอใช้งบ', fmtDay(r.createdAt)) +
      tr('ชื่อผู้ขอใช้งบประมาณ', esc(userName(r.requesterId) + ' · ' + b.department)) +
      (r.deliveryDate ? tr('วันที่ส่งมอบ/วางบิล', fmtDay(r.deliveryDate)) : '') +
      (r.payDueDate ? tr('วันที่กำหนดจ่ายเงิน', fmtDay(r.payDueDate)) : '') +
      (r.requestDate ? tr('วันที่เบิก', fmtDay(r.requestDate)) : '') +
      (r.purpose ? tr('วัตถุประสงค์ในการใช้งบ', esc(r.purpose)) : '') +
      tr(r.useType === 'advance' || r.useType === 'reimburse' ? 'ผู้รับเงิน (พนักงาน)' : 'Supplier (ผู้รับเงิน)', esc(r.payee || '-')) +
      tr('PR / PO No.', poText) +
      (r.overItem > 0 ? tr('หมายเหตุ: ใช้เกินงบรายการ', money(r.overItem) + ' บาท (อยู่ในงบรวมของโครงการ)' + (r.requesterReason ? '<br>เหตุผลผู้ขอ: ' + esc(r.requesterReason) : '')) : '') +
      (r.memo ? tr('Memo ผู้บริหาร', 'เลขที่ ' + esc(r.memo.no) + (r.memo.by ? ' · เซ็นโดย ' + esc(r.memo.by) : '')) : '') +
      (r.approverNote ? tr('Note ผู้คุมงบ', esc(r.approverNote)) : '') +
      (r.status === 'closed' && r.closed ? tr('ปิดยอด', 'ใช้จริง ' + money(r.closed.actual) + ' บาท' + (r.closed.returned > 0 ? ' · คืนเข้างบ ' + money(r.closed.returned) + ' บาท' : '') + (r.closed.over > 0 ? ' · เกินที่ขอ ' + money(r.closed.over) + ' บาท' : '')) : '') +
      (planText(r) ? tr('เงื่อนไขการจ่าย', planDetailHtml(r)) : '') +
      '</tbody></table></div>';

    let detail = '<div class="section"><h2>รายละเอียดการใช้งบประมาณ</h2>';
    if (!perItem) {
      detail += balanceTable('ระดับโครงการ: ' + esc(b.code), proj);
    } else {
      detail += balanceTable('ระดับโครงการ: ' + esc(b.code), proj) +
        '<table style="margin-top:.75rem"><thead><tr><th>' + (isCapex ? 'ระดับรายการย่อย (Item No.)' : 'รายการต้นทุน') + '</th><th class="num">งบ</th><th class="num">ใช้ก่อนหน้า</th><th class="num">ครั้งนี้</th><th class="num">คงเหลือ</th></tr></thead><tbody>' +
        uniq(reqItemIds(r).map((iid) => (budgetNodeOf(b, itemById(b, iid) || {}) || {}).id)).map((nid) => {
          const it = itemById(b, nid) || {};
          const bal = balanceAt(r, b, leafIdsUnder(b, it), itemTotal(it));
          return '<tr><td>' + esc(it.code + ' ' + it.name) + '</td><td class="num">' + money(bal.approved) + '</td><td class="num">' + money(bal.before) +
            '</td><td class="num">' + money(bal.now) + '</td><td class="num">' + moneyCell(bal.after) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    detail += '</div>';

    const withCat = isCapex && r.lines.some((l) => l.category);
    const withSup = r.lines.some((l) => l.supplier);
    const lines = '<div class="section"><h2>รายการที่ขอใช้ครั้งนี้</h2><table><thead><tr><th style="width:2rem">#</th>' +
      (withCat ? '<th>รายการ</th>' : isCapex ? (perItem ? '<th>รายการย่อย (Item No.)</th>' : '') : '<th>รายการต้นทุน / GL</th>') + '<th>บริษัทที่ลงทุน</th>' + (withSup ? '<th>Supplier</th>' : '') + '<th>' + (isCapex ? 'รายการที่ซื้อ / จ่าย' : 'รายละเอียด') + '</th>' +
      '<th class="num">ก่อน VAT</th><th class="num">VAT 7%</th><th class="num">รวม</th></tr></thead><tbody>' +
      r.lines.map((l, i) => {
        const it = itemById(b, l.itemId) || {};
        return '<tr><td>' + (i + 1) + '</td>' +
          (withCat ? '<td>' + esc(l.category || '-') + '</td>' : isCapex ? (perItem ? '<td>' + esc(it.code + ' ' + it.name) + '</td>' : '') : '<td>' + esc(it.code + ' ' + it.name) + (lineGl(b, l).code ? '<br><small>GL ' + esc(lineGl(b, l).code + ' ' + (lineGl(b, l).name || '')) + '</small>' : '') + '</td>') +
          '<td>' + esc(lineInvestor(b, l)) + '</td>' + (withSup ? '<td>' + esc(l.supplier || '-') + '</td>' : '') + '<td>' + esc(l.description) + '</td><td class="num">' + money(l.amountBeforeVat) + '</td><td class="num">' + money(l.vat) + '</td><td class="num">' + money(l.amount) + '</td></tr>';
      }).join('') +
      '<tr><th colspan="' + ((isCapex && !withCat && !perItem ? 3 : 4) + (withSup ? 1 : 0)) + '" class="right">รวมทั้งสิ้น</th><td class="num">' + money(r.amountBeforeVat) + '</td><td class="num">' + money(r.vat) +
      '</td><td class="num"><strong>' + money(r.amount) + '</strong></td></tr></tbody></table></div>';

    // ท้ายกระดาษ: ใบเบิกใช้งบอนุมัติในระบบแล้ว ไม่ต้องเซ็น — แสดงว่าใครสร้าง ใครอนุมัติ เมื่อไร (พิมพ์แนบงานอื่นต่อได้เลย)
    const who = (id) => { const x = user(id); return x ? esc(x.name) + (x.title ? '<br><small>' + esc(x.title) + '</small>' : '') : esc(userName(id)); };
    const approved = (r.steps || []).filter((x) => x.status === 'approved' && x.by);
    const trail = [['สร้างคำขอ', who(r.requesterId) + (r.proxyBy ? '<br><small>ทำแทนโดย ' + esc(userName(r.proxyBy)) + '</small>' : ''), fmtDate(r.createdAt)]]
      .concat(approved.length
        ? approved.map((x) => ['อนุมัติ' + (x.label ? ' (' + esc(x.label) + ')' : ''), who(x.by), fmtDate(x.at)])
        : [['อนุมัติ (ผู้คุมงบตรวจสอบ)', '-', fmtDate(r.approvedAt)]]);
    const signs = '<div class="section approval-trail"><h2>การอนุมัติในระบบ</h2><table><thead><tr><th style="width:26%">ขั้นตอน</th><th>ผู้ดำเนินการ</th><th style="width:24%">วันที่ / เวลา</th></tr></thead><tbody>' +
      trail.map((t) => '<tr><td>' + t[0] + '</td><td>' + t[1] + '</td><td>' + t[2] + '</td></tr>').join('') + '</tbody></table>' +
      '<p class="note">เอกสารนี้ผ่านการตรวจสอบและอนุมัติในระบบแล้ว ไม่ต้องลงนาม · เลขที่ ' + esc(r.docNo) + ' · พิมพ์โดย ' + esc(me().name) + ' เมื่อ ' + fmtDate(new Date().toISOString()) + '</p></div>';

    return '<div class="actions no-print" style="margin:0 0 1rem">' +
      '<button class="btn primary" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>' +
      '<article class="doc">' + head + info + detail + lines +
      signs +
      '<p class="note">' + (r.useType !== 'prpo'
        ? 'ใช้เลขที่ ' + esc(r.docNo) + ' อ้างอิงในเอกสารการจ่าย / เคลียร์เงิน · ' + esc((USE_TYPES[r.useType] || {}).cut || '')
        : 'โปรดแนบเอกสารฉบับนี้ และระบุเลขที่ ' + esc(r.docNo) + ' ในใบขอซื้อ (PR) ที่เกี่ยวข้อง · ยอดขอซื้อรวมต้องไม่เกิน ' + money(r.amount) + ' บาท') + '</p>' +
      '</article>';
  }


  // ---------------------------------------------------------------- dashboard

  const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const monthLabel = (key) => TH_MONTH[Number(key.slice(5, 7)) - 1] + ' ' + String((Number(key.slice(0, 4)) + 543) % 100);

  /** งบที่ผู้ใช้เห็นได้ (ผู้ขอเห็นเฉพาะงบของตนเอง) */
  const visibleBudgets = () => db.budgets.filter((b) => isActive(b) && (canViewAll() ? budgetScoped(b) : actsFor(b)));

  /** วันที่และยอดที่ฝ่ายบัญชีจ่ายแล้วของคำขอ — ใช้ทำกราฟรายเดือน */
  function paidEntries(r) {
    return (r.status === 'approved' || r.status === 'closed') ? (r.cuts || []).map((c) => ({ date: c.date, amount: Number(c.amount || 0) })) : [];
  }

  /**
   * สรุปตามบริษัทที่ลงทุน: งบที่ได้รับตาม Item (งบไม่มี Item = บริษัทเจ้าของงบ)
   * ยอดตัดงบ / จองไว้ตามบรรทัดของคำขอ (แบ่งยอดที่ตัดตามสัดส่วนของบรรทัด เหมือน usage())
   */
  function investorGroups(budgets) {
    const groups = {};
    const names = companyMap();
    const g = (code) => groups[code] || (groups[code] = { label: code + (names[code] ? ' — ' + names[code] : ''), ids: new Set(), n: 0, approved: 0, used: 0, reserved: 0, remaining: 0 });
    budgets.forEach((b) => {
      if (b.structure === 'project') {
        const x = g(b.company);
        x.approved = round2(x.approved + budgetTotal(b));
        x.ids.add(b.id);
      } else {
        ledgerItems(b).forEach((it) => {
          const x = g(itemInvestor(b, it));
          x.approved = round2(x.approved + itemTotal(it));
          x.ids.add(b.id);
        });
      }
      db.requests.forEach((r) => {
        if (r.budgetId !== b.id || !['memo', 'pending', 'approved', 'closed'].includes(r.status) || !(r.amount > 0)) return;
        const cut = cutTotal(r);
        r.lines.forEach((l) => {
          const x = g(lineInvestor(b, l));
          x.ids.add(b.id);
          const share = l.amount / r.amount;
          if (isReserving(r)) x.reserved = round2(x.reserved + l.amount);
          else {
            x.used = round2(x.used + cut * share);
            if (r.status === 'approved') x.reserved = round2(x.reserved + Math.max(l.amount - cut * share, 0));
          }
        });
      });
    });
    Object.values(groups).forEach((x) => { x.n = x.ids.size; x.remaining = round2(x.approved - x.used - x.reserved); });
    return groups;
  }

  function dashDimension(by, b) {
    if (by === 'dept') return { key: b.department || '-', label: b.department || '-' };
    if (by === 'type') return { key: b.type, label: TYPE_LABEL[b.type] };
    return { key: b.company, label: b.company + (companyMap()[b.company] ? ' — ' + companyMap()[b.company] : '') };
  }

  function viewDashboard(params) {
    const u = me();
    const all = visibleBudgets();
    const years = uniq(all.map((b) => String(b.fiscalYear))).sort().reverse();
    const thisYear = String(new Date().getFullYear());
    const year = params.has('year') ? params.get('year') : (years.includes(thisYear) ? thisYear : 'all');
    const company = params.get('company') || 'all';
    const type = TYPE_LABEL[params.get('type')] ? params.get('type') : 'all';
    const by = ['company', 'investor', 'dept', 'type'].includes(params.get('by')) ? params.get('by') : 'company';
    const list = all.filter((b) => (year === 'all' || String(b.fiscalYear) === year) && (company === 'all' || b.company === company) && (type === 'all' || b.type === type));
    const q = (o) => '#/dashboard?' + Object.entries(Object.assign({ year, company, type, by }, o)).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

    // ---- รวมยอด
    const rows = list.map((b) => ({ b, u: usage(b) }));
    const sum = (k) => round2(rows.reduce((s2, x) => s2 + x.u[k], 0));
    const tot = { approved: sum('approved'), used: sum('used'), reserved: sum('reserved'), remaining: sum('remaining') };
    const pct = (v, of) => (of > 0 ? Math.max(0, Math.min(100, (v / of) * 100)) : 0);
    const pctText = (v, of) => (of > 0 ? (Math.round((v / of) * 1000) / 10).toLocaleString('th-TH') + '%' : '-');
    const kpi = (label, value, sub, cls) => '<div class="card kpi' + (cls ? ' ' + cls : '') + '"><span class="kpi-label">' + label + '</span>' +
      '<strong class="kpi-value">' + value + '</strong><span class="kpi-sub">' + sub + '</span></div>';

    // ---- ตัวกรอง
    const sel = (name, label, options, cur) => '<label class="field"><span>' + label + '</span><div class="select-wrap"><select data-dash="' + name + '">' +
      options.map(([v, t]) => opt(v, t, cur)).join('') + '</select></div></label>';
    const filters = '<div class="dash-filters">' +
      sel('year', 'ปีงบประมาณ', [['all', 'ทุกปี']].concat(years.map((y) => [y, y])), year) +
      sel('company', 'บริษัท', [['all', 'ทุกบริษัท']].concat(uniq(all.map((b) => b.company)).sort().map((c) => [c, c])), company) +
      sel('type', 'ประเภทงบ', [['all', 'ทั้งหมด'], ['CAPEX', 'CAPEX'], ['CBS', 'OPEX']], type) + '</div>';

    // ---- ตารางสรุปตามมิติที่เลือก
    const groups = by === 'investor' ? investorGroups(list) : {};
    if (by !== 'investor') {
      rows.forEach((x) => {
        const d = dashDimension(by, x.b);
        const g = groups[d.key] || (groups[d.key] = { label: d.label, n: 0, approved: 0, used: 0, reserved: 0, remaining: 0 });
        g.n += 1;
        ['approved', 'used', 'reserved', 'remaining'].forEach((k) => { g[k] = round2(g[k] + x.u[k]); });
      });
    }
    const gl = Object.values(groups).sort((a, b) => b.approved - a.approved);
    const seg = [['company', 'บริษัท'], ['investor', 'บริษัทที่ลงทุน'], ['dept', 'หน่วยงาน'], ['type', 'ประเภทงบ']]
      .map(([k, t]) => '<a href="' + q({ by: k }) + '"' + (by === k ? ' class="active" aria-current="true"' : '') + '>' + t + '</a>').join('');
    const miniBar = (g) => '<div class="bar mini" role="img" aria-label="ตัดงบแล้ว ' + pctText(g.used, g.approved) + ' จองไว้ ' + pctText(g.reserved, g.approved) + '">' +
      '<div class="used" style="width:' + pct(g.used, g.approved) + '%"></div><div class="reserved" style="width:' + pct(g.reserved, g.approved) + '%"></div></div>';
    const breakdown = '<section class="card"><div class="section-head"><h2 class="section-title">สรุปงบตาม</h2><div class="seg">' + seg + '</div></div>' +
      (gl.length
        ? '<div class="table-wrap"><table><thead><tr><th>' + { company: 'บริษัทเจ้าของงบ', investor: 'บริษัทที่ลงทุน', dept: 'หน่วยงาน', type: 'ประเภทงบ' }[by] + '</th><th class="num">งบ</th>' +
          '<th class="num">งบที่ได้รับ</th><th class="num">ตัดงบแล้ว</th><th class="num">จองไว้</th><th class="num">คงเหลือ</th><th style="width:9rem">สัดส่วน</th></tr></thead><tbody>' +
          gl.map((g) => '<tr><td>' + esc(g.label) + '</td><td class="num">' + g.n + '</td><td class="num">' + money(g.approved) + '</td><td class="num">' + money(g.used) +
            '</td><td class="num">' + money(g.reserved) + '</td><td class="num"><strong>' + moneyCell(g.remaining) + '</strong></td><td>' + miniBar(g) + '</td></tr>').join('') +
          '</tbody><tfoot><tr><td>รวม</td><td class="num">' + rows.length + '</td><td class="num">' + money(tot.approved) + '</td><td class="num">' + money(tot.used) + '</td>' +
          '<td class="num">' + money(tot.reserved) + '</td><td class="num"><strong>' + moneyCell(tot.remaining) + '</strong></td><td></td></tr></tfoot></table></div>' +
          (by === 'investor' ? '<p class="muted small-note dash-note">งบที่ได้รับนับตามบริษัทที่ลงทุนของแต่ละ Item · งบที่ไม่มี Item นับเป็นของบริษัทเจ้าของงบ · ' +
            'ยอดตัดงบ / จองไว้นับตามบริษัทที่ลงทุนของแต่ละบรรทัดในคำขอ (ถ้าบรรทัดเลือกบริษัทอื่น คงเหลือของบริษัทนั้นจะติดลบ) · คอลัมน์ "งบ" = จำนวนงบที่บริษัทนั้นลงทุนอยู่</p>' : '')
        : '<p class="muted">ไม่มีงบตามเงื่อนไขที่เลือก</p>') + '</section>';

    // ---- กราฟตัดงบรายเดือน (เฉพาะที่ฝ่ายบัญชีบันทึกจ่ายแล้ว)
    const listIds = new Set(list.map((b) => b.id));
    const months = {};
    db.requests.filter((r) => listIds.has(r.budgetId)).forEach((r) => paidEntries(r).forEach((e) => {
      if (!e.date) return;
      const k = e.date.slice(0, 7);
      months[k] = round2((months[k] || 0) + e.amount);
    }));
    const keys = Object.keys(months).sort();
    let chart;
    if (!keys.length) {
      chart = '<p class="muted">ยังไม่มีรายการที่ตัดงบแล้ว</p>';
    } else {
      const last = keys[keys.length - 1];
      const span = [];
      let [yy, mm] = last.split('-').map(Number);
      for (let i = 0; i < 6; i += 1) {
        span.unshift(yy + '-' + String(mm).padStart(2, '0'));
        mm -= 1;
        if (mm === 0) { mm = 12; yy -= 1; }
      }
      const max = Math.max.apply(null, span.map((k) => months[k] || 0)) || 1;
      chart = '<div class="chart" role="img" aria-label="ยอดตัดงบรายเดือน">' + span.map((k) => '<div class="chart-col"><span class="chart-val">' +
        (months[k] ? money(months[k]) : '') + '</span><div class="chart-bar" style="height:' + Math.round(((months[k] || 0) / max) * 100) + '%"></div>' +
        '<span class="chart-label">' + monthLabel(k) + '</span></div>').join('') + '</div>';
    }
    const monthly = '<section class="card"><div class="section-head"><h2 class="section-title">ตัดงบรายเดือน (6 เดือนล่าสุด)</h2></div>' + chart + '</section>';

    // ---- งานที่ต้องทำ
    const mineReq = db.requests.filter((r) => r.requesterId === u.id || proxyOf(budgetById(r.budgetId)));
    const task = (label, n, href, note) => '<li><a href="' + href + '"><span>' + label + (note ? '<small>' + note + '</small>' : '') + '</span><b class="' + (n ? 'has' : '') + '">' + n + '</b></a></li>';
    const tasks = [];
    if (can('budget.verify')) {
      tasks.push(task('งบที่รออนุมัติ / ตรวจ Memo', db.budgets.filter((b) => budgetScoped(b) && (b.state === 'review' || b.state === 'open_review')).length, '#/tasks?tab=budgets'),
        task('คำขอเพิ่มงบรอตรวจสอบ', (db.changes || []).filter((c) => chgScoped(c) && c.state === 'review').length, '#/tasks?tab=changes'));
    }
    if (can('gl.manage')) tasks.push(task('OPEX รอใส่ GL', glBudgets().filter((b) => missingGl(b).length).length, '#/tasks?tab=gl'));
    if (can('request.decide')) tasks.push(task('คำขอเบิกใช้งบรอตรวจสอบ', inbox(u).length, '#/tasks?tab=requests'));
    if (can('po.record')) tasks.push(task('รอออก PO', db.requests.filter((r) => reqScoped(r) && needsPO(r)).length, '#/tasks?tab=po'));
    if (can('cut.record')) {
      const cuts = db.requests.filter((r) => reqScoped(r) && needsCut(r));
      tasks.push(task('รอตัดงบ / ปิดยอด', cuts.length, '#/tasks?tab=cuts', cuts.length ? 'รวม ' + money(cuts.reduce((s2, r) => s2 + Math.max(r.amount - cutTotal(r), 0), 0)) + ' บาท' : ''));
    }
    if (can('budget.create') && !proxyOnly()) {
      const mineB = db.budgets.filter(actsFor);
      tasks.push(task('งบรอขอดำเนินการใช้งบ', mineB.filter((b) => b.state === 'pending_open' && b.ownerId === u.id).length, '#/tasks?tab=toopen', 'ทำ Memo ให้ผู้บริหารเซ็น'),
        task('งบร่าง', mineB.filter((b) => b.state === 'draft').length, '#/tasks?tab=drafts'),
        task('งบรอผู้คุมงบยืนยัน', mineB.filter((b) => b.state === 'review' || b.state === 'open_review').length, '#/tasks?tab=waiting'));
    }
    if (can('request.create')) {
      tasks.push(task('วาง Plan Cashflow เดือนนี้', cashflowTodo().length, '#/tasks?tab=cashflow', 'งบ CAPEX ที่เปิดใช้แล้ว เดือน ' + monthLabel(curYm()) + ' ยังไม่มีแผน'),
        task('รอเคลียร์เงินทดรอง', mineReq.filter(needsClear).length, '#/tasks?tab=clear', 'ผู้คุมงบอนุมัติแล้ว — เคลียร์ตามใบเสร็จเพื่อตัดงบ'),
        task('คำขอของฉันที่รอผู้คุมงบตรวจสอบ', mineReq.filter((r) => r.status === 'pending').length, '#/tasks?tab=waiting'),
        task('ส่งกลับแก้ไข', mineReq.filter((r) => r.status === 'rejected').length + db.budgets.filter((b) => actsFor(b) && (b.state === 'returned' || b.state === 'open_returned')).length, '#/tasks?tab=fix'),
        task('ออกใบเบิกใช้งบแล้ว รอปิดยอด', mineReq.filter((r) => r.status === 'approved').length, '#/tasks?tab=open'));
    }
    if (REMOTE && can('user.manage')) tasks.push(task('ผู้ใช้ที่รอกำหนดบทบาท', Number(adminCounts.pending || 0), '#/admin'));
    if (!tasks.length) tasks.push('<li><span class="muted">ไม่มีงานที่ต้องทำสำหรับบทบาทนี้</span></li>');
    const tasksCard = '<section class="card"><h2 class="section-title side-title">งานที่ต้องทำ</h2><ul class="task-list">' + tasks.join('') + '</ul></section>';

    // ---- งบที่ต้องจับตา (เกินงบ / เหลือไม่ถึง 10%)
    const watch = rows.map((x) => {
      const over = x.b.type === 'CBS' ? ledgerItems(x.b).filter((i) => usage(x.b, i.id).remaining < 0).length : 0;
      const ratio = x.u.approved > 0 ? x.u.remaining / x.u.approved : 1;
      return { x, over, ratio };
    }).filter((w) => w.over || w.x.u.remaining < 0 || w.ratio <= 0.1).sort((a, b) => a.ratio - b.ratio).slice(0, 6);
    const watchCard = '<section class="card"><h2 class="section-title side-title">งบที่ต้องจับตา</h2>' + (watch.length
      ? '<ul class="task-list">' + watch.map((w) => '<li><a href="#/budget/' + w.x.b.id + '"><span>' + esc(w.x.b.code) + ' ' + esc(w.x.b.name) +
        '<small>คงเหลือ ' + money(w.x.u.remaining) + ' (' + pctText(w.x.u.remaining, w.x.u.approved) + ')</small></span>' +
        (w.x.u.remaining < 0 ? '<span class="badge rejected">เกินงบ</span>' : w.over ? '<span class="badge rejected">เกินงบ ' + w.over + ' รายการ</span>' : '<span class="badge pending">ใกล้หมด</span>') + '</a></li>').join('') + '</ul>'
      : '<p class="muted">ไม่มีงบที่เกินหรือใกล้หมด (เหลือน้อยกว่า 10%)</p>') + '</section>';

    return '<div class="page-head"><div><h1>รายงาน · ภาพรวมงบประมาณ</h1><div class="page-sub">' + (canViewAll() ? 'ทุกงบในระบบ' : 'เฉพาะงบของคุณ') + ' · ' + list.length + ' งบ</div></div>' + filters + '</div>' +
      '<div class="kpis">' +
      kpi('งบที่เปิดใช้แล้ว', money(tot.approved), list.length + ' งบ') +
      kpi('ตัดงบแล้ว', money(tot.used), pctText(tot.used, tot.approved) + ' ของงบ') +
      kpi('จองไว้ (ยังไม่ตัดงบ)', money(tot.reserved), pctText(tot.reserved, tot.approved) + ' ของงบ') +
      kpi('คงเหลือ', moneyCell(tot.remaining), pctText(tot.remaining, tot.approved) + ' ของงบ', tot.remaining < 0 ? 'bad' : '') + '</div>' +
      '<div class="card dash-bar">' + usageBar(Object.assign({}, tot)) + '</div>' +
      '<div class="dash-grid"><div class="dash-main">' + breakdown + monthly + '</div><aside class="dash-side">' + tasksCard + watchCard + '</aside></div>';
  }

  function bindDashboard() {
    document.querySelectorAll('[data-dash]').forEach((el) => el.addEventListener('change', () => {
      const cur = new URLSearchParams(location.hash.split('?')[1] || '');
      document.querySelectorAll('[data-dash]').forEach((x) => cur.set(x.dataset.dash, x.value));
      go('#/dashboard?' + cur.toString());
    }));
  }

  // ---------------------------------------------------------------- master data (finance)

  /** รายการข้อมูลหลัก: cols[0] เป็นรหัส/ชื่อที่ใช้อ้างอิง — รหัส (lock) แก้ไม่ได้หลังสร้าง, ชื่อที่ใช้อ้างอิง (เช่น หน่วยงาน) เปลี่ยนแล้วระบบแก้ให้ทุกงบ */
  const MASTER_SECTIONS = [
    { key: 'companies', title: 'บริษัทและหน่วยงาน', hint: 'หน่วยงานอยู่ใต้บริษัท (บรรทัดย่อยของบริษัท) — ชื่อหน่วยงานต้องไม่ซ้ำกันทั้งระบบ · งบจะขึ้นเป็นหน่วยงานของเจ้าของงบ (เลือกบริษัทของงบเป็นบริษัทอื่นได้ ไม่ผูกกับบริษัทของหน่วยงาน) · ใช้กับงบทุกประเภท · Memo ทำครั้งเดียวตอนขอเปิดใช้งบ (CAPEX) — การเบิกใช้ครั้งต่อไปไม่ต้องทำ Memo ระบบคุมตามวงเงินที่เปิดใช้', lock: true,
      cols: [{ k: 'code', label: 'รหัสบริษัท', w: '10rem' }, { k: 'name', label: 'ชื่อบริษัท' }, 
        { k: 'logo', label: 'โลโก้หัวกระดาษ Memo', type: 'image', w: '14rem' }],
      inUse: (it) => db.budgets.some((b) => b.company === it.code) },
    { key: 'departments', title: 'หน่วยงาน', hint: 'หน่วยงานอยู่ใต้บริษัท — ต้องเลือกบริษัทของหน่วยงานทุกรายการ · ชื่อหน่วยงานต้องไม่ซ้ำกันทั้งระบบ · งบจะขึ้นเป็นหน่วยงานของเจ้าของงบ (เลือกบริษัทของงบเป็นบริษัทอื่นได้ ไม่ผูกกับบริษัทของหน่วยงาน) · ใช้เป็นตัวกรองในหน้ารายการงบ', lock: false,
      cols: [{ k: 'name', label: 'ชื่อหน่วยงาน' },
        { k: 'company', label: 'บริษัทของหน่วยงาน', type: 'select', required: true, w: '16rem',
          options: () => [['', '— เลือกบริษัท —']].concat(db.master.companies.map((c) => [c.code, c.code + (c.name ? ' — ' + c.name : '')])) }],
      inUse: (it) => db.budgets.some((b) => b.department === it.name) || USERS.some((u) => deptsOf(u).includes(it.name)),
      rename: (from, to) => db.budgets.forEach((b) => { if (b.department === from) b.department = to; }) },
    { key: 'listGroups', title: 'กลุ่มรายการ', hint: 'จัดกลุ่มโครงการตามที่ใช้ในไฟล์สรุปโปรเจ็ค เช่น "1. วงศ์สว่าง" (ตั้งว่างไว้ได้ — Import จากไฟล์จะเพิ่มให้เอง)', lock: false, optional: true,
      cols: [{ k: 'name', label: 'กลุ่มรายการ' }],
      inUse: (it) => db.budgets.some((b) => b.listGroup === it.name),
      rename: (from, to) => db.budgets.forEach((b) => { if (b.listGroup === from) b.listGroup = to; }) },
    { key: 'suppliers', title: 'Supplier (เจ้าหนี้)', hint: 'ชื่อ Supplier / เจ้าหนี้ / คนงานที่เลือกได้ในแต่ละรายการตอนขอเบิกใช้งบ OPEX — Business พิมพ์ชื่อใหม่เองตอนขอเบิกได้ ชื่อใหม่จะถูกเพิ่มที่นี่ให้อัตโนมัติ (ตั้งว่างไว้ได้)', lock: false, optional: true,
      cols: [{ k: 'name', label: 'ชื่อ Supplier' }],
      inUse: (it) => db.requests.some((r) => r.lines.some((l) => l.supplier === it.name)),
      rename: (from, to) => db.requests.forEach((r) => r.lines.forEach((l) => { if (l.supplier === from) l.supplier = to; })) },
    { key: 'priorityGroups', title: 'กลุ่ม Priority', hint: 'ตัวเลือก "กลุ่ม Priority" ของงบทุกประเภท', lock: false,
      cols: [{ k: 'name', label: 'กลุ่ม Priority' }],
      inUse: (it) => db.budgets.some((b) => b.priorityGroup === it.name),
      rename: (from, to) => db.budgets.forEach((b) => { if (b.priorityGroup === from) b.priorityGroup = to; }) },
    { key: 'investGroups', title: 'กลุ่ม Priority การลงทุน (CAPEX)', hint: 'ตัวเลือก "กลุ่ม Priority การลงทุน (กลุ่มการลงทุน New)" ของงบ CAPEX (ตั้งว่างไว้ได้ — Import จากไฟล์จะเพิ่มให้เอง)', lock: false, optional: true,
      cols: [{ k: 'name', label: 'กลุ่ม Priority การลงทุน' }],
      inUse: (it) => db.budgets.some((b) => b.investGroup === it.name),
      rename: (from, to) => db.budgets.forEach((b) => { if (b.investGroup === from) b.investGroup = to; }) }
  ];

  /** เมนูย่อยของข้อมูลหลัก: [key, ชื่อเมนู] */
  const MASTER_NAV = [['companies', 'บริษัทและหน่วยงาน'], ['suppliers', 'Supplier'], ['listGroups', 'กลุ่มรายการ'], ['priorityGroups', 'กลุ่ม Priority'], ['investGroups', 'กลุ่ม Priority การลงทุน']];

  function masterRow(sec, it, isNew) {
    return '<tr data-orig="' + (isNew ? '' : esc(it[sec.cols[0].k])) + '">' + sec.cols.map((c, i) => (c.type === 'image'
      ? '<td' + (c.w ? ' style="width:' + c.w + '"' : '') + '><div class="logo-cell"><input type="hidden" data-k="' + c.k + '" value="' + esc(isNew ? '' : it[c.k] || '') + '">' +
        '<span class="logo-prev">' + (!isNew && it[c.k] ? '<img src="' + esc(it[c.k]) + '" alt="">' : '<span class="muted">ไม่มี</span>') + '</span>' +
        '<label class="btn small file-btn">เลือกรูป<input type="file" accept="image/png,image/jpeg,image/svg+xml" data-logo-file hidden></label>' +
        '<button type="button" class="btn small" data-logo-clear title="ลบโลโก้">ลบ</button></div></td>'
      : c.type === 'select'
      ? '<td' + (c.w ? ' style="width:' + c.w + '"' : '') + '><div class="select-wrap"><select data-k="' + c.k + '" aria-label="' + esc(c.label) + '">' +
        (typeof c.options === 'function' ? c.options() : c.options).map(([v, t]) => opt(v, t, isNew ? '' : it[c.k] || '')).join('') + '</select></div></td>'
      : '<td' + (c.w ? ' style="width:' + c.w + '"' : '') + '><input data-k="' + c.k + '" value="' + esc(it[c.k] || '') + '" aria-label="' + esc(c.label) + '"' +
      (sec.lock && i === 0 && !isNew ? ' readonly class="locked"' : '') + '></td>')).join('') +
      '<td style="width:3rem"><button type="button" class="btn small bad" data-m-remove title="ลบ">×</button></td></tr>';
  }


  // ---- บริษัท + หน่วยงาน (หน่วยงานเป็นบรรทัดย่อยของบริษัท) ----------------------------------
  const DEPT_SEC = () => MASTER_SECTIONS.find((x) => x.key === 'departments');
  /** บรรทัดหน่วยงาน (บรรทัดย่อย) — unassigned = หน่วยงานเดิมที่ยังไม่ระบุบริษัท: เลือกบริษัทให้ครบก่อนบันทึก */
  function deptSubRow(d, unassigned) {
    const co = unassigned
      ? '<td><div class="select-wrap"><select data-k="company" aria-label="บริษัทของหน่วยงาน">' + [['', '— เลือกบริษัท —']].concat(db.master.companies.map((c) => [c.code, c.code + (c.name ? ' — ' + c.name : '')])).map(([v, t]) => opt(v, t, '')).join('') + '</select></div></td>'
      : '<td></td>';
    return '<tr class="dept-row" data-orig="' + esc((d && d.name) || '') + '"' + (unassigned ? ' data-unassigned="1"' : '') + '><td class="dept-mark"><span class="muted">↳ หน่วยงาน</span></td>' +
      '<td><input data-k="dept" value="' + esc((d && d.name) || '') + '" aria-label="ชื่อหน่วยงาน" placeholder="ชื่อหน่วยงาน"></td>' + co +
      '<td style="width:3rem"><button type="button" class="btn small bad" data-m-remove title="ลบหน่วยงาน">×</button></td></tr>';
  }
  const DEPT_ADD_ROW = '<tr class="dept-add-row"><td></td><td colspan="3"><button type="button" class="btn small" data-dept-add>+ เพิ่มหน่วยงาน</button></td></tr>';
  function companyGroupHtml(sec, c, isNew) {
    const depts = isNew ? [] : db.master.departments.filter((d) => d.company === c.code);
    return masterRow(sec, c, isNew).replace('<tr ', '<tr class="co-row" ') + depts.map((d) => deptSubRow(d, false)).join('') + DEPT_ADD_ROW;
  }
  function companiesSection(sec) {
    const known = new Set(db.master.companies.map((c) => c.code));
    const loose = db.master.departments.filter((d) => !known.has(d.company));
    return '<section class="card form-section"><div class="section-head"><div><h2 class="section-title">' + sec.title + '</h2><div class="muted section-hint">' + sec.hint + '</div></div></div>' +
      '<form class="master-form" data-key="companies"><div class="table-wrap"><table class="edit-table"><thead><tr>' +
      sec.cols.map((c) => '<th>' + c.label + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      db.master.companies.map((c) => companyGroupHtml(sec, c, false)).join('') +
      (loose.length ? '<tr class="dept-unassigned-head"><td colspan="4"><div class="alert warn small">หน่วยงานที่ยังไม่ระบุบริษัท — เลือกบริษัทของหน่วยงานให้ครบก่อนบันทึก</div></td></tr>' + loose.map((d) => deptSubRow(d, true)).join('') : '') +
      '</tbody></table></div>' +
      '<template id="tplCompany">' + companyGroupHtml(sec, {}, true) + '</template><template id="tplDept">' + deptSubRow(null, false) + '</template>' +
      '<div class="actions"><button type="button" class="btn" data-co-add>+ เพิ่มบริษัท</button><button class="btn primary" type="submit">บันทึกบริษัทและหน่วยงาน</button></div></form></section>';
  }

  function viewMaster(sub) {
    if (!can('master.manage')) return '<div class="alert error">ไม่มีสิทธิ์จัดการข้อมูลหลัก</div>';
    const key = MASTER_NAV.some(([k]) => k === sub) ? sub : MASTER_NAV[0][0];
    const navTitle = MASTER_NAV.find(([k]) => k === key)[1];
    const sections = MASTER_SECTIONS.filter((sec) => sec.key === key).map((sec) => (sec.key === 'companies' ? companiesSection(sec) : '<section class="card form-section"><div class="section-head"><div><h2 class="section-title">' + sec.title +
      '</h2><div class="muted section-hint">' + sec.hint + '</div></div></div>' +
      '<form class="master-form" data-key="' + sec.key + '"><div class="table-wrap"><table class="edit-table"><thead><tr>' +
      sec.cols.map((c) => '<th>' + c.label + '</th>').join('') + '<th></th></tr></thead><tbody>' +
      db.master[sec.key].map((it) => masterRow(sec, it, false)).join('') + '</tbody></table></div>' +
      '<template>' + masterRow(sec, {}, true) + '</template>' +
      '<div class="actions"><button type="button" class="btn" data-m-add>+ เพิ่ม</button><button class="btn primary" type="submit">บันทึก' + sec.title + '</button></div></form></section>')).join('');

    return '<div class="page-head"><div><h1>' + esc(navTitle) + '</h1><div class="page-sub">ข้อมูลหลัก — ค่าที่ใช้เป็นตัวเลือกในฟอร์มและรายงาน</div></div></div>' + takeFlash() +
      (AUTH_REMOTE ? (masterOnline
        ? '<div class="alert info small">ข้อมูลหลักเก็บบนเซิร์ฟเวอร์ — ทุกคนเห็นชุดเดียวกับที่บันทึกที่นี่ · การเช็กว่า "ลบได้ไหม" และการเปลี่ยนชื่อ ครอบคลุมเฉพาะงบที่เก็บในเครื่องนี้ (งบยังเก็บในเบราว์เซอร์ของแต่ละคนจนกว่าจะย้ายขึ้นเซิร์ฟเวอร์)</div>'
        : '<div class="alert error small">เชื่อมข้อมูลหลักกับเซิร์ฟเวอร์ไม่ได้ — ' + esc(masterError || 'ยังไม่ได้โหลด') + ' · บันทึกไม่ได้จนกว่าจะเชื่อมต่อได้ (ถ้าเพิ่งอัปเดตระบบ ให้รัน supabase/schema_v2.sql ใน SQL Editor แล้วโหลดหน้าใหม่)</div>') : '') +
      '<div id="formError"></div><div class="form-main">' + sections +
      '</div>';
  }

  /** บันทึกข้อมูลหลัก 1 รายการ (key) ตามโหมด — คืน true เมื่อสำเร็จ · ล้มเหลวแล้วแสดงข้อผิดพลาด/พากลับหน้า คืน false · rows = แถวที่มี orig (ชื่อ/รหัสเดิม) ไว้เปลี่ยนชื่อที่งบ */
  async function saveMasterData(sec, data, rows, returnTo) {
    const keyCol = sec.cols[0].k;
    if (REMOTE) {
      const renames = sec.rename ? rows.filter((it) => it.orig && it.orig !== it[keyCol]).map((it) => ({ from: it.orig, to: it[keyCol] })) : [];
      return !!(await runAndReload(() => window.RemoteApi.saveMaster(sec.key, data, renames)));
    }
    if (AUTH_REMOTE) {
      // โหมด Supabase: บันทึกที่เซิร์ฟเวอร์ก่อน สำเร็จแล้วค่อยแก้ชื่อที่งบในเครื่อง
      if (!masterOnline && !(await loadRemoteMaster().then(() => masterOnline, () => false))) { showErrors(['เชื่อมข้อมูลหลักกับเซิร์ฟเวอร์ไม่ได้ — ' + (masterError || 'ลองใหม่อีกครั้ง')]); return false; }
      let res = null;
      document.body.classList.add('busy');
      try {
        res = { value: await window.RemoteApi.v2MasterSave(sec.key, data, masterMeta[sec.key] || null) };
      } catch (ex) {
        if (ex && ex.code === 'AUTH') { showLoginDemo('login', { error: ex.message }); return false; }
        // เช่น มีคนอื่นแก้ไปก่อน: โหลดค่าล่าสุดมาแสดง แล้วบอกให้แก้อีกครั้ง
        await loadRemoteMaster().catch(() => false);
        setFlash('error', (ex && ex.message) || 'บันทึกข้อมูลหลักไม่สำเร็จ');
        go(returnTo);
        return false;
      } finally {
        document.body.classList.remove('busy');
      }
      if (sec.rename) rows.forEach((it) => { if (it.orig && it.orig !== it[keyCol]) sec.rename(it.orig, it[keyCol]); });
      db.master[sec.key] = res.value.items;
      masterMeta[sec.key] = res.value.updatedAt;
      save();
      return true;
    }
    if (sec.rename) rows.forEach((it) => { if (it.orig && it.orig !== it[keyCol]) sec.rename(it.orig, it[keyCol]); });
    db.master[sec.key] = data;
    save();
    return true;
  }

  /** โลโก้บริษัท: อ่านรูปเป็น data URL (ไม่เกิน 300 KB) · ปุ่มลบโลโก้ */
  function bindLogoCells(form) {
    form.addEventListener('change', (e) => {
      if (!e.target.matches('[data-logo-file]')) return;
      const file = e.target.files[0];
      const cell = e.target.closest('.logo-cell');
      e.target.value = '';
      if (!file) return;
      if (file.size > 300 * 1024) { alert('รูปโลโก้ต้องไม่เกิน 300 KB'); return; }
      const rd = new FileReader();
      rd.onload = () => {
        cell.querySelector('input[type="hidden"]').value = rd.result;
        cell.querySelector('.logo-prev').innerHTML = '<img src="' + esc(rd.result) + '" alt="">';
      };
      rd.readAsDataURL(file);
    });
    form.addEventListener('click', (e) => {
      if (!e.target.matches('[data-logo-clear]')) return;
      const cell = e.target.closest('.logo-cell');
      cell.querySelector('input[type="hidden"]').value = '';
      cell.querySelector('.logo-prev').innerHTML = '<span class="muted">ไม่มี</span>';
    });
  }

  /** ฟอร์ม "บริษัทและหน่วยงาน": บริษัท 1 บรรทัด + หน่วยงานเป็นบรรทัดย่อยใต้บริษัท · เพิ่ม/ลบได้ทั้งสองระดับ · บันทึกรวม (บริษัทก่อน แล้วหน่วยงาน) */
  function bindCompaniesForm(form) {
    const coSec = MASTER_SECTIONS.find((x) => x.key === 'companies');
    const deptSec = DEPT_SEC();
    const tbody = form.querySelector('tbody');
    const back = '#/master/companies';
    bindLogoCells(form);
    const groupRows = (coRow) => { const out = []; let n = coRow.nextElementSibling; while (n && !n.matches('.co-row, .dept-unassigned-head')) { out.push(n); n = n.nextElementSibling; } return out; };
    form.addEventListener('click', (e) => {
      if (e.target.matches('[data-co-add]')) {
        const head = tbody.querySelector('.dept-unassigned-head');
        const frag = document.createElement('tbody');
        frag.innerHTML = form.querySelector('#tplCompany').innerHTML;
        Array.from(frag.children).forEach((tr) => tbody.insertBefore(tr, head));
        tbody.querySelectorAll('.co-row')[tbody.querySelectorAll('.co-row').length - 1].querySelector('input:not([type="hidden"])').focus();
      } else if (e.target.matches('[data-dept-add]')) {
        const addRow = e.target.closest('tr');
        const frag = document.createElement('tbody');
        frag.innerHTML = form.querySelector('#tplDept').innerHTML;
        const tr = frag.firstElementChild;
        addRow.parentNode.insertBefore(tr, addRow);
        tr.querySelector('input').focus();
      } else if (e.target.matches('[data-m-remove]')) {
        const tr = e.target.closest('tr');
        const orig = tr.dataset.orig;
        if (tr.matches('.dept-row')) {
          const item = orig && db.master.departments.find((x) => x.name === orig);
          if (item && deptSec.inUse(item)) { alert('ลบไม่ได้ — "' + orig + '" ถูกใช้อยู่ในงบหรือมีผู้ใช้สังกัดอยู่แล้ว'); return; }
          tr.remove();
          return;
        }
        // ลบบริษัท: ต้องไม่มีหน่วยงานเหลืออยู่ใต้บริษัทนี้ และไม่ถูกใช้ในงบ
        const rest = groupRows(tr);
        if (rest.some((x) => x.matches('.dept-row'))) { alert('ลบบริษัทไม่ได้ — ยังมีหน่วยงานอยู่ใต้บริษัทนี้ (ลบหน่วยงานก่อน)'); return; }
        const item = orig && db.master.companies.find((x) => x.code === orig);
        if (item && coSec.inUse(item)) { alert('ลบไม่ได้ — "' + orig + '" ถูกใช้อยู่ในงบหรือเอกสารแล้ว'); return; }
        rest.forEach((x) => x.remove());
        tr.remove();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const coRows = [], deptRows = [];
      const errors = [];
      let cur = null;
      Array.from(tbody.rows).forEach((tr) => {
        if (tr.matches('.co-row')) {
          const it = { orig: tr.dataset.orig };
          coSec.cols.forEach((c) => { it[c.k] = tr.querySelector('[data-k="' + c.k + '"]').value.trim(); });
          cur = it;
          if (it.code || it.orig) coRows.push(it);
        } else if (tr.matches('.dept-unassigned-head')) {
          cur = null;
        } else if (tr.matches('.dept-row')) {
          const name = tr.querySelector('[data-k="dept"]').value.trim();
          const sel = tr.querySelector('[data-k="company"]');
          const company = sel ? sel.value : (cur ? cur.code : '');
          if (!name && !tr.dataset.orig) return;
          if (!name) { errors.push('กรุณากรอกชื่อหน่วยงานให้ครบ'); return; }
          if (!company) errors.push(sel ? 'เลือกบริษัทของหน่วยงาน "' + name + '"' : 'กรอกรหัสบริษัทก่อนเพิ่มหน่วยงาน "' + name + '"');
          deptRows.push({ orig: tr.dataset.orig, name, company });
        }
      });
      if (!coRows.length) errors.push('ต้องมีอย่างน้อย 1 บริษัท');
      coRows.forEach((it) => { if (!it.code) errors.push('กรุณากรอกรหัสบริษัท'); });
      const codes = coRows.map((it) => it.code.toLowerCase());
      if (codes.some((k, i) => k && codes.indexOf(k) !== i)) errors.push('รหัสบริษัทซ้ำกัน');
      const names = deptRows.map((it) => it.name.toLowerCase());
      if (names.some((k, i) => names.indexOf(k) !== i)) errors.push('ชื่อหน่วยงานซ้ำกัน (ชื่อหน่วยงานต้องไม่ซ้ำกันทั้งระบบ)');
      // หน่วยงานที่มีผู้ใช้สังกัดอยู่ เปลี่ยนชื่อไม่ได้ (ผู้ใช้เก็บชื่อหน่วยงาน) — ย้ายผู้ใช้ก่อน
      deptRows.filter((it) => it.orig && it.orig !== it.name && USERS.some((u) => deptsOf(u).includes(it.orig))).forEach((it) => errors.push('เปลี่ยนชื่อ "' + it.orig + '" ไม่ได้ — ยังมีผู้ใช้สังกัดหน่วยงานนี้ (แก้หน่วยงานของผู้ใช้ก่อน)'));
      if (errors.length) { showErrors(uniq(errors)); return; }
      const coData = coRows.map((it) => { const o = {}; coSec.cols.forEach((c) => { o[c.k] = it[c.k]; }); return o; });
      const deptData = deptRows.map((it) => ({ name: it.name, company: it.company }));
      const same = (key, data) => JSON.stringify(db.master[key]) === JSON.stringify(data);
      // บริษัทก่อน แล้วหน่วยงาน — รายการที่ไม่เปลี่ยนไม่ต้องบันทึก (ลดโอกาสชนกับแอดมินคนอื่น)
      if (!same('companies', coData) && !(await saveMasterData(coSec, coData, coRows, back))) return;
      if (!same('departments', deptData) && !(await saveMasterData(deptSec, deptData, deptRows, back))) return;
      setFlash('success', 'บันทึกบริษัทและหน่วยงานแล้ว');
      go(back);
    });
  }

  function bindMaster() {
    document.querySelectorAll('.master-form').forEach((form) => {
      if (form.dataset.key === 'companies') { bindCompaniesForm(form); return; }
      const sec = MASTER_SECTIONS.find((x) => x.key === form.dataset.key);
      const tbody = form.querySelector('tbody');
      form.addEventListener('click', (e) => {
        if (e.target.matches('[data-m-add]')) {
          tbody.insertAdjacentHTML('beforeend', form.querySelector('template').innerHTML);
          tbody.lastElementChild.querySelector('input:not([type="hidden"])').focus();
        } else if (e.target.matches('[data-m-remove]')) {
          const tr = e.target.closest('tr');
          const orig = tr.dataset.orig;
          const item = orig && db.master[sec.key].find((x) => x[sec.cols[0].k] === orig);
          if (item && sec.inUse(item)) { alert('ลบไม่ได้ — "' + orig + '" ถูกใช้อยู่ในงบหรือเอกสารแล้ว'); return; }
          tr.remove();
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keyCol = sec.cols[0].k;
        const rows = Array.from(tbody.rows).map((tr) => {
          const it = { orig: tr.dataset.orig };
          sec.cols.forEach((c) => {
            const el = tr.querySelector('[data-k="' + c.k + '"]');
            it[c.k] = el.tagName === 'SELECT' ? el.value : el.value.trim();
          });
          return it;
        }).filter((it) => it[keyCol] || it.orig);
        const errors = [];
        if (!rows.length && !sec.optional) errors.push('ต้องมีอย่างน้อย 1 รายการ');
        rows.forEach((it) => { if (!it[keyCol]) errors.push('กรุณากรอก' + sec.cols[0].label); });
        const keys = rows.map((it) => it[keyCol].toLowerCase());
        if (keys.some((k, i) => k && keys.indexOf(k) !== i)) errors.push(sec.cols[0].label + 'ซ้ำกัน');
        if (errors.length) { showErrors(errors); return; }
        const data = rows.map((it) => { const o = {}; sec.cols.forEach((c) => { o[c.k] = it[c.k]; }); return o; });
        if (!(await saveMasterData(sec, data, rows, '#/master/' + sec.key))) return;
        setFlash('success', 'บันทึก' + sec.title + 'แล้ว');
        go('#/master/' + sec.key);
      });
    });
  }


  // ---------------------------------------------------------------- Admin: ผู้ใช้ บทบาท สิทธิ์ (โหมด Supabase)

  /** บทบาทที่เห็นงบ/งานของคนอื่น (ต้องกำหนดบริษัทที่ดูได้) */
  const roleSeesWork = (roles) => ['budget.view_all', 'budget.manage', 'budget.verify', 'request.decide', 'cut.record', 'po.record', 'gl.manage'].some((k) => [].concat(roles).some((rk) => (DEMO_ROLE_PERMS[rk] || []).includes(k)));
  const adminResetCount = () => (!REMOTE && can('user.manage') ? USERS.filter((u) => accountState(u).key === 'reset_requested').length : 0);

  function viewAdmin(params) {
    if (!can('user.manage')) return '<div class="alert error">ไม่มีสิทธิ์จัดการผู้ใช้และสิทธิ์</div>';
    if (!REMOTE) return viewAdminDemo(params);
    const tab = params.get('tab') === 'roles' ? 'roles' : 'users';
    const t = (key, label) => '<a href="#/admin' + (key === 'roles' ? '?tab=roles' : '') + '"' + (tab === key ? ' class="active" aria-current="page"' : '') + '>' + label + '</a>';
    return '<div class="page-head"><div><h1>ผู้ใช้และสิทธิ์</h1><div class="page-sub">จัดการผู้ใช้ บทบาท และสิทธิ์ของแต่ละบทบาท — มีผลทันที ตรวจสอบที่ฝั่งฐานข้อมูล</div></div></div>' + takeFlash() +
      '<nav class="tabs" aria-label="หมวด">' + t('users', 'ผู้ใช้') + t('roles', 'บทบาทและสิทธิ์') + '</nav>' +
      '<div id="adminBox" data-tab="' + tab + '"><p class="muted">กำลังโหลด…</p></div>';
  }

  async function bindAdmin() {
    const box = document.getElementById('adminBox');
    if (!box) return;
    if (!REMOTE) { bindAdminDemo(box); return; }
    const [ru, rr] = await Promise.all([run(() => window.RemoteApi.listUsers()), run(() => window.RemoteApi.listRoles())]);
    if (!ru || !rr || !document.getElementById('adminBox')) return;
    const users = ru.value;
    const { roles, catalog } = rr.value;
    adminCounts.pending = users.filter((x) => x.active && !x.role).length;
    renderNav(location.hash.split('?')[0]);
    if (box.dataset.tab === 'roles') renderRolesTab(box, users, roles, catalog); else renderUsersTab(box, users, roles);
  }

  function renderUsersTab(box, users, roles) {
    const stat = (label, n, cls) => '<div class="stat' + (cls ? ' ' + cls : '') + '"><strong>' + n + '</strong><span>' + label + '</span></div>';
    const pending = users.filter((x) => x.active && !x.role).length;
    const disabled = users.filter((x) => !x.active).length;
    const roleOpts = (cur) => opt('', '— ยังไม่กำหนดสิทธิ์ —', cur || '') + roles.map((r) => opt(r.key, r.name, cur || '')).join('');
    box.innerHTML =
      '<div class="admin-stats">' + stat('ผู้ใช้ทั้งหมด', users.length) + stat('รอกำหนดบทบาท', pending, pending ? 'warn' : '') + stat('ปิดการใช้งาน', disabled) + '</div>' +
      '<section class="card form-section"><div class="section-head"><div><h2 class="section-title">รายชื่อผู้ใช้</h2>' +
      '<div class="muted section-hint">เพิ่มผู้ใช้ใหม่ที่ Supabase Dashboard → Authentication → Users → Add user (ใส่อีเมลและรหัสผ่าน) ผู้ใช้จะปรากฏที่นี่เองเป็น "รอกำหนดบทบาท" แล้วมากำหนดชื่อและบทบาทให้</div></div></div>' +
      '<div class="admin-filters"><label class="input-wrap search">' + ICON_SEARCH + '<input id="uSearch" type="search" placeholder="ค้นหาชื่อ อีเมล หน่วยงาน" aria-label="ค้นหา"></label>' +
      '<div class="select-wrap"><select id="uRole" aria-label="กรองตามบทบาท">' + opt('', 'บทบาท: ทั้งหมด', '') + opt('none', 'บทบาท: รอกำหนด', '') + roles.map((r) => opt(r.key, 'บทบาท: ' + r.name, '')).join('') + '</select></div>' +
      '<div class="select-wrap"><select id="uStatus" aria-label="กรองตามสถานะ">' + opt('', 'สถานะ: ทั้งหมด', '') + opt('on', 'สถานะ: ใช้งาน', '') + opt('off', 'สถานะ: ปิดการใช้งาน', '') + '</select></div></div>' +
      '<datalist id="deptList">' + db.master.departments.map((d) => '<option value="' + esc(d.name) + '"></option>').join('') + '</datalist>' +
      '<div class="table-wrap"><table class="edit-table users-table"><thead><tr><th>อีเมล</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>หน่วยงาน</th><th>บทบาท</th><th>ใช้งาน</th><th></th></tr></thead><tbody id="uRows">' +
      users.map((u) => '<tr data-uid="' + esc(u.id) + '" data-search="' + esc((u.email + ' ' + u.name + ' ' + u.department).toLowerCase()) + '" data-role="' + esc(u.role || 'none') + '" data-active="' + (u.active ? 'on' : 'off') + '">' +
        '<td class="nowrap">' + esc(u.email) + (u.id === me().id ? ' <span class="muted">(คุณ)</span>' : '') + (!u.role && u.active ? '<div><span class="badge pending">รอกำหนดบทบาท</span></div>' : '') + '</td>' +
        '<td><input data-u="name" value="' + esc(u.name) + '" aria-label="ชื่อ"></td><td><input data-u="title" value="' + esc(u.title) + '" aria-label="ตำแหน่ง"></td>' +
        '<td><input data-u="department" list="deptList" value="' + esc(u.department) + '" aria-label="หน่วยงาน"></td>' +
        '<td><div class="select-wrap"><select data-u="role" aria-label="บทบาท">' + roleOpts(u.role) + '</select></div></td>' +
        '<td class="center"><input type="checkbox" data-u="active" aria-label="ใช้งาน"' + (u.active ? ' checked' : '') + '></td>' +
        '<td><button type="button" class="btn small primary" data-u-save>บันทึก</button></td></tr>').join('') + '</tbody></table></div>' +
      '<p class="muted small-note" id="uEmpty" hidden>ไม่พบผู้ใช้ตามเงื่อนไข</p></section>';
    const rows = Array.from(box.querySelectorAll('#uRows tr'));
    const apply = () => {
      const q = box.querySelector('#uSearch').value.trim().toLowerCase();
      const r = box.querySelector('#uRole').value;
      const st = box.querySelector('#uStatus').value;
      let shown = 0;
      rows.forEach((tr) => {
        const okRow = (!q || tr.dataset.search.includes(q)) && (!r || tr.dataset.role === r) && (!st || tr.dataset.active === st);
        tr.hidden = !okRow;
        if (okRow) shown += 1;
      });
      box.querySelector('#uEmpty').hidden = shown > 0;
    };
    ['#uSearch', '#uRole', '#uStatus'].forEach((sel) => box.querySelector(sel).addEventListener('input', apply));
    box.querySelector('#uRows').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-u-save]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const val = (k) => tr.querySelector('[data-u="' + k + '"]');
      const next = { id: tr.dataset.uid, name: val('name').value.trim(), title: val('title').value.trim(), department: val('department').value.trim(), role: val('role').value, active: val('active').checked };
      if (next.role && !next.name) { alert('กรุณากรอกชื่อ-นามสกุลก่อนกำหนดบทบาท'); return; }
      if (!(await runAndReload(() => window.RemoteApi.updateUser(next)))) return;
      setFlash('success', 'บันทึกข้อมูลผู้ใช้ ' + (next.name || '') + ' แล้ว');
      go('#/admin');
    });
  }

  function renderRolesTab(box, users, roles, catalog) {
    const groups = [];
    PERMISSIONS.filter((p) => catalog.includes(p.key)).forEach((p) => {
      let g = groups.find((x) => x.name === p.group);
      if (!g) { g = { name: p.group, items: [] }; groups.push(g); }
      g.items.push(p);
    });
    const IMPLIES_VIEW = ['budget.manage', 'request.decide', 'payment.record'];
    const locked = (r, perm) => r.key === 'admin' && perm === 'user.manage';
    const cols = roles.length + 1;
    const matrix = '<div class="table-wrap"><table class="perm-matrix"><thead><tr><th>สิทธิ์</th>' +
      roles.map((r) => '<th class="perm-col"><div class="role-name">' + esc(r.name) + '</div><div class="muted">' + esc(r.key) + ' · ' + r.users + ' คน</div></th>').join('') + '</tr></thead><tbody>' +
      groups.map((g) => '<tr class="perm-group"><td colspan="' + cols + '">' + esc(g.name) + '</td></tr>' + g.items.map((p) =>
        '<tr><td><strong>' + esc(p.label) + '</strong><div class="muted">' + esc(p.hint) + '</div></td>' + roles.map((r) =>
          '<td class="center"><input type="checkbox" data-role="' + esc(r.key) + '" data-perm="' + p.key + '"' + (r.permissions.includes(p.key) || locked(r, p.key) ? ' checked' : '') +
          (locked(r, p.key) ? ' disabled title="Admin ต้องมีสิทธิ์นี้เสมอ"' : '') + ' aria-label="' + esc(r.name + ': ' + p.label) + '"></td>').join('') + '</tr>').join('')).join('') +
      '</tbody></table></div>';
    const details = '<div class="table-wrap"><table class="edit-table"><thead><tr><th>รหัส</th><th>ชื่อบทบาท</th><th>คำอธิบาย</th><th>ผู้ใช้</th><th></th></tr></thead><tbody>' +
      roles.map((r) => '<tr data-rkey="' + esc(r.key) + '"><td class="nowrap">' + esc(r.key) + (r.isSystem ? '<div class="muted">บทบาทตั้งต้น</div>' : '') + '</td>' +
        '<td><input data-r="name" value="' + esc(r.name) + '" aria-label="ชื่อบทบาท"></td><td><input data-r="description" value="' + esc(r.description) + '" aria-label="คำอธิบาย"></td>' +
        '<td class="num">' + r.users + '</td><td>' + (r.isSystem ? '' : '<button type="button" class="btn small bad" data-r-del title="' + (r.users ? 'ลบไม่ได้ — ยังมีผู้ใช้' : 'ลบบทบาท') + '"' + (r.users ? ' disabled' : '') + '>ลบ</button>') + '</td></tr>').join('') + '</tbody></table></div>';
    box.innerHTML = '<section class="card form-section"><div class="section-head"><div><h2 class="section-title">ตารางสิทธิ์ของแต่ละบทบาท</h2>' +
      '<div class="muted section-hint">ติ๊กเพื่อให้บทบาทนั้นทำสิ่งนั้นได้ — มีผลกับผู้ใช้ทุกคนในบทบาททันที สิทธิ์อนุมัติ งวดจ่าย บัญชี และจัดการงบ เห็นงบและคำขอทั้งหมดโดยอัตโนมัติ</div></div></div>' +
      matrix + '<h3 class="side-title" style="margin-top:var(--s-6)">ชื่อและคำอธิบายบทบาท</h3>' + details +
      '<div class="actions"><button type="button" class="btn primary" id="saveRoles">บันทึกการเปลี่ยนแปลง</button></div></section>' +
      '<section class="card form-section"><div class="section-head"><div><h2 class="section-title">สร้างบทบาทใหม่</h2><div class="muted section-hint">เช่น ผู้จัดการฝ่าย, ผู้ตรวจสอบ (ดูอย่างเดียว) หรือ Admin + การเงิน สำหรับทีมเล็กที่คนเดียวทำหลายหน้าที่</div></div></div>' +
      '<form id="newRole" class="form-grid"><label class="field"><span>รหัสบทบาท (อังกฤษพิมพ์เล็ก เช่น manager)</span><input name="key" required pattern="[a-z][a-z0-9_]{1,29}" maxlength="30"></label>' +
      '<label class="field"><span>ชื่อบทบาท</span><input name="name" required></label>' +
      '<label class="field full"><span>คำอธิบาย</span><input name="description"></label>' +
      '<label class="field"><span>คัดลอกสิทธิ์จาก</span><div class="select-wrap"><select name="copy">' + opt('', '— เริ่มจากไม่มีสิทธิ์ —', '') + roles.map((r) => opt(r.key, r.name, '')).join('') + '</select></div></label>' +
      '<div class="field"><span>&nbsp;</span><button class="btn primary" type="submit">สร้างบทบาท</button></div></form></section>';

    // สิทธิ์ที่ต้องเห็นเอกสารของคนอื่น → ช่อง "ดูงบและคำขอของทุกคน" ถูกรวมไว้แล้ว
    const syncImplied = () => roles.forEach((r) => {
      const view = box.querySelector('[data-role="' + r.key + '"][data-perm="budget.view_all"]');
      if (!view) return;
      const implied = IMPLIES_VIEW.some((k) => { const c = box.querySelector('[data-role="' + r.key + '"][data-perm="' + k + '"]'); return c && c.checked; });
      view.title = implied ? 'รวมอยู่แล้วจากสิทธิ์อื่นของบทบาทนี้' : '';
      view.closest('td').classList.toggle('implied', implied);
    });
    box.addEventListener('change', syncImplied);
    syncImplied();

    box.querySelector('#saveRoles').addEventListener('click', async () => {
      const changed = [];
      let invalid = false;
      roles.forEach((r) => {
        const tr = box.querySelector('tr[data-rkey="' + r.key + '"]');
        const name = tr.querySelector('[data-r="name"]').value.trim();
        const description = tr.querySelector('[data-r="description"]').value.trim();
        const permissions = PERMISSIONS.map((p) => p.key).filter((k) => catalog.includes(k) && box.querySelector('[data-role="' + r.key + '"][data-perm="' + k + '"]').checked);
        const same = name === r.name && description === r.description && permissions.length === r.permissions.length && permissions.every((k) => r.permissions.includes(k));
        if (!name) { alert('กรุณากรอกชื่อบทบาท ' + r.key); invalid = true; return; }
        if (!same) changed.push({ key: r.key, name, description, permissions });
      });
      if (invalid) return;
      if (!changed.length) { alert('ยังไม่มีการเปลี่ยนแปลง'); return; }
      for (const c of changed) {
        if (!(await run(() => window.RemoteApi.saveRole(c)))) { await run(reloadRemote); go('#/admin?tab=roles'); return; }
      }
      if (!(await run(reloadRemote))) return;
      setFlash('success', 'บันทึกสิทธิ์ของ ' + changed.length + ' บทบาทแล้ว — มีผลกับผู้ใช้ทันที');
      go('#/admin?tab=roles');
    });
    box.querySelector('table.edit-table tbody').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-r-del]');
      if (!del) return;
      const key = del.closest('tr').dataset.rkey;
      if (!confirm('ลบบทบาท ' + key + ' ?')) return;
      if (!(await runAndReload(() => window.RemoteApi.deleteRole(key)))) return;
      setFlash('info', 'ลบบทบาท ' + key + ' แล้ว');
      go('#/admin?tab=roles');
    });
    box.querySelector('#newRole').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const src = roles.find((r) => r.key === f.copy.value);
      const role = { key: f.key.value.trim(), name: f.name.value.trim(), description: f.description.value.trim(), permissions: src ? src.permissions.filter((k) => k !== 'user.manage') : [] };
      if (!(await runAndReload(() => window.RemoteApi.saveRole(role)))) return;
      setFlash('success', 'สร้างบทบาท ' + role.name + ' แล้ว — ติ๊กสิทธิ์ในตารางด้านบน');
      go('#/admin?tab=roles');
    });
  }

  // ---------------------------------------------------------------- คำขอเพิ่มงบ (Business → ที่ประชุม → ผู้คุมงบยืนยัน)

  function changeLineRow(b, l) {
    const opts = ledgerItems(b).map((i) => opt(i.id, i.code + ' ' + i.name + ' — งบ ' + money(itemTotal(i)), l.itemId || '')).join('');
    const isNew = l.itemId === 'new';
    return '<tr><td><div class="select-wrap"><select name="chItem" aria-label="รายการ">' + opts + opt('new', '+ เพิ่มรายการใหม่', l.itemId || '') + '</select></div>' +
      '<div class="new-item"' + (isNew ? '' : ' hidden') + '><input name="chCode" placeholder="รหัสรายการ" value="' + esc(l.code || '') + '"><input name="chName" placeholder="ชื่อรายการ" value="' + esc(l.name || '') + '"></div></td>' +
      '<td><input name="chAmount" type="number" min="0.01" step="0.01" class="right" value="' + esc(l.amount || '') + '" aria-label="ขอเพิ่ม"></td>' +
      '<td><button type="button" class="btn small bad" data-remove-ch title="ลบ">×</button></td></tr>';
  }

  function viewChangeForm(budgetId, changeId) {
    const c = changeId ? changeById(changeId) : null;
    if (changeId && !c) return notFound();
    const b = budgetById(c ? c.budgetId : budgetId);
    if (!b) return notFound();
    if (!actsFor(b) || !can('request.create')) return '<div class="alert error">ขอเพิ่มงบได้เฉพาะ Business เจ้าของงบนี้หรือธุรการ</div>';
    if (!isActive(b)) return '<div class="alert error">งบนี้ยังไม่เปิดใช้งบ</div>';
    if (c && !['draft', 'returned'].includes(c.state)) return '<div class="alert error">แก้ไขได้เฉพาะร่างหรือคำขอที่ถูกส่งกลับ</div>';
    const isProject = b.structure === 'project';
    const lines = c ? c.lines : [{ itemId: isProject ? b.items[0].id : (ledgerItems(b)[0] || {}).id }];
    return '<div class="page-head"><div><h1>' + (c ? 'แก้ไขคำขอเพิ่มงบ ' + esc(c.no) : 'ขอเพิ่มงบ') + '</h1><div class="page-sub">' + badge(b.type, TYPE_SHORT[b.type]) + ' ' + esc(b.code + ' ' + b.name) +
      ' — บันทึกเป็นร่าง → ' + (b.type === 'CBS' ? 'เสนอผู้บริหารอนุมัติ → แนบเอกสารอนุมัติ' : 'เข้าที่ประชุม → แนบมติ') + ' → ผู้คุมงบยืนยัน แล้ววงเงินจึงเพิ่ม</div></div></div><div id="formError"></div>' +
      '<form id="changeForm" class="card form-section" data-budget="' + b.id + '" data-id="' + esc(changeId || '') + '">' +
      '<label class="field"><span>เหตุผลที่ขอเพิ่มงบ</span><textarea name="reason" rows="3" required>' + esc(c ? c.reason : '') + '</textarea></label>' +
      (isProject
        ? '<label class="field"><span>ขอเพิ่มวงเงินรวมทั้งโครงการ (รวม VAT)</span><input name="projAdd" type="number" min="0.01" step="0.01" class="right" required value="' + esc(c ? c.lines[0].amount : '') + '"></label>'
        : '<div class="table-wrap"><table class="edit-table"><thead><tr><th>รายการ</th><th class="num" style="width:12rem">ขอเพิ่ม (รวม VAT)</th><th style="width:3rem"></th></tr></thead>' +
          '<tbody id="chRows">' + lines.map((l) => changeLineRow(b, l)).join('') + '</tbody></table></div>' +
          '<template id="chTpl">' + changeLineRow(b, { itemId: (ledgerItems(b)[0] || {}).id }) + '</template>' +
          '<div class="actions table-actions"><button type="button" class="btn small" id="addCh">+ เพิ่มบรรทัด</button><span class="muted">รวมขอเพิ่ม <strong id="chTotal">0.00</strong> บาท</span></div>') +
      '<div class="actions"><button class="btn primary" type="submit">บันทึกร่าง</button><a class="btn" data-back href="#/budget/' + b.id + '">ยกเลิก</a></div></form>';
  }

  function bindChangeForm() {
    const form = document.getElementById('changeForm');
    if (!form) return;
    const b = budgetById(form.dataset.budget);
    const rows = document.getElementById('chRows');
    const recalc = () => {
      if (!rows) return;
      let t = 0;
      Array.from(rows.rows).forEach((tr) => {
        t += Number(tr.querySelector('[name="chAmount"]').value || 0);
        tr.querySelector('.new-item').hidden = tr.querySelector('[name="chItem"]').value !== 'new';
      });
      document.getElementById('chTotal').textContent = money(t);
    };
    if (rows) {
      document.getElementById('addCh').addEventListener('click', () => { rows.insertAdjacentHTML('beforeend', document.getElementById('chTpl').innerHTML); recalc(); });
      rows.addEventListener('click', (e) => { if (e.target.matches('[data-remove-ch]') && rows.rows.length > 1) { e.target.closest('tr').remove(); recalc(); } });
      form.addEventListener('input', recalc);
      form.addEventListener('change', recalc);
      recalc();
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = form.elements;
      const errors = [];
      const reason = f.reason.value.trim();
      if (!reason) errors.push('กรุณาระบุเหตุผล');
      let lines;
      if (b.structure === 'project') {
        lines = [{ itemId: b.items[0].id, amount: round2(f.projAdd.value) }];
      } else {
        lines = Array.from(rows.rows).map((tr) => {
          const itemId = tr.querySelector('[name="chItem"]').value;
          const l = { itemId, amount: round2(tr.querySelector('[name="chAmount"]').value) };
          if (itemId === 'new') Object.assign(l, { code: tr.querySelector('[name="chCode"]').value.trim(), name: tr.querySelector('[name="chName"]').value.trim() });
          return l;
        });
        lines.filter((l) => l.itemId === 'new').forEach((l) => {
          if (!l.code || !l.name) errors.push('กรุณากรอกรหัสและชื่อรายการใหม่');
          else if (b.items.some((i) => i.code === l.code)) errors.push('รหัสรายการ ' + l.code + ' มีอยู่แล้ว');
          else if (b.type === 'CBS' && String(l.code).includes('.')) errors.push('Item หลักใหม่ใช้รหัสไม่มีจุด (เช่น 5) — Item ย่อยเพิ่มที่หน้ารายละเอียดงบ');
        });
      }
      if (lines.some((l) => !(l.amount > 0))) errors.push('จำนวนเงินที่ขอเพิ่มต้องมากกว่า 0');
      if (errors.length) { showErrors(errors); return; }
      let c = form.dataset.id ? changeById(form.dataset.id) : null;
      if (c) {
        Object.assign(c, { reason, lines });
        addHistory(c, 'แก้ไขคำขอเพิ่มงบ', '', c.no);
      } else {
        c = { id: nextId('g'), no: nextNo(DOC_PREFIX.inc), budgetId: b.id, state: 'draft', reason, lines,
          meeting: {}, attachments: [], createdBy: b.ownerId || me().id, createdAt: new Date().toISOString(), history: [] };
        if (isProxy() && b.ownerId !== me().id) c.proxyBy = me().id;
        db.changes = (db.changes || []).concat(c);
        addHistory(c, 'สร้างคำขอเพิ่มงบ', money(changeTotal(c)) + ' บาท', c.no);
      }
      save();
      setFlash('success', 'บันทึกคำขอเพิ่มงบ ' + c.no + ' แล้ว — เข้าที่ประชุมแล้วแนบมติและส่งให้ผู้คุมงบ');
      go('#/change/' + c.id);
    });
  }

  function viewChangeDetail(id) {
    const c = changeById(id);
    if (!c) return notFound();
    const b = budgetById(c.budgetId);
    const own = c.createdBy === me().id || proxyOf(budgetById(c.budgetId));
    const editable = own && ['draft', 'returned'].includes(c.state);
    const actions = [];
    if (editable) {
      actions.push('<a class="btn" href="#/change/' + c.id + '/edit">แก้ไขร่าง</a>');
      actions.push('<button type="button" class="btn bad" id="cancelChange">ยกเลิกคำขอ</button>');
    }
    let html = '<div class="page-head detail-head"><div><div class="eyebrow">คำขอเพิ่มงบ · ' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a> ' + esc(b.name) + '</div>' +
      '<h1>' + esc(c.no) + ' ' + badge(CHANGE_STATE_BADGE[c.state], CHANGE_STATE[c.state]) + '</h1></div>' +
      (actions.length ? '<div class="head-actions">' + actions.join('') + '</div>' : '') + '</div>' + takeFlash();
    if (c.state === 'returned') html += '<div class="alert error">ผู้คุมงบส่งกลับ: ' + esc(c.returnReason || '') + '</div>';
    const rows = c.lines.map((l) => {
      const it = l.itemId === 'new' ? null : itemById(b, l.itemId);
      return '<tr><td>' + (it ? esc(it.code + ' ' + it.name) : esc((l.code || '') + ' ' + (l.name || '')) + ' <span class="badge draft">รายการใหม่</span>') + '</td>' +
        '<td class="num">' + (it ? money(itemTotal(it)) : '-') + '</td><td class="num"><strong>+' + money(l.amount) + '</strong></td></tr>';
    }).join('');
    let main = '<section class="card"><p><strong>เหตุผล:</strong> ' + esc(c.reason) + '</p>' +
      '<div class="table-wrap"><table><thead><tr><th>รายการ</th><th class="num">งบปัจจุบัน</th><th class="num">ขอเพิ่ม</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td colspan="2" class="right"><strong>รวมขอเพิ่ม</strong></td><td class="num"><strong>+' + money(changeTotal(c)) + '</strong></td></tr></tfoot></table></div></section>';
    const ap = apprOf(b.type);
    main += '<h2>' + ap.title + '</h2><section class="card">';
    if (editable) {
      main += '<form id="submitChange" data-id="' + c.id + '"><div class="form-grid">' +
        '<label class="field"><span>' + ap.date + '</span><input name="meetingDate" type="date" value="' + esc(c.meeting.date || '') + '"></label>' +
        '<label class="field"><span>' + ap.no + '</span><input name="meetingNo" value="' + esc(c.meeting.no || '') + '"></label>' +
        (ap.exec ? '<label class="field full"><span>' + ap.by + '</span><input name="meetingBy" placeholder="' + ap.byEx + '" value="' + esc(c.meeting.by || '') + '"></label>' : '') + '</div>' +
        '<div class="field"><span>' + ap.file + '</span>' + attachList(c.attachments, { del: true, empty: ap.empty }) +
        '<label class="btn small file-btn">+ แนบไฟล์<input type="file" id="changeFiles" accept="application/pdf,image/png,image/jpeg" multiple hidden></label></div>' +
        '<div class="actions"><button class="btn primary" type="submit">ส่งให้ผู้คุมงบตรวจสอบ</button></div></form>';
    } else {
      main += (c.meeting.no ? '<p>' + esc(c.meeting.no) + apprMetaText(ap, c.meeting) + '</p>' : '<p class="muted">' + ap.none + '</p>') +
        attachList(c.attachments, { empty: ap.empty });
    }
    main += '</section>';
    let side = '<div class="card total-card"><span class="muted">ขอเพิ่มงบ</span><div class="total-amount">+' + money(changeTotal(c)) + ' <small>บาท</small></div>' +
      '<dl class="kv compact"><dt>งบปัจจุบันของโครงการ</dt><dd>' + money(budgetTotal(b)) + '</dd><dt>หลังเพิ่ม</dt><dd>' + money(round2(budgetTotal(b) + changeTotal(c))) + '</dd></dl></div>';
    if (c.state === 'review' && can('budget.verify')) {
      side += '<div class="card decision"><h3 class="side-title">' + ap.verify + 'และเพิ่มงบ</h3><form id="verifyChange" data-id="' + c.id + '">' +
        '<label class="field"><span>หมายเหตุ (จำเป็นเมื่อส่งกลับ)</span><textarea name="comment" rows="3"></textarea></label>' +
        '<div class="actions"><button class="btn primary" type="submit" data-verify="approved">ยืนยันเพิ่มงบ</button><button class="btn bad" type="submit" data-verify="returned">ส่งกลับ</button></div></form></div>';
    }
    side += historyCard(c.history);
    return html + '<div class="detail-layout"><div class="detail-main">' + main + '</div><aside class="detail-side">' + side + '</aside></div>';
  }

  function bindChangeDetail() {
    const sub = document.getElementById('submitChange');
    if (sub) {
      const c = changeById(sub.dataset.id);
      const ap = apprOf((budgetById(c.budgetId) || {}).type);
      const keep = () => { c.meeting = { date: sub.elements.meetingDate.value, no: sub.elements.meetingNo.value.trim(), by: sub.elements.meetingBy ? sub.elements.meetingBy.value.trim() : '' }; };
      sub.querySelector('#changeFiles').addEventListener('change', async (e) => {
        const files = await readFiles(e.target, 'resolution');
        if (!files.length) return;
        keep();
        c.attachments = (c.attachments || []).concat(files);
        addHistory(c, ap.exec ? 'แนบไฟล์เอกสารอนุมัติ' : 'แนบไฟล์มติ', files.map((f) => f.name).join(', '), c.no);
        if (save()) go('#/change/' + c.id);
      });
      sub.addEventListener('click', (e) => {
        const del = e.target.closest('[data-att-del]');
        if (!del) return;
        keep();
        c.attachments = c.attachments.filter((x) => x.id !== del.dataset.attDel);
        save();
        go('#/change/' + c.id);
      });
      sub.addEventListener('submit', (e) => {
        e.preventDefault();
        keep();
        if (!c.meeting.no || !c.attachments.length || (ap.exec && !c.meeting.by)) {
          alert('กรุณาระบุ' + ap.no + (ap.exec ? ' ' + ap.by : '') + 'และแนบ' + ap.file); return;
        }
        c.state = 'review';
        addHistory(c, ap.exec ? 'แนบเอกสารอนุมัติผู้บริหารและส่งให้ผู้คุมงบตรวจสอบ' : 'แนบมติที่ประชุมและส่งให้ผู้คุมงบตรวจสอบ', c.meeting.no, c.no);
        save();
        setFlash('success', 'ส่งคำขอเพิ่มงบ ' + c.no + ' ให้ผู้คุมงบแล้ว');
        go('#/change/' + c.id);
      });
    }
    const cancel = document.getElementById('cancelChange');
    if (cancel) {
      cancel.addEventListener('click', () => {
        const c = changeById(location.hash.split('/')[2]);
        if (!confirm('ยกเลิกคำขอเพิ่มงบ ' + c.no + ' ?')) return;
        c.state = 'cancelled';
        addHistory(c, 'ยกเลิกคำขอเพิ่มงบ', '', c.no);
        save();
        go('#/change/' + c.id);
      });
    }
    const ver = document.getElementById('verifyChange');
    if (ver) {
      let decision = 'approved';
      ver.querySelectorAll('[data-verify]').forEach((btn) => btn.addEventListener('click', () => { decision = btn.dataset.verify; }));
      ver.addEventListener('submit', (e) => {
        e.preventDefault();
        const c = changeById(ver.dataset.id);
        const b = budgetById(c.budgetId);
        const comment = ver.elements.comment.value.trim();
        if (decision === 'returned') {
          if (!comment) { alert('กรุณาระบุเหตุผลที่ส่งกลับ'); return; }
          Object.assign(c, { state: 'returned', returnReason: comment });
          addHistory(c, 'ส่งกลับให้แก้ไข', comment, c.no);
        } else {
          c.lines.forEach((l) => {
            if (l.itemId === 'new') {
              const it = { id: nextId('i'), code: l.code, name: l.name, amount: l.amount, vat: 0, qty: '', unit: '', glCode: '', glName: '' };
              b.items.push(it);
              l.itemId = it.id;
            } else {
              adjustItem(itemById(b, l.itemId), l.amount);
            }
          });
          addRevision(b, 'เพิ่มงบตามคำขอ ' + c.no + ' (' + (c.meeting.no || '') + ')' + (comment ? ' — ' + comment : ''));
          addHistory(b, 'เพิ่มงบตามคำขอ ' + c.no, '+' + money(changeTotal(c)) + ' บาท', 'งบ ' + b.code);
          Object.assign(c, { state: 'approved', approvedAt: new Date().toISOString(), approvedBy: me().id });
          addHistory(c, 'ยืนยันเพิ่มงบ', comment, c.no);
        }
        save();
        setFlash(decision === 'approved' ? 'success' : 'info', decision === 'approved' ? 'เพิ่มงบ ' + b.code + ' +' + money(changeTotal(c)) + ' บาทแล้ว' : 'ส่งคำขอ ' + c.no + ' กลับแล้ว');
        go('#/change/' + c.id);
      });
    }
  }

  // ---------------------------------------------------------------- ผู้คุมงบ: โยก / ลดงบ

  function itemSelectOptions(selected) {
    return db.budgets.filter((b) => isActive(b) && budgetScoped(b)).map((b) => '<optgroup label="' + esc(b.code + ' ' + b.name) + '">' +
      ledgerItems(b).map((i) => {
        const v = b.id + '|' + i.id;
        return opt(v, (b.structure === 'project' ? 'งบรวมทั้งโครงการ' : i.code + ' ' + i.name) + ' — คงเหลือ ' + money(usage(b, i.id).remaining), selected);
      }).join('') + '</optgroup>').join('');
  }

  function viewAdjust(params) {
    if (!can('budget.adjust')) return '<div class="alert error">ไม่มีสิทธิ์โยก/ลดงบ</div>';
    const to = params.get('to') ? params.get('to') + '|' + (params.get('item') || '') : '';
    const from = params.get('budget') ? params.get('budget') + '|' + ((ledgerItems(budgetById(params.get('budget')) || { items: [], type: 'CAPEX' })[0] || {}).id || '') : '';
    const ctx0 = budgetById(params.get('budget') || params.get('to'));
    const ctx = budgetScoped(ctx0) ? ctx0 : undefined;
    const recent = (db.log || []).filter((x) => /^(โยกงบ|ลดงบ)/.test(x.action) && (!ctx || x.ref.split(' → ').includes(ctx.code))).slice(-10).reverse();
    return '<div class="page-head"><div><h1>ปรับปรุงงบ' + (ctx ? ' · ' + esc(ctx.code) : '') + '</h1><div class="page-sub">' + (ctx ? esc(ctx.name) + ' — ' : '') +
      'โยกข้ามรายการหรือข้ามโครงการได้ตามดุลพินิจของผู้คุมงบ ทุกครั้งต้องระบุเหตุผลและเก็บเป็นประวัติการปรับงบ</div></div></div>' + takeFlash() +
      '<div id="formError"></div><div class="form-main">' +
      '<section class="card form-section"><div class="section-head"><h2 class="section-title"><span class="step">1</span>โยกงบ</h2></div>' +
      '<form id="moveForm" class="form-grid"><label class="field"><span>โยกจาก</span><div class="select-wrap"><select name="from" required><option value="">— เลือก —</option>' + itemSelectOptions(from) + '</select></div></label>' +
      '<label class="field"><span>ไปยัง</span><div class="select-wrap"><select name="to" required><option value="">— เลือก —</option>' + itemSelectOptions(to) + '</select></div></label>' +
      '<label class="field"><span>จำนวนเงิน (รวม VAT)</span><input name="amount" type="number" min="0.01" step="0.01" class="right" required value="' + esc(params.get('amount') || '') + '"></label>' +
      '<label class="field"><span>เหตุผล</span><input name="reason" required></label>' +
      '<div class="field full"><button class="btn primary" type="submit">โยกงบ</button></div></form></section>' +
      '<section class="card form-section"><div class="section-head"><h2 class="section-title"><span class="step">2</span>ลดงบ</h2></div>' +
      '<p class="muted small-note">เช่น ซื้อได้ถูกกว่างบ โครงการยกเลิก/เลื่อน หรือผู้บริหารสั่งตัดงบ — ลดได้ไม่เกินยอดคงเหลือ (ยอดที่ใช้/จองแล้วลดไม่ได้)</p>' +
      '<form id="cutBudgetForm" class="form-grid"><label class="field"><span>รายการ</span><div class="select-wrap"><select name="target" required><option value="">— เลือก —</option>' + itemSelectOptions(from) + '</select></div></label>' +
      '<label class="field"><span>ลดลง (รวม VAT)</span><input name="amount" type="number" min="0.01" step="0.01" class="right" required></label>' +
      '<label class="field full"><span>เหตุผล</span><input name="reason" required></label>' +
      '<div class="field full"><button class="btn bad" type="submit">ลดงบ</button></div></form></section>' +
      '<section class="card form-section"><div class="section-head"><h2 class="section-title">การโยก / ลดงบล่าสุด' + (ctx ? ' ของงบนี้' : '') + '</h2></div>' +
      (recent.length ? '<div class="table-wrap"><table><thead><tr><th>เมื่อ</th><th>รายการ</th><th>รายละเอียด</th><th>โดย</th></tr></thead><tbody>' +
        recent.map((x) => '<tr><td class="nowrap">' + fmtDate(x.at) + '</td><td>' + esc(x.action) + '</td><td>' + esc(x.detail) + '</td><td class="nowrap">' + esc(userName(x.by)) + '</td></tr>').join('') +
        '</tbody></table></div>' : '<p class="muted">ยังไม่มี</p>') + '</section></div>';
  }

  function bindAdjust() {
    const mv = document.getElementById('moveForm');
    if (!mv) return;
    const pick = (v) => { const [bid, iid] = v.split('|'); const b = budgetById(bid); return { b, it: b && itemById(b, iid) }; };
    const label = (x) => x.b.code + (x.b.structure === 'project' ? '' : ' / ' + x.it.code);
    mv.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = mv.elements;
      const src = pick(f.from.value);
      const dst = pick(f.to.value);
      const amount = round2(f.amount.value);
      const reason = f.reason.value.trim();
      const errors = [];
      if (!src.it || !dst.it) errors.push('กรุณาเลือกรายการต้นทางและปลายทาง');
      else if (src.it === dst.it) errors.push('ต้นทางและปลายทางต้องไม่ใช่รายการเดียวกัน');
      else if (round2(itemTotal(src.it) - amount) < allocatedOf(src.b, src.it) - 0.005) errors.push('โยกออกแล้วต่ำกว่าวงเงินที่จัดสรรให้ Item ย่อย (' + money(allocatedOf(src.b, src.it)) + ' บาท)');
      else if (amount > usage(src.b, src.it.id).remaining + 0.005) errors.push('ต้นทางมีคงเหลือไม่พอ (คงเหลือ ' + money(usage(src.b, src.it.id).remaining) + ' บาท)');
      if (!(amount > 0)) errors.push('จำนวนเงินต้องมากกว่า 0');
      if (!reason) errors.push('กรุณาระบุเหตุผล');
      if (errors.length) { showErrors(errors); return; }
      adjustItem(src.it, -amount);
      adjustItem(dst.it, amount);
      const no = nextNo(DOC_PREFIX.trf);
      const detail = no + ' · ' + money(amount) + ' บาท จาก ' + label(src) + ' ไป ' + label(dst) + ' — ' + reason;
      addRevision(src.b, 'โยกออก ' + money(amount) + ' ไป ' + label(dst) + ' — ' + reason);
      if (dst.b !== src.b) addRevision(dst.b, 'โยกเข้า ' + money(amount) + ' จาก ' + label(src) + ' — ' + reason);
      else src.b.revisions[src.b.revisions.length - 1].note = 'โยกภายในโครงการ ' + detail;
      src.b.history.push({ at: new Date().toISOString(), by: me().id, action: 'โยกงบออก', note: detail, ref: no });
      if (dst.b !== src.b) dst.b.history.push({ at: new Date().toISOString(), by: me().id, action: 'รับงบที่โยกเข้า', note: detail, ref: no });
      logAction('โยกงบ', 'งบ ' + src.b.code, detail + (dst.b !== src.b ? ' (เข้างบ ' + dst.b.code + ')' : ''));
      save();
      setFlash('success', 'โยกงบ ' + detail);
      go('#/budget/' + (location.hash.indexOf('to=') >= 0 ? dst.b.id : src.b.id));
    });
    const cb = document.getElementById('cutBudgetForm');
    cb.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = cb.elements;
      const t = pick(f.target.value);
      const amount = round2(f.amount.value);
      const reason = f.reason.value.trim();
      const errors = [];
      if (!t.it) errors.push('กรุณาเลือกรายการ');
      else if (round2(itemTotal(t.it) - amount) < allocatedOf(t.b, t.it) - 0.005) errors.push('ลดแล้วต่ำกว่าวงเงินที่จัดสรรให้ Item ย่อย (' + money(allocatedOf(t.b, t.it)) + ' บาท)');
      else if (amount > usage(t.b, t.it.id).remaining + 0.005) errors.push('ลดได้ไม่เกินยอดคงเหลือ ' + money(usage(t.b, t.it.id).remaining) + ' บาท');
      if (!(amount > 0)) errors.push('จำนวนเงินต้องมากกว่า 0');
      if (!reason) errors.push('กรุณาระบุเหตุผล');
      if (errors.length) { showErrors(errors); return; }
      adjustItem(t.it, -amount);
      const no = nextNo(DOC_PREFIX.dec);
      const detail = no + ' · ' + money(amount) + ' บาท ที่ ' + label(t) + ' — ' + reason;
      addRevision(t.b, 'ลดงบ ' + detail);
      t.b.history.push({ at: new Date().toISOString(), by: me().id, action: 'ลดงบ', note: detail, ref: no });
      logAction('ลดงบ', 'งบ ' + t.b.code, detail);
      save();
      setFlash('success', 'ลดงบ ' + detail);
      go('#/budget/' + t.b.id);
    });
  }

  // ---------------------------------------------------------------- คิวงาน / Log / สิ่งที่รอยืนยัน

  function budgetQueueTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div class="table-wrap"><table><thead><tr><th>งบ</th><th>Business</th><th>มติ / เอกสารอนุมัติ / Memo</th><th class="num">วงเงิน</th><th>ส่งเมื่อ</th></tr></thead><tbody>' +
      list.map((b) => '<tr><td>' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div class="muted">' + esc(b.name) + '</div></td>' +
        '<td class="nowrap">' + esc(ownerLabel(b)) + '</td><td>' + (groupLead(b).openMemo
          ? 'Memo ' + esc(groupLead(b).openMemo.no) + (groupMembers(groupLead(b)).length > 1 ? ' (รวม ' + groupMembers(groupLead(b)).length + ' งบ)' : '') + '<div class="muted">' + (groupLead(b).openMemo.files || []).length + ' ไฟล์' + (groupLead(b).openMemo.signers ? ' · ' + esc(groupLead(b).openMemo.signers) : '') + '</div>'
          : esc((b.meeting && b.meeting.no) || '-') + '<div class="muted">' + (b.attachments || []).length + ' ไฟล์</div>') + '</td>' +
        '<td class="num">' + money(budgetTotal(b)) + '</td><td class="nowrap">' + fmtDay(b.submittedAt || (b.history.slice(-1)[0] || {}).at) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function changeQueueTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>งบ</th><th>เหตุผล</th><th class="num">ขอเพิ่ม</th><th>สถานะ</th></tr></thead><tbody>' +
      list.map((c) => { const b = budgetById(c.budgetId); return '<tr><td class="nowrap"><a href="#/change/' + c.id + '">' + esc(c.no) + '</a></td><td>' + esc(b.code) + '<div class="muted">' + esc(b.name) + '</div></td>' +
        '<td>' + esc(c.reason) + '</td><td class="num">+' + money(changeTotal(c)) + '</td><td>' + badge(CHANGE_STATE_BADGE[c.state], CHANGE_STATE[c.state]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function nextCutStep(r) {
    if (r.useType === 'prpo') return 'ยืนยันยอด PO และปิดยอด';
    if (r.useType === 'advance') return r.advance ? 'เคลียร์เงินทดรอง' : 'จ่ายเงินทดรอง';
    if (r.useType === 'reimburse') return 'จ่ายคืนพนักงาน';
    return cutTotal(r) > 0 ? 'บันทึกจ่ายงวดถัดไป / ปิดยอด' : 'บันทึกการจ่ายเงิน';
  }
  function cutQueueTable(list, withStep) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการค้าง</div>';
    return '<div class="table-wrap"><table><thead><tr><th>เลขที่</th><th>งบ</th><th>ประเภท</th><th>ผู้ขอ</th><th class="num">ขอไว้</th><th class="num">ตัดงบแล้ว</th>' + (withStep ? '<th>ขั้นถัดไป</th>' : '') + '</tr></thead><tbody>' +
      list.map((r) => { const b = budgetById(r.budgetId); return '<tr><td class="nowrap"><a href="#/request/' + r.id + '">' + esc(r.docNo) + '</a><div class="muted">' + fmtDay(r.approvedAt) + '</div></td>' +
        '<td>' + esc(b.code) + '<div class="muted">' + esc(reqSummary(r)) + '</div></td><td class="nowrap">' + esc(USE_TYPES[r.useType].short) + '</td><td class="nowrap">' + esc(userName(r.requesterId)) + '</td>' +
        '<td class="num">' + money(r.amount) + '</td><td class="num">' + money(cutTotal(r)) + '</td>' + (withStep ? '<td>' + esc(nextCutStep(r)) + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  // ---------------------------------------------------------------- งานทั้งหมด (รวมทุกคิวงานในหน้าเดียว แยกเป็นแท็บ)

  /** ผู้ใช้ที่ทำรายการในระบบ (Business / ผู้คุมงบ / จัดซื้อ) — Admin อย่างเดียวไม่มีงานและประวัติการทำรายการ */
  const WORK_PERMS = ['budget.create', 'request.create', 'budget.verify', 'budget.adjust', 'budget.manage', 'request.decide', 'cut.record', 'po.record', 'business.proxy', 'gl.manage'];
  const isWorker = (u) => permsOf(u).some((p) => WORK_PERMS.includes(p));

  function myBudgetTable(list) {
    if (!list.length) return '<div class="card empty">ไม่มีรายการ</div>';
    return '<div class="table-wrap"><table><thead><tr><th>งบ</th><th>สถานะ</th><th class="num">วงเงิน</th><th>อัปเดตล่าสุด</th></tr></thead><tbody>' +
      list.map((b) => {
        const last = b.history.slice(-1)[0] || {};
        return '<tr><td>' + badge(b.type, TYPE_SHORT[b.type]) + ' <a href="#/budget/' + b.id + '">' + esc(b.code) + '</a><div class="muted">' + esc(b.name) + '</div></td>' +
          '<td>' + badge(BUDGET_STATE_BADGE[b.state], BUDGET_STATE[b.state]) + ((b.state === 'returned' || b.state === 'open_returned') && b.returnReason ? '<div class="muted">' + esc(b.returnReason) + '</div>' : '') + '</td>' +
          '<td class="num">' + money(budgetTotal(b)) + '</td><td class="nowrap">' + fmtDay(last.at) + '<div class="muted">' + esc(last.action || '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /**
   * แท็บของหน้า "งานทั้งหมด" ตามสิทธิ์
   * act = งานที่ผู้ใช้ต้องลงมือ (นับรวมเป็นตัวเลขที่เมนู) · ไม่ act = รายการติดตามสถานะ
   */
  function taskTabs(u) {
    const has = (p) => permsOf(u).includes(p);
    const tabs = [];
    const add = (key, label, act, hint, sections) => tabs.push({ key, label, act, hint, sections, n: sections.reduce((n, x) => n + x.list.length, 0) });
    const sec = (title, list, table) => ({ title, list, table });

    if (has('gl.manage')) {
      add('gl', 'OPEX รอใส่ GL', true, 'งบ OPEX ที่ Business ขอเปิดแล้วและยังมี Item หลักไม่มี GL — ใส่ได้ทันที ไม่ต้องรอเปิดใช้งบ',
        [sec('', glBudgets().filter((b) => missingGl(b).length), glTable)]);
    }
    if (has('budget.verify')) {
      add('budgets', 'งบรออนุมัติ / ตรวจ Memo', true, 'Memo ขอดำเนินการใช้งบ CAPEX ที่ผู้บริหารเซ็นแล้ว และคำขอตั้งงบใหม่ของ Business (มติ / เอกสารอนุมัติผู้บริหาร) — ตรวจแล้วยืนยันเปิดใช้ หรือส่งกลับให้ Business แก้ไข',
        [sec('Memo ขอดำเนินการใช้งบ (งบประจำปี)', db.budgets.filter((b) => budgetScoped(b) && b.state === 'open_review'), budgetQueueTable),
          sec('คำขอตั้งงบใหม่ของ Business', db.budgets.filter((b) => budgetScoped(b) && b.state === 'review'), budgetQueueTable)]);
      if (has('budget.manage')) {
        add('setup', 'งบที่ผ่านอนุมัติ / ลงไว้ ยังไม่เปิดใช้งบ', false, 'งบ CAPEX ประจำปีที่ผู้คุมงบลงไว้ (สร้าง / Import Excel) ที่ Business ยังไม่ได้ขอดำเนินการใช้งบ — แก้ไข / ยกเลิกได้จนกว่า Business ส่ง Memo หรือเปิดใช้',
          [sec('', db.budgets.filter((b) => budgetScoped(b) && openFlow(b) && waitingOpen(b)), myBudgetTable)]);
      }
      add('changes', 'คำขอเพิ่มงบ', true, 'ตรวจมติ / เอกสารอนุมัติผู้บริหารแล้วยืนยันเพิ่มงบ หรือส่งกลับ',
        [sec('', (db.changes || []).filter((c) => chgScoped(c) && c.state === 'review'), changeQueueTable)]);
    }
    if (has('request.decide')) {
      add('requests', 'คำขอเบิกใช้งบ', true, 'ตรวจคำขอแล้วอนุมัติออกใบเบิกใช้งบ หรือส่งกลับ — ขอเกินงบรายการต้องใส่ Note',
        [sec('', inbox(u), (l) => requestTable(l, true))]);
    }
    if (has('po.record')) {
      add('po', 'รอออก PO', true, 'ใบเบิกใช้งบประเภท PR/PO ที่ผู้คุมงบอนุมัติแล้ว — บันทึกเลข PR/PO และยอด PO เพื่อตัดงบ',
        [sec('', db.requests.filter((r) => reqScoped(r) && needsPO(r)), (l) => cutQueueTable(l, false))]);
      add('po-done', 'บันทึก PO แล้ว', false, 'ผู้คุมงบยืนยันยอดและปิดยอดเมื่อรับของ / จ่ายครบ',
        [sec('', db.requests.filter((r) => reqScoped(r) && r.useType === 'prpo' && hasPO(r) && r.status === 'approved'), (l) => cutQueueTable(l, false))]);
    }
    if (has('cut.record')) {
      add('cuts', 'รอตัดงบ / ปิดยอด', true, 'ใบเบิกใช้งบที่ออกแล้วแต่ยังไม่ปิดยอด (ไม่รวม PR/PO ที่รอจัดซื้อออก PO)',
        [sec('', db.requests.filter((r) => reqScoped(r) && needsCut(r)), (l) => cutQueueTable(l, true))]);
    }
    if (has('budget.create') || has('request.create')) {
      const mineB = db.budgets.filter(actsFor);
      const mineR = db.requests.filter((r) => r.requesterId === u.id || proxyOf(budgetById(r.budgetId)));
      const mineC = (db.changes || []).filter((c) => c.createdBy === u.id || proxyOf(budgetById(c.budgetId)));
      add('toopen', 'งบรอขอดำเนินการใช้งบ', true, 'งบ CAPEX ประจำปีที่ผู้คุมงบลงไว้ให้คุณ — ทำ Memo ขอดำเนินการใช้งบ ให้ผู้บริหารเซ็น แนบไฟล์ที่เซ็นแล้วส่งให้ผู้คุมงบยืนยัน',
        [sec('', mineB.filter((b) => b.state === 'pending_open' && b.ownerId === u.id), openPickTable)]);
      add('fix', 'ส่งกลับแก้ไข', true, 'ผู้คุมงบส่งกลับพร้อมเหตุผล — แก้ไขแล้วส่งใหม่ หรือยกเลิก', [
        sec('งบ', mineB.filter((b) => b.state === 'returned' || b.state === 'open_returned'), myBudgetTable),
        sec('คำขอเบิกใช้งบ', mineR.filter((r) => r.status === 'rejected'), (l) => requestTable(l, true)),
        sec('คำขอเพิ่มงบ', mineC.filter((c) => c.state === 'returned'), changeQueueTable)]);
      add('drafts', 'ร่าง', false, 'ร่างที่ยังไม่ได้ส่ง — แนบมติที่ประชุม (CAPEX) หรือเอกสารอนุมัติผู้บริหาร (OPEX) แล้วส่งให้ผู้คุมงบ (ร่างค้างไว้ได้ไม่จำกัดเวลา)', [
        sec('งบ', mineB.filter((b) => b.state === 'draft'), myBudgetTable),
        sec('คำขอเพิ่มงบ', mineC.filter((c) => c.state === 'draft'), changeQueueTable)]);
      add('waiting', 'รอผู้คุมงบ', false, 'ส่งแล้ว รอผู้คุมงบตรวจสอบ', [
        sec('งบ', mineB.filter((b) => b.state === 'review' || b.state === 'open_review'), myBudgetTable),
        sec('คำขอเบิกใช้งบ', mineR.filter((r) => r.status === 'pending'), (l) => requestTable(l, true)),
        sec('คำขอเพิ่มงบ', mineC.filter((c) => c.state === 'review'), changeQueueTable)]);
      add('cashflow', 'Plan Cashflow เดือนนี้', true, 'งบ CAPEX ที่เปิดใช้แล้ว ถึงเดือน ' + monthLabel(curYm()) + ' แล้วแต่ยังไม่มีแผนใช้เงินของเดือนนี้ — วางแผน หรือกด "เดือนนี้ไม่มีแผน"',
        [sec('', cashflowTodo(), cashflowTable)]);
      add('clear', 'รอเคลียร์เงินทดรอง', true, 'ผู้คุมงบอนุมัติ = จ่ายเงินทดรองแล้ว — Business / ธุรการเคลียร์ตามใบเสร็จ งบจะถูกตัดตามยอดที่เคลียร์',
        [sec('', mineR.filter(needsClear), (l) => cutQueueTable(l, false))]);
      add('open', 'รอปิดยอด', false, 'ออกใบเบิกใช้งบแล้ว รอออก PO / เคลียร์เงินทดรอง และปิดยอด',
        [sec('', mineR.filter((r) => r.status === 'approved' && !needsClear(r)), (l) => requestTable(l, true))]);
    }
    return tabs;
  }

  /** เส้นทางเดิม (#/approvals, #/po ฯลฯ) → แท็บในหน้างานทั้งหมด */
  const OLD_TASK_ROUTES = { approvals: 'requests', po: 'po', cuts: 'cuts', payments: 'cuts', accounting: 'cuts' };

  function viewTasks(params, oldRoute) {
    const tabs = taskTabs(me());
    if (!tabs.length) return '<div class="alert info">บทบาทนี้ไม่มีงานที่ต้องทำ</div>';
    let key = params.get('tab') || OLD_TASK_ROUTES[oldRoute];
    if (oldRoute === 'approvals' && !tabs.some((t) => t.key === 'requests' && t.n)) key = (tabs.find((t) => t.n) || tabs[0]).key;
    const tab = tabs.find((t) => t.key === key) || tabs.find((t) => t.act && t.n) || tabs.find((t) => t.n) || tabs[0];
    const nav = '<nav class="tabs task-tabs" aria-label="ประเภทงาน">' + tabs.map((t) => '<a href="#/tasks?tab=' + t.key + '"' + (t === tab ? ' class="active" aria-current="page"' : '') + '>' +
      esc(t.label) + '<span class="tab-badge' + (t.act && t.n ? ' act' : '') + '">' + t.n + '</span></a>').join('') + '</nav>';
    const multi = tab.sections.length > 1;
    const body = tab.sections.map((x) => (multi ? '<h2>' + x.title + ' <span class="muted count-note">(' + x.list.length + ')</span></h2>' : '') + x.table(x.list)).join('');
    return '<div class="page-head"><div><h1>งานทั้งหมด</h1><div class="page-sub">' + esc(roleLabel(me())) + '</div></div></div>' + takeFlash() + nav +
      '<p class="muted tab-hint">' + esc(tab.hint) + '</p>' + body;
  }

  // ---------------------------------------------------------------- ประวัติการทำรายการ (ผู้ใช้ทั่วไป)

  /** ลิงก์ไปยังเรื่องของรายการใน Log (ref = "งบ CODE" / เลขที่คำขอ / เลขที่เอกสาร / INC-…) */
  function refLink(ref) {
    if (!ref) return { href: '', mine: false };
    const u = me();
    if (ref.startsWith('งบ ')) {
      const b = db.budgets.find((x) => x.code === ref.slice(3));
      return { href: b ? '#/budget/' + b.id : '', owner: b && b.ownerId };
    }
    const r = db.requests.find((x) => x.no === ref || x.docNo === ref);
    if (r) return { href: '#/request/' + r.id, owner: r.requesterId };
    const c = (db.changes || []).find((x) => x.no === ref);
    if (c) return { href: '#/change/' + c.id, owner: c.createdBy };
    const codes = ref.split(' → ').map((code) => db.budgets.find((x) => x.code === code)).filter(Boolean);
    if (codes.length) return { href: '#/budget/' + codes[0].id, owner: codes.some((b) => b.ownerId === u.id) ? u.id : codes[0].ownerId };
    return { href: '', owner: null };
  }

  function viewHistory(params) {
    const u = me();
    if (!isWorker(u)) return '<div class="alert error">หน้านี้สำหรับผู้ใช้ที่ทำรายการในระบบ</div>';
    const scope = params.get('scope') === 'mine' ? 'mine' : 'all';
    const q = (params.get('q') || '').toLowerCase();
    const rows = (db.log || []).map((x) => Object.assign({ link: refLink(x.ref) }, x))
      .filter((x) => x.by === u.id || x.link.owner === u.id);
    const list = rows.filter((x) => (scope === 'all' || x.by === u.id) && (!q || (x.action + ' ' + x.ref + ' ' + x.detail).toLowerCase().includes(q))).reverse();
    const t = (key, label, n) => '<a href="#/history' + (key === 'mine' ? '?scope=mine' : '') + '"' + (scope === key ? ' class="active" aria-current="page"' : '') + '>' + label + '<span class="tab-badge">' + n + '</span></a>';
    return '<div class="page-head"><div><h1>ประวัติการทำรายการ</h1><div class="page-sub">รายการที่คุณทำ และสิ่งที่ผู้อื่นทำกับงบ / เอกสารของคุณ</div></div></div>' +
      '<nav class="tabs task-tabs" aria-label="ขอบเขต">' + t('all', 'ทั้งหมด', rows.length) + t('mine', 'ที่ฉันทำ', rows.filter((x) => x.by === u.id).length) + '</nav>' +
      '<form id="historyFilter" class="admin-filters" data-scope="' + scope + '"><label class="input-wrap search">' + ICON_SEARCH +
      '<input name="q" type="search" placeholder="ค้นหาการกระทำ เลขที่ รายละเอียด" value="' + esc(params.get('q') || '') + '"></label><button class="btn" type="submit">ค้นหา</button></form>' +
      '<div class="table-wrap"><table><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>เรื่อง</th><th>รายละเอียด</th></tr></thead><tbody>' +
      (list.length ? list.slice(0, 300).map((x) => '<tr><td class="nowrap">' + fmtDate(x.at) + '</td><td class="nowrap">' + (x.by === u.id ? '<strong>คุณ</strong>' : esc(userName(x.by))) + '</td>' +
        '<td>' + esc(x.action) + '</td><td class="nowrap">' + (x.link.href ? '<a href="' + x.link.href + '">' + esc(x.ref) + '</a>' : esc(x.ref)) + '</td><td>' + esc(x.detail) + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">ไม่พบรายการ</td></tr>') + '</tbody></table></div>';
  }
  function bindHistory() {
    const f = document.getElementById('historyFilter');
    if (!f) return;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      go('#/history?' + (f.dataset.scope === 'mine' ? 'scope=mine&' : '') + 'q=' + encodeURIComponent(f.elements.q.value.trim()));
    });
  }

  // ---------------------------------------------------------------- Admin: ผู้ใช้ / บทบาทและสิทธิ์ (โหมดทดลอง แก้ไขได้ เก็บในเบราว์เซอร์)

  const ACCOUNT_BADGE = { pending: 'draft', ok: 'approved', reset_requested: 'pending', inactive: 'cancelled' };
  const ACCOUNT_STATES = [['pending', 'รอตั้งรหัสผ่าน'], ['ok', 'ใช้งานได้'], ['reset_requested', 'ขอรีเซ็ตรหัสผ่าน'], ['inactive', 'ปิดการใช้งาน']];
  const roleKeys = () => Object.keys(DEMO_ROLE_PERMS);

  function viewAdminDemo(params) {
    const tab = params && params.get('tab') === 'roles' ? 'roles' : 'users';
    const store = AUTH_REMOTE ? 'บัญชีและสิทธิ์เก็บบนเซิร์ฟเวอร์' : 'โหมดทดลองเก็บในเบราว์เซอร์นี้เท่านั้น';
    return '<div class="page-head"><div><h1>' + (tab === 'roles' ? 'บทบาทและสิทธิ์' : 'ผู้ใช้') + '</h1><div class="page-sub">' +
      (tab === 'roles' ? 'กำหนดว่าแต่ละบทบาททำอะไรได้บ้าง · สร้างบทบาทเพิ่มได้ — ' : 'เพิ่ม แก้ไข เปิด/ปิดใช้งานผู้ใช้ และรีเซ็ตรหัสผ่าน — ') + store + '</div></div></div>' +
      takeFlash() + '<div id="formError"></div><div id="adminBox">' + (tab === 'roles' ? viewAdminRoles() : viewAdminUsers()) + '</div>';
  }

  /** ข้อมูลที่ฟอร์มผู้ใช้ต้องกรอก ตามสิทธิ์ของบทบาทที่ติ๊ก: ฝั่ง Business (สังกัดบริษัท+หน่วยงาน) · ธุรการ (หลายหน่วยงาน) · ผู้ทำงาน (บริษัทที่รับผิดชอบ) · Admin (ไม่ต้อง) */
  function userNeeds(roles) {
    const perms = uniq([].concat(roles).flatMap((k) => DEMO_ROLE_PERMS[k] || []));
    const admin = [].concat(roles).includes('admin');
    const proxy = perms.includes('business.proxy');
    const business = !proxy && (perms.includes('request.create') || perms.includes('budget.create'));
    const work = !admin && roleSeesWork(roles);
    return { affil: business, deptMulti: proxy, companies: work, proxy };
  }
  /** คอลัมน์ "สังกัด / รับผิดชอบ" ในตารางผู้ใช้ */
  function userScopeCell(u) {
    const roles = rolesOf(u), need = userNeeds(roles), parts = [];
    if (roles.includes('admin')) parts.push('<span class="muted">ทุกบริษัท</span>');
    if (need.deptMulti) {
      const ds = deptsOf(u);
      parts.push(ds.length ? '<div>ช่วยงาน ' + esc(ds.join(', ')) + '</div>' : '<div><span class="badge cancelled">ยังไม่กำหนดหน่วยงานที่ช่วย</span></div>');
    } else if (need.affil || deptsOf(u).length || u.company) {
      const t = [u.company, deptsOf(u).join(', ')].filter(Boolean).join(' · ');
      parts.push(t ? esc(t) : (need.affil ? '<span class="badge cancelled">ยังไม่กำหนดสังกัด</span>' : '–'));
    }
    if (need.companies && !roles.includes('admin')) {
      const cs = Array.isArray(u.companies) ? u.companies : [];
      parts.push(cs.length ? '<div class="muted">รับผิดชอบ ' + esc(cs.join(', ')) + '</div>' : '<div><span class="badge cancelled">ยังไม่กำหนดบริษัทที่รับผิดชอบ</span></div>');
    }
    return parts.join('') || '–';
  }

  function viewAdminUsers() {
    const reset = adminResetCount();
    const roleSel = (id) => '<div class="select-wrap"><select ' + id + '>' + roleKeys().map((k) => opt(k, ROLE_LABEL[k] || k, '')).join('') + '</select></div>';
    const fld = (label, inner) => '<label class="field"><span>' + label + '</span>' + inner + '</label>';
    const form = '<div class="viewer" id="userFormCard" role="dialog" aria-modal="true" aria-labelledby="userFormTitle" hidden><div class="viewer-panel is-form">' +
      '<div class="viewer-head"><strong class="viewer-name" id="userFormTitle">เพิ่มผู้ใช้</strong><div class="viewer-actions"><button type="button" class="btn small" data-user-close aria-label="ปิด">ปิด ✕</button></div></div>' +
      '<div class="viewer-form"><div id="userFormError"></div><form id="userForm" novalidate><div class="form-grid">' +
      fld('อีเมล', '<input name="email" type="email" required autocomplete="off" placeholder="name@company.com">') +
      fld('ชื่อ-นามสกุล', '<input name="name" required>') +
      fld('ตำแหน่ง', '<input name="title">') +
      '<div class="field full req" id="roleField"><span>บทบาท (เลือกได้หลายบทบาท — สิทธิ์รวมกัน · แสดงบทบาทหลักเป็นบทบาทแรกตามลำดับในรายการ)</span><div class="actions" id="roleChecks">' +
      roleKeys().map((k) => '<label class="chip"><input type="checkbox" name="roles" value="' + esc(k) + '"> ' + esc(ROLE_LABEL[k] || k) + '</label>').join('') + '</div></div>' +
      // ฝั่ง Business: สังกัดของตัวเอง — บริษัท 1 บริษัท + หน่วยงาน 1 หน่วยงาน (หน่วยงานต้องอยู่ใต้บริษัทที่เลือก)
      '<div class="field full" id="affilField" style="display:none"><span>สังกัดของผู้ใช้ (Business — งบที่ขอจะขึ้นเป็นหน่วยงานนี้ · เลือกบริษัทอื่นตอนขอใช้งบได้)</span><div class="form-grid">' +
      fld('บริษัทสังกัด', '<div class="select-wrap"><select name="company"><option value="">— เลือกบริษัท —</option>' + db.master.companies.map((c) => opt(c.code, c.code + (c.name ? ' — ' + c.name : ''), '')).join('') + '</select></div>') +
      fld('หน่วยงาน', '<div class="select-wrap"><select name="department"><option value="">— เลือกหน่วยงาน —</option></select></div>') + '</div></div>' +
      // ธุรการ: ช่วยงานตามหน่วยงาน (เลือกหลายหน่วยงานได้ แยกตามบริษัทของหน่วยงาน) — เห็นและทำแทนเฉพาะงบของหน่วยงานที่เลือก ที่เปิดใช้งานแล้ว (บริษัทของงบเป็นบริษัทไหนก็ได้)
      '<div class="field full" id="deptMultiField" style="display:none"><span>หน่วยงานที่ช่วยงาน (ธุรการ — เลือกได้หลายหน่วยงาน · เห็นและทำแทนเฉพาะงบของหน่วยงานที่เลือกซึ่งเปิดใช้งานแล้ว)</span><div id="deptChecks">' +
      db.master.companies.map((c) => ({ label: c.code + (c.name ? ' — ' + c.name : ''), list: db.master.departments.filter((d) => d.company === c.code) }))
        .concat([{ label: 'ยังไม่ระบุบริษัท (ไปตั้งที่ข้อมูลหลัก → หน่วยงาน)', list: db.master.departments.filter((d) => !d.company || !db.master.companies.some((c) => c.code === d.company)) }])
        .filter((g) => g.list.length).map((g) => '<div class="muted">' + esc(g.label) + '</div><div class="actions">' +
          g.list.map((d) => '<label class="chip"><input type="checkbox" name="departments" value="' + esc(d.name) + '"> ' + esc(d.name) + '</label>').join('') + '</div>').join('') + '</div></div>' +
      '<div class="field full" id="coField" style="display:none"><span>บริษัทที่รับผิดชอบ (ผู้คุมงบ · บัญชี · จัดซื้อ · ธุรการ — เลือกได้หลายบริษัท · เห็นและทำงานของบริษัทที่เลือกเท่านั้น)</span><div class="actions" id="coChecks">' +
      db.master.companies.map((c) => '<label class="chip"><input type="checkbox" name="companies" value="' + esc(c.code) + '"> ' + esc(c.code) + '</label>').join('') + '</div></div>' +
      '</div><div class="muted section-hint" id="userFormHint">ผู้ดูแลระบบไม่ตั้งรหัสผ่านให้ — ผู้ใช้เข้าหน้าล็อกอิน → "' + (AUTH_REMOTE ? 'เปิดใช้ครั้งแรก' : 'ตั้งรหัสผ่าน') + '" แล้วกรอกอีเมลนี้เพื่อตั้งรหัสผ่านเอง</div>' +
      '<div class="actions"><button class="btn primary" type="submit">บันทึก</button><button class="btn" type="button" data-user-cancel>ยกเลิก</button></div></form></div></div></div>';
    const rows = USERS.map((u) => {
      const st = accountState(u);
      const self = u.id === me().id;
      return '<tr data-uid="' + esc(u.id) + '" data-search="' + esc([u.email, u.name, u.title, deptsOf(u).join(' '), u.company, (u.companies || []).join(' ')].join(' ').toLowerCase()) + '" data-role="' + esc(rolesOf(u).join(' ')) + '" data-state="' + st.key + '">' +
        '<td>' + esc(u.name) + (self ? ' <span class="muted">(คุณ)</span>' : '') + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.title || '–') + '</td>' +
        '<td>' + userScopeCell(u) + '</td>' +
        '<td>' + esc(roleLabel(u)) + '</td><td><span class="badge ' + ACCOUNT_BADGE[st.key] + '">' + esc(st.label) + '</span></td>' +
        '<td class="nowrap">' + (u.lastLoginAt ? fmtDate(u.lastLoginAt) : '–') + '</td>' +
        '<td class="nowrap"><button type="button" class="btn small" data-user-edit>แก้ไข</button> ' +
        '<button type="button" class="btn small" data-user-reset' + (u.active === false ? ' disabled' : '') + '>รีเซ็ตรหัสผ่าน</button> ' +
        '<button type="button" class="btn small' + (u.active === false ? '' : ' bad') + '" data-user-toggle' + (self ? ' disabled title="ปิดบัญชีของตัวเองไม่ได้"' : '') + '>' + (u.active === false ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + '</button></td></tr>';
    }).join('');
    return (reset ? '<div class="alert warn" id="resetAlert">มี ' + reset + ' บัญชีขอรีเซ็ตรหัสผ่าน — กด "รีเซ็ตรหัสผ่าน" ที่แถวนั้นเพื่อให้ผู้ใช้ตั้งรหัสใหม่เอง <button type="button" class="btn small" data-filter-reset>ดูเฉพาะที่ขอรีเซ็ต</button></div>' : '') +
      '<div class="page-head"><div class="rr-panel-title">ผู้ใช้ <span class="rr-count" id="userCount">' + USERS.length + '</span></div><div class="head-actions"><button type="button" class="btn primary" data-user-add>+ เพิ่มผู้ใช้</button></div></div>' + form +
      '<div class="admin-filters"><label class="input-wrap search">' + ICON_SEARCH + '<input id="userQ" type="search" placeholder="ค้นหาชื่อ อีเมล ตำแหน่ง หน่วยงาน" aria-label="ค้นหาผู้ใช้"></label>' +
      '<div class="select-wrap"><select id="userRoleF" aria-label="กรองบทบาท">' + opt('', 'บทบาท: ทั้งหมด', '') + roleKeys().map((k) => opt(k, ROLE_LABEL[k] || k, '')).join('') + '</select></div>' +
      '<div class="select-wrap"><select id="userStateF" aria-label="กรองสถานะ">' + opt('', 'สถานะ: ทั้งหมด', '') + ACCOUNT_STATES.map(([k, t]) => opt(k, t, '')).join('') + '</select></div></div>' +
      '<div class="table-wrap"><table id="userTable"><thead><tr><th>ชื่อ</th><th>อีเมล</th><th>ตำแหน่ง</th><th>สังกัด / รับผิดชอบ</th><th>บทบาท</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>' + rows +
      '<tr id="userEmpty" hidden><td colspan="8" class="empty">ไม่พบผู้ใช้</td></tr></tbody></table></div>';
  }

  // เลือกบทบาททางซ้าย → ติ๊กสิทธิ์ของบทบาทนั้นทางขวา (ไม่มีตารางทุกบทบาทพร้อมกัน) — บทบาทที่เลือกจำไว้ระหว่างเปลี่ยนหน้า
  let adminRoleSel = '';
  const roleUserCount = (k) => USERS.filter((u) => rolesOf(u).includes(k)).length;
  const roleUnknownPerm = (pm) => AUTH_REMOTE && remotePermCatalog && !remotePermCatalog.includes(pm.key);
  function viewAdminRoles() {
    const keys = roleKeys();
    if (!keys.includes(adminRoleSel)) adminRoleSel = keys[0] || '';
    const stale = PERMISSIONS.filter(roleUnknownPerm);
    const fld = (label, inner) => '<label class="field"><span>' + label + '</span>' + inner + '</label>';
    const list = keys.map((k) => '<button type="button" class="role-item' + (k === adminRoleSel ? ' active' : '') + '" data-role-pick="' + esc(k) + '"' + (k === adminRoleSel ? ' aria-current="true"' : '') + '><strong>' + esc(ROLE_LABEL[k] || k) + '</strong><span>' + roleUserCount(k) + ' คน</span></button>').join('');
    const modal = '<div class="viewer" id="roleFormCard" role="dialog" aria-modal="true" aria-labelledby="roleFormTitle" hidden><div class="viewer-panel is-form">' +
      '<div class="viewer-head"><strong class="viewer-name" id="roleFormTitle">สร้างบทบาท</strong><div class="viewer-actions"><button type="button" class="btn small" data-role-close aria-label="ปิด">ปิด ✕</button></div></div>' +
      '<div class="viewer-form"><div id="roleFormError"></div><form id="roleForm" novalidate><div class="form-grid">' +
      '<label class="field full req"><span>ชื่อบทบาท</span><input name="name" required maxlength="60" placeholder="เช่น ผู้ตรวจสอบภายใน"></label>' +
      '<label class="field full" id="roleCopyField"><span>คัดลอกสิทธิ์จาก (ไม่บังคับ)</span><div class="select-wrap"><select name="copy"><option value="">— เริ่มจากไม่มีสิทธิ์ —</option>' + keys.map((k) => opt(k, ROLE_LABEL[k] || k, '')).join('') + '</select></div></label>' +
      '</div><div class="actions"><button class="btn primary" type="submit" id="roleFormSave">สร้าง</button><button class="btn" type="button" data-role-cancel>ยกเลิก</button></div></form></div></div></div>';
    return (stale.length ? '<div class="alert warn">ฐานข้อมูล Supabase ยังเป็นเวอร์ชันเก่า ไม่รู้จักสิทธิ์: ' + stale.map((x) => esc(x.label)).join(' · ') + ' — บันทึกแล้วสิทธิ์เหล่านี้จะหาย ให้ผู้ดูแลรัน <code>supabase/schema_v2.sql</code> ใหม่ใน SQL Editor ก่อน (ดู SETUP-v2.md ขั้นตอน 2)</div>' : '') + modal +
      '<div class="muted section-hint">เลือกบทบาททางซ้าย แล้วติ๊กสิทธิ์ทางขวา — 1 คนมีได้หลายบทบาท (สิทธิ์รวมกัน) · มีผลกับผู้ใช้ทุกคนในบทบาทนั้นทันทีหลังกดบันทึก (ผู้ใช้ที่ล็อกอินอยู่ต้องรีเซ็ตหน้า)</div>' +
      '<div class="role-split"><section class="card role-list-card"><div class="section-head"><h2 class="section-title">บทบาท <span class="rr-count">' + keys.length + '</span></h2>' +
      '<button type="button" class="btn small primary" data-role-new>+ สร้าง</button></div><div class="role-list" id="roleList">' + (list || '<div class="empty">ยังไม่มีบทบาท</div>') + '</div>' +
      (AUTH_REMOTE ? '' : '<div class="actions"><button class="btn small" type="button" data-roles-reset>คืนค่าเริ่มต้น</button></div>') + '</section>' +
      '<section class="card role-panel" id="rolePanel"></section></div>';
  }
  /** วาดแผงสิทธิ์ของบทบาทที่เลือก (draft = สิทธิ์ที่ติ๊กอยู่ ยังไม่บันทึก) */
  function roleCountText(k) { return 'ผู้ใช้ ' + roleUserCount(k) + ' คน'; }
  function renderRolePanel(draft) {
    const panel = document.getElementById('rolePanel');
    const k = adminRoleSel;
    if (!panel) return;
    if (!k) { panel.innerHTML = '<div class="empty">ยังไม่มีบทบาท — กด "+ สร้าง"</div>'; return; }
    let group = '';
    const body = PERMISSIONS.map((pm) => {
      const g = pm.group !== group ? '<tr class="perm-group"><td colspan="2">' + esc(pm.group) + '</td></tr>' : '';
      group = pm.group;
      const locked = k === 'admin' && pm.key === 'user.manage';
      const off = roleUnknownPerm(pm);
      return g + '<tr><td><strong>' + esc(pm.label) + '</strong>' + (pm.hint ? '<div class="muted">' + esc(pm.hint) + '</div>' : '') + '</td><td class="center"><input type="checkbox" data-perm="' + pm.key + '"' +
        (draft.has(pm.key) || locked ? ' checked' : '') + (locked ? ' disabled title="Admin ต้องมีสิทธิ์นี้เสมอ"' : off ? ' disabled title="ฐานข้อมูลยังไม่รู้จักสิทธิ์นี้ — รัน schema_v2.sql ใหม่"' : '') + ' aria-label="' + esc((ROLE_LABEL[k] || k) + ' — ' + pm.label) + '"></td></tr>';
    }).join('');
    panel.innerHTML = '<div class="section-head"><div><h2 class="section-title">' + esc(ROLE_LABEL[k] || k) + '</h2><div class="muted section-hint">' + roleCountText(k) + ' · รหัส ' + esc(k) + (isSystemRole(k) ? ' · บทบาทตั้งต้น' : '') + '</div></div>' +
      '<div class="head-actions"><button type="button" class="btn small" data-role-rename>แก้ชื่อ</button>' + (isSystemRole(k) ? '' : '<button type="button" class="btn small bad" data-role-delete>ลบบทบาท</button>') + '</div></div>' +
      '<div class="table-wrap"><table class="perm-matrix"><thead><tr><th>สิทธิ์</th><th class="perm-col">ให้บทบาทนี้</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="actions role-foot"><span class="badge pending" id="roleDirty" hidden>ยังไม่ได้บันทึก</span><button type="button" class="btn" id="roleCancel" disabled>ยกเลิก</button><button type="button" class="btn primary" id="roleSave" disabled>บันทึก</button></div>';
  }

  function bindAdminDemo(box) {
    const app = document.getElementById('app');
    const err = (m) => { document.getElementById('formError').innerHTML = '<div class="alert error">' + esc(m) + '</div>'; window.scrollTo(0, 0); };
    const back = () => go(location.hash);
    // ----- แท็บบทบาทและสิทธิ์ (เลือกบทบาทซ้าย → ติ๊กสิทธิ์ขวา)
    const roleList = document.getElementById('roleList');
    if (roleList) {
      const savedSet = (k) => new Set(DEMO_ROLE_PERMS[k] || []);
      let draft = savedSet(adminRoleSel);
      const dirty = () => { const sv = savedSet(adminRoleSel); return sv.size !== draft.size || Array.from(draft).some((x) => !sv.has(x)); };
      const sync = () => {
        const d = dirty();
        document.getElementById('roleDirty').hidden = !d;
        document.getElementById('roleSave').disabled = !d;
        document.getElementById('roleCancel').disabled = !d;
      };
      const paint = () => { renderRolePanel(draft); sync(); };
      paint();
      const permsOfDraft = () => PERMISSIONS.map((p) => p.key).filter((x) => draft.has(x));
      roleList.addEventListener('click', (e) => {
        const b = e.target.closest('[data-role-pick]');
        if (!b || b.dataset.rolePick === adminRoleSel) return;
        if (dirty() && !confirm('สิทธิ์ของบทบาทนี้ยังไม่ได้บันทึก — ทิ้งการแก้ไขแล้วเปลี่ยนบทบาท?')) return;
        adminRoleSel = b.dataset.rolePick;
        roleList.querySelectorAll('[data-role-pick]').forEach((x) => { const on = x.dataset.rolePick === adminRoleSel; x.classList.toggle('active', on); if (on) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
        draft = savedSet(adminRoleSel);
        paint();
      });
      const panel = document.getElementById('rolePanel');
      panel.addEventListener('change', (e) => {
        const k = e.target.dataset && e.target.dataset.perm;
        if (!k) return;
        if (e.target.checked) draft.add(k); else draft.delete(k);
        sync();
      });
      panel.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        if (btn.id === 'roleCancel') { draft = savedSet(adminRoleSel); paint(); }
        else if (btn.id === 'roleSave') {
          btn.disabled = true;
          try {
            await rolesSavePerms({ [adminRoleSel]: permsOfDraft() });
            setFlash('success', 'บันทึกสิทธิ์ของ "' + (ROLE_LABEL[adminRoleSel] || adminRoleSel) + '" แล้ว');
          } catch (ex) { btn.disabled = false; err(ex.message); return; }
          back();
        } else if (btn.matches('[data-role-rename]')) openRoleForm('rename');
        else if (btn.matches('[data-role-delete]')) {
          const n = roleUserCount(adminRoleSel);
          if (n) { err('ลบบทบาทนี้ไม่ได้ — ยังมีผู้ใช้ ' + n + ' คนใช้อยู่ ย้ายผู้ใช้ไปบทบาทอื่นก่อน'); return; }
          if (!confirm('ลบบทบาท "' + (ROLE_LABEL[adminRoleSel] || adminRoleSel) + '" ?')) return;
          try { await rolesRemove(adminRoleSel); setFlash('success', 'ลบบทบาทแล้ว'); } catch (ex) { err(ex.message); return; }
          adminRoleSel = '';
          back();
        }
      });
      const rr = app.querySelector('[data-roles-reset]');
      if (rr) rr.addEventListener('click', async () => {
        if (!confirm('คืนสิทธิ์และชื่อของบทบาทตั้งต้นเป็นค่าเริ่มต้น? (บทบาทที่สร้างเพิ่มไม่ถูกแตะ)')) return;
        try { await rolesReset(); setFlash('success', 'คืนค่าเริ่มต้นแล้ว'); } catch (ex) { err(ex.message); return; }
        back();
      });
      // ----- Modal สร้าง / แก้ชื่อบทบาท
      const card = document.getElementById('roleFormCard'), form = document.getElementById('roleForm');
      let mode = 'new';
      const errModal = (m) => { document.getElementById('roleFormError').innerHTML = '<div class="alert error" role="alert">' + esc(m) + '</div>'; };
      const onEsc = (e) => { if (e.key === 'Escape') closeRoleForm(); };
      function closeRoleForm() { card.hidden = true; document.getElementById('roleFormError').innerHTML = ''; document.removeEventListener('keydown', onEsc); }
      function openRoleForm(m) {
        mode = m;
        form.reset();
        document.getElementById('roleFormError').innerHTML = '';
        document.getElementById('roleFormTitle').textContent = m === 'new' ? 'สร้างบทบาท' : 'แก้ชื่อบทบาท';
        document.getElementById('roleFormSave').textContent = m === 'new' ? 'สร้าง' : 'บันทึก';
        document.getElementById('roleCopyField').hidden = m !== 'new';
        if (m === 'rename') form.elements.name.value = ROLE_LABEL[adminRoleSel] || adminRoleSel;
        card.hidden = false;
        document.addEventListener('keydown', onEsc);
        form.elements.name.focus();
      }
      app.querySelector('[data-role-new]').addEventListener('click', () => {
        if (dirty() && !confirm('สิทธิ์ของบทบาทนี้ยังไม่ได้บันทึก — ทิ้งการแก้ไขแล้วสร้างบทบาทใหม่?')) return;
        openRoleForm('new');
      });
      card.addEventListener('click', (e) => { if (e.target === card || e.target.closest('[data-role-close], [data-role-cancel]')) closeRoleForm(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        const copy = form.elements.copy.value;
        const submitBtn = document.getElementById('roleFormSave');
        submitBtn.disabled = true;
        try {
          if (mode === 'new') {
            const key = await rolesCreate(name);
            if (copy) await rolesSavePerms({ [key]: (DEMO_ROLE_PERMS[copy] || []).filter((x) => x !== 'user.manage') });
            adminRoleSel = key;
            setFlash('success', 'สร้างบทบาท ' + name + ' แล้ว' + (copy ? ' (คัดลอกสิทธิ์แล้ว)' : ' — ติ๊กสิทธิ์ทางขวา'));
          } else {
            // แก้ชื่อ: คงสิทธิ์ที่บันทึกไว้ (สิทธิ์ที่ติ๊กค้างอยู่ยังไม่ถูกบันทึก)
            await rolesSavePerms({ [adminRoleSel]: DEMO_ROLE_PERMS[adminRoleSel] || [] }, { [adminRoleSel]: name });
            setFlash('success', 'แก้ชื่อบทบาทเป็น ' + name + ' แล้ว');
          }
        } catch (ex) { submitBtn.disabled = false; errModal(ex.message); return; }
        closeRoleForm();
        back();
      });
      return;
    }
    // ----- แท็บผู้ใช้
    const table = document.getElementById('userTable');
    if (!table) return;
    const q = document.getElementById('userQ'), fr = document.getElementById('userRoleF'), fs = document.getElementById('userStateF');
    const filter = () => {
      let n = 0;
      table.querySelectorAll('tbody tr[data-uid]').forEach((tr) => {
        const ok = (!q.value.trim() || tr.dataset.search.includes(q.value.trim().toLowerCase())) && (!fr.value || (' ' + tr.dataset.role + ' ').includes(' ' + fr.value + ' ')) && (!fs.value || tr.dataset.state === fs.value);
        tr.hidden = !ok;
        if (ok) n += 1;
      });
      document.getElementById('userEmpty').hidden = n > 0;
      document.getElementById('userCount').textContent = n;
    };
    [q, fr, fs].forEach((el) => el.addEventListener('input', filter));
    const fa = app.querySelector('[data-filter-reset]');
    if (fa) fa.addEventListener('click', () => { fs.value = 'reset_requested'; filter(); });
    const card = document.getElementById('userFormCard'), form = document.getElementById('userForm');
    let editId = '';
    const errModal = (m) => { document.getElementById('userFormError').innerHTML = '<div class="alert error" role="alert">' + esc(m) + '</div>'; card.querySelector('.viewer-form').scrollTop = 0; };
    const closeForm = () => { card.hidden = true; document.getElementById('userFormError').innerHTML = ''; document.removeEventListener('keydown', onEsc); };
    const onEsc = (e) => { if (e.key === 'Escape') closeForm(); };
    // ช่องที่ต้องกรอกเปลี่ยนตามบทบาทที่ติ๊ก: Business = บริษัท+หน่วยงาน (อย่างละ 1) · ธุรการ = หลายหน่วยงาน + บริษัทที่รับผิดชอบ + ช่วยงานให้ Business · ผู้คุมงบ/บัญชี/จัดซื้อ = บริษัทที่รับผิดชอบ
    const checkedRoles = () => Array.from(form.querySelectorAll('[name=roles]:checked')).map((c) => c.value);
    const showIf = (id, on) => { document.getElementById(id).style.display = on ? '' : 'none'; };
    const syncProxyField = () => {
      const need = userNeeds(checkedRoles());
      showIf('affilField', need.affil);
      showIf('deptMultiField', need.deptMulti);
      showIf('coField', need.companies);
    };
    // หน่วยงานของ Business: เลือกได้เฉพาะที่อยู่ใต้บริษัทสังกัดที่เลือก (ข้อมูลเก่าที่ยังไม่ระบุบริษัทเลือกได้ด้วย)
    const fillDeptSelect = (selected) => {
      const sel = form.elements.department, company = form.elements.company.value;
      const list = db.master.departments.filter((d) => !d.company || d.company === company);
      sel.innerHTML = '<option value="">' + (company ? (list.length ? '— เลือกหน่วยงาน —' : '— ยังไม่มีหน่วยงานของบริษัทนี้ (เพิ่มที่ข้อมูลหลัก → หน่วยงาน) —') : '— เลือกบริษัทก่อน —') + '</option>' +
        list.map((d) => opt(d.name, d.name + (d.company ? '' : ' (ยังไม่ระบุบริษัท)'), selected || '')).join('') +
        (selected && !list.some((d) => d.name === selected) ? opt(selected, selected + ' (ไม่อยู่ใต้บริษัทนี้)', selected) : '');
      sel.value = selected || '';
    };
    form.addEventListener('change', (e) => {
      if (!e.target) return;
      if (e.target.name === 'roles') syncProxyField();
      else if (e.target.name === 'company') fillDeptSelect('');
    });
    const openForm = (u) => {
      editId = u ? u.id : '';
      form.reset();
      document.getElementById('userFormError').innerHTML = '';
      document.getElementById('userFormTitle').textContent = u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้';
      document.getElementById('userFormHint').hidden = !!u;
      ['email', 'name', 'title'].forEach((k) => { form.elements[k].value = u ? u[k] || '' : ''; });
      const cv = u ? u.company || '' : '';
      const csel = form.elements.company;
      if (cv && !Array.from(csel.options).some((o) => o.value === cv)) csel.appendChild(new Option(cv, cv)); // ค่าเดิมที่ไม่อยู่ในข้อมูลหลักแล้ว ไม่ให้หาย
      csel.value = cv;
      fillDeptSelect(u ? deptsOf(u)[0] || '' : '');
      const ds = u ? deptsOf(u) : [];
      form.querySelectorAll('[name=departments]').forEach((c) => { c.checked = ds.includes(c.value); });
      const rs = u ? rolesOf(u) : ['business'];
      form.querySelectorAll('[name=roles]').forEach((c) => { c.checked = rs.includes(c.value); });
      const cos = u ? (Array.isArray(u.companies) ? u.companies : []) : [];
      form.querySelectorAll('[name=companies]').forEach((c) => { c.checked = cos.includes(c.value); });
      syncProxyField();
      card.hidden = false;
      document.addEventListener('keydown', onEsc);
      form.elements.email.readOnly = !!(AUTH_REMOTE && u); // อีเมลผูกกับบัญชีล็อกอิน แก้ไม่ได้
      (form.elements.email.readOnly ? form.elements.name : form.elements.email).focus();
    };
    app.querySelector('[data-user-add]').addEventListener('click', () => openForm(null));
    card.addEventListener('click', (e) => { if (e.target === card || e.target.closest('[data-user-close], [data-user-cancel]')) closeForm(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const roles = checkedRoles();
      if (!roles.length) { errModal('เลือกบทบาทอย่างน้อย 1 บทบาท'); return; }
      const need = userNeeds(roles);
      const data = { email: f.email.value, name: f.name.value, title: f.title.value, roles, company: '', departments: [], companies: [] };
      if (need.affil) {
        data.company = f.company.value;
        data.departments = f.department.value ? [f.department.value] : [];
        if (!data.company) { errModal('เลือกบริษัทสังกัดของผู้ใช้'); return; }
        if (!data.departments.length) { errModal('เลือกหน่วยงานของผู้ใช้ (1 หน่วยงาน) — งบที่ผู้ใช้ขอจะขึ้นเป็นหน่วยงานนี้'); return; }
      }
      if (need.deptMulti) {
        data.departments = Array.from(form.querySelectorAll('[name=departments]:checked')).map((c) => c.value);
        if (!data.departments.length) { errModal('เลือกหน่วยงานที่ธุรการช่วยงานอย่างน้อย 1 หน่วยงาน'); return; }
      }
      if (need.companies) {
        data.companies = Array.from(form.querySelectorAll('[name=companies]:checked')).map((c) => c.value);
        if (!data.companies.length) { errModal('เลือกบริษัทที่รับผิดชอบอย่างน้อย 1 บริษัท — บทบาทนี้เห็นและทำงานของบริษัทที่เลือกเท่านั้น'); return; }
      }
      const submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      try {
        if (editId) { await accountUpdate(editId, data); setFlash('success', 'แก้ไขข้อมูลผู้ใช้แล้ว'); } else { await accountCreate(data); setFlash('success', 'เพิ่มผู้ใช้แล้ว — แจ้งผู้ใช้ให้เข้าหน้าล็อกอิน → "' + (AUTH_REMOTE ? 'เปิดใช้ครั้งแรก' : 'ตั้งรหัสผ่าน') + '" แล้วกรอกอีเมล ' + normEmail(data.email) + ' เพื่อตั้งรหัสผ่านของตัวเอง'); }
      } catch (ex) { submitBtn.disabled = false; errModal(ex.message); return; }
      closeForm();
      back();
    });
    table.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const tr = e.target.closest('tr[data-uid]');
      if (!btn || !tr || btn.disabled) return;
      const u = user(tr.dataset.uid);
      if (!u) return;
      if (btn.matches('[data-user-edit]')) openForm(u);
      else if (btn.matches('[data-user-reset]')) {
        const first = AUTH_REMOTE ? 'เปิดใช้ครั้งแรก' : 'ตั้งรหัสผ่าน';
        if (!confirm('รีเซ็ตรหัสผ่านของ ' + u.name + ' (' + u.email + ') ?\nรหัสเดิมจะใช้ไม่ได้ทันที — ผู้ใช้ต้องเข้า "' + first + '" เพื่อตั้งรหัสใหม่เอง')) return;
        try { await accountResetPassword(u.id); setFlash('success', 'รีเซ็ตรหัสผ่านของ ' + u.name + ' แล้ว — ให้ผู้ใช้เข้าหน้าล็อกอิน → "' + first + '" เพื่อตั้งรหัสใหม่เอง'); } catch (ex) { err(ex.message); return; }
        back();
      } else if (btn.matches('[data-user-toggle]')) {
        const on = u.active === false;
        if (!on && !confirm('ปิดการใช้งานบัญชีของ ' + u.name + ' ? ผู้ใช้จะล็อกอินไม่ได้และหลุดจากระบบทันที')) return;
        try { await accountSetActive(u.id, on); setFlash('success', (on ? 'เปิดใช้งาน' : 'ปิดการใช้งาน') + 'บัญชีของ ' + u.name + ' แล้ว'); } catch (ex) { err(ex.message); return; }
        back();
      }
    });
  }

  function viewLog(params) {
    if (!can('log.view')) return '<div class="alert error">ไม่มีสิทธิ์ดู Log</div>';
    const q = (params.get('q') || '').toLowerCase();
    const who = params.get('by') || '';
    const list = (db.log || []).slice().reverse().filter((x) => (!who || x.by === who) &&
      (!q || (x.action + ' ' + x.ref + ' ' + x.detail).toLowerCase().includes(q)));
    return '<div class="page-head"><div><h1>Log การทำงาน</h1><div class="page-sub">บันทึกทุกการกระทำในระบบ เพิ่มได้อย่างเดียว แก้หรือลบไม่ได้</div></div></div>' +
      '<form id="logFilter" class="admin-filters"><label class="input-wrap search">' + ICON_SEARCH + '<input name="q" type="search" placeholder="ค้นหาการกระทำ เลขที่ รายละเอียด" value="' + esc(params.get('q') || '') + '"></label>' +
      '<div class="select-wrap"><select name="by">' + opt('', 'ผู้ใช้: ทั้งหมด', who) + USERS.map((x) => opt(x.id, 'ผู้ใช้: ' + x.name, who)).join('') + '</select></div><button class="btn" type="submit">กรอง</button></form>' +
      '<div class="table-wrap"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>เรื่อง</th><th>รายละเอียด</th></tr></thead><tbody>' +
      (list.length ? list.slice(0, 300).map((x) => '<tr><td class="nowrap">' + fmtDate(x.at) + '</td><td class="nowrap">' + esc(userName(x.by)) + '</td><td>' + esc(x.action) + '</td><td class="nowrap">' + esc(x.ref) + '</td><td>' + esc(x.detail) + '</td></tr>').join('')
        : '<tr><td colspan="5" class="muted">ไม่พบรายการ</td></tr>') + '</tbody></table></div>';
  }
  function bindLog() {
    const f = document.getElementById('logFilter');
    if (!f) return;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      go('#/log?q=' + encodeURIComponent(f.elements.q.value.trim()) + '&by=' + encodeURIComponent(f.elements.by.value));
    });
  }

  /** สมมติฐานที่ใช้ในต้นแบบรอบนี้ — รอทีมผู้ใช้ยืนยัน */
  function viewAssumptions() {
    const rows = [
      ['ระบบ', 'กลุ่มงบประมาณและประเภทสินทรัพย์', 'ตัดออกจากระบบ (ข้อมูลหลัก ฟอร์ม Memo ขอเปิดใช้งบ ไฟล์ Import / Export รายงานสรุปตามกลุ่มงบ และหน้ารายละเอียดงบ) — ไม่มีช่องให้เลือกและไม่ได้ใช้ในการคุมงบ · ข้อมูลเดิมที่เคยมีค่านี้ถูกเมินเฉย · ไฟล์ Import รูปแบบรายการ Item ไม่มีคอลัมน์กลุ่มงบ / ประเภทสินทรัพย์แล้ว'],
      ['ระบบ', 'ขอบเขตบริษัทของผู้คุมงบ', 'ผู้คุมงบ / จัดซื้อ เห็นเฉพาะงบ คำขอเบิก คำขอเพิ่มงบ และเอกสารของบริษัทที่บัญชีมีสิทธิ์ (ได้หลายบริษัท) แต่เห็นทุกงานของบริษัทนั้นแม้ไม่ใช่ผู้รับผิดชอบ · Admin กำหนดบริษัทที่ดูได้ให้แต่ละบัญชี · ยังไม่ตัดสิน: ผู้ที่ไม่ใช่ผู้รับผิดชอบ (เจ้าของฝ่ายการเงิน) กดตรวจ/ยืนยันได้หรือไม่ — ตอนนี้กดได้ทุกคนที่มีสิทธิ์ในบริษัท และ Log ผู้ทำจริง'],
      ['ระบบ', 'DOA (อำนาจอนุมัติ)', 'ตัดออกจากระบบก่อน — ตรวจสอบกันเองแบบ Manual: CAPEX ผู้คุมงบนำงบที่ผ่านการอนุมัติแล้วมาลงให้ Business เปิดใช้ · OPEX Business ส่งผู้อนุมัติตามที่ตนรู้เซ็นเอง แล้วแนบเอกสารเปิดใช้งบ · ไม่มีหมวด DOA ใน Item, ไม่มีตาราง DOA ในใบเบิกใช้งบ, ไม่มีช่อง "อ้างอิงอำนาจอนุมัติ" ใน Memo, ไม่มีเมนู "ตารางอำนาจอนุมัติ" ในข้อมูลหลัก'],
      ['ระบบ', 'Admin ทำอะไรได้', 'ดูแลข้อมูลหลัก ดู Log ทั้งระบบ และจัดการผู้ใช้/สิทธิ์ · ดูงบได้ทั้งหมดแต่ไม่ทำรายการ'],
      ['ระบบ', 'ผู้ใช้ทั่วไปเห็นประวัติแค่ไหน', 'เห็น "ประวัติการทำรายการ" ที่ตนทำ และที่ผู้อื่นทำกับงบ/เอกสารของตน (ไม่เห็น Log ทั้งระบบ)'],
      ['ตั้งงบ', 'Journey งบประจำปี', 'CAPEX: ผู้คุมงบลงงบของแต่ละปี (กดสร้าง หรือ Import Excel) → งบรอ Business เจ้าของงบเปิดใช้ครั้งแรก (เปิดทั้งงบทีเดียว) → Business ทำ Memo ขอดำเนินการใช้งบ ให้ผู้บริหารเซ็น แนบไฟล์ที่เซ็นแล้วส่ง → ผู้คุมงบตรวจ Memo แล้วยืนยัน (หรือส่งกลับให้แก้) · ผู้คุมงบแก้ / ยกเลิกงบที่ลงไว้ได้จนกว่า Business ส่ง Memo หรือขอดำเนินการใช้งบ · OPEX: Business เป็นผู้สร้างงบเอง (ผู้คุมงบลง / Import OPEX ไม่ได้) — ดูแถว "OPEX Business สร้างและส่งอนุมัติเอง"'],
      ['ตั้งงบ', 'ช่องข้อมูลตามไฟล์ Capex / Opex Governance Framework', 'งบทุกประเภทมีช่อง: รหัส (Capex ID / Opex ID) · ชื่อโครงการ · หน่วยงานที่ขอ · กลุ่ม Priority · เหตุผลสนับสนุน Priority (ย่อ) · มูลค่ารวม · ปี (เฉลี่ยปีที่ลงทุน / ปีงบประมาณ) · Owner / เจ้าของ Action Plan · เจ้าของฝ่ายการเงิน (ติดตามร่วม) · สถานะอนุมัติ (คำนวณจากสถานะงบ) · กลุ่มรายการ · CAPEX เพิ่ม: กลุ่ม Priority การลงทุน (New) · ตัวเลือกกลุ่มต่าง ๆ ตั้งได้ที่ข้อมูลหลัก'],
      ['ตั้งงบ', 'Import งบจาก Excel', 'ไฟล์ .xlsx หรือ .csv ตามไฟล์ตัวอย่าง: 1 แถว = 1 Item · รหัสโครงการเดียวกัน = งบเดียวกัน · Business เจ้าของงบใส่ชื่อหรือรหัสผู้ใช้ · ตรวจข้อมูลก่อนนำเข้า (บริษัท / หน่วยงานตามข้อมูลหลัก, รหัสซ้ำ, วงเงิน > 0) งบที่ผิดไม่ถูกนำเข้า · นำเข้าได้เฉพาะ CAPEX'],
      ['ตั้งงบ', 'ขั้นตอนหลักของงบ (CAPEX / OPEX)', 'Business สร้าง: สร้างงบประมาณ (ร่าง) → อนุมัติ (ส่งแล้ว สถานะ "รออนุมัติ" — ผู้อนุมัติเซ็นเอกสารนอกระบบ ผู้คุมงบเป็นคนกดตรวจผ่าน / ส่งกลับในระบบ) → เปิดใช้ (CAPEX: ส่ง Memo ให้ผู้คุมงบยืนยัน · OPEX: Business กดขอดำเนินการใช้งบ) → จบเมื่อเปิดใช้งบ · ผู้คุมงบสร้าง / Import: สร้างงบประมาณ → เปิดใช้ (2 ขั้น)'],
      ['ใช้งบ', 'วงเงินที่ขอเบิกได้', 'OPEX: เกินวงเงินต่อ Item (งบรวมทั้งโครงการ = เกินวงเงินรวม) ไม่ได้ ต้องขอเพิ่มงบ / โยกงบก่อน · CAPEX: เกินวงเงินรายการย่อยได้ (ผู้คุมงบใส่ Note) แต่ห้ามเกินงบรวมของโครงการ'],
      ['ใช้งบ', 'Memo ทำครั้งเดียวตอนขอเปิดใช้งบ', 'ตัดสินแล้ว: Memo (CAPEX) ทำครั้งเดียวตอนขอดำเนินการใช้งบ (เปิดใช้งบ) · หลังเปิดใช้งบแล้ว การเบิกใช้แต่ละครั้งไม่ต้องทำ Memo — ผู้คุมงบตรวจและระบบคุมตามวงเงินที่เปิดใช้ (OPEX เกินวงเงินต่อ Item / งบรวมไม่ได้ · CAPEX เกินรายการได้แต่ห้ามเกินงบรวม)'],
      ['ตั้งงบ', 'ใครกำหนดรหัสโครงการ/รหัสรายการย่อย', 'ผู้คุมงบกรอกตอนลงงบ / Import · Business กรอกเองเมื่อขอตั้งงบใหม่'],
      ['ตั้งงบ', 'แบบฟอร์มขออนุมัติงบเข้าที่ประชุม', 'ใช้แบบฟอร์มชั่วคราว (รอแบบฟอร์มจริง)'],
      ['ตั้งงบ', 'หลักฐานที่ต้องแนบ', 'ไฟล์มติที่ประชุมอย่างน้อย 1 ไฟล์ + เลขที่มติ'],
      ['ปรับงบ', 'ผู้คุมงบลดงบได้ไหม', 'ได้ ต้องใส่เหตุผล ลดไม่ได้เกินยอดคงเหลือ'],
      ['ปรับงบ', 'ผู้บริหารสั่งตัดงบต้องแนบเอกสารไหม', 'ยังไม่บังคับแนบ (ใส่เหตุผลอย่างเดียว)'],
      ['ปรับงบ', 'ปิดปีงบ: งบเหลือหมดสิทธิ์หรือยกไป', 'ยังไม่ได้ทำ — งบปีก่อนยังใช้ต่อได้เหมือนเดิม'],
      ['ปรับงบ', 'มีงบกลาง/งบสำรองไหม', 'ไม่มี — โยกตรงจากรายการ/โครงการหนึ่งไปอีกที่'],
      ['ปรับงบ', 'โยก/ลดงบแล้วแจ้งเจ้าของงบไหม', 'บันทึกในประวัติของงบทั้งสองฝั่ง (ยังไม่มีแจ้งเตือน)'],
      ['ระบบ', 'ส่งออกข้อมูล (Excel)', 'เมนู "ส่งออกข้อมูล (Excel)" สำหรับผู้คุมงบและ Admin (สิทธิ์ data.export) · กรองปีงบ / บริษัท / ประเภทงบ · แผ่นงาน: งบประมาณ, Item, เบิกใช้งบ, รายการในใบ, ตัดงบ-จ่ายเงิน, ปรับงบ (INC/TRF/DEC), Plan Cashflow · ตัวเลขเป็นตัวเลขจริงใน Excel (รวม/กรองได้) · รอยืนยันกับฝ่ายบัญชีว่าต้องการคอลัมน์ / รูปแบบเพิ่มเติม (เช่น รูปแบบนำเข้าระบบบัญชี)'],
      ['OPEX', 'GL Code', 'ไม่บังคับตอนตั้งงบ / เพิ่ม Item ย่อย — ฝ่ายบัญชี (ผู้คุมงบ) ใส่ทีหลังได้ทุกเมื่อที่ปุ่ม "ใส่ GL Code" ในหน้างบ · Item ย่อยที่เว้นว่างใช้ GL ของ Item แม่ · ใบเบิกใช้งบที่ยังไม่มี GL แสดง GL ล่าสุดของ Item (รวมถึงใน Excel) · หน้างบแจ้งเตือน Item หลักที่ยังไม่มี GL'],
      ['CAPEX', 'Plan Cashflow', 'หลังงบอนุมัติ (เปิดใช้แล้ว) Business เจ้าของงบหรือผู้คุมงบ ประมาณการว่าแต่ละ Item จะใช้เงินเดือนไหนเท่าไร (รวม VAT) ตามเดือนของปีงบประมาณ · รวมของแต่ละ Item ต้องไม่เกินวงเงิน Item · ไม่บังคับก่อนขอใช้งบ (แจ้งเตือนในหน้างบ) · แสดงเทียบกับยอดตัดงบจริงรายเดือน · แก้ได้ตลอด เก็บประวัติ'],
      ['ใช้งบ', 'ใบเบิกใช้งบ 1 ใบใช้ได้หลาย Item ไหม', 'ได้ ทั้ง CAPEX และ OPEX — เลือก Item ทีละบรรทัด · ตรวจเกินงบทีละ Item และทั้งโครงการ · ตัดงบแบ่งตามสัดส่วนยอดของแต่ละ Item'],
      ['ใช้งบ', 'ขอเกินงบรายการย่อยแต่ไม่เกินงบโครงการ', 'ขอได้ ระบบเตือน ผู้คุมงบต้องใส่ Note'],
      ['ใช้งบ', 'ขอเกินงบโครงการ', 'อนุมัติไม่ได้จนกว่าผู้คุมงบโยกงบเข้า หรือส่งกลับให้ขอเพิ่มงบ'],
      ['ใช้งบ', 'ผู้ขอต้องใส่เหตุผลที่ขอเกินไหม', 'ไม่บังคับ (มีช่องให้ใส่)'],
      ['ใช้งบ', 'Note ผู้อนุมัติแสดงบนใบที่พิมพ์ไหม', 'แสดง'],
      ['ใช้งบ', 'ยอดจริงมากกว่าที่ขอได้ไหม', 'ได้ ต้องใส่หมายเหตุ (ยังไม่ต้องอนุมัติซ้ำ)'],
      ['ใช้งบ', 'คืนส่วนต่างเมื่อไร', 'เมื่อปิดยอด (Advance/สำรองจ่ายปิดอัตโนมัติเมื่อบันทึกใบเสร็จ)'],
      ['ใช้งบ', 'ผู้ขอยกเลิกใบ CAPEX ที่ออกแล้วได้ไหม', 'ไม่ได้ (ยกเลิกได้เฉพาะตอนรอตรวจ/ถูกส่งกลับ)'],
      ['ใช้งบ', 'จ่ายหลายงวด', 'ใช้ได้กับ PR/PO และจ่ายตรง — บันทึกจ่ายหลายครั้งแล้วปิดยอด'],
      ['ตั้งงบ', 'แบบฟอร์ม Memo', 'ออกตามแบบฟอร์ม Memo จริงของบริษัท: เรียน/สำเนาถึง/เรื่อง/อ้างอิง → 1. เรื่องสืบเนื่อง → 2. เรื่องเพื่อพิจารณาลงนาม (ยอดเงินเป็นตัวอักษร) → ตารางสรุปงบ (กรอบงบ − เบิกไปแล้ว − ขอครั้งนี้ = คงเหลือ) → ตารางทบทวน/ผู้พิจารณาอนุมัติ · หัวกระดาษ: โลโก้ของบริษัท (ตั้งต้นใช้โลโก้กลุ่มบริษัท · อัปโหลดโลโก้เฉพาะบริษัทได้ที่ ข้อมูลหลัก > บริษัท) และคำว่า Memo ชิดขวา · ตารางหัว (เรียน/วันที่-เลขที่, เรื่อง, สำเนาถึง, อ้างอิง) กว้างกว่าเนื้อความ มีแต่เส้นแนวนอน · ยังไม่ทำเลขหน้าและแถบสีท้ายกระดาษ'],
      ['ตั้งงบ', 'กรอก Memo ขอดำเนินการใช้งบอย่างไร', 'CAPEX: ในหน้างบที่ยังไม่เปิดใช้งบ กด "ทำ Memo" → ระบบออกเลขที่ Memo แล้วเปิดหน้า Memo ที่เป็นโครงแบบฟอร์มจริง มีช่องกรอกในตำแหน่งเดียวกับเอกสาร · ค่าเริ่มต้นดึงจากงบและ ข้อมูลหลัก > ผู้ลงนาม Memo · แนบฉบับที่เซ็นแล้วแล้วส่งให้ผู้คุมงบตรวจ/ยืนยัน · OPEX ไม่ต้องทำ Memo'],
      ['ใช้งบ', 'ค่าเริ่มต้นของเรื่องสืบเนื่อง / อ้างอิง', 'เรื่องสืบเนื่อง = ข้อความอ้างอิงงบและกรอบวงเงิน (ผู้ขอแก้/เพิ่มย่อหน้าเองได้) · อ้างอิง = มติที่ประชุม (CAPEX) / เอกสารอนุมัติผู้บริหาร (OPEX) ของงบ · "ครั้งที่" นับจากคำขอก่อนหน้าของงบเดียวกัน'],
      ['ใช้งบ', 'บริษัทที่ลงทุน', 'ไม่มีการใช้งบข้ามบริษัทราย Item แล้ว — ทุก Item ใช้งบของบริษัทเจ้าของงบ (ไม่มีช่อง "บริษัทที่ลงทุน" ใน Item) · งบที่ไม่มี Item (งบรวมทั้งโครงการ) ยังเลือกบริษัทที่ลงทุนรายบรรทัดตอนเบิกใช้งบได้ (ค่าตั้งต้น = บริษัทเจ้าของงบ) · แสดงในใบเบิกใช้งบและ Memo'],
      ['ใช้งบ', 'รายการของงบรวมโครงการ', 'งบที่ไม่มี Item (CAPEX / OPEX) ตอนขอเบิกพิมพ์ชื่อรายการเอง ไม่ต้องเลือกหมวด · ถ้าชื่อตรงกับหมวดค่าใช้จ่ายในข้อมูลหลัก OPEX จะได้ GL ตั้งต้นของหมวดนั้น'],
      ['OPEX', 'Item ของงบ OPEX', 'ต้องมี Item เสมอ (ไม่มีงบรวมทั้งโครงการ) · Item หลัก (1, 2, 3) กำหนดตอนตั้งงบพร้อมวงเงิน ไม่มีจำนวน/หน่วย · Item ย่อยได้ 3 ระดับ (1 → 1.1 → 1.1.1) เพิ่มได้เรื่อย ๆ หลังงบเปิดใช้แล้ว · รหัสโครงการและรหัส Item ผู้สร้างงบตั้งเอง โดย Business เจ้าของงบหรือผู้คุมงบ (ไม่ต้องอนุมัติซ้ำ ยอดงบรวมไม่เปลี่ยน)'],
      ['OPEX', 'วงเงินของ Item ย่อย', 'เงื่อนไขเดียว: รวมกันต้องไม่เกินวงเงิน Item หลัก (ถ้า 1.1 กำหนดวงเงินไว้ 1.1.x ต้องรวมไม่เกิน 1.1 ด้วย เพื่อให้ยอดคงเหลือสอดคล้องกัน) · จะกำหนดหรือไม่กำหนดวงเงินของ Item ย่อยก็ได้ (ไม่กำหนด = ใช้วงเงินของ Item แม่) · จำนวน/หน่วย กรอกที่ Item ย่อย · Item ย่อยที่กำหนดวงเงินถูกตรวจทั้งวงเงินตัวเองและวงเงิน Item หลัก · Item ย่อยที่มีการขอใช้แล้ว แก้รหัส/ลบไม่ได้'],
      ['ตั้งงบ', 'คัดลอกงบอื่น', 'หน้าสร้างงบมีปุ่ม "คัดลอกงบอื่น" (และปุ่ม "คัดลอกเป็นงบใหม่" ในหน้างบ) — Business คัดลอกได้จากงบของตนเองทั้ง CAPEX และ OPEX · ผู้คุมงบคัดลอกได้จากทุกงบ · ดึงประเภท บริษัท หน่วยงาน ข้อมูล Priority ชื่อ และรายการหลักพร้อมวงเงิน · รหัสโครงการต้องกรอกใหม่ · ไม่คัดลอก Item ย่อย / ข้อมูลอนุมัติ / ไฟล์แนบ'],
      ['OPEX', 'ขั้นตอนการใช้งบ OPEX', 'เหมือน CAPEX ทุกขั้น: ขอเบิกใช้งบ (4 ประเภท) → ผู้คุมงบตรวจสอบ → ตัดงบตามประเภท → ปิดยอดคืนส่วนต่าง · ขอเกินงบรายการต้องมี Note · ไม่ใช้ Memo'],
      ['OPEX', 'การอนุมัติงบ OPEX (ตั้งงบ / เพิ่มงบ)', 'ไม่เข้าบอร์ด — ให้ผู้บริหารอนุมัติ: แนบเอกสารอนุมัติ + เลขที่เอกสาร + ชื่อผู้บริหารที่อนุมัติ แล้วผู้คุมงบตรวจสอบและยืนยัน (ต้นแบบนี้ผู้บริหารอนุมัตินอกระบบ แล้วแนบหลักฐาน)'],
      ['OPEX', 'ผู้บริหารที่อนุมัติ ต้องเป็นผู้ใช้ในระบบไหม', 'ไม่ — พิมพ์ชื่อ/ตำแหน่งและแนบหลักฐาน (ถ้าต้องการให้ผู้บริหารกดอนุมัติในระบบ จะเพิ่มบทบาท "ผู้บริหาร" ภายหลัง)'],
      ['OPEX', 'ใบ OPEX ที่ใช้หลายรายการต้นทุน ตัดงบอย่างไร', 'แบ่งยอดที่ตัดตามสัดส่วนยอดของแต่ละรายการต้นทุนในใบ'],
      ['OPEX', 'Asset / Expenses และขั้นตอนบัญชีแยกของ OPEX', 'ไม่มี — ใช้ GL Code ที่ติดมากับรายการต้นทุน (ขั้นตอนบัญชี OPEX เดิมถูกแทนด้วยการตัดงบแบบเดียวกับ CAPEX)'],
      ['ระบบ', 'เลขที่เอกสารที่ระบบออกให้', 'รูปแบบ ตัวย่อเอกสาร-ปี ค.ศ.-ลำดับ 4 หลัก เริ่มนับใหม่ทุกปี: REQ คำขอเบิกใช้งบ · CAPEX / OPEX ใบเบิกใช้งบ · MEMO บันทึกข้อความ · INC คำขอเพิ่มงบ · TRF โยกงบ · DEC ลดงบ (เช่น CAPEX-2026-0001) · เอกสารที่ออกไปแล้วคงเลขเดิม · เลขที่ฝ่ายอื่นเป็นคนออก (รหัสโครงการ / Item No. / PR / PO / เลขที่มติ / เลขที่ใบเสร็จ) ผู้ใช้กรอกเอง'],
      ['ไฟล์แนบ', 'จุดแนบและชนิดเอกสาร', 'มติ (ตั้งงบ/เพิ่มงบ) · เอกสารประกอบคำขอ · PO · ใบเสร็จ/หลักฐานจ่าย — โหมดทดลองจำกัด 400 KB ต่อไฟล์'],
      ['ระบบ', 'ฐานข้อมูล Supabase', 'ต้นแบบนี้ยังไม่เชื่อม — จะปรับฐานข้อมูลเมื่อยืนยันขั้นตอนแล้ว (เวอร์ชันเดิมอยู่ที่ /v1/)']
    ];
    return '<div class="page-head"><div><h1>สิ่งที่รอยืนยัน</h1><div class="page-sub">ต้นแบบรอบนี้ใช้ค่าตั้งต้นด้านล่างแทนข้อที่ยังไม่ได้ตอบ — ถ้าไม่ตรงกับงานจริง แจ้งได้เลย</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>หมวด</th><th>คำถาม</th><th>ต้นแบบนี้ใช้</th></tr></thead><tbody>' +
      rows.map((x) => '<tr><td class="nowrap">' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td>' + esc(x[2]) + '</td></tr>').join('') + '</tbody></table></div>';
  }

  // ---------------------------------------------------------------- ช่องที่ต้องกรอก (*) และปิดปุ่มจนกว่าเงื่อนไขครบ

  /** ใส่ * สีแดงให้ช่องที่ต้องกรอก (ตามชื่อช่อง) — ช่องที่มี required อยู่แล้วได้ * จาก CSS อัตโนมัติ */
  function markReq(form, names) {
    names.forEach((n) => form.querySelectorAll('[name="' + n + '"]').forEach((el) => {
      const fld = el.closest('.field');
      if (fld) fld.classList.add('req');
    }));
  }
  /** ใส่ * ที่หัวตาราง / หัวข้อ ตามข้อความ */
  function markReqText(root, selector, re) {
    root.querySelectorAll(selector).forEach((el) => { if (re.test(el.textContent)) el.classList.add('req'); });
  }

  /**
   * ปิดปุ่มจนกว่าจะกรอกครบ และบอกใต้ปุ่มว่ายังขาดอะไร
   * rules = [{ btn: ตัวเลือกปุ่ม, label?: ชื่อสั้นของปุ่ม (เมื่อมีหลายปุ่ม), missing: (form) => ['สิ่งที่ยังขาด', ...] }]
   */
  function guard(form, rules, anchorSel) {
    if (!form) return;
    let hint = form.querySelector('.guard-hint');
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'guard-hint';
      const anchor = form.querySelector(anchorSel || '.side-actions, .decision-actions, .actions');
      if (anchor) anchor.insertAdjacentElement('afterend', hint); else form.appendChild(hint);
    }
    const run = () => {
      const notes = [];
      const per = new Map(); // ปุ่มหนึ่งอาจถูกหลายกฎตรวจ: ขาดอะไรก็ได้ = กดไม่ได้
      let active = 0;
      rules.forEach((rule) => {
        const btns = Array.from(form.querySelectorAll(rule.btn));
        if (!btns.length) return;
        active += 1;
        const miss = rule.missing(form).filter(Boolean);
        btns.forEach((btn) => per.set(btn, (per.get(btn) || []).concat(miss)));
        if (miss.length) notes.push({ label: rule.label, text: miss.join(' · ') });
      });
      per.forEach((miss, btn) => {
        btn.disabled = miss.length > 0;
        btn.title = miss.length ? 'ยังขาด: ' + miss.join(', ') : '';
      });
      hint.textContent = notes.length ? 'กรอกให้ครบก่อน: ' + notes.map((n) => (active > 1 && n.label ? n.label + ': ' : '') + n.text).join(' | ') : '';
      hint.hidden = !notes.length;
    };
    form.addEventListener('input', run);
    form.addEventListener('change', run);
    form.addEventListener('click', () => setTimeout(run, 0)); // เพิ่ม/ลบแถว
    run();
  }
  const filled = (el) => !!(el && String(el.value || '').trim());
  const fileCount = (form) => form.querySelectorAll('.files li').length;

  function bindGuards() {
    // ---- ฟอร์มตั้งงบ / นำเข้างบ
    const bf = document.getElementById('budgetForm');
    if (bf) {
      markReq(bf, ['company', 'fiscalYear', 'code', 'name', 'department', 'ownerId', 'projAmount', 'priorityGroup', 'investGroup', 'financeOwner']);
      markReqText(bf, '.item-table thead th', /^(รหัสรายการย่อย|ชื่อรายการ|วงเงิน \(รวม VAT\))$/);
      guard(bf, [{ btn: '[data-action="create"]', label: 'สร้างงบ', missing: (f) => budgetFormMissing(f) },
        { btn: '[data-action="draft"]', label: 'บันทึกแบบร่าง', missing: (f) => [!filled(f.elements.code) && 'รหัสโครงการ', !filled(f.elements.name) && 'ชื่อโครงการ'] }], '.form-bar .bar-hint');
    }

    // ---- แนบมติ / เอกสารอนุมัติแล้วส่งตรวจ (งบ และคำขอเพิ่มงบ)
    ['submitBudget', 'submitChange'].forEach((id) => {
      const f = document.getElementById(id);
      if (!f) return;
      markReq(f, ['meetingNo', 'meetingBy']);
      f.querySelectorAll('input[type="file"]').forEach((el) => { const fld = el.closest('.field'); if (fld) fld.classList.add('req'); });
      guard(f, [{ btn: 'button[type="submit"]', missing: (form) => [
        !filled(form.elements.meetingNo) && (form.elements.meetingBy ? 'เลขที่เอกสารอนุมัติ' : 'เลขที่มติ'),
        form.elements.meetingBy && !filled(form.elements.meetingBy) && 'ผู้บริหารที่อนุมัติ',
        !fileCount(form) && 'ไฟล์' + (form.elements.meetingBy ? 'เอกสารอนุมัติ' : 'มติ')
      ] }]);
    });

    // ---- ผู้คุมงบ: ส่งกลับต้องมีเหตุผล
    ['verifyBudget', 'verifyChange'].forEach((id) => {
      const f = document.getElementById(id);
      if (!f) return;
      guard(f, [{ btn: '[data-verify="returned"]', label: 'ส่งกลับ', missing: (form) => [!filled(form.elements.comment) && 'หมายเหตุ / เหตุผลที่ส่งกลับ'] }]);
    });

    // ---- ขอเบิกใช้งบ
    const rf = document.getElementById('requestForm');
    if (rf) {
      markReq(rf, ['itemId', 'deliveryDate', 'payDueDate']); // ไม่มีวัตถุประสงค์ แต่ต้องมีวันที่ส่งมอบ / กำหนดจ่าย
      markReqText(rf, '.section-title', /ประเภทการเบิกใช้งบ/);
      markReqText(rf, '.lines-table thead th', /^(รายการต้นทุน \(OPEX\)|Supplier และรายละเอียด|รายการย่อย \(Item No\.\)|หมวดค่าใช้จ่าย|รายละเอียด|ก่อน VAT)/);
      markReq(rf, ['memoTo', 'memoApprovers']);
      guard(rf, [{ btn: 'button[type="submit"]', missing: (f) => {
        const e = f.elements;
        const m = [];
        if (!f.querySelector('[name="useType"]:checked')) m.push('ประเภทการเบิกใช้งบ');

        if (e.purpose && !filled(e.purpose)) m.push('วัตถุประสงค์');
        if (e.payee && e.payee.required && !filled(e.payee)) m.push('ผู้รับเงิน');
        if (requestLimitIssues(f).block.length) m.push('ยอดไม่เกินวงเงิน');
        if (e.deliveryDate && !filled(e.deliveryDate)) m.push('วันที่ส่งมอบ/วางบิล');
        if (e.payDueDate && !filled(e.payDueDate)) m.push('วันที่กำหนดจ่ายเงิน');
        const rows = lineTrs(f).map((tr) => ({
          desc: filled(tr.querySelector('[name="lnDesc"]')), amt: Number(tr.querySelector('[name="lnAmount"]').value || 0),
          item: rowItemSel(tr), cat: rowField(tr, 'lnCat'), sup: tr.querySelector('[name="lnSupplier"]'), purp: rowField(tr, 'grpPurpose')
        }));
        const used = rows.filter((r) => r.desc || r.amt);
        if (!used.length) m.push('รายการที่ขอใช้อย่างน้อย 1 บรรทัด');
        if (used.some((r) => !r.desc)) m.push('รายละเอียดทุกบรรทัด');
        if (used.some((r) => !(r.amt > 0))) m.push('จำนวนเงินทุกบรรทัด');
        const rb = budgetById(f.dataset.budget) || {};
        if ((used.length ? used : rows).some((r) => r.item && !r.item.value)) m.push(rb.type === 'CAPEX' ? 'รายการย่อย (Item No.) ทุกบรรทัด' : 'รายการต้นทุนทุกบรรทัด');
        if (used.some((r) => r.cat && !filled(r.cat))) m.push('ชื่อรายการทุกกลุ่ม');
        if (used.some((r) => r.purp && !filled(r.purp))) m.push('วัตถุประสงค์ทุกรายการ');
        if (used.some((r) => r.sup && (!filled(r.sup) || r.sup.value === SUP_NEW)) && (f.querySelector('[name="useType"]:checked') || {}).value !== 'prpo') m.push('Supplier ทุกบรรทัด');
        const wrap = document.getElementById('planWrap');
        const mode = f.querySelector('[name="payMode"]:checked');
        if (wrap && !wrap.hidden && mode && mode.value === 'installments') {
          const pcts = Array.from(f.querySelectorAll('#planRows [name="planPct"]')).map((x) => Number(x.value || 0)).filter((x) => x);
          if (pcts.length < 2 || round2(pcts.reduce((s, x) => s + x, 0)) !== 100) m.push('งวดจ่ายอย่างน้อย 2 งวด รวม 100%');
        }
        return m;
      } }], '.total-card .kv');
    }

    // ---- ผู้คุมงบตรวจคำขอ
    const df = document.getElementById('decisionForm');
    if (df) {
      const r = requestById(df.dataset.id);
      const ov = capexOver(r);
      guard(df, [
        { btn: '[data-decision="approved"]', label: 'อนุมัติ', missing: (form) => [
          ov.project > 0 && 'เกินงบโครงการ ' + money(ov.project) + ' บาท — โยกงบเข้าก่อน',
          ov.project <= 0 && ov.item > 0 && !filled(form.elements.comment) && 'Note เหตุผลที่ให้ผ่าน (ขอเกินงบรายการ)'] },
        { btn: '[data-decision="rejected"]', label: 'ส่งกลับ', missing: (form) => [!filled(form.elements.comment) && 'เหตุผลที่ส่งกลับ'] }
      ]);
    }

    // ---- แนบ Memo ที่เซ็นแล้ว
    const ms = document.getElementById('memoSubmit');
    if (ms) {
      const fi = ms.querySelector('input[type="file"]');
      if (fi && fi.closest('.field')) fi.closest('.field').classList.add('req');
      guard(ms, [{ btn: 'button[type="submit"]', missing: (form) => [
        !fileCount(form) && 'ไฟล์ Memo ที่เซ็นแล้ว'] }]);
    }

    // ---- การตัดงบ
    const af = document.getElementById('advForm');
    if (af) guard(af, [{ btn: 'button[type="submit"]', missing: (f) => [!filled(f.elements.date) && 'วันที่จ่าย', !(Number(f.elements.amount.value) > 0) && 'ยอดเงินทดรอง'] }]);
    const cf = document.getElementById('cutForm');
    if (cf) {
      const r = requestById(cf.dataset.id);
      guard(cf, [{ btn: 'button[type="submit"]', missing: (f) => {
        const e = f.elements;
        const amt = Number(e.amount.value || 0);
        return [e.prNo && !filled(e.prNo) && 'เลขที่ PR', e.poNo && !filled(e.poNo) && 'เลขที่ PO', !filled(e.date) && 'วันที่',
          !(amt > 0) && 'ยอดเงิน', amt > 0 && round2(cutTotal(r) + amt) > r.amount + 0.005 && !filled(e.note) && 'หมายเหตุ (ยอดรวมเกินที่ขอ)'];
      } }]);
    }
    const clf = document.getElementById('closeForm');
    if (clf) {
      const r = requestById(clf.dataset.id);
      guard(clf, [{ btn: 'button[type="submit"]', missing: (f) => [cutTotal(r) > r.amount + 0.005 && !filled(f.elements.note) && 'หมายเหตุ (ยอดจริงเกินที่ขอ)'] }]);
    }

    // ---- คำขอเพิ่มงบ
    const chf = document.getElementById('changeForm');
    if (chf) {
      markReq(chf, ['reason', 'projAdd']);
      guard(chf, [{ btn: 'button[type="submit"]', missing: (f) => {
        const m = [];
        if (!filled(f.elements.reason)) m.push('เหตุผลที่ขอเพิ่มงบ');
        if (f.elements.projAdd) { if (!(Number(f.elements.projAdd.value) > 0)) m.push('วงเงินที่ขอเพิ่ม'); return m; }
        const rows = Array.from(f.querySelectorAll('#chRows tr'));
        if (!rows.length) m.push('รายการที่ขอเพิ่ม');
        if (rows.some((tr) => !(Number(tr.querySelector('[name="chAmount"]').value) > 0))) m.push('จำนวนเงินที่ขอเพิ่มทุกแถว');
        if (rows.some((tr) => tr.querySelector('[name="chItem"]').value === 'new' && (!filled(tr.querySelector('[name="chCode"]')) || !filled(tr.querySelector('[name="chName"]'))))) m.push('รหัสและชื่อรายการใหม่');
        return m;
      } }]);
    }

    // ---- โยก / ลดงบ
    const pick = (v) => { const [bid, iid] = String(v || '').split('|'); const b = budgetById(bid); const it = b && itemById(b, iid); return { b, it }; };
    const remainOf = (x) => (x.it ? usage(x.b, x.it.id).remaining : 0);
    const mv = document.getElementById('moveForm');
    if (mv) guard(mv, [{ btn: 'button[type="submit"]', missing: (f) => {
      const e = f.elements;
      const src = pick(e.from.value);
      const amt = Number(e.amount.value || 0);
      return [!e.from.value && 'โยกจาก', !e.to.value && 'ไปยัง', e.from.value && e.from.value === e.to.value && 'ต้นทางและปลายทางต้องต่างกัน',
        !(amt > 0) && 'จำนวนเงิน', amt > 0 && src.it && amt > remainOf(src) + 0.005 && 'ต้นทางคงเหลือไม่พอ (' + money(remainOf(src)) + ')',
        amt > 0 && src.it && round2(itemTotal(src.it) - amt) < allocatedOf(src.b, src.it) - 0.005 && 'โยกออกแล้วต่ำกว่าวงเงินที่จัดสรรให้ Item ย่อย (' + money(allocatedOf(src.b, src.it)) + ')', !filled(e.reason) && 'เหตุผล'];
    } }]);
    const cb = document.getElementById('cutBudgetForm');
    if (cb) guard(cb, [{ btn: 'button[type="submit"]', missing: (f) => {
      const e = f.elements;
      const t = pick(e.target.value);
      const amt = Number(e.amount.value || 0);
      return [!e.target.value && 'รายการ', !(amt > 0) && 'จำนวนที่ลด', amt > 0 && t.it && amt > remainOf(t) + 0.005 && 'ลดได้ไม่เกินคงเหลือ ' + money(remainOf(t)),
        amt > 0 && t.it && round2(itemTotal(t.it) - amt) < allocatedOf(t.b, t.it) - 0.005 && 'ลดแล้วต่ำกว่าวงเงินที่จัดสรรให้ Item ย่อย (' + money(allocatedOf(t.b, t.it)) + ')', !filled(e.reason) && 'เหตุผล'];
    } }]);
  }

  function notFound() {
    return '<div class="card empty">ไม่พบข้อมูลที่ต้องการ</div>';
  }

  // ---------------------------------------------------------------- router

  // ---- ปุ่มย้อนกลับ: กลับไปหน้าก่อนหน้าที่ผู้ใช้เปิดมาจริง ๆ (ใช้ stack ของตัวเอง แทน history ของเบราว์เซอร์
  //      เพราะหลังส่งฟอร์ม history จะพากลับไปหน้าฟอร์มเดิม) ถ้าไม่มีหน้าก่อนหน้า (เปิดลิงก์ตรง) จะกลับไปหน้า "ต้นทาง" ตามชนิดหน้า
  const NAV_KEY = DB_KEY + '.nav';
  const NAV_MAX = 40;
  let navStack = [];
  try { navStack = JSON.parse(sessionStorage.getItem(NAV_KEY) || '[]'); } catch (err) { navStack = []; }
  if (!Array.isArray(navStack)) navStack = [];

  const navPath = (hash) => hash.split('?')[0];
  /** หน้าฟอร์ม (สร้าง/แก้ไข) ไม่ใช่ที่ที่ควรย้อนกลับมา — หลังส่งหรือยกเลิกแล้วจะถูกตัดออกจาก stack */
  function isFormHash(hash) {
    const p = navPath(hash).slice(2).split('/');
    return (p[0] === 'budget' && (p[1] === 'new' || p[1] === 'import' || p[2] === 'edit' || p[2] === 'items' || p[2] === 'cashflow' || p[2] === 'gl' || p[2] === 'breakdown')) || (p[0] === 'request' && (p[1] === 'new' || p[2] === 'edit')) ||
      (p[0] === 'change' && (p[1] === 'new' || p[2] === 'edit')) || p[0] === 'adjust';
  }
  /** หน้าที่อ้างถึงข้อมูลที่ถูกลบไปแล้วไม่ใช้เป็นปลายทางย้อนกลับ */
  function navValid(hash) {
    const p = navPath(hash).slice(2).split('/');
    if (p[0] === 'budget' && p[1] !== 'new' && p[1] !== 'import') return !!budgetById(p[1]);
    if (p[0] === 'request' && p[1] !== 'new') return !!requestById(p[1]);
    if (p[0] === 'doc') return !!requestById(p[1]);
    if (p[0] === 'change' && p[1] !== 'new') return !!changeById(p[1]);
    return true;
  }
  function trackNav(here) {
    navStack = navStack.filter(navValid);
    const top = navStack[navStack.length - 1];
    if (top !== here) {
      if (navStack.length > 1 && navStack[navStack.length - 2] === here) {
        navStack.pop(); // ย้อนกลับ (ปุ่มย้อนกลับหรือปุ่มย้อนของเบราว์เซอร์)
      } else {
        if (top && isFormHash(top)) navStack.pop();
        const prevTop = navStack[navStack.length - 1];
        if (prevTop && navPath(prevTop) === navPath(here)) navStack.pop(); // หน้าเดิมแต่เปลี่ยนแท็บ/ตัวกรอง
        navStack.push(here);
      }
      if (navStack.length > NAV_MAX) navStack = navStack.slice(-NAV_MAX);
    }
    try { sessionStorage.setItem(NAV_KEY, JSON.stringify(navStack)); } catch (err) { /* ignore */ }
  }
  const previousPage = () => (navStack.length > 1 ? navStack[navStack.length - 2] : null);

  const LIST_PAGES = ['export', 'dashboard', 'master', 'admin', 'adjust', 'tasks', 'history', 'po', 'cuts', 'log', 'gl', 'assumptions', 'budgets', 'my-budgets', 'requests', 'approvals', 'accounting', 'payments'];
  let lastBudgetList = null; // หน้ารายการงบล่าสุด (จำแท็บ/ตัวกรอง)
  let lastRequestParent = null; // หน้าที่เปิดคำขอมาล่าสุด: รายการคำขอ / รอตรวจสอบ / งวดจ่าย / หน้ารายละเอียดงบ

  function backLabel(hash) {
    const p = hash.slice(2).split('?')[0].split('/');
    if (p[0] === 'budget') {
      const b = budgetById(p[1]);
      return b ? b.code + ' ' + b.name : 'งบประมาณ';
    }
    if (p[0] === 'request') {
      if (p[1] === 'new') return 'ขอเบิกใช้งบ';
      const r = requestById(p[1]);
      return r ? 'คำขอ ' + r.no : 'คำขอ';
    }
    if (p[0] === 'doc') {
      const r = requestById(p[1]);
      return r && r.docNo ? 'เอกสาร ' + r.docNo : 'เอกสาร';
    }
    const titles = {
      dashboard: 'รายงาน', master: 'ข้อมูลหลัก',
      admin: 'ผู้ใช้และสิทธิ์',
      budgets: can('budget.manage') ? 'จัดการงบประมาณ' : 'งบประมาณ', 'my-budgets': 'งบประมาณ',
      requests: 'รายการเบิกใช้งบ',
      tasks: 'งานทั้งหมด', approvals: 'งานทั้งหมด', accounting: 'งานทั้งหมด', payments: 'งานทั้งหมด', po: 'งานทั้งหมด', cuts: 'งานทั้งหมด',
      history: 'ประวัติการทำรายการ', adjust: 'ปรับปรุงงบ', log: 'Log การทำงาน', assumptions: 'สิ่งที่รอยืนยัน'
    };
    if (p[0] === 'change') {
      const c = changeById(p[1]);
      return c ? 'คำขอเพิ่มงบ ' + c.no : 'คำขอเพิ่มงบ';
    }
    return titles[p[0]] || 'กลับ';
  }

  /** ปลายทางของปุ่มย้อนกลับ ตามชนิดหน้า (null = หน้ารายการ ไม่ต้องมีปุ่ม) */
  function backTarget(parts) {
    const budgetList = lastBudgetList || (canViewAll() ? '#/budgets' : '#/my-budgets');
    if (parts[0] === 'budget' && (parts[1] === 'new' || parts[1] === 'import')) return budgetList;
    if (parts[0] === 'budget' && (parts[2] === 'edit' || parts[2] === 'form' || parts[2] === 'items' || parts[2] === 'cashflow' || parts[2] === 'gl' || parts[2] === 'memo' || parts[2] === 'breakdown')) return '#/budget/' + parts[1];
    if (parts[0] === 'budget') return budgetList;
    if (parts[0] === 'request' && parts[1] === 'new') return '#/budget/' + parts[2];
    if (parts[0] === 'request' && (parts[2] === 'edit' || parts[2] === 'memo')) return '#/request/' + parts[1];
    if (parts[0] === 'request') return lastRequestParent || '#/requests';
    if (parts[0] === 'doc') return '#/request/' + parts[1];
    if (parts[0] === 'adjust') {
      const q = new URLSearchParams(location.hash.split('?')[1] || '');
      const bid = q.get('budget') || q.get('to');
      return bid && budgetById(bid) ? '#/budget/' + bid : budgetList;
    }
    if (parts[0] === 'change' && parts[1] === 'new') return '#/budget/' + parts[2];
    if (parts[0] === 'change' && parts[2] === 'edit') return '#/change/' + parts[1];
    if (parts[0] === 'change') { const c = changeById(parts[1]); return c ? '#/budget/' + c.budgetId : budgetList; }
    return null;
  }

  function render() {
    if (REMOTE && !remoteMe) return; // ยังไม่ได้ล็อกอิน
    if (AUTH_REMOTE && !accountsReady) return; // รอตรวจ session / โหลดบัญชี (หน้าล็อกอินแสดงโดย init / enterAccounts)
    if (!REMOTE) {
      // โหมดทดลอง: ต้องล็อกอินก่อน (บัญชีที่ถูกปิดการใช้งานจะถูกออกจากระบบทันที)
      const cur = user(currentUserId);
      if (!cur || cur.active === false) { showLoginDemo('login'); return; }
      document.body.classList.remove('auth-screen');
      initUserMenu();
    }
    const hash = location.hash || homeFor(me());
    const [path, query] = hash.slice(1).split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) { location.replace(homeFor(me())); return; }
    const app = document.getElementById('app');
    let html;

    // บริษัทนอกขอบเขตของผู้ใช้: เปิดงบ / คำขอ / เอกสาร / คำขอเพิ่มงบ ของบริษัทอื่นไม่ได้
    const guardCo = () => {
      const sc = companyScope();
      if (!sc) return null;
      let b = null;
      if (parts[0] === 'budget' && parts[1] && !['new', 'import'].includes(parts[1])) b = budgetById(parts[1]);
      else if ((parts[0] === 'request' || parts[0] === 'doc') && parts[1] && parts[1] !== 'new') { const r = requestById(parts[1]); b = r && budgetById(r.budgetId); }
      else if (parts[0] === 'change' && parts[1] && parts[1] !== 'new') { const c = changeById(parts[1]); b = c && budgetById(c.budgetId); }
      return b && !scopeOk(b.company) ? b.company : null;
    };
    const outCo = guardCo();

    if (outCo) html = '<div class="alert error">ไม่มีสิทธิ์ดูข้อมูลของบริษัท ' + esc(outCo) + ' — บัญชีของคุณดูได้เฉพาะบริษัท ' + esc(companyScope().join(', ') || '(ยังไม่ได้กำหนด)') + ' · ติดต่อผู้ดูแลระบบหากต้องการเพิ่มสิทธิ์</div>';
    else if (parts[0] === 'dashboard') html = viewDashboard(params);
    else if (parts[0] === 'master') html = viewMaster(parts[1]);
    else if (parts[0] === 'admin') html = viewAdmin(params);
    else if (parts[0] === 'account') html = viewAccount();
    else if (parts[0] === 'budgets' || parts[0] === 'my-budgets') html = viewBudgets(params, parts[0] === 'my-budgets');
    else if (parts[0] === 'budget' && parts[1] === 'new') html = viewBudgetForm(null, params);
    else if (parts[0] === 'budget' && parts[1] === 'import') html = viewImport();
    else if (parts[0] === 'budget' && parts[2] === 'memo') html = viewOpenMemo(parts[1], params);
    else if (parts[0] === 'budget' && parts[2] === 'edit') html = viewBudgetForm(parts[1]);
    else if (parts[0] === 'budget' && parts[2] === 'form') html = viewBudgetRequestForm(parts[1]);
    else if (parts[0] === 'budget' && parts[2] === 'items') html = viewSubItems(parts[1]);
    else if (parts[0] === 'budget' && parts[2] === 'cashflow') html = viewCashflow(parts[1]);
    else if (parts[0] === 'budget' && parts[2] === 'breakdown') html = viewBreakdown(parts[1]);
    else if (parts[0] === 'budget' && parts[2] === 'gl') html = viewGl(parts[1]);
    else if (parts[0] === 'budget') html = viewBudgetDetail(parts[1]);
    else if (parts[0] === 'request' && parts[1] === 'new') html = viewRequestForm(parts[2], null, params);
    else if (parts[0] === 'request' && parts[2] === 'edit') html = viewRequestForm(null, parts[1], params);
    else if (parts[0] === 'request' && parts[2] === 'memo') html = viewRequestMemo(parts[1], params);
    else if (parts[0] === 'request') html = viewRequestDetail(parts[1]);
    else if (parts[0] === 'requests') html = viewRequests();
    else if (parts[0] === 'change' && parts[1] === 'new') html = viewChangeForm(parts[2], null);
    else if (parts[0] === 'change' && parts[2] === 'edit') html = viewChangeForm(null, parts[1]);
    else if (parts[0] === 'change') html = viewChangeDetail(parts[1]);
    else if (parts[0] === 'adjust') html = viewAdjust(params);
    else if (parts[0] === 'tasks') html = viewTasks(params);
    else if (OLD_TASK_ROUTES[parts[0]]) html = viewTasks(params, parts[0]);
    else if (parts[0] === 'history') html = viewHistory(params);
    else if (parts[0] === 'log') html = viewLog(params);
    else if (parts[0] === 'gl') html = viewGlQueue();
    else if (parts[0] === 'assumptions') html = viewAssumptions();
    else if (parts[0] === 'export') html = viewExport();
    else if (parts[0] === 'doc') html = viewDocument(parts[1]);
    else html = notFound();

    const here = '#' + path + (query ? '?' + query : '');
    trackNav(here);
    const fallback = backTarget(parts);
    const back = fallback && (previousPage() || fallback);
    if (back) html = '<div class="back-bar no-print"><a class="back-link" href="' + esc(back) + '">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      esc(backLabel(back)) + '</a></div>' + html;
    if (parts[0] === 'budgets' || parts[0] === 'my-budgets') lastBudgetList = here;
    if (LIST_PAGES.includes(parts[0]) || (parts[0] === 'budget' && parts.length === 2 && parts[1] !== 'new' && parts[1] !== 'import')) lastRequestParent = here;

    renderNav('#' + path);
    if (AUTH_REMOTE && schemaStale) {
      html = '<div class="alert warn" id="schemaWarn">ฐานข้อมูลยังไม่อัปเดตให้ตรงกับเว็บเวอร์ชันนี้ — บางฟังก์ชันอาจใช้ไม่ได้หรือขึ้นข้อผิดพลาด ' +
        (can('user.manage') ? '· ผู้ดูแลระบบ: รันไฟล์ <code>supabase/schema_v2_all.sql</code> ใหม่ใน Supabase SQL Editor (ดู supabase/SETUP-v2.md ขั้นตอน 2) แล้วรีเฟรชหน้านี้' : '· แจ้งผู้ดูแลระบบให้อัปเดตฐานข้อมูล') + '</div>' + html;
    }
    app.innerHTML = html;
    // ปุ่ม "ยกเลิก" ในฟอร์มกลับไปหน้าก่อนหน้าเช่นเดียวกับปุ่มย้อนกลับ
    if (back) app.querySelectorAll('[data-back]').forEach((a) => { a.setAttribute('href', back); });
    bindBudgetForm();
    bindBudgetDetail();
    bindChangeForm();
    bindSubItems();
    bindMemoDoc();
    bindCashflow();
    bindBreakdown();
    bindOpenPick();
    bindCashflowTask();
    bindGl();
    bindImport();
    bindExport();
    bindChangeDetail();
    bindAdjust();
    bindLog();
    bindHistory();
    bindGuards();
    bindDashboard();
    bindMaster();
    bindAdmin();
    bindAccount();
    bindRequestForm();
    bindCuts();
    bindRequestDetail();
    bindBudgetFilters();
    document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
  }

  /**
   * GitHub Pages ให้เบราว์เซอร์เก็บ cache หน้าเว็บได้ราว 10 นาที จึงเช็กเลขเวอร์ชันจากเซิร์ฟเวอร์โดยตรง
   * ถ้าเลขใน index.html บนเซิร์ฟเวอร์ใหม่กว่าหน้าที่เปิดอยู่ จะโหลดหน้าใหม่ให้เอง (ข้อมูลใน localStorage ไม่หาย)
   */
  function checkForUpdate() {
    const meta = document.querySelector('meta[name="app-version"]');
    if (!meta || !window.fetch || location.protocol === 'file:') return;
    fetch('index.html?check=' + Date.now(), { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        const m = html.match(/<meta name="app-version" content="([^"]+)"/);
        const url = new URL(location.href);
        // กันโหลดวนซ้ำ: ถ้าเคยพาไปที่ ?v=เวอร์ชันนี้แล้ว ไม่ต้องโหลดอีก
        if (!m || m[1] === meta.content || url.searchParams.get('v') === m[1]) return;
        url.searchParams.set('v', m[1]);
        location.replace(url.toString());
      })
      .catch(() => { /* ออฟไลน์หรือเช็กไม่ได้ ใช้หน้าเดิมต่อ */ });
  }

  function renderUserButton() {
    document.getElementById('userName').textContent = me().name;
    document.getElementById('userPos').textContent = [me().title, deptsOf(me()).join(', ')].filter(Boolean).join(' · ');
  }

  /** เมนูผู้ใช้มุมขวาบน: บัญชีของฉัน / ออกจากระบบ (โหมดทดลองมีเครื่องมือล้างข้อมูลทดสอบเพิ่ม) */
  function initUserMenu() {
    if (userMenuReady) { renderUserButton(); return; }
    userMenuReady = true;
    const btn = document.getElementById('userBtn');
    const menu = document.getElementById('userMenu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    const fill = () => {
      const who = '<div class="menu-label">เข้าสู่ระบบในฐานะ</div><div class="menu-user"><strong>' + esc(me().name) + '</strong><small>' +
        esc([me().title, roleLabel(me())].filter(Boolean).join(' · ')) + '</small>' +
        (me().email ? '<small>' + esc(me().email) + '</small>' : '') + '</div><hr>';
      menu.innerHTML = who + (REMOTE ? '' : '<button type="button" role="menuitem" data-account>บัญชีของฉัน</button>') +
        (REMOTE || AUTH_REMOTE ? '' : '<button type="button" role="menuitem" class="danger" data-clear-all>ล้างข้อมูลทดสอบ (งบ คำขอ เอกสาร Log)</button><button type="button" role="menuitem" data-reset>โหลดข้อมูลตัวอย่าง</button><hr>') +
        '<button type="button" role="menuitem" data-logout>ออกจากระบบ</button>';
    };
    renderUserButton();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu.hidden) { close(); return; }
      fill();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('button');
      if (!item) return;
      e.stopPropagation();
      close();
      if (item.hasAttribute('data-logout')) { logout(); return; }
      if (item.hasAttribute('data-account')) { go('#/account'); return; }
      if (item.hasAttribute('data-clear-all')) {
        if (!confirm('ล้างข้อมูลทดสอบ (งบ คำขอ เอกสาร ไฟล์แนบ Log) เพื่อเริ่มทดสอบใหม่? — ข้อมูลหลักและบัญชีผู้ใช้ยังอยู่')) return;
        db = emptyDb(db.master);
        navStack = [];
        save();
      } else if (item.hasAttribute('data-reset')) {
        if (!confirm('แทนที่ข้อมูลงบทั้งหมดด้วยข้อมูลตัวอย่าง? — บัญชีผู้ใช้ยังอยู่')) return;
        db = seed();
        navStack = [];
        save();
      }
      go(homeFor(me()));
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // ---------------------------------------------------------------- เข้าสู่ระบบ (โหมดทดลอง: อีเมล + รหัสผ่านที่ผู้ใช้ตั้งเอง)

  const authField = (label, name, type, extra) => '<label class="field"><span>' + label + '</span><input name="' + name + '" type="' + type + '" ' + (extra || '') + ' required></label>';
  const authLinks = (items) => '<div class="actions auth-links">' + items.map((x) => '<button type="button" class="btn small" data-auth-mode="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';

  /** หน้าเข้าสู่ระบบโหมดทดลอง: mode = login | set (ตั้งรหัสผ่าน) | forgot (ลืมรหัสผ่าน) */
  function showLoginDemo(mode, opts) {
    opts = opts || {};
    document.body.classList.add('auth-screen');
    const notice = (opts.error ? '<div class="alert error" role="alert">' + esc(opts.error) + '</div>' : '') + (opts.info ? '<div class="alert info">' + esc(opts.info) + '</div>' : '');
    const emailVal = opts.email ? ' value="' + esc(opts.email) + '"' : '';
    let inner;
    if (AUTH_REMOTE && mode === 'set') mode = 'activate';
    if (mode === 'activate') {
      inner = '<h1>เปิดใช้ครั้งแรก</h1><p class="muted">กรอกอีเมลของคุณ ระบบจะตรวจว่าผู้ดูแลระบบเพิ่มอีเมลนี้แล้วหรือยัง — ถ้าเพิ่มแล้วและยังไม่เคยตั้งรหัสผ่าน คุณจะตั้งรหัสผ่านของตัวเองได้ (ใช้ตั้งรหัสผ่านใหม่หลังผู้ดูแลระบบรีเซ็ตให้ด้วย)</p>' + notice +
        '<form id="authForm" data-mode="activate">' + authField('อีเมล', 'email', 'email', 'autocomplete="username"' + emailVal) +
        '<button class="btn primary tall" type="submit">ตรวจสอบอีเมล</button></form>' + authLinks([['login', 'กลับไปเข้าสู่ระบบ']]);
    } else if (mode === 'activate-pw') {
      inner = '<h1>ตั้งรหัสผ่าน</h1><p class="muted">ตั้งรหัสผ่านของคุณเอง (ผู้ดูแลระบบไม่เห็นรหัสผ่านนี้)</p>' + notice +
        '<form id="authForm" data-mode="activate-pw">' + authField('อีเมล', 'email', 'email', 'readonly autocomplete="username"' + emailVal) +
        authField('รหัสผ่านใหม่', 'password', 'password', 'autocomplete="new-password" minlength="' + PW_MIN + '"') +
        authField('ยืนยันรหัสผ่านใหม่', 'confirm', 'password', 'autocomplete="new-password"') +
        '<p class="muted small-note">อย่างน้อย ' + PW_MIN + ' ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>' +
        '<button class="btn primary tall" type="submit">ตั้งรหัสผ่านและเข้าสู่ระบบ</button></form>' + authLinks([['activate', 'ใช้อีเมลอื่น'], ['login', 'กลับไปเข้าสู่ระบบ']]);
    } else if (mode === 'set') {
      inner = '<h1>ตั้งรหัสผ่าน</h1><p class="muted">ใช้ตั้งรหัสผ่านครั้งแรก หรือตั้งรหัสผ่านใหม่หลังผู้ดูแลระบบรีเซ็ตให้ — ใช้อีเมลที่ผู้ดูแลระบบเพิ่มไว้</p>' + notice +
        '<form id="authForm" data-mode="set">' + authField('อีเมล', 'email', 'email', 'autocomplete="username"' + emailVal) +
        authField('รหัสผ่านใหม่', 'password', 'password', 'autocomplete="new-password" minlength="' + PW_MIN + '"') +
        authField('ยืนยันรหัสผ่านใหม่', 'confirm', 'password', 'autocomplete="new-password"') +
        '<p class="muted small-note">อย่างน้อย ' + PW_MIN + ' ตัวอักษร มีทั้งตัวอักษรและตัวเลข</p>' +
        '<button class="btn primary tall" type="submit">ตั้งรหัสผ่านและเข้าสู่ระบบ</button></form>' + authLinks([['login', 'กลับไปเข้าสู่ระบบ']]);
    } else if (mode === 'forgot') {
      inner = '<h1>ลืมรหัสผ่าน</h1><p class="muted">แจ้งผู้ดูแลระบบให้รีเซ็ตรหัสผ่านให้ เมื่อรีเซ็ตแล้วให้กลับมา' + (AUTH_REMOTE ? 'กด "เปิดใช้ครั้งแรก" แล้วตั้ง' : 'ตั้ง') + 'รหัสผ่านใหม่ด้วยตัวเอง</p>' + notice +
        (opts.sent ? '' : '<form id="authForm" data-mode="forgot">' + authField('อีเมลของคุณ', 'email', 'email', 'autocomplete="username"' + emailVal) +
          '<button class="btn primary tall" type="submit">แจ้งผู้ดูแลระบบให้รีเซ็ต</button></form>') +
        authLinks(opts.sent ? [['set', AUTH_REMOTE ? 'เปิดใช้ครั้งแรก / ตั้งรหัสผ่านใหม่' : 'ตั้งรหัสผ่านใหม่'], ['login', 'กลับไปเข้าสู่ระบบ']] : [['login', 'กลับไปเข้าสู่ระบบ']]);
    } else {
      const quick = DEMO_QUICK_LOGIN && !AUTH_REMOTE ? '<details class="auth-demo"><summary>โหมดทดลอง: เข้าด้วยบัญชีตัวอย่าง (ข้ามรหัสผ่าน)</summary><div class="auth-demo-list">' +
        activeUsers().map((x) => '<button type="button" class="btn small" data-quick="' + esc(x.id) + '">' + esc(x.name) + ' — ' + esc(roleLabel(x)) + '</button>').join('') + '</div></details>' : '';
      inner = '<h1>เข้าสู่ระบบ</h1><p class="muted">ระบบขอเบิกใช้งบประมาณ</p>' + notice +
        '<form id="authForm" data-mode="login">' + authField('อีเมล', 'email', 'email', 'autocomplete="username"' + emailVal) +
        authField('รหัสผ่าน', 'password', 'password', 'autocomplete="current-password"') +
        '<button class="btn primary tall" type="submit">เข้าสู่ระบบ</button></form>' +
        authLinks(AUTH_REMOTE ? [['activate', 'เปิดใช้ครั้งแรก (ตั้งรหัสผ่าน)'], ['forgot', 'ลืมรหัสผ่าน']] : [['set', 'ตั้งรหัสผ่าน (ครั้งแรก / หลังรีเซ็ต)'], ['forgot', 'ลืมรหัสผ่าน']]) +
        '<p class="muted small-note">' + (AUTH_REMOTE ? 'บัญชีผู้ใช้เพิ่มโดยผู้ดูแลระบบ — ถ้าเพิ่งได้รับสิทธิ์ ให้กด "เปิดใช้ครั้งแรก" แล้วกรอกอีเมลของคุณ' : 'บัญชีผู้ใช้เพิ่มโดยผู้ดูแลระบบ — ถ้าไม่มีอีเมลในระบบ ให้แจ้งผู้ดูแลระบบ') + '</p>' + quick;
    }
    authShell('<div class="card auth-card" id="authCard">' + inner + '</div>');
    const card = document.getElementById('authCard');
    card.querySelectorAll('[data-auth-mode]').forEach((b) => b.addEventListener('click', () => {
      const f = document.getElementById('authForm');
      showLoginDemo(b.dataset.authMode, { email: f && f.elements.email ? f.elements.email.value.trim() : (opts.email || '') });
    }));
    card.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => enterDemo(user(b.dataset.quick), '')));
    const form = document.getElementById('authForm');
    if (form) {
      const first = form.elements.email ? (form.elements.email.value ? form.elements.password || form.elements.confirm : form.elements.email) : form.elements.password;
      if (first) first.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        const email = form.elements.email ? form.elements.email.value.trim() : '';
        const m = form.dataset.mode;
        try {
          if (AUTH_REMOTE) { await remoteAuthSubmit(m, form, email); return; }
          if (m === 'forgot') {
            authRequestReset(email);
            showLoginDemo('forgot', { sent: true, email, info: 'ส่งคำขอถึงผู้ดูแลระบบแล้ว — เมื่อผู้ดูแลระบบรีเซ็ตรหัสผ่านให้ ให้กด "ตั้งรหัสผ่านใหม่" แล้วกรอกอีเมลกับรหัสผ่านใหม่' });
            return;
          }
          if (m === 'set') {
            if (form.elements.password.value !== form.elements.confirm.value) { showLoginDemo('set', { email, error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }); return; }
            const r = await authSetPassword(email, form.elements.password.value);
            if (r.error) { showLoginDemo(r.error === 'has_password' ? 'login' : 'set', { email, error: r.message }); return; }
            enterDemo(r.user, 'ตั้งรหัสผ่านเรียบร้อย ยินดีต้อนรับ');
            return;
          }
          const r = await authLogin(email, form.elements.password.value);
          if (r.error === 'needs_password') { showLoginDemo('set', { email, info: r.message }); return; }
          if (r.error) { showLoginDemo('login', { email, error: r.message }); return; }
          enterDemo(r.user, '');
        } catch (err) {
          showLoginDemo(m, { email, error: 'เกิดข้อผิดพลาด: ' + ((err && err.message) || err) });
        }
      });
    }
  }


  // ---------------------------------------------------------------- ซิงก์ข้อมูลงบกับ Supabase (เฟส 2a)
  // เก็บเป็นเอกสารรายตัว (budget / request / change) + Log · ฟังก์ชันบนฐานข้อมูล v2_load / v2_save_docs (supabase/schema_v2b.sql)
  // ข้อมูลหลัก (db.master) ไม่อยู่ในชั้นนี้ — เก็บแยกที่ v2_master (loadRemoteMaster / bindMaster)
  // แอปแก้ข้อมูลใน db แล้วเรียก save() ตามเดิม → save() ตั้งเวลาให้ syncPush() ส่งเฉพาะเอกสารที่เปลี่ยน (เทียบกับ snapshot ล่าสุดที่ตรงกับเซิร์ฟเวอร์)
  // เลขเวอร์ชันสคีมาที่เว็บนี้ต้องการ — ต้องเท่ากับ v2_schema_version() ใน supabase/schema_v2b.sql (ตรวจด้วย supabase/tests/check_schema.js)
  const SCHEMA_VERSION = 5;
  let schemaStale = false; // ฐานข้อมูลยังไม่ได้รันสคีมาล่าสุด → แสดงแถบเตือน
  async function checkSchemaVersion() {
    try {
      schemaStale = Number(await window.RemoteApi.v2SchemaVersion()) < SCHEMA_VERSION;
    } catch (e) {
      // ไม่มีฟังก์ชันนี้ (404) = ยังไม่เคยรันสคีมารุ่นที่มีเลขเวอร์ชัน · ข้อผิดพลาดอื่น (ออฟไลน์ ฯลฯ) ไม่ถือว่าเก่า
      schemaStale = !!(e && (e.status === 404 || e.code === 'PGRST202'));
    }
  }
  const SYNC_KINDS = [['budget', 'budgets'], ['request', 'requests'], ['change', 'changes']];
  const sync = { docs: new Map(), since: null, timer: null, retryTimer: null, pollTimer: null, inflight: false, again: false, status: 'idle', error: '' };
  const syncKey = (kind, id) => kind + ':' + id;
  const tokenRe = /@@NO:[A-Z]{2,10}-[0-9]{4}:[A-Za-z0-9]{4,24}@@/g;

  /** เอกสารทั้งหมดในหน่วยความจำ → [{kind,id,obj}] */
  function syncCollect() {
    const out = [];
    SYNC_KINDS.forEach(([kind, col]) => (db[col] || []).forEach((o) => { if (o && o.id) out.push({ kind, id: o.id, obj: o }); }));
    return out;
  }
  const logMeta = (e) => {
    const l = refLink(e.ref);
    let company = '';
    const m = /^#\/(budget|request|change)\/(.+)$/.exec(l.href || '');
    if (m) {
      const doc = m[1] === 'budget' ? budgetById(m[2]) : m[1] === 'request' ? requestById(m[2]) : (db.changes || []).find((c) => c.id === m[2]);
      const b = m[1] === 'budget' ? doc : doc && budgetById(doc.budgetId);
      company = (b && b.company) || '';
    }
    return { company, ownerId: l.owner || '' };
  };
  /** สิ่งที่ต้องส่ง: เอกสารใหม่/ที่เปลี่ยน/ที่ถูกลบ + Log ที่ยังไม่ได้ส่ง */
  function syncDiff() {
    const docs = [];
    const jsons = new Map();
    const seen = new Set();
    syncCollect().forEach(({ kind, id, obj }) => {
      const key = syncKey(kind, id);
      seen.add(key);
      const json = JSON.stringify(obj);
      const snap = sync.docs.get(key);
      if (snap && snap.json === json) return;
      docs.push({ kind, id, version: snap ? snap.version : 0, data: obj });
      jsons.set(key, json);
    });
    sync.docs.forEach((snap, key) => {
      if (seen.has(key)) return;
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      docs.push({ kind, id, version: snap.version, deleted: true });
    });
    const entries = (db.log || []).filter((x) => x.id == null);
    const log = entries.map((e) => Object.assign({ action: e.action, ref: e.ref, detail: e.detail }, logMeta(e)));
    return { docs, jsons, entries, log };
  }
  const syncDirty = () => { try { const d = syncDiff(); return d.docs.length > 0 || d.log.length > 0; } catch (e) { return false; } };

  function replaceTokensDeep(o, map) {
    if (o && typeof o === 'object') {
      Object.keys(o).forEach((k) => {
        const v = o[k];
        if (typeof v === 'string') { if (v.indexOf('@@NO:') >= 0) o[k] = v.replace(tokenRe, (t) => map[t] || t); } else replaceTokensDeep(v, map);
      });
    }
  }
  const replaceTokensStr = (str, map) => str.replace(tokenRe, (t) => map[t] || t);

  function syncSchedule() {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(syncPush, 300);
  }

  async function syncPush() {
    clearTimeout(sync.timer);
    if (!AUTH_REMOTE || !accountsReady) return;
    if (sync.inflight) { sync.again = true; return; }
    const batch = syncDiff();
    if (!batch.docs.length && !batch.log.length) { syncStatus('idle'); return; }
    sync.inflight = true;
    syncStatus('saving');
    let res;
    try {
      res = await window.RemoteApi.v2SaveDocs(batch.docs, batch.log);
    } catch (e) {
      sync.inflight = false;
      await syncPushFailed(e);
      return;
    }
    sync.inflight = false;
    const tokens = res.tokens || {};
    const hasTokens = Object.keys(tokens).length > 0;
    res.docs.forEach((d) => {
      const key = syncKey(d.kind, d.id);
      const del = batch.docs.find((x) => x.kind === d.kind && x.id === d.id && x.deleted);
      if (del) sync.docs.delete(key); else sync.docs.set(key, { version: d.version, json: replaceTokensStr(batch.jsons.get(key), tokens) });
    });
    if (hasTokens) {
      SYNC_KINDS.forEach(([, col]) => (db[col] || []).forEach((o) => replaceTokensDeep(o, tokens)));
      batch.entries.forEach((e) => replaceTokensDeep(e, tokens));
    }
    batch.entries.forEach((e, i) => { const at = db.log.indexOf(e); if (at >= 0 && res.log[i]) db.log[at] = res.log[i]; });
    sync.error = '';
    if (sync.again || syncDirty()) { sync.again = false; syncSchedule(); } else syncStatus('idle');
    if (hasTokens) syncRerender();
  }

  async function syncPushFailed(e) {
    const msg = (e && e.message) || '';
    if (e && e.code === 'AUTH') { syncStatus('idle'); logoutDemo(); showLoginDemo('login', { error: e.message }); return; }
    if (/CONFLICT/.test(msg)) {
      // มีผู้อื่นแก้เอกสารเดียวกันไปก่อน → โหลดข้อมูลล่าสุดมาแทน (การแก้ไขที่ยังไม่ถูกบันทึกของเรื่องนั้นหายไป)
      syncStatus('conflict');
      try { await syncPull(true); } catch (err) { /* แสดงสถานะ conflict ต่อ */ }
      syncRerender(true);
      return;
    }
    if (e && e.code === 'NETWORK') {
      syncStatus('retry', msg);
      clearTimeout(sync.retryTimer);
      sync.retryTimer = setTimeout(syncPush, 8000);
      return;
    }
    syncStatus('error', msg);
  }

  /** โหลดเอกสารจากเซิร์ฟเวอร์: full = ทั้งหมด (แทนที่ในเครื่อง) · ไม่ใช่ = เฉพาะที่เปลี่ยนตั้งแต่ครั้งก่อน คืน true ถ้ามีอะไรเปลี่ยน */
  async function syncPull(full) {
    const res = await window.RemoteApi.v2Load(full ? null : sync.since);
    let changed = false;
    if (full) {
      const shell = emptyDb();
      shell.budgets = []; shell.requests = []; shell.changes = []; shell.log = [];
      shell.master = db.master; // ข้อมูลหลักโหลดแยก (loadRemoteMaster) — ไม่แตะ
      SYNC_KINDS.forEach(([kind, col]) => { shell[col] = res.docs.filter((d) => d.kind === kind).map((d) => d.data); });
      shell.log = res.log.slice();
      db = migrate(shell);
      sync.docs = new Map();
      res.docs.forEach((d) => sync.docs.set(syncKey(d.kind, d.id), { version: d.version, json: '' }));
      changed = true;
    } else {
      res.docs.forEach((d) => {
        const key = syncKey(d.kind, d.id);
        const snap = sync.docs.get(key);
        if (snap && snap.version === d.version) return; // ของเราเอง / ไม่เปลี่ยน
        const col = (SYNC_KINDS.find(([k]) => k === d.kind) || [])[1];
        const list = col ? db[col] : null;
        if (!list) return; // ชนิดที่ไม่รู้จัก
        const cur = list.find((o) => o.id === d.id);
        if (cur && snap && JSON.stringify(cur) !== snap.json) return; // มีการแก้ไขในเครื่องที่ยังไม่ได้ส่ง — คงไว้ (ถ้าชนจะแจ้งตอนบันทึก)
        if (d.deleted) {
          if (list && cur) list.splice(list.indexOf(cur), 1);
          sync.docs.delete(key);
          changed = true;
          return;
        }
        if (cur) list[list.indexOf(cur)] = d.data;
        else list.push(d.data);
        sync.docs.set(key, { version: d.version, json: '' });
        changed = true;
      });
      const have = new Set((db.log || []).filter((x) => x.id != null).map((x) => x.id));
      const fresh = res.log.filter((x) => !have.has(x.id));
      if (fresh.length) { db.log = (db.log || []).filter((x) => x.id != null).concat(fresh).concat((db.log || []).filter((x) => x.id == null)); changed = true; }
      if (changed) migrate(db);
    }
    // snapshot = JSON ของข้อมูลในเครื่องหลัง migrate (ให้ตรงกับที่จะเทียบตอนบันทึก — ไม่ใช่ JSON จากเซิร์ฟเวอร์ซึ่งเรียงคีย์ต่างกัน)
    syncCollectAll().forEach(({ kind, id, obj }) => {
      const key = syncKey(kind, id);
      const snap = sync.docs.get(key);
      if (snap && snap.json === '') snap.json = JSON.stringify(obj);
    });
    sync.since = res.now;
    return changed;
  }
  function syncCollectAll() {
    const out = [];
    SYNC_KINDS.forEach(([kind, col]) => (db[col] || []).forEach((o) => { if (o && o.id) out.push({ kind, id: o.id, obj: o }); }));
    return out;
  }

  async function syncPoll() {
    if (!AUTH_REMOTE || !accountsReady || sync.inflight || document.visibilityState !== 'visible') return;
    try {
      let changed = await syncPull(false);
      try { if (await loadRemoteMaster()) changed = true; } catch (e) { if (e && e.code === 'AUTH') throw e; }
      if (changed) syncRerender();
      await loadRemoteRoles();
      await refreshAccounts();
      adminTabsRefresh();
    } catch (e) {
      if (e && e.code === 'AUTH') { logoutDemo(); showLoginDemo('login', { error: e.message }); }
    }
  }
  const adminTabsRefresh = () => { if (accountsReady) renderNav(location.hash.split('?')[0] || ''); };
  function syncStartPolling() {
    if (sync.pollTimer) return;
    sync.pollTimer = setInterval(syncPoll, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPoll(); });
    window.addEventListener('beforeunload', (e) => {
      if (accountsReady && (sync.inflight || syncDirty())) { e.preventDefault(); e.returnValue = ''; }
    });
  }
  /** วาดหน้าใหม่ถ้าไม่ได้กำลังกรอกฟอร์ม (force = วาดเสมอ เช่นหลังโหลดข้อมูลใหม่เพราะชนกัน) */
  function syncRerender(force) {
    if (!accountsReady) return;
    const ae = document.activeElement;
    const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && document.getElementById('app').contains(ae);
    if (!force && (typing || isFormHash(location.hash || ''))) return;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function syncStatus(status, message) {
    sync.status = status;
    let bar = document.getElementById('syncBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'syncBar';
      bar.className = 'sync-bar no-print';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    const retryBtn = '<div class="actions"><button type="button" class="btn small" data-sync-reload>โหลดข้อมูลล่าสุด (ทิ้งการแก้ไขที่ยังไม่ได้บันทึก)</button></div>';
    const html = {
      idle: '',
      saving: '<div class="alert info">กำลังบันทึก…</div>',
      retry: '<div class="alert warn">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — กำลังลองบันทึกใหม่ (อย่าปิดหน้านี้)</div>',
      conflict: '<div class="alert warn">มีผู้อื่นแก้ข้อมูลเดียวกันไปก่อน — โหลดข้อมูลล่าสุดให้แล้ว การแก้ไขล่าสุดของคุณในเรื่องนั้นไม่ถูกบันทึก กรุณาตรวจแล้วทำซ้ำ <button type="button" class="btn small" data-sync-close>ปิด</button></div>',
      error: '<div class="alert error">บันทึกไม่สำเร็จ: ' + esc(message || '') + retryBtn + '</div>'
    }[status] || '';
    bar.innerHTML = html;
    bar.hidden = !html;
    const rl = bar.querySelector('[data-sync-reload]');
    if (rl) rl.addEventListener('click', async () => { try { await syncPull(true); syncStatus('idle'); syncRerender(true); } catch (e) { syncStatus('error', e.message); } });
    const cl = bar.querySelector('[data-sync-close]');
    if (cl) cl.addEventListener('click', () => syncStatus('idle'));
  }
  window.AppSync = { push: syncPush, pull: syncPull, poll: syncPoll, status: () => sync.status, dirty: syncDirty };

  // ---- เข้าสู่ระบบบน Supabase (เฟส 1) ----------------------------------------------------------
  async function remoteAuthSubmit(m, form, email) {
    const api = window.RemoteApi;
    if (m === 'forgot') {
      await api.v2RequestReset(email);
      showLoginDemo('forgot', { sent: true, email, info: 'ส่งคำขอถึงผู้ดูแลระบบแล้ว — เมื่อผู้ดูแลระบบรีเซ็ตรหัสผ่านให้ ให้กด "เปิดใช้ครั้งแรก / ตั้งรหัสผ่านใหม่" แล้วกรอกอีเมลนี้' });
      return;
    }
    if (m === 'activate') {
      // ขั้น 1: ตรวจว่าผู้ดูแลระบบเพิ่มอีเมลนี้แล้วหรือยัง
      let status;
      try { status = await api.v2ActivationStatus(email); } catch (e) { showLoginDemo('activate', { email, error: e.status === 404 ? 'ระบบยังไม่ได้อัปเดตฐานข้อมูลสำหรับขั้นตอนนี้ — แจ้งผู้ดูแลระบบให้รัน schema_v2.sql ใหม่' : e.message }); return; }
      if (status === 'not_found') { showLoginDemo('activate', { email, error: 'ไม่พบอีเมลนี้ในระบบ — ให้ผู้ดูแลระบบเพิ่มอีเมลของคุณก่อน' }); return; }
      if (status === 'inactive') { showLoginDemo('activate', { email, error: 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' }); return; }
      if (status === 'has_password') { showLoginDemo('login', { email, info: 'บัญชีนี้ตั้งรหัสผ่านแล้ว — เข้าสู่ระบบได้เลย ถ้าจำรหัสผ่านไม่ได้ให้กด "ลืมรหัสผ่าน"' }); return; }
      showLoginDemo('activate-pw', { email, info: 'พบอีเมลของคุณในระบบแล้ว — ตั้งรหัสผ่านของคุณเอง' });
      return;
    }
    if (m === 'activate-pw') {
      // ขั้น 2: ตั้งรหัสผ่านของตัวเอง (เซิร์ฟเวอร์ตรวจซ้ำว่ายังไม่เคยตั้ง) แล้วเข้าสู่ระบบ
      const pw = form.elements.password.value;
      if (pw !== form.elements.confirm.value) { showLoginDemo('activate-pw', { email, error: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }); return; }
      const problem = passwordProblem(pw, email);
      if (problem) { showLoginDemo('activate-pw', { email, error: problem }); return; }
      try { await api.activate(email, pw); } catch (e) {
        if (e.status === 409) showLoginDemo('login', { email, info: e.message }); else showLoginDemo('activate-pw', { email, error: e.message });
        return;
      }
      try { await api.signIn(email, pw); } catch (e) { showLoginDemo('login', { email, error: 'ตั้งรหัสผ่านแล้ว แต่เข้าสู่ระบบไม่สำเร็จ: ' + e.message }); return; }
      await enterAccounts('ตั้งรหัสผ่านเรียบร้อย ยินดีต้อนรับ');
      return;
    }
    try { await api.signIn(email, form.elements.password.value); } catch (e) { showLoginDemo('login', { email, error: e.message }); return; }
    await enterAccounts('');
  }

  /** เข้าระบบหลังมี session แล้ว: โหลดโปรไฟล์ สิทธิ์ของบทบาท และรายชื่อผู้ใช้ */
  async function enterAccounts(flashText) {
    const api = window.RemoteApi;
    authShell('<div class="card auth-card"><p class="muted">กำลังเข้าสู่ระบบ…</p></div>');
    let meRow;
    try {
      meRow = await api.v2Me(true);
      if (meRow) {
        currentUserId = meRow.id;
        USERS = [profileToUser(meRow)];
        await loadRemoteRoles();
        await refreshAccounts();
        await loadRemoteMaster(); // ข้อมูลหลักบน Supabase (v2_master)
        await checkSchemaVersion();
        await syncPull(true); // โหลดข้อมูลงบทั้งหมดที่ผู้ใช้เห็น
      }
    } catch (e) {
      if (e && e.code === 'AUTH') { showLoginDemo('login', { error: e.message }); return; }
      authShell('<div class="card auth-card"><h1>เปิดระบบไม่สำเร็จ</h1><div class="alert error">' + esc((e && e.message) || 'เกิดข้อผิดพลาด') + '</div>' +
        '<div class="actions"><button class="btn primary" id="retry">ลองใหม่</button><button class="btn" id="fatalLogout">ออกจากระบบ</button></div></div>');
      document.getElementById('retry').addEventListener('click', () => enterAccounts(flashText));
      document.getElementById('fatalLogout').addEventListener('click', logoutDemo);
      return;
    }
    if (!meRow) {
      authShell('<div class="card auth-card"><h1>บัญชีนี้ใช้งานไม่ได้</h1><p class="muted">ไม่พบบัญชีนี้ในระบบ หรือถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ</p>' +
        '<p><strong>' + esc((api.sessionUser() || {}).email || '') + '</strong></p><div class="actions"><button class="btn" id="pendingLogout">ออกจากระบบ</button></div></div>');
      document.getElementById('pendingLogout').addEventListener('click', logoutDemo);
      return;
    }
    accountsReady = true;
    syncStartPolling();
    syncSchedule(); // ผู้ดูแลระบบเข้าครั้งแรก: สร้างเอกสารข้อมูลหลักตั้งต้นบนเซิร์ฟเวอร์
    lastBudgetList = null;
    lastRequestParent = null;
    navStack = [];
    if (flashText) setFlash('success', flashText);
    render();
  }

  function enterDemo(u, flashText) {
    if (!u) return;
    currentUserId = u.id;
    lastBudgetList = null;
    lastRequestParent = null;
    navStack = [];
    try { localStorage.setItem(DB_KEY + '.user', currentUserId); } catch (e) { /* ignore */ }
    if (flashText) setFlash('success', flashText);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    render();
  }

  function logoutDemo() {
    if (AUTH_REMOTE) {
      window.RemoteApi.signOut();
      accountsReady = false;
      USERS = [];
      clearTimeout(sync.timer); clearTimeout(sync.retryTimer);
      sync.docs = new Map(); sync.since = null; sync.inflight = false; sync.again = false;
      db = emptyDb(); // ไม่ทิ้งข้อมูลของผู้ใช้เดิมไว้ในหน่วยความจำ
      syncStatus('idle');
    } else authLog(me(), 'ออกจากระบบ', '');
    currentUserId = '';
    navStack = [];
    try { localStorage.removeItem(DB_KEY + '.user'); } catch (e) { /* ignore */ }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    showLoginDemo('login');
  }

  // ---------------------------------------------------------------- บัญชีของฉัน (โหมดทดลอง)

  function viewAccount() {
    const u = me();
    const row = (k, v) => '<tr><th scope="row">' + k + '</th><td>' + (v ? esc(v) : '<span class="muted">-</span>') + '</td></tr>';
    return '<div class="page-head"><div><h1>บัญชีของฉัน</h1><div class="page-sub">ข้อมูลบัญชีให้ผู้ดูแลระบบแก้ไข — เปลี่ยนรหัสผ่านได้เอง</div></div></div>' + takeFlash() +
      '<section class="card form-section"><div class="section-head"><h2 class="section-title">ข้อมูลบัญชี</h2></div><div class="table-wrap"><table><tbody>' +
      row('ชื่อ', u.name) + row('อีเมล', u.email) + row('ตำแหน่ง', u.title) + row('หน่วยงาน', deptsOf(u).join(', ')) + row('บริษัท', u.company) + (Array.isArray(u.companies) && u.role !== 'admin' ? row('บริษัทที่ดูงบ / งานได้', u.companies.join(', ') || 'ยังไม่ได้กำหนด — ติดต่อผู้ดูแลระบบ') : '') + row('บทบาท', roleLabel(u)) +
      '</tbody></table></div></section>' +
      (REMOTE ? '' : '<section class="card form-section"><div class="section-head"><h2 class="section-title">เปลี่ยนรหัสผ่าน</h2></div>' +
        (u.pwHash ? '<form id="pwForm" class="form-narrow"><div id="pwMsg"></div>' +
          authField('รหัสผ่านเดิม', 'current', 'password', 'autocomplete="current-password"') +
          authField('รหัสผ่านใหม่', 'next', 'password', 'autocomplete="new-password" minlength="' + PW_MIN + '"') +
          authField('ยืนยันรหัสผ่านใหม่', 'confirm', 'password', 'autocomplete="new-password"') +
          '<p class="muted small-note">อย่างน้อย ' + PW_MIN + ' ตัวอักษร มีทั้งตัวอักษรและตัวเลข · ถ้าลืมรหัสผ่านเดิม ให้ออกจากระบบแล้วแจ้งผู้ดูแลระบบรีเซ็ต</p>' +
          '<div class="actions"><button class="btn primary" type="submit">เปลี่ยนรหัสผ่าน</button></div></form>'
          : '<p class="muted">บัญชีนี้เข้าสู่ระบบด้วยบัญชีตัวอย่าง (ข้ามรหัสผ่าน) จึงยังไม่มีรหัสผ่าน — ออกจากระบบแล้วใช้ "ตั้งรหัสผ่าน" เพื่อกำหนดรหัสผ่านของตัวเอง</p>') + '</section>');
  }
  function bindAccount() {
    const form = document.getElementById('pwForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('pwMsg');
      if (form.elements.next.value !== form.elements.confirm.value) { msg.innerHTML = '<div class="alert error" role="alert">รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน</div>'; return; }
      const r = await authChangePassword(me(), form.elements.current.value, form.elements.next.value);
      if (r.error) { msg.innerHTML = '<div class="alert error" role="alert">' + esc(r.message) + '</div>'; return; }
      form.reset();
      msg.innerHTML = '<div class="alert success">เปลี่ยนรหัสผ่านเรียบร้อย</div>';
    });
  }

  // ---------------------------------------------------------------- เข้าสู่ระบบ (โหมด Supabase)

  function authShell(inner) {
    document.body.classList.add('auth-screen');
    document.getElementById('app').innerHTML = '<div class="auth-wrap">' + inner + '</div>';
  }

  function showLogin(message) {
    remoteMe = null;
    db = null;
    navStack = [];
    authShell('<div class="card auth-card"><h1>เข้าสู่ระบบ</h1><p class="muted">ระบบขอเบิกใช้งบประมาณ</p>' +
      '<div id="loginError">' + (message ? '<div class="alert error">' + esc(message) + '</div>' : '') + '</div>' +
      '<form id="loginForm"><label class="field"><span>อีเมล</span><input name="email" type="email" autocomplete="username" required></label>' +
      '<label class="field"><span>รหัสผ่าน</span><input name="password" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn primary tall" type="submit">เข้าสู่ระบบ</button></form>' +
      '<p class="muted small-note">บัญชีผู้ใช้สร้างโดยผู้ดูแลระบบ หากเข้าสู่ระบบไม่ได้กรุณาติดต่อฝ่ายการเงิน</p></div>');
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await window.RemoteApi.signIn(form.elements.email.value.trim(), form.elements.password.value);
      } catch (err) {
        document.getElementById('loginError').innerHTML = '<div class="alert error">' + esc(err.message) + '</div>';
        btn.disabled = false;
        return;
      }
      await enterApp();
    });
    form.elements.email.focus();
  }

  function showPending(meRow) {
    const inactive = meRow && meRow.active === false;
    authShell('<div class="card auth-card"><h1>' + (inactive ? 'บัญชีถูกปิดการใช้งาน' : 'รอผู้ดูแลกำหนดสิทธิ์') + '</h1>' +
      '<p class="muted">' + (inactive
        ? 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อฝ่ายการเงิน'
        : 'เข้าสู่ระบบสำเร็จ แต่ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาแจ้งฝ่ายการเงินให้กำหนดชื่อและบทบาทให้บัญชีนี้') + '</p>' +
      '<p><strong>' + esc((meRow && meRow.email) || (window.RemoteApi.sessionUser() || {}).email || '') + '</strong></p>' +
      '<div class="actions"><button class="btn primary" id="recheck">ตรวจสอบอีกครั้ง</button><button class="btn" id="pendingLogout">ออกจากระบบ</button></div></div>');
    document.getElementById('recheck').addEventListener('click', enterApp);
    document.getElementById('pendingLogout').addEventListener('click', logout);
  }

  function showFatal(message) {
    authShell('<div class="card auth-card"><h1>เปิดระบบไม่สำเร็จ</h1><div class="alert error">' + esc(message) + '</div>' +
      '<div class="actions"><button class="btn primary" id="retry">ลองใหม่</button><button class="btn" id="fatalLogout">ออกจากระบบ</button></div></div>');
    document.getElementById('retry').addEventListener('click', enterApp);
    document.getElementById('fatalLogout').addEventListener('click', logout);
  }

  /** ออกจากระบบเมื่อหมดเวลาเข้าใช้งาน (session หมดอายุ) */
  function signedOut(message) {
    window.RemoteApi.signOut();
    showLogin(message);
  }

  async function logout() {
    if (!REMOTE) { logoutDemo(); return; }
    await window.RemoteApi.signOut();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    showLogin();
  }

  async function enterApp() {
    authShell('<div class="card auth-card"><p class="muted">กำลังเข้าสู่ระบบ…</p></div>');
    let meRow;
    try {
      meRow = await window.RemoteApi.me();
      if (meRow && meRow.active && meRow.role) await reloadRemote();
    } catch (e) {
      if (e && e.code === 'AUTH') showLogin(e.message); else showFatal((e && e.message) || 'เกิดข้อผิดพลาด');
      return;
    }
    if (!meRow || !meRow.active || !meRow.role) { showPending(meRow); return; }
    document.body.classList.remove('auth-screen');
    renderUserButton();
    initUserMenu();
    startPolling();
    render();
  }

  // โหลดข้อมูลใหม่เป็นระยะ (และเมื่อกลับมาที่แท็บ) เพื่อให้เห็นงานที่คนอื่นทำ — ข้ามเมื่อกำลังกรอกฟอร์ม
  let pollTimer = null;
  async function silentRefresh() {
    if (!REMOTE || !remoteMe || document.visibilityState !== 'visible' || isFormHash(location.hash || '')) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && document.getElementById('app').contains(ae)) return;
    const before = remoteSnapshot;
    try {
      await reloadRemote();
    } catch (e) {
      if (e && e.code === 'AUTH') signedOut('หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่');
      return;
    }
    if (remoteSnapshot !== before) {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(silentRefresh, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') silentRefresh(); });
  }

  let userMenuReady = false;

  function init() {
    if (AUTH_REMOTE) db = emptyDb(); else if (!REMOTE) db = load(); // โหมด Supabase: ข้อมูลโหลดจากเซิร์ฟเวอร์หลังล็อกอิน (ไม่ใช้ localStorage)
    if (AUTH_REMOTE) { const note = document.querySelector('.sidebar-note'); if (note) note.textContent = 'ข้อมูลเก็บบนเซิร์ฟเวอร์ — ทุกคนเห็นข้อมูลเดียวกันตามสิทธิ์และบริษัทของตน · ตอนนี้เป็นช่วงทดสอบ'; }
    checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    // โหมด Supabase: กลับมาที่แท็บแล้วโหลดข้อมูลหลักล่าสุด (คนอื่นอาจแก้ไว้) — ถ้าเปลี่ยนและไม่ได้กรอกฟอร์มอยู่ ให้วาดหน้าใหม่
    if (AUTH_REMOTE) {
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || !accountsReady || !window.RemoteApi.hasSession()) return;
        let changed = false;
        try { changed = await loadRemoteMaster(); } catch (e) { return; }
        const ae = document.activeElement;
        const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && document.getElementById('app').contains(ae);
        if (changed && !typing && !isFormHash(location.hash || '')) { const y = window.scrollY; render(); window.scrollTo(0, y); }
      });
    }
    if (REMOTE) {
      document.body.classList.add('remote');
      const note = document.querySelector('.sidebar-note');
      if (note) note.textContent = 'ข้อมูลเก็บบนเซิร์ฟเวอร์ — ทุกคนในองค์กรเห็นข้อมูลเดียวกันตามสิทธิ์ของบทบาท';
    }
    const toggle = document.getElementById('menuToggle');
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop no-print';
    document.body.appendChild(backdrop);
    const setNav = (open) => {
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
    backdrop.addEventListener('click', () => setNav(false));
    window.addEventListener('hashchange', render);
    if (AUTH_REMOTE) {
      document.body.classList.add('auth-screen');
      if (window.RemoteApi.hasSession()) enterAccounts('');
      else showLoginDemo('login');
    } else if (REMOTE) {
      document.body.classList.add('auth-screen');
      if (window.RemoteApi.hasSession()) enterApp(); else showLogin();
    } else {
      render();
    }
  }

  init();
})();

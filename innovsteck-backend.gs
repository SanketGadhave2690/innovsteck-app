/**
 * INNOVSTECK BACKEND  (Google Apps Script - free)
 * ------------------------------------------------------------------
 * - Register with email + password, verified by a REAL 6-digit OTP emailed from your Gmail
 * - Sign in, Forgot password (OTP by email), Logout
 * - Admin dashboard (password stored only in Script properties)
 * - Saves users, bookings, enquiries, activity and app content in your Google Sheet
 *
 * SETUP (once):  see README.md  ->  STEP A
 *  1. Google Sheet -> Extensions -> Apps Script -> paste this whole file -> Save
 *  2. Select function  setup  -> Run -> allow permissions (it needs to send mail and use the Sheet)
 *  3. Project Settings (gear) -> Script properties -> Add  ADMIN_PASSWORD = your own strong password
 *  4. Deploy -> New deployment -> type Web app -> Execute as: Me, Who has access: Anyone -> Deploy
 *  5. Copy the Web app URL and paste it as BACKEND_URL in index.html
 *  After changing this code later: Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy
 */

var BRAND = 'Innovsteck';
var GMAIL_ONLY = false;      // true = only @gmail.com addresses may register
var OTP_MINUTES = 10;        // how long a code stays valid
var MAX_OTP_TRIES = 5;       // wrong codes allowed per OTP
var MAX_CODES_PER_HOUR = 5;  // OTP emails per address per hour
var SESSION_DAYS = 30;       // stay signed in for
var TZ = 'Asia/Kolkata';

var SHEETS = {
  Users:     ['Name', 'Email', 'Registered', 'Last login', 'Last logout', 'Status', 'Logins', 'Salt', 'Hash'],
  Bookings:  ['Time', 'Name', 'Email', 'Project', 'Need', 'Course', 'College', 'Message'],
  Enquiries: ['Time', 'Name', 'Email', 'Project', 'Message'],
  Activity:  ['Time', 'Name', 'Email', 'Event'],
  Content:   ['Data']
};

/* ---------------- one-time setup (run from the editor) ---------------- */
function setup() {
  Object.keys(SHEETS).forEach(sh);
  secret('SECRET'); secret('PEPPER');
  Logger.log('Sheets created. Mail quota left today: ' + MailApp.getRemainingDailyQuota());
  if (!props().getProperty('ADMIN_PASSWORD')) {
    Logger.log('ACTION NEEDED: add a Script property named ADMIN_PASSWORD (Project Settings -> Script properties).');
  } else {
    Logger.log('ADMIN_PASSWORD is set. Now deploy as a Web app.');
  }
}

/* ---------------- web entry points ---------------- */
function doGet() {
  return ContentService.createTextOutput('Innovsteck backend is running.');
}

function doPost(e) {
  var out, lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route(req);
  } catch (err) {
    out = { ok: false, error: 'Server busy or error. Please try again.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route(r) {
  switch (r.action) {
    case 'register_start':  return registerStart(r);
    case 'register_resend': return registerResend(r);
    case 'register_verify': return registerVerify(r);
    case 'login':           return login(r);
    case 'forgot_start':    return forgotStart(r);
    case 'forgot_verify':   return forgotVerify(r);
    case 'logout':          return logout(r);
    case 'enquiry':         return enquiry(r);
    case 'booking':         return booking(r);
    case 'get_content':     return getContent();
    case 'save_content':    return saveContent(r);
    case 'admin_list':      return adminList(r);
  }
  return { ok: false, error: 'Unknown request.' };
}

/* ---------------- helpers ---------------- */
function props() { return PropertiesService.getScriptProperties(); }
function secret(name) {
  var p = props(), v = p.getProperty(name);
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(name, v); }
  return v;
}
function now() { return Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, hh:mm a'); }
function fail(m) { return { ok: false, error: m }; }
function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function emailOk(e) {
  if (e.length > 120 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e)) return false;
  if (GMAIL_ONLY && !/@gmail\.com$/.test(e)) return false;
  return true;
}
function pwOk(p) {
  p = String(p || '');
  return p.length >= 8 && p.length <= 64 && /[A-Za-z]/.test(p) && /\d/.test(p);
}
function badEmailMsg() { return GMAIL_ONLY ? 'Please enter a valid Gmail address.' : 'Please enter a valid email address.'; }

/* ---------------- sheets ---------------- */
function sh(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    var h = SHEETS[name];
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}
function add(name, vals) {
  var s = sh(name), r = s.getLastRow() + 1;
  // plain-text format stops anything typed by a user being run as a spreadsheet formula
  s.getRange(r, 1, 1, vals.length).setNumberFormat('@').setValues([vals.map(function (v) { return String(v); })]);
}
function put(row, col, val) {
  sh('Users').getRange(row, col, 1, 1).setNumberFormat('@').setValues([[String(val)]]);
}
function log(name, email, ev) { add('Activity', [now(), name, email, ev]); }
function findUser(email) {
  var s = sh('Users'), n = s.getLastRow();
  if (n < 2) return null;
  var vals = s.getRange(2, 1, n - 1, 9).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1]).toLowerCase() === email) return { row: i + 2, v: vals[i] };
  }
  return null;
}
function rows(name, cols, limit) {
  var s = sh(name), n = s.getLastRow();
  if (n < 2) return [];
  var from = Math.max(2, n - limit + 1);
  var v = s.getRange(from, 1, n - from + 1, cols).getValues();
  return v.map(function (r) { return r.map(String); }).reverse();
}

/* ---------------- passwords & sessions ---------------- */
function hashPw(pw, salt) {
  var sb = Utilities.newBlob(salt + secret('PEPPER')).getBytes();
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw), Utilities.Charset.UTF_8);
  for (var i = 0; i < 300; i++) d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(sb));
  return Utilities.base64Encode(d);
}
function sign(p) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(p, secret('SECRET')));
}
function makeToken(email) {
  var p = email + '|' + (Date.now() + SESSION_DAYS * 864e5);
  return Utilities.base64EncodeWebSafe(p) + '.' + sign(p);
}
function whoIs(token) {
  try {
    var a = String(token || '').split('.');
    if (a.length !== 2) return null;
    var p = Utilities.newBlob(Utilities.base64DecodeWebSafe(a[0])).getDataAsString();
    if (sign(p) !== a[1]) return null;
    var i = p.lastIndexOf('|');
    if (Date.now() > Number(p.slice(i + 1))) return null;
    var email = p.slice(0, i), u = findUser(email);
    return u ? { email: email, name: String(u.v[0]), user: u } : null;
  } catch (e) { return null; }
}

/* ---------------- OTP (stored in script cache, never sent to the app) ---------------- */
function cache() { return CacheService.getScriptCache(); }
function cget(k) { var v = cache().get(k); return v ? JSON.parse(v) : null; }
function cput(k, o, sec) { cache().put(k, JSON.stringify(o), Math.max(1, Math.min(21600, Math.floor(sec)))); }
function genOtp() {
  var n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16);
  return ('000000' + (n % 1000000)).slice(-6);
}
function otpHash(kind, email, otp) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    kind + '|' + email + '|' + otp + '|' + secret('SECRET'), Utilities.Charset.UTF_8));
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function sendOtpMail(kind, email, otp, name) {
  var what = kind === 'reg' ? 'verify your email and finish registering' : 'reset your password';
  var hi = name ? 'Hi ' + name + ',' : 'Hello,';
  var plain = hi + '\n\nYour ' + BRAND + ' verification code is: ' + otp + '\n\nUse it to ' + what +
    '. The code is valid for ' + OTP_MINUTES + ' minutes.\n\nIf you did not ask for this, you can ignore this email. Never share this code with anyone.\n\n' + BRAND;
  var html = '<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;border:1px solid #dde4f5;border-radius:14px;padding:24px">' +
    '<h2 style="margin:0 0 6px;color:#0b1a3a">INNOV<span style="color:#f5a800">STECK</span></h2>' +
    '<p style="color:#4a5878">' + esc(hi) + '</p>' +
    '<p style="color:#4a5878">Use this code to ' + what + ':</p>' +
    '<p style="font-size:34px;letter-spacing:8px;font-weight:700;background:#eef3ff;border-radius:10px;padding:14px;text-align:center;color:#0b1a3a;margin:14px 0">' + otp + '</p>' +
    '<p style="color:#4a5878;font-size:13px">Valid for ' + OTP_MINUTES + ' minutes. If you did not ask for this, ignore this email. Never share this code with anyone.</p></div>';
  MailApp.sendEmail({ to: email, subject: BRAND + ' verification code: ' + otp, body: plain, htmlBody: html, name: BRAND });
}

// issues + emails a new OTP. extra = data kept with the OTP (e.g. pending registration)
function issueOtp(kind, email, extra) {
  if (cache().get('cd:' + email)) return fail('Please wait 30 seconds before asking for a new code.');
  var rl = cget('rl:' + email) || { n: 0, t: Date.now() };
  if (Date.now() - rl.t > 3600000) rl = { n: 0, t: Date.now() };
  if (rl.n >= MAX_CODES_PER_HOUR) return fail('Too many codes requested. Please try again after an hour.');
  if (MailApp.getRemainingDailyQuota() < 1) return fail('Daily email limit reached. Please try again tomorrow.');
  var otp = genOtp(), rec = extra || {};
  rec.h = otpHash(kind, email, otp); rec.tries = 0; rec.x = Date.now() + OTP_MINUTES * 60000;
  try { sendOtpMail(kind, email, otp, rec.name); }
  catch (e) { return fail('Could not send the email. Please check the address and try again.'); }
  cput('o:' + kind + ':' + email, rec, OTP_MINUTES * 60);
  rl.n++; cput('rl:' + email, rl, 3600);
  cache().put('cd:' + email, '1', 30);
  return { ok: true };
}

function checkOtp(kind, email, otp) {
  var k = 'o:' + kind + ':' + email, rec = cget(k);
  if (!rec || Date.now() > rec.x) { cache().remove(k); return fail('Code expired. Please request a new one.'); }
  if (rec.tries >= MAX_OTP_TRIES) { cache().remove(k); return fail('Too many wrong attempts. Please request a new code.'); }
  if (rec.h !== otpHash(kind, email, String(otp || '').replace(/\D/g, ''))) {
    rec.tries++;
    if (rec.tries >= MAX_OTP_TRIES) { cache().remove(k); return fail('Too many wrong attempts. Please request a new code.'); }
    cput(k, rec, (rec.x - Date.now()) / 1000);
    return fail('Wrong code. ' + (MAX_OTP_TRIES - rec.tries) + ' attempts left.');
  }
  cache().remove(k);
  return { ok: true, rec: rec };
}

/* ---------------- register ---------------- */
function registerStart(r) {
  var name = clean(r.name, 60), email = normEmail(r.email);
  if (name.length < 2) return fail('Please enter your name.');
  if (!emailOk(email)) return fail(badEmailMsg());
  if (!pwOk(r.password)) return fail('Password must be 8+ characters with at least one letter and one number.');
  if (findUser(email)) return fail('This email is already registered. Please sign in.');
  var salt = Utilities.getUuid();
  return issueOtp('reg', email, { name: name, salt: salt, ph: hashPw(r.password, salt) });
}

function registerResend(r) {
  var email = normEmail(r.email), rec = cget('o:reg:' + email);
  if (!rec) return fail('Session expired. Please register again.');
  return issueOtp('reg', email, { name: rec.name, salt: rec.salt, ph: rec.ph });
}

function registerVerify(r) {
  var email = normEmail(r.email), c = checkOtp('reg', email, r.otp);
  if (!c.ok) return c;
  if (findUser(email)) return fail('This email is already registered. Please sign in.');
  var t = now();
  add('Users', [c.rec.name, email, t, t, '', 'Logged in', '1', c.rec.salt, c.rec.ph]);
  log(c.rec.name, email, 'Registered');
  return { ok: true, name: c.rec.name, email: email, token: makeToken(email) };
}

/* ---------------- login / logout ---------------- */
function login(r) {
  var email = normEmail(r.email), lf = cget('lf:' + email) || { n: 0 };
  if (lf.n >= 5) return fail('Too many failed attempts. Please try again after 15 minutes or use Forgot password.');
  var u = findUser(email);
  if (!u || hashPw(r.password, String(u.v[7])) !== String(u.v[8])) {
    lf.n++; cput('lf:' + email, lf, 900);
    return fail('Wrong email or password.');
  }
  cache().remove('lf:' + email);
  put(u.row, 4, now()); put(u.row, 6, 'Logged in'); put(u.row, 7, (Number(u.v[6]) || 0) + 1);
  log(u.v[0], email, 'Login');
  return { ok: true, name: String(u.v[0]), email: email, token: makeToken(email) };
}

function logout(r) {
  var w = whoIs(r.token);
  if (w) { put(w.user.row, 5, now()); put(w.user.row, 6, 'Logged out'); log(w.name, w.email, 'Logout'); }
  return { ok: true };
}

/* ---------------- forgot password ---------------- */
function forgotStart(r) {
  var email = normEmail(r.email);
  if (!emailOk(email)) return fail(badEmailMsg());
  var u = findUser(email);
  if (u) issueOtp('pw', email, { name: String(u.v[0]) });   // same answer whether or not the email exists
  return { ok: true };
}

function forgotVerify(r) {
  var email = normEmail(r.email);
  if (!pwOk(r.password)) return fail('Password must be 8+ characters with at least one letter and one number.');
  var u = findUser(email);
  if (!u) return fail('Code expired. Please request a new one.');
  var c = checkOtp('pw', email, r.otp);
  if (!c.ok) return c;
  var salt = Utilities.getUuid();
  put(u.row, 8, salt); put(u.row, 9, hashPw(r.password, salt));
  cache().remove('lf:' + email);
  log(u.v[0], email, 'Password reset');
  return { ok: true };
}

/* ---------------- bookings & enquiries (signed-in users) ---------------- */
function enquiry(r) {
  var w = whoIs(r.token);
  if (!w) return fail('session');
  add('Enquiries', [now(), w.name, w.email, clean(r.project, 120), clean(r.message, 1000)]);
  return { ok: true };
}
function booking(r) {
  var w = whoIs(r.token);
  if (!w) return fail('session');
  add('Bookings', [now(), w.name, w.email, clean(r.project, 120), clean(r.need, 80), clean(r.course, 80), clean(r.college, 120), clean(r.message, 1000)]);
  return { ok: true };
}

/* ---------------- app content (projects, photos, settings) ---------------- */
function getContent() {
  var s = sh('Content'), n = s.getLastRow();
  if (n < 2) return { ok: true, content: null };
  var v = s.getRange(2, 1, n - 1, 1).getValues(), str = '';
  for (var i = 0; i < v.length; i++) str += v[i][0];
  try { return { ok: true, content: JSON.parse(str) }; } catch (e) { return { ok: true, content: null }; }
}

/* ---------------- admin ---------------- */
function adminCheck(pw) {
  var real = props().getProperty('ADMIN_PASSWORD');
  if (!real) return 'Admin password is not set. Add ADMIN_PASSWORD in Script properties.';
  var f = cget('af') || { n: 0 };
  if (f.n >= 5) return 'Too many wrong attempts. Try again after 15 minutes.';
  if (String(pw || '') !== real) { f.n++; cput('af', f, 900); return 'Wrong password.'; }
  cache().remove('af');
  return '';
}

function saveContent(r) {
  var m = adminCheck(r.password);
  if (m) return fail(m);
  var c = r.content;
  if (!c || !Array.isArray(c.projects) || !Array.isArray(c.cats)) return fail('Invalid content.');
  var str = JSON.stringify(c);
  if (str.length > 3000000) return fail('Content is too large. Use fewer or smaller photos.');
  var parts = [];
  for (var i = 0; i < str.length; i += 40000) parts.push([str.slice(i, i + 40000)]);
  var s = sh('Content');
  s.clear();
  s.getRange(1, 1, 1, 1).setValues([['Data']]).setFontWeight('bold');
  s.getRange(2, 1, parts.length, 1).setNumberFormat('@').setValues(parts);
  return { ok: true };
}

function adminList(r) {
  var m = adminCheck(r.password);
  if (m) return fail(m);
  var users = rows('Users', 7, 2000);
  return {
    ok: true,
    users: users,
    bookings: rows('Bookings', 8, 500),
    enquiries: rows('Enquiries', 5, 500),
    activity: rows('Activity', 4, 500)
  };
}

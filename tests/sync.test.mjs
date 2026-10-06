// ทดสอบการแชร์บ้านระหว่าง 2 เครื่องจำลอง กับบริการซิงก์ที่รันในเครื่อง
//   1) cd sync && npx wrangler d1 execute survival-sync --local --file=schema.sql
//   2) cd sync && npx wrangler dev --local --port 8787 --ip 127.0.0.1
//   3) python -X utf8 build.py --dev && node tests/sync.test.mjs
import assert from "node:assert/strict";
import { device } from "./harness.mjs";

const wait = ms => new Promise(r => setTimeout(r, ms));
const plain = v => JSON.parse(JSON.stringify(v));
// ซิงก์สลับกันจนนิ่ง (เซิร์ฟเวอร์จำกัดความถี่การเขียนต่อบ้าน จึงต้องเว้นจังหวะ)
async function settle(...ds) { for (let i = 0; i < 3; i++) for (const d of ds) { await wait(900); await d.run("syncHome(H())"); } }

const A = device();
await wait(50);

// --- โครงข้อมูลหลายบ้าน ---
assert.equal(A.run("Object.keys(DB.homes).length"), 1, "เริ่มต้นมี 1 บ้าน");
A.run(`put("c.home:w-drink", 1); put("n.health", "แพ้เพนิซิลลิน"); put("p.days", 14); put("u.utest1", {kit:"home", cat:"water", n:"ถังน้ำ <b>20</b> ลิตร"})`);
assert.deepEqual(plain(A.run("S.checks")), { "home:w-drink": true });
assert.equal(A.run("S.profile.days"), 14);
A.run(`put("p.days", "<img src=x onerror=1>"); put("x.evil", 1); put("c.<bad>", 1)`);
assert.equal(A.run("S.profile.days"), 14, "ค่าที่ไม่ผ่านการตรวจถูกทิ้ง");
assert.equal(A.run(`Object.keys(H().f).some(k => k.includes("evil") || k.includes("<"))`), false);

// ย้ายข้อมูลจากเวอร์ชันบ้านเดียว
const legacy = device(); legacy.store.clear();
legacy.store.set("survival.v1", JSON.stringify({ profile: { adults: 3, days: 30, home: "condo" }, checks: { "go:w-drink": true }, exp: { "go:w-drink": "2027-01-01" }, custom: [{ id: "u1", kit: "go", cat: "water", n: "เก่า" }], plan: { hub: "ป้า" } }));
legacy.run("DB = loadDB(); S = view()");
assert.equal(legacy.run("S.profile.adults"), 3); assert.equal(legacy.run("S.plan.hub"), "ป้า");
assert.equal(legacy.run("S.custom[0].n"), "เก่า"); assert.equal(legacy.run("S.exp['go:w-drink']"), "2027-01-01");

// --- แชร์บ้านและเข้าร่วม ---
A.run(`put("name", "คอนโดทดสอบ"); H().sync = {k:b64(crypto.getRandomValues(new Uint8Array(32))), ver:0, dirty:true, at:0, gone:false}`);
await A.run("syncHome(H())");
assert.equal(A.run("H().sync.err || ''"), "", "ซิงก์ครั้งแรกสำเร็จ");
assert.equal(A.run("H().sync.ver"), 1); assert.equal(A.run("H().sync.dirty"), false);
const link = A.run("inviteLink(H())");
assert.match(link, /#join=[A-Za-z0-9_-]{43}$/);

// เซิร์ฟเวอร์ต้องไม่เห็นเนื้อหา
const K = plain(await A.run("keysOf(H().sync.k).then(k => ({id:k.id, token:k.token}))"));
const raw = await (await fetch(`http://127.0.0.1:8787/v1/h/${K.id}`, { headers: { Authorization: "Bearer " + K.token } })).json();
const decoded = Buffer.from(raw.data, "base64url").toString("latin1");
for (const s of ["health", "w-drink", "คอนโด", "ถังน้ำ", "name"]) assert.equal(decoded.includes(s) || raw.data.includes(s), false, "ข้อมูลบนเซิร์ฟเวอร์ต้องอ่านไม่ออก: " + s);

const B = device("#join=" + link.split("#join=")[1]);
await wait(600);
assert.equal(B.run("location.hash"), "#home", "รหัสลับถูกลบออกจากแถบที่อยู่");
assert.equal(B.run("JOIN && JOIN.name"), "คอนโดทดสอบ", "ต้องรอผู้ใช้ยืนยันก่อนเข้าร่วม");
assert.equal(B.run("Object.keys(DB.homes).length"), 1);
assert.ok(B.html().includes("เข้าร่วมบ้าน"), "แสดงการ์ดยืนยัน");
B.run(`(() => { const nh = newHome(JOIN.name, JOIN.f); nh.sync = {k:JOIN.k, ver:JOIN.ver, dirty:false, at:Date.now(), gone:false}; DB.homes[nh.id] = nh; DB.cur = nh.id; JOIN = null; S = view(); save(); })()`);
assert.deepEqual(plain(B.run("S.checks")), { "home:w-drink": true }, "B เห็นรายการที่ A ติ๊ก");
assert.equal(B.run("S.plan.health"), "แพ้เพนิซิลลิน"); assert.equal(B.run("S.profile.days"), 14);
assert.equal(B.run("S.custom[0].n"), "ถังน้ำ <b>20</b> ลิตร");

// --- แก้พร้อมกันคนละรายการ ต้องไม่ทับกัน ---
A.run(`put("c.home:f-rice", 1)`); B.run(`put("c.home:p-torch", 1); put("n.meet1", "หน้าเซเว่น")`);
await settle(A, B);
for (const d of [A, B]) {
  assert.deepEqual(Object.keys(plain(d.run("S.checks"))).sort(), ["home:f-rice", "home:p-torch", "home:w-drink"]);
  assert.equal(d.run("S.plan.meet1"), "หน้าเซเว่น");
}
// แก้ข้อเดียวกัน: ที่แก้ทีหลังชนะ และการลบรายการต้องไปถึงอีกเครื่อง
A.run(`put("p.days", 7)`); await wait(20); B.run(`put("p.days", 30); put("u.utest1", null); put("c.home:w-drink", 0)`);
await wait(900); await settle(A, B);
for (const d of [A, B]) { assert.equal(d.run("S.profile.days"), 30); assert.equal(d.run("S.custom.length"), 0); assert.equal(d.run("!!S.checks['home:w-drink']"), false); }

// --- คนนอกที่ไม่มีรหัส ---
const bad = await fetch(`http://127.0.0.1:8787/v1/h/${K.id}`, { headers: { Authorization: "Bearer " + "x".repeat(43) } });
assert.equal(bad.status, 403);
// ข้อมูลปลอมที่ถอดรหัสไม่ได้ต้องไม่ทำให้ข้อมูลในเครื่องเสีย
const before = JSON.stringify(plain(B.run("H().f")));
await wait(900);
const ver = B.run("H().sync.ver");
assert.equal((await fetch(`http://127.0.0.1:8787/v1/h/${K.id}`, { method: "PUT", headers: { Authorization: "Bearer " + K.token }, body: JSON.stringify({ base: ver, data: "A".repeat(80) }) })).status, 200);
await B.run("syncHome(H())");
assert.equal(JSON.stringify(plain(B.run("H().f"))), before, "ข้อมูลในเครื่องไม่เปลี่ยนเมื่อเซิร์ฟเวอร์ส่งของที่ถอดรหัสไม่ได้");
assert.equal(B.run("H().sync.err || ''"), "", "เครื่องเขียนข้อมูลที่ถูกต้องกลับขึ้นไปแทน");

// --- เปลี่ยนรหัสบ้าน: ลิงก์เดิมใช้ไม่ได้ เครื่องที่ยังถือรหัสเดิมถูกแจ้งว่าบ้านหาย ---
await fetch(`http://127.0.0.1:8787/v1/h/${K.id}`, { method: "DELETE", headers: { Authorization: "Bearer " + K.token } });
await B.run("syncHome(H())");
assert.equal(B.run("H().sync.gone"), true);
assert.equal(JSON.stringify(plain(B.run("H().f"))), before, "ข้อมูลในเครื่องยังอยู่หลังบ้านถูกลบจากเซิร์ฟเวอร์");
const C = device("#join=" + link.split("#join=")[1]);
await wait(600);
assert.equal(C.run("JOIN"), null); assert.ok(C.html().includes("ไม่พบบ้านนี้"));

console.log("ผ่านทั้งหมด");

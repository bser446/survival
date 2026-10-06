// ทดสอบหน้าจอทุกหน้าและการกดปุ่มหลัก โดยไม่ต้องมีเบราว์เซอร์และไม่ต้องมีบริการซิงก์
//   python -X utf8 build.py --dev && node tests/ui.test.mjs
import assert from "node:assert/strict";
import { device } from "./harness.mjs";

const d = device();
await new Promise(r => setTimeout(r, 50));
const guides = JSON.parse(JSON.stringify(d.run("DATA.guides.map(g => g.id)")));
assert.equal(guides.length, 7);

// ทุกหน้าต้องวาดได้โดยไม่ล้ม
const pages = ["home", "list/go", "list/home", "list/car", "sos", "set", "terms"];
for (const g of guides) for (const p of ["during", "before", "after", "dont", "more"]) pages.push(`g/${g}/${p}`);
for (const p of pages) assert.ok(d.go(p).length > 200, "หน้า " + p);

// ติ๊กรายการ วันหมดอายุ และตัวคำนวณ
d.go("list/home");
await d.fire("change", { dataset: { chk: "home:w-drink" }, checked: true });
await d.fire("change", { dataset: { exp: "home:w-drink" }, value: "2031-01-01" });
assert.ok(d.html().includes("พร้อมแล้ว 1%"));
assert.ok(d.html().includes("42 ลิตร"), "2 คน 7 วัน = น้ำดื่ม 42 ลิตร");
d.go("set");
await d.fire("click", { dataset: { step: "children:1" } });
await d.fire("click", { dataset: { days: "14" } });
assert.ok(d.go("list/home").includes("126 ลิตร"), "3 คน 14 วัน = 126 ลิตร");
assert.ok(d.html().includes("ผ้าอ้อมเด็ก"));

// ข้อความที่ผู้ใช้พิมพ์ต้องถูก escape ทุกจุด
const evil = '<img src=x onerror=alert(1)>';
await d.fire("submit", { dataset: { add: "water" }, n: { value: evil } });
await d.fire("input", { dataset: { plan: "notes" }, value: "</textarea>" + evil });
d.go("set");
await d.fire("change", { dataset: { name: "1" }, value: evil });
await d.fire("submit", { dataset: { newhome: "1" }, n: { value: "บ้าน " + evil } });
for (const p of ["home", "list/home", "sos", "set"]) assert.equal(d.go(p).includes("<img"), false, "ไม่มี <img> ดิบในหน้า " + p);
assert.ok(d.go("set").includes("&lt;img"));

// หลายบ้าน: ข้อมูลแยกกัน สลับได้ ลบได้
assert.equal(d.run("Object.keys(DB.homes).length"), 2);
assert.equal(d.run("Object.keys(S.checks).length"), 0, "บ้านใหม่เริ่มว่าง");
const first = d.run("Object.keys(DB.homes)[0]");
await d.fire("click", { dataset: { use: first } });
assert.equal(d.run("!!S.checks['home:w-drink']"), true, "กลับมาบ้านแรก ข้อมูลยังอยู่");
const del = { dataset: { act: "delhome" }, textContent: "" };
await d.fire("click", del); assert.equal(d.run("Object.keys(DB.homes).length"), 2, "แตะครั้งแรกยังไม่ลบ");
await d.fire("click", del); assert.equal(d.run("Object.keys(DB.homes).length"), 1);

// ล้างข้อมูลของบ้าน
const reset = { dataset: { act: "reset" }, textContent: "" };
d.run(`put("c.go:w-drink", 1)`);
await d.fire("click", reset); await d.fire("click", reset);
assert.equal(d.run("Object.keys(S.checks).length + S.custom.length + Object.values(S.plan).filter(Boolean).length"), 0);
assert.equal(d.run("S.profile.days"), 7);

// ข้อมูลที่เก็บไว้ถูกดัดแปลง: โหลดกลับมาต้องไม่มีของแปลกปลอม
d.store.set("survival.v2", JSON.stringify({ cur: "hx", homes: { hx: { f: { name: [evil, 1], "p.adults": ["<b>", 1], "p.days": [9e99, 1], "c.<x>": [1, 1], "n.notes": [{ a: 1 }, 1], "u.u1": [{ kit: "home", cat: "water", n: evil }, 1], "__proto__": [1, 1] }, sync: { k: "short" } }, "<bad>": {} }, ui: { open: { "<x>": true }, showAll: "yes" } }));
d.run("DB = loadDB(); S = view()");
assert.equal(d.run("S.profile.adults"), 2); assert.equal(d.run("S.profile.days"), 365); assert.equal(d.run("H().sync"), null);
assert.equal(d.run("Object.keys(DB.homes).length"), 1); assert.equal(d.run("({}).polluted"), undefined);
for (const p of ["home", "list/home", "sos", "set"]) assert.equal(d.go(p).includes("<img"), false, "หลังโหลดข้อมูลดัดแปลง หน้า " + p);

// QR ของลิงก์เชิญ
const svg = d.run(`qrSvg("https://survival.thundererz.com/#join=" + "A".repeat(43))`);
assert.ok(svg.startsWith("<svg") && svg.includes("<path"));
assert.equal(d.run(`qrSvg("x".repeat(200))`), "");

console.log("ผ่านทั้งหมด");

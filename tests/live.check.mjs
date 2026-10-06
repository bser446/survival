// ตรวจหลัง deploy ว่าเว็บจริงเสิร์ฟชุดไฟล์ที่เข้าคู่กัน และตรงกับที่ build ในเครื่อง
//   node tests/live.check.mjs            (รอได้ถึง ~4 นาทีให้ GitHub Pages กระจายไฟล์)
// ผ่านแล้วยังต้องเปิดเว็บในเบราว์เซอร์จริงดูหน้าที่ถูกเสิร์ฟอีกครั้ง (ดู README หัวข้อ deploy)
import fs from "node:fs";
import crypto from "node:crypto";

const SITE = process.env.SITE || "https://survival.thundererz.com/";
const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");
const local = name => fs.readFileSync(new URL("../" + name, import.meta.url));
const get = async name => { const r = await fetch(SITE + name + "?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error(name + " " + r.status); return Buffer.from(await r.arrayBuffer()); };

const want = { index: sha(local("index.html")), sw: sha(local("sw.js")) };
const pinned = /INDEX_SHA256 = "([0-9a-f]{64})"/.exec(local("sw.js").toString())?.[1];
if (pinned !== want.index) { console.error("ในเครื่อง: sw.js ไม่ได้ build คู่กับ index.html นี้ ให้รัน build.py ใหม่"); process.exit(1); }
if (/127\.0\.0\.1|localhost/.test(/<meta http-equiv[^>]*>/.exec(local("index.html").toString())?.[0] || "")) { console.error("ในเครื่อง: index.html เป็น build แบบ --dev ห้ามขึ้นเว็บจริง"); process.exit(1); }

// ใช้ process.exitCode แทน process.exit() หลัง fetch: บน Windows การออกทันทีขณะ socket กำลังปิดทำให้ node ล้ม (libuv assertion)
let last = "", ok = false;
for (let i = 0; i < 16 && !ok; i++) {
  try {
    const [index, sw] = await Promise.all([get("index.html"), get("sw.js")]);
    const livePinned = /INDEX_SHA256 = "([0-9a-f]{64})"/.exec(sw.toString())?.[1];
    const problems = [];
    if (sha(sw) !== want.sw) problems.push("sw.js บนเว็บยังไม่ใช่รุ่นในเครื่อง");
    if (sha(index) !== want.index) problems.push("index.html บนเว็บยังไม่ใช่รุ่นในเครื่อง");
    if (livePinned !== sha(index)) problems.push("sw.js กับ index.html บนเว็บไม่เข้าคู่กัน (เครื่องผู้ใช้จะยังไม่อัปเดตจนกว่าจะเข้าคู่)");
    ok = !problems.length;
    last = problems.join("; ");
  } catch (e) { last = String(e.message || e); }
  if (!ok) await new Promise(r => setTimeout(r, 15000));
}
if (ok) console.log("ผ่าน: เว็บจริงเสิร์ฟรุ่น " + want.index.slice(0, 10) + " ครบและเข้าคู่กัน");
else { console.error("ไม่ผ่าน: " + last); process.exitCode = 1; }

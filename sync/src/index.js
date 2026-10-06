// บริการซิงก์ของคู่มือเอาตัวรอด: รับฝากข้อมูลของ "บ้าน" ที่เข้ารหัสมาจากเครื่องผู้ใช้แล้ว
// เซิร์ฟเวอร์ไม่มีกุญแจ เห็นแค่ id สุ่ม ค่าแฮชของโทเคน และก้อนข้อมูลที่อ่านไม่ออก
const ID = /^[A-Za-z0-9_-]{22}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/, DATA = /^[A-Za-z0-9_-]{24,}$/;
const MAX_BODY = 400_000;          // ไบต์ต่อบ้าน
const MIN_WRITE_GAP = 800;         // มิลลิวินาทีระหว่างการเขียนของบ้านเดียวกัน
const MAX_NEW_PER_IP_DAY = 30;     // จำนวนบ้านใหม่ต่อ IP ต่อวัน
const KEEP_DAYS = 365;             // ลบบ้านที่ไม่มีเครื่องไหนเปิดเกินนี้
const DAY = 864e5;

const hex = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

function cors(req, env) {
  const origin = req.headers.get("Origin");
  const allowed = (env.ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!origin) return {};                       // ไม่ใช่เบราว์เซอร์ ยังต้องมีโทเคนอยู่ดี
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin, "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(req, env) {
    const headers = cors(req, env);
    if (headers === null) return new Response("origin not allowed", { status: 403 });
    const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
      status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      const url = new URL(req.url);
      if (url.pathname === "/") return reply(200, { ok: true });
      const m = /^\/v1\/h\/([^/]+)$/.exec(url.pathname);
      if (!m || !ID.test(m[1])) return reply(404, { error: "not found" });
      const id = m[1], token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
      if (!TOKEN.test(token)) return reply(401, { error: "token required" });
      const tokenHash = await hex(token), now = Date.now();
      const row = await env.DB.prepare("SELECT token_hash, ver, data, updated, seen FROM homes WHERE id = ?").bind(id).first();
      if (row && row.token_hash !== tokenHash) return reply(403, { error: "wrong token" });

      if (req.method === "GET") {
        if (!row) return reply(404, { error: "not found" });
        if (now - row.seen > DAY) await env.DB.prepare("UPDATE homes SET seen = ? WHERE id = ?").bind(now, id).run();
        if (String(row.ver) === url.searchParams.get("since")) return new Response(null, { status: 304, headers });
        return reply(200, { ver: row.ver, data: row.data });
      }

      if (req.method === "DELETE") {
        if (!row) return reply(404, { error: "not found" });
        await env.DB.prepare("DELETE FROM homes WHERE id = ? AND token_hash = ?").bind(id, tokenHash).run();
        return reply(200, { ok: true });
      }

      if (req.method === "PUT") {
        const text = await req.text();
        if (text.length > MAX_BODY) return reply(413, { error: "too large" });
        let body; try { body = JSON.parse(text); } catch { return reply(400, { error: "bad json" }); }
        const base = Number(body && body.base), data = body && body.data;
        if (!Number.isInteger(base) || base < 0 || typeof data !== "string" || !DATA.test(data)) return reply(400, { error: "bad body" });

        if (!row) {
          const day = new Date(now).toISOString().slice(0, 10);
          const key = day + ":" + (await hex(day + (req.headers.get("CF-Connecting-IP") || "local"))).slice(0, 32);
          const q = await env.DB.prepare("INSERT INTO quota (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n").bind(key).first();
          if (q.n > MAX_NEW_PER_IP_DAY) return reply(429, { error: "too many new homes today" });
          const ins = await env.DB.prepare("INSERT OR IGNORE INTO homes (id, token_hash, ver, data, updated, seen, created) VALUES (?, ?, 1, ?, ?, ?, ?)")
            .bind(id, tokenHash, data, now, now, now).run();
          if (ins.meta.changes === 1) return reply(200, { ver: 1 });
          return reply(409, await current(env, id));          // มีเครื่องอื่นสร้างตัดหน้า
        }
        if (base !== row.ver) return reply(409, { ver: row.ver, data: row.data });
        if (now - row.updated < MIN_WRITE_GAP) return reply(429, { error: "slow down" });
        const up = await env.DB.prepare("UPDATE homes SET ver = ver + 1, data = ?, updated = ?, seen = ? WHERE id = ? AND ver = ?")
          .bind(data, now, now, id, base).run();
        if (up.meta.changes === 1) return reply(200, { ver: base + 1 });
        return reply(409, await current(env, id));
      }
      return reply(405, { error: "method not allowed" });
    } catch (e) {
      console.error("sync error", e && e.message);          // ไม่ส่งรายละเอียดข้อผิดพลาดกลับไปหาผู้เรียก
      return reply(500, { error: "server error" });
    }
  },

  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.prepare("DELETE FROM homes WHERE seen < ?").bind(now - KEEP_DAYS * DAY).run();
    await env.DB.prepare("DELETE FROM quota WHERE k < ?").bind(new Date(now - 2 * DAY).toISOString().slice(0, 10)).run();
  },
};

async function current(env, id) {
  const r = await env.DB.prepare("SELECT ver, data FROM homes WHERE id = ?").bind(id).first();
  return r ? { ver: r.ver, data: r.data } : { ver: 0, data: "" };
}

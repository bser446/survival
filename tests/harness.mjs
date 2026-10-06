// เครื่องจำลองสำหรับทดสอบ: รันสคริปต์ของแอป (จาก index.html ที่ build แล้ว) ใน context แยก มี localStorage ของตัวเอง
import vm from "node:vm";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];

export function device(hash = "") {
  const store = new Map(), els = {}, listeners = {};
  const el = () => ({ innerHTML: "", textContent: "", dataset: {}, insertAdjacentHTML() {}, querySelectorAll: () => [] });
  const on = (type, fn) => (listeners[type] ??= []).push(fn);
  const ctx = {
    console, setTimeout, clearTimeout, setInterval() {}, fetch, btoa, atob, TextEncoder, TextDecoder, crypto, URL, Blob,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    location: { hash, hostname: "127.0.0.1", protocol: "http:", origin: "http://127.0.0.1:8766", pathname: "/" },
    navigator: { onLine: true },
    history: { replaceState(_a, _b, url) { ctx.location.hash = url.slice(url.indexOf("#")); } },
    document: { getElementById: id => (els[id] ??= el()), addEventListener: on, querySelectorAll: () => [], activeElement: null, hidden: false },
    addEventListener: on, scrollY: 0, scrollTo() {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {
    run: code => vm.runInContext(code, ctx),
    store,
    html: () => els.app.innerHTML,
    go(h) { ctx.location.hash = "#" + h; vm.runInContext("render(false)", ctx); return els.app.innerHTML; },
    // ยิงเหตุการณ์เข้า handler ของแอป target คือ object ที่มี dataset (และ field อื่นที่ handler ใช้)
    async fire(type, target) {
      const t = Object.assign({ dataset: {}, closest() { return t; } }, target);
      for (const fn of listeners[type] || []) await fn({ target: t, preventDefault() {} });
    },
  };
}

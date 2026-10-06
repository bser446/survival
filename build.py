"""Build the offline app: inline data/*.json into src/app.html -> index.html, and stamp sw.js.

Usage:  python -X utf8 build.py
"""
import base64
import hashlib
import json
import struct
import sys
import zlib
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GUIDES = ROOT / "data" / "guides"
REQUIRED = ("id", "title", "summary", "phases")
SYNC_ORIGIN = "https://survival-sync.thundererz.com"   # ต้องตรงกับ SYNC ใน src/app.html และ sync/wrangler.toml

SW = """const CACHE = "survival-__VER__";
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;  // ไม่ยุ่งกับบริการซิงก์
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).catch(() => caches.match("index.html"))));
});
"""

MANIFEST = {
    "name": "คู่มือเอาตัวรอด",
    "short_name": "เอาตัวรอด",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "background_color": "#f6f4ef",
    "theme_color": "#b3261e",
    "lang": "th",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
    ],
}


def icon(size: int) -> bytes:
    """Red square with a white cross, as a PNG, without third-party libraries."""
    red, white = b"\xb3\x26\x1e", b"\xff\xff\xff"
    arm, half = size * 0.30, size * 0.09
    mid = size / 2
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")
        for x in range(size):
            dx, dy = abs(x - mid), abs(y - mid)
            row += white if (dx < half and dy < arm) or (dy < half and dx < arm) else red
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def main() -> int:
    guides, problems = [], []
    for path in sorted(GUIDES.glob("*.json")):
        try:
            g = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as err:
            problems.append(f"{path.name}: {err}")
            continue
        missing = [k for k in REQUIRED if k not in g]
        if missing:
            problems.append(f"{path.name}: missing {missing}")
            continue
        known = {s.get("id") for s in g.get("sources", [])}
        items = [i for p in g["phases"].values() for i in p] + g.get("dont", []) + g.get("cases", [])
        unknown = sorted({s for i in items for s in i.get("src", []) if s not in known})
        if unknown:
            problems.append(f"{path.name}: src ids not in sources: {unknown}")
        guides.append(g)


    checklist = json.loads((ROOT / "data" / "checklist.json").read_text(encoding="utf-8"))
    firstaid, fa_path = None, ROOT / "data" / "firstaid.json"
    if fa_path.exists():
        firstaid = json.loads(fa_path.read_text(encoding="utf-8"))
        known = {s.get("id") for s in firstaid.get("sources", [])}
        used = {x for tp in firstaid["topics"] for i in tp.get("steps", []) + tp.get("dont", []) + [tp] for x in i.get("src", [])}
        if used - known:
            problems.append(f"firstaid.json: src ids not in sources: {sorted(used - known)}")
    for g in guides:   # ctx ต้องเป็นค่าที่แอปรู้จัก ไม่งั้นรายการจะแสดงกับทุกบ้านโดยไม่ตั้งใจ
        for i in [i for p in g["phases"].values() for i in p] + g.get("kit", []):
            c = i.get("ctx", "all")
            if not set(c if isinstance(c, list) else [c]) <= {"all", "condo", "house", "town"}:
                problems.append(f"{g['id']}: unknown ctx {c!r}")
    data = {"guides": guides, "checklist": checklist, "firstaid": firstaid, "built": date.today().isoformat()}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    tpl = (ROOT / "src" / "app.html").read_text(encoding="utf-8")
    start, end = tpl.index("/*__DATA__*/"), tpl.index("/*__END__*/") + len("/*__END__*/")
    html = tpl[:start] + blob + tpl[end:]
    if "--no-sync" in sys.argv:
        html = html.replace("/*__SYNC_ON__*/true", "/*__SYNC_ON__*/false")

    # CSP: อนุญาตเฉพาะสคริปต์ในไฟล์นี้ (ผูกด้วย hash) สคริปต์ที่ถูกฉีดเข้ามาจะไม่ทำงาน
    script = html[html.index("<script>") + len("<script>"):html.rindex("</script>")]
    # --dev อนุญาตบริการซิงก์ที่รันในเครื่อง (wrangler dev) ห้ามใช้ build แบบนี้ขึ้นเว็บจริง
    connect = "'self' " + SYNC_ORIGIN + (" http://127.0.0.1:8787" if "--dev" in sys.argv else "")
    digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode()
    csp = ("default-src 'none'; script-src 'sha256-" + digest + "'; style-src 'unsafe-inline'; img-src 'self' data:; "
           "manifest-src 'self'; worker-src 'self'; connect-src " + connect + "; base-uri 'none'; form-action 'none'")
    html = html.replace("<!--__CSP__-->", f'<meta http-equiv="Content-Security-Policy" content="{csp}">')
    (ROOT / "index.html").write_text(html, encoding="utf-8", newline="\n")

    ver = hashlib.sha256(html.encode("utf-8")).hexdigest()[:10]
    (ROOT / "sw.js").write_text(SW.replace("__VER__", ver), encoding="utf-8", newline="\n")
    (ROOT / "manifest.webmanifest").write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    for size in (192, 512):
        out = ROOT / f"icon-{size}.png"
        if not out.exists():
            out.write_bytes(icon(size))

    for p in problems:
        print("WARN", p)
    print(f"built index.html: {len(guides)} guides, {len(checklist['items'])} checklist items, {len(html) // 1024} KB, cache {ver}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

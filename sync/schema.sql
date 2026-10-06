-- ฐานข้อมูลของบริการซิงก์ (Cloudflare D1)
CREATE TABLE IF NOT EXISTS homes (
  id         TEXT PRIMARY KEY,     -- id สุ่มของบ้าน แตกมาจากรหัสลับในเครื่องผู้ใช้
  token_hash TEXT NOT NULL,        -- SHA-256 ของโทเคน ไม่เก็บโทเคนจริง
  ver        INTEGER NOT NULL,     -- เพิ่มทีละ 1 ทุกครั้งที่เขียน ใช้กันเขียนทับกัน
  data       TEXT NOT NULL,        -- ข้อมูลที่เข้ารหัสแล้ว (AES-GCM) เซิร์ฟเวอร์อ่านไม่ได้
  updated    INTEGER NOT NULL,
  seen       INTEGER NOT NULL,     -- ครั้งล่าสุดที่มีเครื่องมาอ่านหรือเขียน ใช้ลบบ้านที่ถูกทิ้ง
  created    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS homes_seen ON homes (seen);

CREATE TABLE IF NOT EXISTS quota (
  k TEXT PRIMARY KEY,              -- วันที่ + แฮชของ IP ลบภายใน 2 วัน
  n INTEGER NOT NULL
);

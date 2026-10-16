# Binder Town Manager — แผนสถาปัตยกรรม (อิงจาก Pelican Manager v4.3)

## Pelican Manager ทำงานยังไง

```
Start_Pelican.bat / PelicanManager.exe
        │
        ▼
manager/server.js  (Node, http://localhost:3888 — Dashboard + API)
        │  เปิด/คุมหน้าต่างเกมแต่ละ profile
        ├── browser_mode.js : Chrome/Edge ตัวเดียว หลายหน้าต่าง คุมผ่าน CDP (port 9339)
        │                      ฉีด window.__pmProfileId + msgpack + bot.js ทุกครั้งที่โหลดหน้าเกม
        └── main.js (Electron loader) : แบบ 1 แอปต่อ 1 profile, เปิด HTTP /api/state /api/eval /api/window
        │
        ▼
bot.js  (userscript ~1.1 MB, รันใน page ที่ document-start)
        ├── hook WebSocket (prototype.send + Proxy constructor) → ดัก/ถอด packet ด้วย msgpack
        ├── loop บอท: ฟาร์ม, ขาย, เดิน, ปาร์ตี้, boss hunt ...
        ├── HUD (#pelican-hud) + config ใน localStorage แยกต่อ profile (pelican_<pid>__*)
        └── window.__getClientLiveState() ← Manager เรียกผ่าน Runtime.evaluate เพื่อดึงสถานะ
        │
manager/ โมดูลเสริม: party, boss_hunt, discord_bot, auto_relaunch, screen_watch,
         inventory_market_api, token_trader, plan_sync/plans.json, profiles.json ...
```

## ใช้ซ้ำได้กับ Binder Town

| ส่วน | ใช้ซ้ำ | หมายเหตุ |
|---|---|---|
| server.js + Dashboard | ✅ เกือบทั้งหมด | เปลี่ยนชื่อเกม/URL, ตัดส่วนเฉพาะ Aetheria |
| browser_mode.js (CDP, หลายหน้าต่าง) | ✅ | `GAME_URL` → `https://play.bindertowngame.com/` และ path ของ bot script |
| profiles / sessions / auto_relaunch / screen_watch | ✅ | |
| discord_bot, party | 🟡 | โครงใช้ได้ แต่ข้อความ/คำสั่งในเกมต้องเขียนใหม่ |
| bot.js | ❌ ต้องเขียนใหม่ | protocol คนละแบบ (ดูด้านล่าง) |
| item_catalog / boss_drops | ❌ | ใช้ `data/` ที่ dump มาแทน |
| ระบบแก้ captcha / human-check / board solver | ❌ ไม่ทำ | ไม่พอร์ตส่วนที่หลบระบบตรวจจับบอท |

## bot.js ของ Binder Town ต่างจากเดิมตรงไหน

1. **Socket**: เกมใช้ Colyseus — packet = protocol code (1 byte) + msgpack ([รายละเอียด](protocol/README.md))
   - คำสั่ง: ROOM_DATA ชื่อ `"input"` + `{type, ...}`
   - เหตุการณ์: ROOM_DATA ชื่อ `"server"`
   - state (ตำแหน่ง player/mob): binary patch ของ `@colyseus/schema` → **ต้องใช้ Decoder** ถอดเอง
     (bundle `@colyseus/schema` เข้าไปใน bot แล้วรับ Reflection ตอน JOIN_ROOM) หรืออาศัย `census` ไปก่อน
2. **ตัวแปรเกมไม่ได้อยู่ใน window**: ทุกอย่างอยู่ใน module scope → ต้องอ่านจาก socket อย่างเดียว ไม่มี object ให้เรียกตรงๆ
3. **ข้อมูลเกม**: โหลด `data/bot/*.json` เข้าไปใน bot (mobs, spawns, routes, npcs, items)

## ลำดับงานต่อไป

1. ตรวจ traffic จริง: hook WebSocket ใน hook ขั้นต่ำ แล้ว log frame ตอนเดิน/ตี/เก็บของ/วาร์ป → ยืนยัน `protocol.md` และหาฟิลด์ schema
2. ทำ `binder_bot.js` ขั้นต่ำ: hook socket → ถอด `server` message → ส่ง `moveTo`/`attack`/`skill` → ฟาร์มมอน 1 ชนิดในแมพเดียว
   ใช้ `data/bot/mob_spawns.json` เลือกจุด, `zone_routes.json` เดินข้ามแมพ, ตอบ `idleWarn` ด้วย `stillHere`
3. ก๊อป Pelican Manager เป็น `Binder_Town/manager` → แก้ `GAME_URL`, path ของ bot script, ตัดโมดูลเฉพาะ Aetheria
4. เพิ่มฟีเจอร์: ขายของ NPC (`sell`/`autoSell`), เก็บของ (`gather` + `gather_nodes.json`), ปาร์ตี้, หลายไอดี

## อัปเดตข้อมูลตอนเกมออก build ใหม่

```
cd Binder_Town/tools
npm install      (ครั้งแรกครั้งเดียว)
node dump.js     → raw/, data/, protocol/ ถูกสร้างใหม่ทั้งหมด
```
ตารางถูกหาจาก "รูปร่างข้อมูล" (`tools/find.js`) ไม่ใช่ชื่อตัวแปร ถ้าเกมเปลี่ยนโครงสร้างจะเห็น `not found: ...` ใน log

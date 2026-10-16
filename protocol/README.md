# Binder Town — Protocol (แกะจาก client build 20261015-163807)

ไฟล์ในโฟลเดอร์นี้
- `protocol.md` — ตาราง message ทุกแบบ: client→server 156 แบบ, server→client 134 แบบ (สร้างอัตโนมัติด้วย `tools/proto.js`)
- `protocol.json` — ข้อมูลเดียวกันแบบอ่านด้วยโปรแกรม พร้อมโค้ดตัวอย่างจาก client

- `state_schema.json` — schema ของ room state ที่ถอดจาก traffic จริง

> ตาราง message อ่านจากโค้ด client และตรวจกับ traffic จริงแล้วบางส่วน (ดู "ตรวจกับ traffic จริงแล้ว")

## ภาพรวม

| ชั้น | รายละเอียด |
|---|---|
| Framework | **Colyseus** (client 0.16: มี `getDecoderStateCallbacks`) + `@colyseus/schema` แบบ Reflection — client ไม่ได้ประกาศ schema เอง server ส่งมาให้ตอน join |
| Server | `wss://play.bindertowngame.com` (ผ่าน Cloudflare) · `GET /api/topology` ส่งกลับ `{count, route:"port"\|"path", ports[], routes[]}` สำหรับแบ่ง shard |
| Room | `map_<mapId>_ch<channel>` เช่น `map_southvale_field_ch1` · 1 แมพ × 1 channel = 1 room |
| Join options | `{name, gender, profile, autoChannel, queuePass, invDelta:true}` · ตอนวาร์ปเพิ่ม `transfer:<token>` |
| ส่งคำสั่ง | `room.send("input", {type, ...})` — **ทุกคำสั่งใช้ message ชื่อ `"input"`** แยกด้วย `type` |
| รับเหตุการณ์ | `room.onMessage("server", msg)` — msg อาจเป็น object เดียวหรือ array · แยกด้วย `msg.type` |
| State | `room.state.players` / `room.state.mobs` (MapSchema) · มี `state.pt` = server tick time |
| Kick | onLeave code `4001` / `4005` / `4007` = ถูกเตะ (ไม่ต่อใหม่เอง) · code อื่น = หลุด |

## ขั้นตอนล็อกอิน (HTTP, cookie session)

1. `GET /api/me` → ถ้ามี session อยู่แล้วจะได้ `{providers, ...}`
2. ถ้าไม่มี: `POST /api/guest` body `{}` หรือ `{key}` → `{me}` · error อาจมี `guard:true`
   ล็อกอินแบบอื่น: `/api/local/login`, `/api/local/register`, Google/Discord (OAuth)
3. ยังไม่มีตัวละคร: `GET /api/name?n=` (เช็คชื่อ) → `POST /api/character`
4. คิว (ตอนคนเต็ม): `GET /api/queue?ticket=` วนจนได้ `{ok, pass}` → ส่ง `queuePass` ตอน join
5. `GET /api/channel?map=<id>&cur=<ch>` → `{ch}` channel ที่คนน้อย
6. join room → ส่ง `{type:"socialQuery"}`

## คำสั่งหลักที่บอทต้องใช้

| ทำอะไร | ส่ง | ได้กลับ |
|---|---|---|
| เดินไปจุด | `moveTo {x, y}` | state player x/y เปลี่ยน |
| เดินต่อเนื่อง | `dir {dx, dy}` | |
| ตีปกติ | `attack {x, y, auto?}` | `basicAttack`, `hit` |
| ใช้สกิล | `skill {skillId, x, y, auto?}` | `castStart`, `cast`, `hit`, `cdSync` |
| หลบ | `dodge` | `cdSync{skillId:"dodge"}` |
| เก็บของ | `gather {nodeId}` | `gatherResult` / `gatherFailed` |
| ตกปลา | `fish` | `gatherResult` |
| ใช้ไอเทม | `useItem {itemId}` | `potionCd` |
| ขาย NPC | `sell {itemId, qty}` / `sellMany` / `sellBulk` / `autoSell` | `sold`, `autoSold` |
| ซื้อ NPC | `shopBuy` / `vendorBuy` | `bought` |
| คุย NPC | `talk {npcId}` | `dialog {npcId}` |
| วาร์ป | `warpMenu` → `warpTo {mapId}` | `warps`, `warp {mapId, channel, token}` |
| เกิดใหม่ | `respawn {here?}` | `respawned` |
| Auto ในเกม | `autoState {on}` | |
| ping | `ping {t}` | `pong {t, online, build}` |
| กันโดนเตะ AFK | `stillHere` (ตอบ `idleWarn {leftMs}`) | |

เหตุการณ์ที่ควรฟัง: `killGain {xp, job, gold}`, `levelUp`, `jobLevelUp`, `youDied`, `deathPenalty`, `inv`, `notice`, `idleWarn`, `mapFull`/`mapQueue`, `maintenance {inMs}`, `drain {inMs, version}` (server กำลังรีสตาร์ต), `census {m, p, n}` (ตำแหน่งมอน/ผู้เล่นบน minimap)

สถานะของ player: `idle, move, gather, fish, attack, dodge, dead` · สถานะของ mob: `idle, alert, chase, attack, flee, return, sleep, hidden, dead`

## ตรวจกับ traffic จริงแล้ว (2026-10-16)

ดักจาก browser pane ระหว่างเล่นจริง: ได้ 1,300+ frame, ข้อความ server ตรงกับ `protocol.md` ทุกแบบที่เจอ
(`hit, died, respawned, castStart, cast, projectile, census, inv, pong, mobAttack, dashMove, zone, basicAttack ...`)

**รูปแบบ wire** (byte แรก = Colyseus protocol code)

| code | ทิศ | ความหมาย |
|---|---|---|
| 10 | in | JOIN_ROOM: `[10][len][reconnectionToken][len]"schema"[reflection]` — มี schema ทั้งหมดอยู่ในนี้ |
| 10 | out | client ตอบรับ (1 byte) |
| 12 | out | ออกจาก room (ตอนวาร์ป/เปลี่ยน channel) |
| 13 | in/out | ROOM_DATA: `[13][msgpack ชื่อ "server"/"input"][msgpack payload]` |
| 14 | in | ROOM_STATE: state เต็มตอนเข้า room |
| 15 | in | ROOM_STATE_PATCH: patch ของ state (~10–20 ครั้ง/วินาที) |

- **ขาส่ง**: client ใช้ msgpackr แบบ `useRecords` → payload เป็น `d4 72 40` (record def) + array ชื่อ key + ค่าเรียงตามลำดับ
  เช่น `moveTo` = `d4 72 40 93 ["type","x","y"] "moveTo" 47.28 39.66`
- **ขารับ**: msgpack ปกติ · `undefined` ถูกส่งเป็น `d4 00 00`
- server ส่ง event หลายอันรวมเป็น array ใน message เดียวบ่อยมาก

**State schema** (ถอดจาก reflection ด้วย `tools/decode_state.js` → [`state_schema.json`](state_schema.json))

| type | ฟิลด์สำคัญ |
|---|---|
| MapState (root) | `mapId, dayTime, worldTime, pt, players, mobs, nodes, loots, bossZones, campfires, graves` |
| Player | `qx, qy, st, hp, maxHp, mp, maxMp, xp, level, job, jobLevel, jobXp, silver, name, uid, castSkill, gatherNode, fight, effects(JSON), skillLevels, str/agi/vit/int/dex/luk` |
| Mob | `mobType, level, qx, qy, st, hp, maxHp, ownerId, fighters, bossGuard, effects` |
| GatherNode | `nodeType, x, y, tier, available, charges, maxCharges, respawnAt, golden` |
| Loot | `itemId, qty, x, y, owner, ownerUntil` |
| Grave | `x, y, mobType, level, killer, respawnAt` (ศพมอนบอส/อีลิท) |

- ตำแหน่ง: **`x = qx / 64`, `y = qy / 64`** (uint16) · ของ Loot/Node เป็น float อยู่แล้ว
- `st` ของ Player: `0 idle, 1 move, 2 gather, 3 fish, 4 attack, 5 dodge, 6 dead`
- `st` ของ Mob: `0 idle, 1 alert, 2 chase, 3 attack, 4 flee, 5 return, 6 sleep, 7 hidden, 8 dead`
- key ใน `players` = sessionId (`basicAttack.id`, `hit.actorId` ใช้ id นี้) · key ใน `mobs` = `m_<group>_<n>`

## สิ่งที่ต้องใช้สำหรับ "ของเต็ม → กลับไปขาย / ตาย → กลับมาฟาร์ม"

| เงื่อนไข | ดูจาก |
|---|---|
| ตำแหน่ง/แมพตัวเอง | `state.players[mySessionId].qx/qy`, `state.mapId` |
| ตาย | event `youDied` / Player `st === 6` → `respawn` → event `respawned` |
| ของเต็ม | event `inv` มีแค่ `items[{id,qty}]`, `equip` ฯลฯ — **ไม่มีฟิลด์น้ำหนัก/ความจุ** client คำนวณเอง (300 ช่อง + น้ำหนักจาก STR) ต้องหาสูตรใน client ต่อ · join ด้วย `invDelta:true` → `inv` ครั้งต่อๆ ไปอาจเป็น delta |
| กลับเมือง/ไปแมพฟาร์ม | `warpMenu` → `warpTo {mapId}` หรือเดินตาม `data/bot/zone_routes.json` |
| ขาย | `talk {npcId}` (merchant) → `sell` / `sellMany` / `sellBulk` → event `sold` |
| เปิด AUTO ของเกมต่อ | `autoState {on:true}` |

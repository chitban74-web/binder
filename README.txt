Binder Town Manager — release 1.0.4

วิธีเปิด
1. ดับเบิลคลิก Binder-Town-Manager.exe
2. ไอคอน Binder Town Manager จะอยู่ใน System Tray และ Dashboard จะเปิดในเบราว์เซอร์
3. ใช้ Dashboard เพื่อสร้างโปรไฟล์และเปิดเกม

การควบคุม
- ดับเบิลคลิกไอคอน System Tray หรือเลือก “เปิด Dashboard” เพื่อเปิดหน้า Manager
- คลิกขวาไอคอนเพื่อเปิด Dashboard, รีสตาร์ตเซิร์ฟเวอร์ หรือปิดโปรแกรม
- ปิดโปรแกรมจากเมนูใน System Tray เพื่อหยุด Manager และหน้าต่างเกมที่เปิดโดยโปรแกรม

สิ่งที่รวมมาในชุดนี้
- Binder-Town-Manager.exe เป็น Windows launcher ขนาดเล็กและทำงานใน System Tray
- Start_Binder.bat และ Stop_Binder.bat สำหรับเปิดหรือหยุดผ่าน Console
- bin/node.exe เป็น Node.js portable ไม่ต้องติดตั้ง Node.js เพิ่ม
- ต้องติดตั้ง Chrome, Edge หรือ Brave เพื่อเปิดหน้าต่างเกม

ข้อมูลผู้ใช้
- รายการโปรไฟล์และข้อมูลเบราว์เซอร์เก็บใน %APPDATA%\Binder Town Manager
- เมื่อลบโปรไฟล์ ระบบจะลบข้อมูลเบราว์เซอร์ของโปรไฟล์นั้นด้วย

การทำงานของ Helper
- สถานะฟาร์มและ Gathering จะจำโหมดที่เลือกไว้เมื่อรีโหลด helper หรือเปิดแท็บเกมใหม่
- ปุ่มทดสอบ full routine ในเมนูขายของทำรายการจริงตามตัวกรอง ซื้อยา และฝากวัตถุดิบ

หมายเหตุ
- launcher นี้เปิด Dashboard ในเบราว์เซอร์เริ่มต้นเหมือน Pelican Manager
- ตัว .exe ยังไม่ได้เซ็นรับรองด้วย certificate ผู้เผยแพร่ Windows อาจแสดงคำเตือนเมื่อเปิดครั้งแรก


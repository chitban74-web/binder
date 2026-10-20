Binder Town Manager

วิธีเปิด
1. ดับเบิลคลิก Start_Binder.bat
2. Dashboard จะเปิดที่ http://localhost:3889 ในเบราว์เซอร์
3. ใช้ Dashboard เพื่อสร้างโปรไฟล์และเปิดเกม

การควบคุม
- ดับเบิลคลิก Start_Binder.bat เพื่อเปิด Manager
- ดับเบิลคลิก Stop_Binder.bat เพื่อหยุด Manager และหน้าต่างเกมที่เปิดโดยโปรแกรม
- เครื่องลูกจะเก็บการแก้ไขไฟล์ที่ติดตามโดย Git ไว้ใน Git stash ก่อนเปิด Manager; เครื่องหลักที่มี .binder-main จะข้ามขั้นตอนนี้
- ดูรายการสำรองด้วย git stash list และกู้คืนรายการล่าสุดด้วย git stash pop

สิ่งที่รวมมาในชุดนี้
- Start_Binder.bat และ Stop_Binder.bat สำหรับเปิดและหยุด Manager
- ต้องมี Node.js 22 ขึ้นไป หรือวาง portable Node.js ที่ bin\node.exe
- ต้องติดตั้ง Chrome, Edge หรือ Brave เพื่อเปิดหน้าต่างเกม

ข้อมูลผู้ใช้
- รายการโปรไฟล์และข้อมูลเบราว์เซอร์เก็บใน %APPDATA%\Binder Town Manager
- เมื่อลบโปรไฟล์ ระบบจะลบข้อมูลเบราว์เซอร์ของโปรไฟล์นั้นด้วย

อัปเดตจาก Private GitHub repo
- รัน set_token.bat แล้วใส่ Fine-grained GitHub token ที่มีสิทธิ์อ่าน Contents ของ repo ต้นทาง
- ปิดและเปิด Manager ใหม่; ตัวอัปเดตใช้ token เรียก GitHub API เพื่อหา Private repo ที่ token อนุญาต
- ถ้า token อนุญาตหลาย Private repo ให้ตั้ง BINDER_UPDATE_REPO เป็น owner/repo ของ repo ต้นทาง
- origin ของ Git ในเครื่องนี้เป็น repo ปลายทางสำหรับ push; ปุ่ม “ดึงจาก token” ไม่ push และไม่เปลี่ยน origin
- อย่าแชร์หรือ commit token; token ถูกเก็บใน environment ของบัญชี Windows นี้

การทำงานของ Helper
- สถานะฟาร์มและ Gathering จะจำโหมดที่เลือกไว้เมื่อรีโหลด helper หรือเปิดแท็บเกมใหม่
- ปุ่มทดสอบ full routine ในเมนูขายของทำรายการจริงตามตัวกรอง ซื้อยา และฝากวัตถุดิบ

หมายเหตุ
- Start_Binder.bat เปิด Manager เบื้องหลังและเปิด Dashboard ในเบราว์เซอร์เริ่มต้น


Binder Town Manager — release 1.0.1

ติดตั้ง
1. แตกโฟลเดอร์ release-1.0.1 ไว้ในตำแหน่งที่ต้องการ
2. ติดตั้ง Node.js รุ่น LTS และติดตั้ง Chrome, Edge, Brave หรือ Vivaldi
3. เปิด Start_Binder.bat
4. เปิด http://localhost:3889 แล้วใช้หน้า Manager เพื่อเปิดเกม

หยุดระบบ
เปิด Stop_Binder.bat

โครงสร้าง Helper
- helper/binder_helper.js เป็น controller หลักและจัดการระบบที่ใช้ร่วมกัน
- helper/pages/ มีไฟล์ UI และการตั้งค่าของแต่ละหน้าเมนู

หมายเหตุ
- ชุดนี้ไม่มี Git metadata จึงไม่มีปุ่มอัปเดตจาก GitHub; ใช้ release ชุดใหม่เมื่อต้องการอัปเดต
- โปรไฟล์เบราว์เซอร์และข้อมูลล็อกอินจะถูกสร้างในโฟลเดอร์ profiles หลังเปิดเกม
- เก็บโฟลเดอร์ profiles ไว้เป็นส่วนตัว และอย่าส่งต่อให้ผู้อื่น

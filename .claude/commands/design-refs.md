---
description: เปิด Bookmark แหล่งอ้างอิงงานออกแบบ UX/UI ของ Petmore Magic Sale
argument-hint: "[ชื่อแหล่ง หรือสิ่งที่อยากออกแบบ (ไม่บังคับ)]"
---

แสดงรายการ Bookmark ด้านล่างให้ผู้ใช้เป็นภาษาไทย เป็นลิงก์ที่กดได้ พร้อมบอกสั้นๆ ว่าแต่ละแหล่งใช้ทำอะไร

ถ้าผู้ใช้ใส่ข้อความมาด้วย: $ARGUMENTS
ให้แนะนำว่าควรใช้แหล่งไหนกับงานนั้น และคอมโพเนนต์หรือคำสั่งที่เกี่ยวข้อง (เช่น ชื่อคอมโพเนนต์ React Bits ที่เข้ากับธีม Magic × ร้านอาหารสัตว์) โดยดูธีมและข้อห้ามใน CLAUDE.md ประกอบ

## Bookmark

1. **React Bits** — https://github.com/DavidHDev/react-bits
   แอนิเมชันกว่า 200 แบบ (ข้อความ พื้นหลัง micro-interaction 3D) เว็บตัวอย่าง: https://reactbits.dev
   ติดตั้ง: `npx shadcn@latest add @react-bits/<Name>-TS-TW` (หรือ `-TS-CSS` ถ้าไม่ใช้ Tailwind)
2. **shadcn/ui** — https://github.com/shadcn-ui/ui
   คอมโพเนนต์พื้นฐานแบบคัดลอกเข้าโปรเจ็กต์ (Radix + Tailwind) เว็บ: https://ui.shadcn.com
3. **Vercel Templates** — https://vercel.com/templates
   เทมเพลตเว็บแอปสำเร็จรูป ใช้ดูโครงหน้าและ layout
4. **Impeccable** — https://github.com/pbakaus/impeccable
   skill ช่วยออกแบบสำหรับ AI: `/impeccable audit`, `critique`, `polish`, `colorize`, `typeset`, `animate` และกฎตรวจ anti-pattern 60 ข้อ
   ติดตั้ง: `npx impeccable install` หรือ `/plugin marketplace add pbakaus/impeccable`

Bookmark ชุดเดียวกันอยู่ในหน้า "Petmore Magic Design Board" ที่ปักหมุดไว้ใน sidebar ของ claude.ai

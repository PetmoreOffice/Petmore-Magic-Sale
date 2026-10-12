# วิธี Deploy ขึ้นเครื่องเซิร์ฟเวอร์บริษัท

ย้ายระบบจากโน้ตบุ๊กไปเครื่องเซิร์ฟเวอร์ Windows ที่เปิดทั้งวัน ใช้ไฟล์ในโฟลเดอร์ `deploy/` ทั้งหมด
(ทดสอบครบทุกขั้นบนโน้ตบุ๊กแล้วเมื่อ 12 ต.ค. 2569: build, ย้ายข้อมูล, เข้าสู่ระบบผ่าน Caddy, sync จาก SQL Server, สำรองข้อมูล)

```
มือถือ Sup (นอกบริษัท) ──https──▶ Cloudflare ──Tunnel──┐
                                                       ▼
Handheld / คอมในบริษัท ──http://IP-เซิร์ฟเวอร์──▶ web (Caddy) ──/api──▶ api (NestJS) ──▶ db (PostgreSQL)
                                                                         │
                                                                         └─อ่านอย่างเดียว─▶ SQL Server บริษัท
```

| ส่วน | ทำอะไร |
|---|---|
| `db` | PostgreSQL 17 เก็บข้อมูลทั้งหมด ไม่เปิดพอร์ตออกนอกเครื่อง |
| `api` | NestJS รัน migration เองทุกครั้งที่เปิด แล้วค่อยรับคำขอ ไม่เปิดพอร์ตออกนอกเครื่อง |
| `web` | Caddy เสิร์ฟหน้าเว็บ และส่ง `/api` ต่อให้ api เปิดพอร์ต 80 ให้คนในวง LAN |
| `tunnel` | cloudflared ให้คนนอกบริษัทเข้าผ่าน https (เปิดหลังซื้อโดเมนแล้ว) |

ขั้นที่ 1–6 ทำได้เลยโดยไม่ต้องมีโดเมน ใช้ในวง LAN ได้ทันที ส่วนขั้นที่ 7 รอซื้อโดเมนก่อน

---

## 0. เช็กก่อนเริ่ม

- **รุ่น Windows**: กด `Win + R` พิมพ์ `winver`
  - Windows 10/11 **Pro** ทำตามคู่มือนี้ได้เลย
  - **Windows Server** ใช้ Docker Desktop ไม่ได้ ต้องเปลี่ยนวิธีติดตั้ง แจ้งก่อนเริ่ม
- **เครื่อง**: RAM 8 GB ขึ้นไป, ดิสก์ว่าง 20 GB ขึ้นไป, เปิด Virtualization ใน BIOS แล้ว (เช็กใน Task Manager → Performance → CPU → Virtualization: Enabled)
- **IP ตายตัว**: ให้ IT จอง IP ของเครื่องนี้ไว้ (เช่น `192.168.10.20`) Handheld จะเข้าด้วย IP นี้ตลอด
- **SQL Server บริษัท**: เครื่องนี้ต้องต่อถึง `192.168.10.250` พอร์ต 1433 ได้ เช็กใน PowerShell:
  ```powershell
  Test-NetConnection 192.168.10.250 -Port 1433
  ```
  ต้องขึ้น `TcpTestSucceeded : True`
- **สิทธิ์ใช้ Docker Desktop**: ฟรีเมื่อบริษัทมีพนักงานไม่ถึง 250 คน **และ** รายได้ไม่ถึง 10 ล้านดอลลาร์ต่อปี ถ้าเกินต้องซื้อ Docker subscription

## 1. ติดตั้งโปรแกรมบนเซิร์ฟเวอร์

1. ติดตั้ง [Git for Windows](https://git-scm.com/download/win) (ค่าตั้งต้นทั้งหมด)
2. ติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) เลือกใช้ **WSL 2** แล้วรีสตาร์ทเครื่อง
3. เปิด Docker Desktop → Settings → General → ติ๊ก **Start Docker Desktop when you sign in to your computer**
4. ให้เครื่องเปิดตลอด:
   - Settings → System → Power → Screen and sleep → **Sleep: Never**
   - ตั้ง Windows ให้เข้าสู่ระบบอัตโนมัติหลังรีสตาร์ท (เช่น หลังอัปเดต) ไม่งั้น Docker Desktop จะไม่เปิดจนกว่าจะมีคนมา login ที่เครื่อง ใช้เครื่องมือ [Autologon ของ Microsoft](https://learn.microsoft.com/sysinternals/downloads/autologon)
   - ล็อกหน้าจอได้ตามปกติ (`Win + L`) ระบบยังทำงานอยู่

## 2. ดึงโค้ดลงเครื่อง

```powershell
git clone https://github.com/PetmoreOffice/Petmore-Magic-Sale.git C:\petmore
```

ถ้า repo เป็น private Git จะขอให้ login GitHub ให้ login ด้วยบัญชีที่มีสิทธิ์เข้า repo

## 3. ตั้งค่า `deploy\.env`

```powershell
cd C:\petmore\deploy
copy .env.example .env
notepad .env
```

ใส่ค่าต่อไปนี้:

| ค่า | ใส่อะไร |
|---|---|
| `POSTGRES_PASSWORD` | รหัสผ่านฐานข้อมูลใหม่ยาวๆ สุ่มด้วยคำสั่งข้างล่าง |
| `HTTP_PORT` | `80` (ถ้าเครื่องมี IIS หรือโปรแกรมอื่นใช้ 80 อยู่ เปลี่ยนเป็น `8080`) |
| `MSSQL_*` และ `SYNC_CRON` | คัดลอกบรรทัดเหล่านี้จาก `apps\api\.env` บนโน้ตบุ๊ก **ทั้งบรรทัดตามเดิม** |
| `SEED_ADMIN_*` | ใส่เฉพาะตอนเริ่มระบบใหม่ ไม่ได้ย้ายข้อมูลจากโน้ตบุ๊ก (ขั้นที่ 5ข) |
| `TUNNEL_TOKEN` | เว้นไว้ก่อน ใส่ในขั้นที่ 7 |

สุ่มรหัสผ่านฐานข้อมูล:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
```

> ย้ายค่า `MSSQL_PASSWORD` ด้วย USB หรือพิมพ์เองที่เครื่อง อย่าส่งทางแชตหรืออีเมล และห้าม commit ไฟล์ `.env` (อยู่ใน .gitignore แล้ว)

## 4. เปิดระบบ

```powershell
cd C:\petmore\deploy
docker compose up -d --build
```

ครั้งแรกใช้เวลา 3–5 นาที (ดาวน์โหลดและ build) เสร็จแล้วเช็ก:

```powershell
docker compose ps
```

ต้องเห็น `petmore-db-1` (healthy), `petmore-api-1`, `petmore-web-1` สถานะ Up ทั้ง 3 ตัว ดู log ของ API:

```powershell
docker compose logs api --tail 20
```

ต้องเห็น `Nest application successfully started` แล้วเปิด `http://localhost` บนเซิร์ฟเวอร์ จะเห็นหน้าบัตรเข้างาน

ทุก container ตั้ง `restart: unless-stopped` แล้ว เครื่องรีสตาร์ทหรือ Docker เปิดใหม่ ระบบกลับมาเอง

## 5. ข้อมูลตั้งต้น (เลือก ก หรือ ข)

### 5ก. ย้ายข้อมูลจากโน้ตบุ๊ก (แนะนำ: ได้ผู้ใช้ สิทธิ์ ออเดอร์ และสินค้าครบ)

**บนโน้ตบุ๊ก** (Docker Desktop เปิดอยู่):

```powershell
docker exec petmoremagicsaleoms-db-1 pg_dump -U wms -d petmore_wms -Fc -f /tmp/move.dump
docker cp petmoremagicsaleoms-db-1:/tmp/move.dump C:\petmore-move.dump
```

คัดลอก `C:\petmore-move.dump` ไปไว้ที่ `C:\petmore-move.dump` บนเซิร์ฟเวอร์ (USB หรือแชร์ไฟล์ในบริษัท)

**บนเซิร์ฟเวอร์**:

```powershell
cd C:\petmore\deploy
docker compose stop api
docker exec petmore-db-1 dropdb -U wms --force petmore_wms
docker exec petmore-db-1 createdb -U wms petmore_wms
docker cp C:\petmore-move.dump petmore-db-1:/tmp/move.dump
docker exec petmore-db-1 pg_restore -U wms -d petmore_wms --no-owner /tmp/move.dump
docker exec petmore-db-1 rm /tmp/move.dump
docker compose start api
```

เช็กว่าข้อมูลมาครบ (เทียบกับโน้ตบุ๊กด้วยคำสั่งเดียวกันแต่เปลี่ยนเป็น `petmoremagicsaleoms-db-1`):

```powershell
'select (select count(*) from "User") as users, (select count(*) from "Product") as products, (select count(*) from "SalesOrder") as orders;' | docker exec -i petmore-db-1 psql -U wms -d petmore_wms
```

เข้าสู่ระบบด้วยบัญชีเดิมที่ใช้บนโน้ตบุ๊กได้เลย หลังย้ายแล้ว **เลิกใช้ระบบบนโน้ตบุ๊ก** ไม่งั้นข้อมูลสองที่จะไม่ตรงกัน

### 5ข. เริ่มระบบใหม่ (ไม่มีข้อมูลเดิม)

ใส่ `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (อย่างน้อย 8 ตัว) ใน `deploy\.env` แล้ว:

```powershell
cd C:\petmore\deploy
docker compose up -d
docker compose exec api npx tsx prisma/seed.ts
```

เสร็จแล้วลบค่า `SEED_ADMIN_PASSWORD` ออกจาก `.env` สินค้าและผู้สั่งจะ sync จาก SQL Server เองภายใน 15 นาที

## 6. ให้ Handheld และคอมในบริษัทเข้าได้

เปิดพอร์ต 80 ใน Windows Firewall (PowerShell แบบ **Run as administrator**):

```powershell
New-NetFirewallRule -DisplayName "Petmore Magic Sale (web)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Domain,Private
```

แล้วเปิด `http://192.168.10.20` (IP ของเซิร์ฟเวอร์) บน Handheld หรือคอม ถ้าตั้ง `HTTP_PORT=8080` ให้เปิดพอร์ต 8080 แทน และใช้ `http://192.168.10.20:8080`

- หัวสแกนของ Handheld และเครื่องสแกน USB ใช้กับ http ได้ปกติ
- **กล้องมือถือใช้ไม่ได้บน http** (เบราว์เซอร์อนุญาตเฉพาะ https) และติดตั้งเป็นไอคอนแอปไม่ได้ ต้องรอขั้นที่ 7

## 7. คนนอกบริษัท (Sup ที่หน้างาน) ผ่าน Cloudflare Tunnel — ทำหลังซื้อโดเมน

ไม่ต้องเปิดพอร์ตที่ router และไม่ต้องมี IP จริง Cloudflare ให้ https ฟรี กล้องมือถือจึงใช้ได้

1. **ซื้อโดเมน** ที่ Cloudflare dashboard → Domain Registration → Register Domains (`.com` ประมาณ 10.46 ดอลลาร์ต่อปี)
2. **สร้าง Tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** → เลือก **Cloudflared** → ตั้งชื่อ `petmore`
3. หน้าติดตั้ง connector เลือก **Docker** จะเห็นคำสั่งที่ลงท้ายด้วย `--token eyJ...` คัดลอกเฉพาะข้อความยาวหลัง `--token` ไปใส่ `TUNNEL_TOKEN=` ใน `deploy\.env` (**ไม่ต้อง**รันคำสั่งที่ Cloudflare ให้มา)
4. แท็บ **Public Hostname** → Add:
   - Subdomain: `oms` (หรือชื่ออื่น), Domain: โดเมนที่ซื้อ
   - Service Type: **HTTP**, URL: **`web:8080`**
5. เปิด tunnel บนเซิร์ฟเวอร์:
   ```powershell
   cd C:\petmore\deploy
   docker compose --profile tunnel up -d
   ```
6. เปิด `https://oms.โดเมนของคุณ` จากมือถือ (ใช้เน็ตมือถือ ไม่ใช่ Wi-Fi บริษัท) ต้องเห็นหน้าเข้าสู่ระบบ แล้วลองกดปุ่มกล้องในหน้าตรวจของเบิก

ข้อสำคัญ:
- **ไม่เปิด** Cloudflare Access (ตกลงกันไว้แล้ว ใช้ล็อกอินของแอป เพราะ Access ฟรีแค่ 50 คน)
- URL ใน Public Hostname ต้องเป็น `web:8080` เท่านั้น ทางเข้า 8080 รับหัว `CF-Connecting-IP` จาก Cloudflare ให้ระบบจำกัดคำขอตาม IP จริงของแต่ละคน ส่วนพอร์ต 80 ที่เปิดให้ LAN จะลบหัวนี้ทิ้ง กันคนในวงปลอม IP
- ห้ามเปิดพอร์ต API (3000) หรือฐานข้อมูล (5432) ออกนอกเครื่อง (compose ไม่ได้เปิดไว้อยู่แล้ว)
- คนในบริษัทใช้ https ได้เหมือนกัน (ผ่านอินเทอร์เน็ต) ถ้าอยากใช้กล้องบนมือถือในบริษัท

## 8. สำรองข้อมูลทุกคืน

สคริปต์ `deploy\backup.ps1` ใช้ `pg_dump` เก็บไฟล์ `petmore_wms-ปี-เดือน-วัน_เวลา.dump` และลบไฟล์ที่เก่ากว่า 30 วัน

ลองรันเองก่อน 1 ครั้ง:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\petmore\deploy\backup.ps1 -Dest D:\petmore-backup
```

ตั้งให้รันทุกคืน 23:30:

```powershell
schtasks /Create /TN "Petmore backup" /SC DAILY /ST 23:30 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\petmore\deploy\backup.ps1 -Dest D:\petmore-backup"
schtasks /Run /TN "Petmore backup"
```

- ไฟล์สำรองควรอยู่**นอกเครื่องนี้**ด้วย (เครื่องเสียทั้งเครื่องแล้วข้อมูลยังอยู่) เช่น ตั้ง `-Dest \\NAS\backup\petmore` หรือโฟลเดอร์ OneDrive/Google Drive ที่ sync ขึ้น cloud
- กู้คืนจากไฟล์สำรอง: ทำเหมือนขั้นที่ 5ก ฝั่งเซิร์ฟเวอร์ แต่ใช้ไฟล์ `.dump` จากโฟลเดอร์สำรองแทน `C:\petmore-move.dump`
- ลองกู้คืนดูสักครั้ง (เช่น เดือนละครั้ง) ไฟล์สำรองที่ไม่เคยลองกู้ ไม่รู้ว่าใช้ได้จริงไหม

## 9. อัปเดตเป็นเวอร์ชันใหม่

หลังมีการ push โค้ดใหม่ขึ้น GitHub:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\petmore\deploy\backup.ps1 -Dest D:\petmore-backup
cd C:\petmore
git pull
cd deploy
docker compose up -d --build
```

- migration ฐานข้อมูลรันเองตอน api เปิด ดูผลได้ที่ `docker compose logs api --tail 30`
- ระหว่าง build ระบบเดิมยังใช้งานได้ สะดุดแค่ไม่กี่วินาทีตอนสลับ container ไม่ควรอัปเดตช่วงงานอีเวนต์
- ถ้าเปิด tunnel อยู่ ใส่ `--profile tunnel` ด้วย: `docker compose --profile tunnel up -d --build`
- ย้อนกลับเวอร์ชันก่อน: `git log --oneline` หาเลข commit ที่ใช้ได้ แล้ว `git checkout <เลข>` ตามด้วย `docker compose up -d --build` (ถ้าเวอร์ชันใหม่เปลี่ยนฐานข้อมูลไปแล้ว ต้องกู้ไฟล์สำรองก่อนอัปเดตด้วย)

## 10. แก้ปัญหาที่เจอบ่อย

| อาการ | ดูอะไร / แก้ยังไง |
|---|---|
| เปิดหน้าเว็บไม่ได้เลย | Docker Desktop เปิดอยู่ไหม แล้ว `docker compose ps` ดูว่าครบ 3 ตัว |
| หน้าเว็บขึ้นแต่เข้าสู่ระบบไม่ได้ / 502 | api ล่ม: `docker compose logs api --tail 50` |
| Handheld เข้าไม่ได้ แต่บนเซิร์ฟเวอร์เข้าได้ | Firewall (ขั้นที่ 6) หรือ IP เซิร์ฟเวอร์เปลี่ยน |
| พอร์ต 80 ถูกใช้อยู่ (เปิด web ไม่ขึ้น) | ตั้ง `HTTP_PORT=8080` ใน `.env` แล้ว `docker compose up -d` |
| สินค้าใหม่ไม่ขึ้น | `docker compose logs api \| Select-String sync` ดูข้อความ sync ไม่สำเร็จ เช็ก `MSSQL_*` และ `MSSQL_TLS_MIN_VERSION=TLSv1` |
| "ติดพัก 15 นาที" แต่ต้องเข้าด่วน | `docker compose restart api` (ปลดล็อกทุกชื่อ) |
| "ลองเข้าสู่ระบบบ่อยเกินไปจากเครือข่ายนี้" | รอ 10 นาที หรือ `docker compose restart api` |
| tunnel ไม่ทำงาน | `docker compose --profile tunnel logs tunnel` เช็ก token และ URL `web:8080` |
| ดิสก์เต็ม | `docker system prune` ล้าง image เก่า (ห้ามใส่ `--volumes` ข้อมูลจะหาย) |

คำสั่งทั้งหมดรันในโฟลเดอร์ `C:\petmore\deploy`

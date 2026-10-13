# สำรองฐานข้อมูล Petmore Magic Sale (ตั้งใน Task Scheduler ให้รันทุกคืน ดู docs/DEPLOY.md ขั้นที่ 8)
#   powershell -ExecutionPolicy Bypass -File deploy\backup.ps1 -Dest "D:\petmore-backup"
# เก็บไฟล์ย้อนหลัง $Keep วัน ไฟล์เก่ากว่านั้นลบทิ้ง ผลแต่ละรอบเขียนต่อท้าย backup.log ในโฟลเดอร์เดียวกัน
param(
  [string]$Dest = "D:\petmore-backup",
  [int]$Keep = 30,
  [string]$Container = "petmore-db-1"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Dest | Out-Null
# Task Scheduler ไม่แสดงผลให้เห็น เก็บ log ไว้ดูย้อนหลังว่ารอบไหนพัง
Start-Transcript -Path (Join-Path $Dest "backup.log") -Append | Out-Null
try {
  $file = Join-Path $Dest ("petmore_wms-" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".dump")

  # pg_dump แบบ custom format (-Fc) ย่อขนาดในตัว ใช้คู่กับ pg_restore
  docker exec $Container pg_dump -U wms -d petmore_wms -Fc -f /tmp/backup.dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump ไม่สำเร็จ (Docker หรือฐานข้อมูลไม่ได้เปิดอยู่?)" }
  try {
    docker cp "${Container}:/tmp/backup.dump" $file
    if ($LASTEXITCODE -ne 0) { throw "คัดลอกไฟล์สำรองออกจาก container ไม่สำเร็จ" }
  } finally {
    # ไม่ทิ้งไฟล์สำรองค้างใน container แม้คัดลอกไม่สำเร็จ
    docker exec $Container rm -f /tmp/backup.dump | Out-Null
  }

  $size = (Get-Item $file).Length
  if ($size -lt 1024) { throw "ไฟล์สำรองเล็กผิดปกติ ($size bytes): $file" }
  Get-ChildItem $Dest -Filter "petmore_wms-*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Keep) } | Remove-Item
  "สำรองแล้ว: $file ($([math]::Round($size / 1MB, 1)) MB)"
} catch {
  "สำรองไม่สำเร็จ: $_"
  exit 1
} finally {
  Stop-Transcript | Out-Null
}

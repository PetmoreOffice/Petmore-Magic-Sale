# Petmore Magic Sale

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and Purpose

ระบบคลังสินค้าร้านอาหารสัตว์สำหรับผู้ดูแลและพนักงานคลัง ใช้สแกน รับสินค้า ย้าย Location ดูสต็อก และพิมพ์ป้าย ตาม README และหน้าจอปัจจุบัน

## Operating Context

ใช้คอม มือถือ และ Handheld ข้อความภาษาไทย สิทธิ์รายงานและขอบเขตคลังจำกัดรายคน

## Capabilities and Constraints

React + Vite PWA, NestJS, Prisma และ PostgreSQL บันทึกสต็อกผ่านใบรับและการย้าย ไม่รองรับ offline ข้อมูล SQL Server บริษัทอ่านอย่างเดียว

ผู้ใช้ยืนยันว่าหน้าใหม่ใช้จดออเดอร์ที่ลูกค้าหรือซัพพลายเออร์/คู่ค้าสั่งเข้ามาในแอป ไม่ใช่ใบสั่งซื้อเข้าคลัง ขอบเขตคือบันทึกและดูออเดอร์ ยังไม่รวมส่งสินค้า ตัดสต็อก หรือส่งข้อความไปหาผู้สั่ง

## Brand Commitments

รักษาธีม Magic × ร้านอาหารสัตว์ โลโก้เดิม และข้อความภาษาไทยตาม CLAUDE.md

## Accessibility & Inclusion

งานคลังใช้ปุ่ม 48px ฟอนต์ไทย และเคารพ prefers-reduced-motion

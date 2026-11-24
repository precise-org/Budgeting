#!/bin/sh
# รวม schema_v2.sql + schema_v2b.sql เป็นไฟล์เดียว (schema_v2_all.sql) ให้ผู้ใช้วางรันครั้งเดียวใน Supabase SQL Editor
# รันทุกครั้งที่แก้ schema_v2.sql หรือ schema_v2b.sql (tests/check_schema.js ตรวจว่าไฟล์รวมเป็นปัจจุบัน)
cd "$(dirname "$0")" || exit 1
{
  echo "-- schema_v2_all.sql = schema_v2.sql + schema_v2b.sql รวมเป็นไฟล์เดียว (สร้างด้วย build_schema_all.sh — อย่าแก้ไฟล์นี้ตรงๆ)"
  echo "-- วางทั้งไฟล์ใน Supabase → SQL Editor → New query → Run · รันซ้ำได้ ไม่ลบข้อมูล"
  echo
  cat schema_v2.sql
  echo
  cat schema_v2b.sql
} > schema_v2_all.sql
echo "สร้าง schema_v2_all.sql แล้ว ($(wc -l < schema_v2_all.sql) บรรทัด)"

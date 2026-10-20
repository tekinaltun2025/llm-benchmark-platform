import { NextResponse } from 'next/server';
import { getLockStatus } from '@/lib/benchmark-lock';

/**
 * GET /api/benchmark/status
 *
 * Global benchmark kilidinin anlık durumunu döndürür.
 * İstemci, Test Çalıştırıcı sekmesine girmeden önce buradan kontrol yaparak
 * arka planda devam eden bir test olup olmadığını görebilir.
 */
export async function GET() {
  const status = getLockStatus();
  return NextResponse.json(status, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

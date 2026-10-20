import { NextResponse } from 'next/server';
import { getRunById } from '@/lib/db';

/**
 * GET /api/runs/[runId]
 * Bir benchmark koşusunun tam detayını döner (detay modalı için).
 * Soru bazlı cevaplar, düşünme süreçleri, puanlar ve hakem gerekçeleri dahil.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = await getRunById(runId);
    if (!run) {
      return NextResponse.json(
        { error: 'Koşu bulunamadı' },
        { status: 404 }
      );
    }
    return NextResponse.json(run);
  } catch (error) {
    console.error('Koşu detayı alınamadı:', error);
    return NextResponse.json(
      { error: 'Koşu detayı alınamadı' },
      { status: 500 }
    );
  }
}

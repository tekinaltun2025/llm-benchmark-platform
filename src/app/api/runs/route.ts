import { NextResponse } from 'next/server';
import { deleteRuns, restoreRuns, readArchivedRuns } from '@/lib/db';

/**
 * DELETE /api/runs
 *
 * Seçilen test sonucu (koşu) kayıtlarını ARŞİVELER.
 *
 * KALICILIK: Koşular asla fiziksel olarak silinmez — `runs` dizisinden
 * `archivedRuns` (geri dönüşüm kutusu) dizisine taşınır ve
 * `POST /api/runs/restore` ile her zaman geri getirilebilir.
 *
 * Gövde: { runIds: string[] }
 * Yanıt: { archived: number } — arşivlenen kayıt sayısı.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (
      !body ||
      !Array.isArray(body.runIds) ||
      body.runIds.length === 0 ||
      !body.runIds.every((id: unknown) => typeof id === 'string')
    ) {
      return NextResponse.json(
        { error: 'Geçersiz istek: runIds boş olmayan bir string dizisi olmalıdır.' },
        { status: 400 }
      );
    }

    const archived = await deleteRuns(body.runIds as string[]);

    return NextResponse.json({ archived });
  } catch (error) {
    console.error('Koşular arşivlenemedi:', error);
    return NextResponse.json(
      { error: 'Koşular arşivlenemedi' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/runs/restore
 *
 * Arşivlenmiş koşuları geri yükler.
 *
 * Gövde: { runIds?: string[] } — boş/verilmezse arşivdeki TÜM koşular
 * geri yüklenir. Aynı ID'li koşu zaten aktif listede varsa arşivden
 * gelen atlanır (çakışma olmaz).
 *
 * Yanıt: { restored: number } — geri yüklenen kayıt sayısı.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const runIds = Array.isArray(body?.runIds)
      ? body.runIds.filter((id: unknown): id is string => typeof id === 'string')
      : undefined;

    const restored = await restoreRuns(runIds);

    return NextResponse.json({ restored });
  } catch (error) {
    console.error('Koşular geri yüklenemedi:', error);
    return NextResponse.json(
      { error: 'Koşular geri yüklenemedi' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/runs
 *
 * Arşivlenmiş koşuların özet listesini döner (geri yükleme UI'ı için):
 * [{ id, modelName, totalScore, timestamp }]
 */
export async function GET() {
  try {
    const archived = await readArchivedRuns();
    const summary = archived.map((run) => ({
      id: run.id,
      modelName: run.modelConfig.name,
      provider: run.modelConfig.provider,
      modelId: run.modelConfig.modelId,
      totalScore: run.totalScore,
      timestamp: run.timestamp,
    }));
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Arşiv okunamadı:', error);
    return NextResponse.json(
      { error: 'Arşiv okunamadı' },
      { status: 500 }
    );
  }
}

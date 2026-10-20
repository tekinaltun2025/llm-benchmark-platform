import { NextResponse } from 'next/server';
import { deleteRuns } from '@/lib/db';

/**
 * DELETE /api/runs
 *
 * Madde 2: Seçilen test sonucu (koşu) kayıtlarını kalıcı olarak siler.
 *
 * Gövde: { runIds: string[] }
 * Yanıt: { deleted: number } — silinen kayıt sayısı.
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

    const deleted = await deleteRuns(body.runIds as string[]);

    return NextResponse.json({ deleted });
  } catch (error) {
    console.error('Koşular silinemedi:', error);
    return NextResponse.json(
      { error: 'Koşular silinemedi' },
      { status: 500 }
    );
  }
}

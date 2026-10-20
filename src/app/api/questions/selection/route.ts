import { NextResponse } from 'next/server';
import { readQuestionSelection, writeQuestionSelection } from '@/lib/db';

/**
 * GET /api/questions/selection
 *
 * Madde 3: Seçili standart soru ID'lerini döner.
 * Yanıt: { enabledQuestionIds: number[] | null }
 *   null = hiç ayarlanmamış → tüm sorular seçili kabul edilir.
 */
export async function GET() {
  try {
    const enabledQuestionIds = await readQuestionSelection();
    return NextResponse.json({ enabledQuestionIds });
  } catch (error) {
    console.error('Soru seçimi okunamadı:', error);
    return NextResponse.json(
      { error: 'Soru seçimi okunamadı' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/questions/selection
 *
 * Madde 3: Seçili standart soru ID'lerini kaydeder.
 * Gövde: { enabledQuestionIds: number[] } — boş dizi reddedilir.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (
      !body ||
      !Array.isArray(body.enabledQuestionIds) ||
      body.enabledQuestionIds.length === 0 ||
      !body.enabledQuestionIds.every((id: unknown) => typeof id === 'number')
    ) {
      return NextResponse.json(
        {
          error:
            'Geçersiz istek: enabledQuestionIds boş olmayan bir sayı dizisi olmalıdır (en az 1 soru seçili kalmalı).',
        },
        { status: 400 }
      );
    }

    await writeQuestionSelection(body.enabledQuestionIds as number[]);
    return NextResponse.json({ enabledQuestionIds: body.enabledQuestionIds });
  } catch (error) {
    console.error('Soru seçimi kaydedilemedi:', error);
    return NextResponse.json(
      { error: 'Soru seçimi kaydedilemedi' },
      { status: 500 }
    );
  }
}

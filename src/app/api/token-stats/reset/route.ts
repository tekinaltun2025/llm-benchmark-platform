import { NextResponse } from 'next/server';

/**
 * POST /api/token-stats/reset
 *
 * Token sayacı daemon'una (/reset) köprü yapar: tüm sayaçları sıfırlar
 * (log konumları korunur — çift sayım olmaz). UI'da onay dialog'u ile
 * çağrılır.
 */
export async function POST() {
  try {
    const res = await fetch('http://127.0.0.1:8790/reset', {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Sıfırlama başarısız (HTTP ${res.status})` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Token sayacı daemon\'una bağlanılamadı — sayaç sıfırlanamadı.',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 }
    );
  }
}

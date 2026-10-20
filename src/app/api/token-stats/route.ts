import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/token-stats[?from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * LM Studio Token Sayacı daemon'una (127.0.0.1:8790) köprü yapar.
 * Daemon, LM Studio'nun motor seviyesi sunucu loglarını
 * (~/.lmstudio/apps/bionic/server-logs) parse ederek uygulama içi
 * sohbet + API dahil TÜM tahminleri model bazında sayar.
 *
 * Daemon kapalıysa 503 + anlaşılır hata döner (UI bunu gösterir).
 * Tarih parametreleri daemon tarafında sunucu tarafında süzülür.
 */

const COUNTER_BASE = 'http://127.0.0.1:8790';

/** Daemondan dönen /stats JSON'unun tipi (kullanılan alanlar). */
export interface TokenStats {
  totals: {
    prompt_tokens: number;
    completion_tokens: number;
    predictions: number;
  };
  today: {
    date: string;
    prompt_tokens: number;
    completion_tokens: number;
    predictions: number;
  };
  days: Record<
    string,
    {
      prompt_tokens: number;
      completion_tokens: number;
      predictions: number;
      models?: Record<
        string,
        { prompt_tokens: number; completion_tokens: number; predictions: number }
      >;
    }
  >;
  models: Record<
    string,
    {
      prompt_tokens: number;
      completion_tokens: number;
      predictions: number;
      last_ts: number;
      label: string;
    }
  >;
  recent: Array<{
    ts: number;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    tokens_per_second: number | null;
  }>;
  in_flight_tokens: number;
  last_event_ts: number;
  log_tail: {
    files_parsed: number;
    last_file: string | null;
    offset: number;
    last_error: string | null;
  };
  range?: { from: string | null; to: string | null } | null;
}

export async function GET(request: NextRequest) {
  // Tarih filtresi parametrelerini daemon'a aynen aktar
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();

  try {
    const res = await fetch(`${COUNTER_BASE}/stats${qs ? `?${qs}` : ''}`, {
      // 1 sn'de bir yenilenen canlı panel: kısa timeout + cache'siz
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Token sayacı daemon hata döndürdü (HTTP ${res.status}).`,
          hint: 'systemctl --user restart lmstudio-token-counter.service ile yeniden başlatmayı deneyin.',
        },
        { status: 502 }
      );
    }

    const stats = (await res.json()) as TokenStats;
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    // Daemon kapalı / bağlanılamıyor
    return NextResponse.json(
      {
        error:
          'Token sayacı daemon\'una bağlanılamadı (127.0.0.1:8790). Daemon kapalı olabilir.',
        hint: 'Başlatmak için: systemctl --user start lmstudio-token-counter.service (veya python3 scripts/token-counter.py)',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 }
    );
  }
}

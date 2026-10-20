import { NextResponse } from 'next/server';
import { ModelConfig, RunProgressEvent } from '@/types/benchmark';
import {
  getModelById,
  setModelLoadError,
  clearModelLoadError,
} from '@/lib/db';
import { acquireLock, releaseLock, getLockStatus } from '@/lib/benchmark-lock';
import { executeBenchmarkRun } from '@/lib/benchmark-runner';
import { describeError } from '@/lib/retry';

// Uzun testler için Next.js route timeout'unu yükselt (saniye)
export const maxDuration = 900;

/**
 * POST /api/benchmark/run
 *
 * Tek modelin 4 sütunlu dinamik benchmark koşusu. Koşu mantığı
 * src/lib/benchmark-runner.ts içinde; bu route yalnızca:
 *   1. İsteği doğrular (model ID'leri)
 *   2. Global kilidi alır (aynı anda tek koşu)
 *   3. NDJSON akışını kurar ve koşuyu yürütür
 *
 * Gövde: { testModelId: string, judgeModelId: string }
 */
export async function POST(request: Request) {
  let testModel: ModelConfig | null = null;
  let judgeModel: ModelConfig | null = null;

  try {
    const body = await request.json();
    const { testModelId, judgeModelId } = body;

    if (!testModelId || !judgeModelId) {
      return NextResponse.json(
        { error: 'testModelId ve judgeModelId zorunludur' },
        { status: 400 }
      );
    }

    testModel = await getModelById(String(testModelId));
    judgeModel = await getModelById(String(judgeModelId));

    if (!testModel) {
      return NextResponse.json(
        { error: 'Test modeli bulunamadı. Önce Model Yönetimi sekmesinden ekleyin.' },
        { status: 404 }
      );
    }
    if (!judgeModel) {
      return NextResponse.json(
        { error: 'Hakem modeli bulunamadı. Önce Model Yönetimi sekmesinden ekleyin.' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('İstek gövdesi ayrıştırılamadı:', error);
    return NextResponse.json(
      { error: 'Geçersiz istek gövdesi' },
      { status: 400 }
    );
  }

  // ─── Global test kilidi: aynı anda yalnızca bir benchmark koşabilir ──
  // acquireLock senkron çalıştığı için Node.js event loop'unda atomiktir;
  // eşzamanlı iki istekten yalnızca ilki kilidi alabilir, diğeri 409 alır.
  if (!acquireLock(testModel.name)) {
    const status = getLockStatus();
    return NextResponse.json(
      {
        error: `Şu anda başka bir benchmark testi çalışıyor (${status.lockedBy}). Lütfen o test tamamlanana kadar bekleyin.`,
        lockedBy: status.lockedBy,
        lockedAt: status.lockedAt,
      },
      { status: 409 }
    );
  }

  // Test ve hakem modellerini closure'a sabitle (TS null-check için)
  const testModelConfig = testModel;
  const judgeModelConfig = judgeModel;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: RunProgressEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const outcome = await executeBenchmarkRun(
          testModelConfig,
          judgeModelConfig,
          sendEvent
        );

        if (outcome.status === 'completed' && outcome.run) {
          // Başarılı test: varsa eski "çalışmıyor" notunu temizle
          await clearModelLoadError(
            testModelConfig.provider,
            testModelConfig.modelId
          );
          sendEvent({
            type: 'complete',
            progress: 100,
            message: `Test tamamlandı! Genel Skor: ${outcome.run.totalScore}/100 | Biçim Disiplini: ${outcome.run.formatDiscipline}%`,
            run: outcome.run,
          });
        }
        // 'stopped' ve 'error' olayları executeBenchmarkRun içinde
        // zaten emit edildi; burada ek bir şey yapmaya gerek yok.
      } catch (error) {
        console.error('Benchmark koşusu başarısız:', error);
        // Model çalışmadı: kalıcı "çalışmıyor" notu yaz
        const errorDetail =
          error instanceof Error ? error.message : String(error);
        const reason = describeError(error);
        await setModelLoadError(
          testModelConfig.provider,
          testModelConfig.modelId,
          `Test başarısız: ${reason}`
        );
        sendEvent({
          type: 'error',
          progress: 0,
          message: `Test başarısız oldu (3 deneme yapıldı). Sebep: ${reason}`,
        });
      } finally {
        // Kilit, koşu nasıl sonuçlanırsa sonuçlansın (başarı / hata / istemci
        // bağlantıyı kesti / durdurma) mutlaka serbest bırakılmalı.
        releaseLock();
        try {
          controller.close();
        } catch {
          // Stream zaten kapatılmış olabilir (ör. istemci bağlantıyı kesti)
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

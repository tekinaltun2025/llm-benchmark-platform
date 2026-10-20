import { NextResponse } from 'next/server';
import { ModelConfig, RunProgressEvent } from '@/types/benchmark';
import {
  getModelById,
  readModels,
  writeModel,
  setModelLoadError,
  clearModelLoadError,
} from '@/lib/db';
import { acquireLock, releaseLock, isStopRequested, getStopReason } from '@/lib/benchmark-lock';
import { executeBenchmarkRun } from '@/lib/benchmark-runner';
import {
  loadLMStudioModel,
  unloadLMStudioModel,
  listTestableLMStudioModels,
} from '@/lib/lmstudio';
import { describeError } from '@/lib/retry';

// Toplu test saatler sürebilir (25 model × ~10 dk): timeout'u kaldır
export const maxDuration = 3600;

/**
 * POST /api/benchmark/run-all
 *
 * LM Studio kütüphanesindeki TÜM test edilebilir modelleri (embedding
 * hariç) sırayla test eder. Her model için:
 *
 *   1. lms load <model-id>  — modeli VRAM'e yükle
 *   2. executeBenchmarkRun  — 4 sütunlu tam benchmark
 *   3. lms unload <model-id> — modeli VRAM'den boşalt (eject)
 *
 * Böylece VRAM'de aynı anda yalnızca tek test modeli + hakem modeli
 * bulunur. Hakem modeli döngü boyunca yüklü kalır (her koşuda
 * yeniden yüklenmez); test modelleri bitince boşaltılır.
 *
 * Gövde (opsiyonel): { judgeModelId?: string }
 *   — verilmezse kayıtlı isJudge modeli kullanılır.
 *
 * NDJSON akışı: 'batch' (yeni model), normal faz olayları, 'batch-complete'
 * (model bitti), 'complete' (tümü bitti), 'stopped' (durduruldu).
 */
export async function POST(request: Request) {
  // ─── Hakem modelini çöz ─────────────────────────────────
  let judgeModel: ModelConfig | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.judgeModelId) {
      judgeModel = await getModelById(String(body.judgeModelId));
    }
    if (!judgeModel) {
      const models = await readModels();
      judgeModel = models.find((m) => m.isJudge) ?? null;
    }
  } catch {
    judgeModel = null;
  }

  if (!judgeModel) {
    return NextResponse.json(
      { error: 'Hakem modeli bulunamadı. Model Yönetimi sekmesinden bir hakem atayın.' },
      { status: 400 }
    );
  }

  // ─── Kütüphanedeki test edilebilir modelleri listele ────
  // "Çalışmıyor" notlu modeller (bozuk GGUF vb.) toplu testte de ATLANIR —
  // her seferinde 3 deneme + dakikalarca bekleme yapılmaz.
  const allLibraryModels = await listTestableLMStudioModels();
  const dbModels = await readModels();
  const brokenIds = new Set(
    dbModels
      .filter((m) => m.provider === 'lmstudio' && m.lastLoadError)
      .map((m) => m.modelId.toLowerCase())
  );
  const skippedBroken = allLibraryModels.filter((m) =>
    brokenIds.has(m.id.toLowerCase())
  );
  const libraryModels = allLibraryModels.filter(
    (m) => !brokenIds.has(m.id.toLowerCase())
  );
  if (libraryModels.length === 0) {
    return NextResponse.json(
      { error: 'LM Studio kütüphanesinde test edilebilir model bulunamadı. LM Studio sunucusunun açık olduğundan emin olun.' },
      { status: 503 }
    );
  }

  // ─── Global kilit ───────────────────────────────────────
  if (!acquireLock('Toplu Test (Tüm Modeller)')) {
    return NextResponse.json(
      { error: 'Şu anda başka bir benchmark testi çalışıyor.' },
      { status: 409 }
    );
  }

  const judgeModelConfig = judgeModel;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: RunProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          // İstemci bağlantıyı kesti; koşu arka planda devam eder
        }
      };

      // Özet: her modelin sonucu (UI'da özet tablo için)
      const batchSummary: Array<{
        modelName: string;
        modelId: string;
        status: 'completed' | 'error' | 'skipped';
        totalScore?: number;
        error?: string;
      }> = [];

      try {
        sendEvent({
          type: 'phase',
          progress: 0,
          message: `🚀 Toplu test başlıyor: ${libraryModels.length} model sırayla yüklenecek, test edilecek ve boşaltılacak. Hakem: ${judgeModelConfig.name}${
            skippedBroken.length > 0
              ? ` (${skippedBroken.length} çalışmayan model atlandı: ${skippedBroken.map((m) => m.id).join(', ')})`
              : ''
          }`,
        });

        // ─── Hakem modelini baştan yükle (döngü boyunca kalır) ──
        if (judgeModelConfig.provider === 'lmstudio') {
          sendEvent({
            type: 'phase',
            progress: 1,
            message: `⚖️ Hakem modeli yükleniyor: ${judgeModelConfig.modelId}...`,
          });
          const judgeLoad = await loadLMStudioModel(judgeModelConfig.modelId);
          if (!judgeLoad.ok) {
            sendEvent({
              type: 'error',
              progress: 0,
              message: `Hakem modeli (${judgeModelConfig.modelId}) yüklenemedi: ${judgeLoad.output.slice(0, 300)}`,
            });
            return;
          }
          sendEvent({
            type: 'phase',
            progress: 2,
            message: `⚖️ Hakem modeli hazır: ${judgeModelConfig.modelId}`,
          });
        }

        let completedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < libraryModels.length; i++) {
          const libModel = libraryModels[i];

          // ─── Durdurma kontrolü: her model öncesi ──
          if (isStopRequested()) {
            sendEvent({
              type: 'stopped',
              progress: 0,
              message: `⏹️ Toplu test durduruldu (${getStopReason() ?? 'sebep belirtilmedi'}). ${completedCount} model tamamlanmıştı.`,
            });
            break;
          }

          const batchIndex = i + 1;
          const batchTotal = libraryModels.length;
          // Model bazlı ilerleme dilimi: her model toplamın eşit payını alır
          const sliceStart = 3 + Math.round((i / batchTotal) * 94);
          const sliceEnd = 3 + Math.round(((i + 1) / batchTotal) * 94);

          sendEvent({
            type: 'batch',
            progress: sliceStart,
            message: `📦 [${batchIndex}/${batchTotal}] Model yükleniyor: ${libModel.id} (${libModel.quantization ?? '?'})...`,
            batchIndex,
            batchTotal,
            batchModelName: libModel.id,
          });

          // ─── 1) Modeli VRAM'e yükle (3 deneme, lmstudio.ts içinde) ──
          const loadResult = await loadLMStudioModel(libModel.id);
          if (!loadResult.ok) {
            failedCount++;
            // Modeli DB'ye kaydet ki "çalışmıyor" notu kalıcı olsun
            const failedModelConfig: ModelConfig = {
              id: `lmstudio-batch-${libModel.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
              name: libModel.id,
              provider: 'lmstudio',
              baseUrl: 'http://localhost:1234/v1',
              modelId: libModel.id,
              isJudge: false,
            };
            await writeModel(failedModelConfig);
            // Hata nedenini açıkla ve kalıcı nota yaz
            const loadErrorReason = describeError(
              new Error(loadResult.output || 'Bilinmeyen yükleme hatası')
            );
            await setModelLoadError(
              'lmstudio',
              libModel.id,
              `Yükleme başarısız (3 deneme): ${loadErrorReason}`
            );
            batchSummary.push({
              modelName: libModel.id,
              modelId: libModel.id,
              status: 'error',
              error: `Yükleme başarısız: ${loadErrorReason}`,
            });
            sendEvent({
              type: 'batch-complete',
              progress: sliceEnd,
              message: `❌ [${batchIndex}/${batchTotal}] ${libModel.id} yüklenemedi (3 deneme yapıldı) — atlandı. Sebep: ${loadErrorReason}`,
              batchIndex,
              batchTotal,
              batchModelName: libModel.id,
            });
            continue;
          }

          // ─── 2) Modeli DB'ye kaydet (yoksa oluştur, varsa güncelle) ──
          // writeModel upsert yapar ve DB'de temsil edilen GERÇEK kaydı
          // döner: aynı model zaten kayıtlıysa mevcut kaydın ID'si
          // kullanılır — böylece koşu her zaman aynı kimlik altında
          // toplanır ve leaderboard'da ikinci satır oluşmaz.
          const batchModelConfig: ModelConfig = {
            id: `lmstudio-batch-${libModel.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
            name: libModel.id,
            provider: 'lmstudio',
            baseUrl: 'http://localhost:1234/v1',
            modelId: libModel.id,
            isJudge: false,
          };
          const testModelConfig = await writeModel(batchModelConfig);

          // ─── 3) Benchmark koşusu ──
          // Koşu içi olayları toplam ilerlemeye ölçekle
          const emitScaled = (event: RunProgressEvent) => {
            const inner = Math.max(0, Math.min(100, event.progress));
            const scaled = sliceStart + Math.round((inner / 100) * (sliceEnd - sliceStart));
            sendEvent({
              ...event,
              progress: scaled,
              batchIndex,
              batchTotal,
              batchModelName: libModel.id,
            });
          };

          const outcome = await executeBenchmarkRun(
            testModelConfig,
            judgeModelConfig,
            emitScaled
          );

          // ─── 4) Modeli VRAM'den boşalt (eject) ──
          // Koşu hata verse bile model boşaltılmalı (VRAM sızıntısı olmasın).
          // Hakem modeli asla boşaltılmaz.
          if (libModel.id !== judgeModelConfig.modelId) {
            sendEvent({
              type: 'phase',
              progress: sliceEnd,
              message: `📤 [${batchIndex}/${batchTotal}] ${libModel.id} VRAM'den boşaltılıyor (eject)...`,
              batchIndex,
              batchTotal,
              batchModelName: libModel.id,
            });
            const unloadResult = await unloadLMStudioModel(libModel.id);
            if (!unloadResult.ok) {
              console.warn(`Model boşaltılamadı (${libModel.id}):`, unloadResult.output);
            }
          }

          if (outcome.status === 'completed' && outcome.run) {
            completedCount++;
            // Başarılı test: varsa eski "çalışmıyor" notunu temizle
            await clearModelLoadError('lmstudio', libModel.id);
            batchSummary.push({
              modelName: libModel.id,
              modelId: libModel.id,
              status: 'completed',
              totalScore: outcome.run.totalScore,
            });
            sendEvent({
              type: 'batch-complete',
              progress: sliceEnd,
              message: `✅ [${batchIndex}/${batchTotal}] ${libModel.id} tamamlandı — Skor: ${outcome.run.totalScore}/100`,
              batchIndex,
              batchTotal,
              batchModelName: libModel.id,
            });
          } else if (outcome.status === 'stopped') {
            // Koşu içinde durduruldu; 'stopped' olayı zaten emit edildi.
            // Döngüden çık — sonraki modelleri başlatma.
            break;
          } else {
            failedCount++;
            batchSummary.push({
              modelName: libModel.id,
              modelId: libModel.id,
              status: 'error',
              error: outcome.error ?? 'Bilinmeyen hata',
            });
            sendEvent({
              type: 'batch-complete',
              progress: sliceEnd,
              message: `❌ [${batchIndex}/${batchTotal}] ${libModel.id} testi başarısız — atlandı.`,
              batchIndex,
              batchTotal,
              batchModelName: libModel.id,
            });
          }
        }

        // ─── Toplu özet ──
        if (completedCount > 0 || failedCount > 0) {
          sendEvent({
            type: 'complete',
            progress: 100,
            message: `🏁 Toplu test bitti: ${completedCount} model tamamlandı, ${failedCount} model başarısız/atlandı. Sonuçlar Leaderboard'ta.`,
          });
        }
      } catch (error) {
        console.error('Toplu test başarısız:', error);
        sendEvent({
          type: 'error',
          progress: 0,
          message: `Toplu test başarısız oldu. Sebep: ${describeError(error)}`,
        });
      } finally {
        releaseLock();
        try {
          controller.close();
        } catch {
          // Stream zaten kapalı olabilir
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

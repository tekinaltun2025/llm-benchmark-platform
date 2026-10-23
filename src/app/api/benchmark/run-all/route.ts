import { NextResponse } from 'next/server';
import { ModelConfig, RunProgressEvent, TestCategory } from '@/types/benchmark';
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
 * Test edilecek tek hedef: LM Studio kütüphane modeli veya
 * kayıtlı harici API modeli olabilir.
 */
interface TestTarget {
  /** LM Studio model kimliği veya DB modelId (API modelleri) */
  id: string;
  /** UI'da gösterilen ad */
  name: string;
  provider: 'lmstudio' | 'custom';
  baseUrl: string;
  quantization?: string | null;
  /** Seçili modeller akışında: DB'deki gerçek kayıt (apiKey dahil) */
  dbModel?: ModelConfig;
}

/**
 * POST /api/benchmark/run-all
 *
 * İki çalışma modu:
 *
 * 1) Gövde: { modelIds: string[] } — yalnızca seçili modeller sırayla
 *    test edilir (LM Studio + harici API karışık olabilir). LM Studio
 *    modelleri için yükle → test → boşalt (eject) akışı uygulanır;
 *    API modelleri doğrudan test edilir.
 *
 * 2) Gövde boş — LM Studio kütüphanesindeki TÜM test edilebilir
 *    modeller (embedding hariç) sırayla test edilir.
 *
 * Her model için:
 *   1. lms load <model-id>  — modeli VRAM'e yükle (yalnızca LM Studio)
 *   2. executeBenchmarkRun  — 4 sütunlu tam benchmark
 *   3. lms unload <model-id> — modeli VRAM'den boşalt (yalnızca LM Studio)
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
  // ─── Gövde: hakem + opsiyonel seçili model listesi ──────
  let judgeModelIdFromBody: string | null = null;
  let selectedModelIds: string[] | null = null;
  let selectedCategories: TestCategory[] = ['all'];
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.judgeModelId) {
      judgeModelIdFromBody = String(body.judgeModelId);
    }
    if (Array.isArray(body?.modelIds) && body.modelIds.length > 0) {
      selectedModelIds = body.modelIds.map((id: unknown) => String(id));
    }
    // Kategori seçimi: 'general' | 'coding' | 'turkish' | 'all'
    // Geçersiz değerler sessizce atılır; hiçbiri geçerli değilse 'all' kalır.
    if (Array.isArray(body?.selectedCategories) && body.selectedCategories.length > 0) {
      const valid: TestCategory[] = ['general', 'coding', 'turkish', 'all'];
      const parsed = body.selectedCategories
        .map((c: unknown) => String(c))
        .filter((c: string): c is TestCategory => valid.includes(c as TestCategory));
      if (parsed.length > 0) selectedCategories = parsed;
    }
  } catch {
    // Gövde yok/bozuk — varsayılan (tüm kütüphane) akış
  }

  // ─── Hakem modelini çöz ─────────────────────────────────
  let judgeModel: ModelConfig | null = null;
  if (judgeModelIdFromBody) {
    judgeModel = await getModelById(judgeModelIdFromBody);
  }
  if (!judgeModel) {
    const models = await readModels();
    judgeModel = models.find((m) => m.isJudge) ?? null;
  }

  if (!judgeModel) {
    return NextResponse.json(
      { error: 'Hakem modeli bulunamadı. Model Yönetimi bölümünden bir hakem atayın.' },
      { status: 400 }
    );
  }

  // ─── Test edilecek hedefleri belirle ────────────────────
  // "Çalışmıyor" notlu modeller (bozuk GGUF vb.) her iki modda da ATLANIR —
  // her seferinde 3 deneme + dakikalarca bekleme yapılmaz.
  let testTargets: TestTarget[] = [];
  let skippedBroken: Array<{ id: string }> = [];

  if (selectedModelIds) {
    // ── Mod 1: yalnızca seçili modeller ──
    const dbModels = await readModels();
    const byId = new Map(dbModels.map((m) => [m.id, m]));
    const seen = new Set<string>();
    for (const rawId of selectedModelIds) {
      const dbModel = byId.get(rawId);
      if (!dbModel) continue; // kayıt silinmiş — atla
      const identity = `${dbModel.provider}:${dbModel.modelId.toLowerCase()}`;
      if (seen.has(identity)) continue; // aynı model iki kez eklenmiş
      seen.add(identity);
      if (dbModel.lastLoadError) {
        skippedBroken.push({ id: dbModel.modelId });
        continue;
      }
      testTargets.push({
        id: dbModel.modelId,
        name: dbModel.name,
        provider: dbModel.provider,
        baseUrl: dbModel.baseUrl,
        dbModel,
      });
    }
    if (testTargets.length === 0) {
      return NextResponse.json(
        {
          error:
            'Seçili modeller bulunamadı veya "çalışmıyor" olarak işaretli. Listeden geçerli model ekleyin.',
        },
        { status: 400 }
      );
    }
  } else {
    // ── Mod 2: LM Studio kütüphanesindeki tüm modeller ──
    const allLibraryModels = await listTestableLMStudioModels();
    const dbModels = await readModels();
    const brokenIds = new Set(
      dbModels
        .filter((m) => m.provider === 'lmstudio' && m.lastLoadError)
        .map((m) => m.modelId.toLowerCase())
    );
    skippedBroken = allLibraryModels
      .filter((m) => brokenIds.has(m.id.toLowerCase()))
      .map((m) => ({ id: m.id }));
    testTargets = allLibraryModels
      .filter((m) => !brokenIds.has(m.id.toLowerCase()))
      .map((m) => ({
        id: m.id,
        name: m.id,
        provider: 'lmstudio' as const,
        baseUrl: 'http://localhost:1234/v1',
        quantization: m.quantization,
      }));
    if (testTargets.length === 0) {
      return NextResponse.json(
        { error: 'LM Studio kütüphanesinde test edilebilir model bulunamadı. LM Studio sunucusunun açık olduğundan emin olun.' },
        { status: 503 }
      );
    }
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
          message: `🚀 Toplu test başlıyor: ${testTargets.length} model sırayla test edilecek. Hakem: ${judgeModelConfig.name}${
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

        for (let i = 0; i < testTargets.length; i++) {
          const target = testTargets[i];

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
          const batchTotal = testTargets.length;
          // Model bazlı ilerleme dilimi: her model toplamın eşit payını alır
          const sliceStart = 3 + Math.round((i / batchTotal) * 94);
          const sliceEnd = 3 + Math.round(((i + 1) / batchTotal) * 94);
          const targetLabel = target.quantization
            ? `${target.name} (${target.quantization})`
            : target.name;

          sendEvent({
            type: 'batch',
            progress: sliceStart,
            message: `📦 [${batchIndex}/${batchTotal}] Model hazırlanıyor: ${targetLabel}...`,
            batchIndex,
            batchTotal,
            batchModelName: target.name,
          });

          // ─── 1) LM Studio modelini VRAM'e yükle (3 deneme) ──
          // Harici API modelleri için yükleme adımı yoktur.
          if (target.provider === 'lmstudio') {
            const loadResult = await loadLMStudioModel(target.id);
            if (!loadResult.ok) {
              failedCount++;
              // Modeli DB'ye kaydet ki "çalışmıyor" notu kalıcı olsun
              const failedModelConfig: ModelConfig = {
                id: `lmstudio-batch-${target.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
                name: target.id,
                provider: 'lmstudio',
                baseUrl: 'http://localhost:1234/v1',
                modelId: target.id,
                isJudge: false,
              };
              await writeModel(failedModelConfig);
              // Hata nedenini açıkla ve kalıcı nota yaz
              const loadErrorReason = describeError(
                new Error(loadResult.output || 'Bilinmeyen yükleme hatası')
              );
              await setModelLoadError(
                'lmstudio',
                target.id,
                `Yükleme başarısız (3 deneme): ${loadErrorReason}`
              );
              batchSummary.push({
                modelName: target.name,
                modelId: target.id,
                status: 'error',
                error: `Yükleme başarısız: ${loadErrorReason}`,
              });
              sendEvent({
                type: 'batch-complete',
                progress: sliceEnd,
                message: `❌ [${batchIndex}/${batchTotal}] ${target.name} yüklenemedi (3 deneme yapıldı) — atlandı. Sebep: ${loadErrorReason}`,
                batchIndex,
                batchTotal,
                batchModelName: target.name,
              });
              continue;
            }
          }

          // ─── 2) DB kaydını çöz ──
          // Seçili modeller akışında kayıt zaten DB'de vardır (apiKey dahil)
          // ve doğrudan kullanılır. Kütüphane akışında writeModel upsert
          // yapar ve DB'de temsil edilen GERÇEK kaydı döner: aynı model
          // zaten kayıtlıysa mevcut kaydın ID'si kullanılır — böylece koşu
          // her zaman aynı kimlik altında toplanır ve leaderboard'da
          // ikinci satır oluşmaz.
          let testModelConfig: ModelConfig;
          if (target.dbModel) {
            testModelConfig = target.dbModel;
          } else {
            testModelConfig = await writeModel({
              id: `lmstudio-batch-${target.id.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
              name: target.id,
              provider: 'lmstudio',
              baseUrl: 'http://localhost:1234/v1',
              modelId: target.id,
              isJudge: false,
            });
          }

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
              batchModelName: target.name,
            });
          };

          const outcome = await executeBenchmarkRun(
            testModelConfig,
            judgeModelConfig,
            emitScaled,
            selectedCategories
          );

          // ─── 4) LM Studio modelini VRAM'den boşalt (eject) ──
          // Koşu hata verse bile model boşaltılmalı (VRAM sızıntısı olmasın).
          // Hakem modeli ve harici API modelleri asla boşaltılmaz.
          if (target.provider === 'lmstudio' && target.id !== judgeModelConfig.modelId) {
            sendEvent({
              type: 'phase',
              progress: sliceEnd,
              message: `📤 [${batchIndex}/${batchTotal}] ${target.name} VRAM'den boşaltılıyor (eject)...`,
              batchIndex,
              batchTotal,
              batchModelName: target.name,
            });
            const unloadResult = await unloadLMStudioModel(target.id);
            if (!unloadResult.ok) {
              console.warn(`Model boşaltılamadı (${target.id}):`, unloadResult.output);
            }
          }

          if (outcome.status === 'completed' && outcome.run) {
            completedCount++;
            // Başarılı test: varsa eski "çalışmıyor" notunu temizle
            await clearModelLoadError(testModelConfig.provider, testModelConfig.modelId);
            batchSummary.push({
              modelName: target.name,
              modelId: target.id,
              status: 'completed',
              totalScore: outcome.run.totalScore,
            });
            sendEvent({
              type: 'batch-complete',
              progress: sliceEnd,
              message: `✅ [${batchIndex}/${batchTotal}] ${target.name} tamamlandı — Skor: ${outcome.run.totalScore}/100`,
              batchIndex,
              batchTotal,
              batchModelName: target.name,
            });
          } else if (outcome.status === 'stopped') {
            // Koşu içinde durduruldu; 'stopped' olayı zaten emit edildi.
            // Döngüden çık — sonraki modelleri başlatma.
            break;
          } else {
            failedCount++;
            batchSummary.push({
              modelName: target.name,
              modelId: target.id,
              status: 'error',
              error: outcome.error ?? 'Bilinmeyen hata',
            });
            sendEvent({
              type: 'batch-complete',
              progress: sliceEnd,
              message: `❌ [${batchIndex}/${batchTotal}] ${target.name} testi başarısız — atlandı.`,
              batchIndex,
              batchTotal,
              batchModelName: target.name,
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

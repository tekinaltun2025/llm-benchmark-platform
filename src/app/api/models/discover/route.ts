import { NextResponse } from 'next/server';
import { ModelConfig } from '@/types/benchmark';
import { readModels, writeModel } from '@/lib/db';

// LM Studio varsayılan yerel sunucu adresi
const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';

/**
 * baseUrl + modelId'den deterministik ID üretir.
 * Aynı model her keşifte aynı ID'yi alır (upsert için).
 */
function generateModelId(baseUrl: string, modelId: string): string {
  const cleanBaseUrl = baseUrl.replace(/[^a-zA-Z0-9]/g, '-');
  const cleanModelId = modelId.replace(/[^a-zA-Z0-9]/g, '-');
  return `lmstudio-${cleanBaseUrl}-${cleanModelId}`;
}

/**
 * GET /api/models/discover
 * LM Studio'nun /v1/models uç noktasından modelleri çeker,
 * mevcut olmayanları veritabanına kaydeder (tek tıkla ekleme)
 * ve güncel model listesini döner.
 */
export async function GET() {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // LM Studio kapalıysa hızlı başarısız ol
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `LM Studio'ya ulaşılamadı (HTTP ${response.status}). LM Studio'nun açık olduğundan ve yerel sunucunun (localhost:1234) çalıştığından emin olun.`,
          models: [],
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      return NextResponse.json(
        { error: 'LM Studio beklenmeyen bir yanıt formatı döndürdü', models: [] },
        { status: 502 }
      );
    }

    // Mevcut modelleri al (isJudge bayraklarını korumak için)
    const existingModels = await readModels();
    const existingById = new Map<string, ModelConfig>();
    existingModels.forEach((m) => existingById.set(m.id, m));

    const discovered: ModelConfig[] = [];
    let addedCount = 0;

    for (const model of data.data) {
      const id = generateModelId(LM_STUDIO_BASE_URL, model.id);
      const existing = existingById.get(id);

      const modelConfig: ModelConfig = {
        id,
        name: model.id,
        provider: 'lmstudio',
        baseUrl: LM_STUDIO_BASE_URL,
        apiKey: undefined,
        modelId: model.id,
        // Hakem bayrağı korunur; yeni keşfedilenlerde varsayılan false
        isJudge: existing?.isJudge ?? false,
      };

      discovered.push(modelConfig);
      if (!existing) {
        await writeModel(modelConfig);
        addedCount++;
      } else {
        // Mevcut kaydı güncelle (isim/baseUrl değişmiş olabilir)
        await writeModel(modelConfig);
      }
    }

    return NextResponse.json({
      models: discovered,
      addedCount,
      message: `${discovered.length} model bulundu, ${addedCount} tanesi yeni eklendi.`,
    });
  } catch (error) {
    console.error('LM Studio model keşfi başarısız:', error);
    return NextResponse.json(
      {
        error:
          'LM Studio\'ya ulaşılamadı. LM Studio\'nun açık olduğundan ve yerel sunucunun (Developer -> Start Server) çalıştığından emin olun.',
        models: [],
      },
      { status: 502 }
    );
  }
}

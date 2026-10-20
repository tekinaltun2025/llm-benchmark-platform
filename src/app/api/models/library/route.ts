import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ModelConfig } from '@/types/benchmark';
import { readModels, writeModel } from '@/lib/db';
import { listLMStudioModels } from '@/lib/lmstudio';

// LM Studio varsayılan yerel sunucu adresi
const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';

/** model-data.json dosyasının yolu: ~/.lmstudio/.internal/model-data.json */
function getModelDataPath(): string {
  return path.join(os.homedir(), '.lmstudio', '.internal', 'model-data.json');
}

/**
 * LM Studio model anahtarından (publisher/repo/file.gguf) okunabilir bir ad üretir.
 * Örn: "lmstudio-community/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf"
 *   → name: "Qwen3.5-9B-Q4_K_M", repo: "lmstudio-community/Qwen3.5-9B-GGUF"
 */
function parseModelKey(key: string): { name: string; repo: string } | null {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const fileName = parts[parts.length - 1];
  const repo = parts.slice(0, -1).join('/');
  // .gguf uzantısını at; çok parçalı dosyalarda -0000X-of-0000Y sonekini de temizle
  const name = fileName
    .replace(/\.gguf$/i, '')
    .replace(/-0000\d+-of-\d+$/i, '');
  return { name, repo };
}

/**
 * LM Studio'nun /v1/models'te kullandığı kısa model ID'sini üretir.
 * Gerçek davranış: dosya adından türetilmiş, küçük harfe çevrilmiş ID.
 * Örn: "Qwen3.5-9B-Q4_K_M.gguf" → "qwen3.5-9b-q4_k_m"
 * LM Studio JIT yükleme bu ID'leri kabul eder (doğrulandı).
 */
function deriveShortId(name: string): string {
  return name.toLowerCase();
}

/**
 * GET /api/models/library
 *
 * LM Studio kütüphanesindeki TÜM modelleri listeler — yüklü (loaded)
 * OLMAYANLAR DAHİL. Kaynak: ~/.lmstudio/.internal/model-data.json
 * (LM Studio'nun kendi kütüphane indeksi; JIT yükleme için model anahtarlarını içerir)
 *
 * Ayrıca /v1/models'ten aktif (loaded) modelleri getirip state bilgisini birleştirir.
 * Keşfedilen modeller veritabanına kaydedilmez; yalnızca listelenir.
 * Kullanıcı Test Koşucusu'ndan seçtiğinde LM Studio modeli otomatik (JIT) yükler.
 */
export async function GET() {
  try {
    // 1) Aktif (yüklü) modelleri LM Studio'dan al
    const loadedIds = new Set<string>();
    let loadedError: string | null = null;
    try {
      const res = await fetch(`${LM_STUDIO_BASE_URL}/models`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          data.data.forEach((m: { id: string }) => loadedIds.add(m.id.toLowerCase()));
        }
      }
    } catch {
      loadedError = 'LM Studio sunucusuna ulaşılamadı; yalnızca kütüphane indeksi listeleniyor.';
    }

    // 2) Kütüphane indeksini oku (yüklü olmayanlar dahil)
    const modelDataPath = getModelDataPath();
    let libraryEntries: Array<{ key: string; name: string; repo: string }> = [];
    let libraryError: string | null = null;

    try {
      await fs.access(modelDataPath);
      const raw = await fs.readFile(modelDataPath, 'utf8');
      const parsed = JSON.parse(raw);
      // Format: { json: [[key, metadata], ...], meta: {...} }
      const pairs: unknown[] = Array.isArray(parsed.json) ? parsed.json : [];
      for (const pair of pairs) {
        if (Array.isArray(pair) && typeof pair[0] === 'string') {
          const parsedKey = parseModelKey(pair[0]);
          if (parsedKey) {
            libraryEntries.push({
              key: pair[0],
              name: parsedKey.name,
              repo: parsedKey.repo,
            });
          }
        }
      }
    } catch {
      libraryError =
        'LM Studio kütüphane indeksi (~/.lmstudio/.internal/model-data.json) okunamadı.';
    }

    // 3) Kütüphane boşsa ve sunucu açıksa, aktif modelleri tek kaynak olarak kullan
    if (libraryEntries.length === 0 && loadedIds.size > 0) {
      libraryEntries = [...loadedIds].map((id) => ({
        key: id,
        name: id,
        repo: '—',
      }));
    }

    if (libraryEntries.length === 0) {
      return NextResponse.json(
        {
          error:
            libraryError ??
            loadedError ??
            'Kütüphanede model bulunamadı. LM Studio ile model indirin.',
          models: [],
        },
        { status: 404 }
      );
    }

    // 4) LM Studio'nun GERÇEK model ID'lerini çek (/api/v0/models).
    //    Dosya adından türetilen ID ("qwen3.8-27b-q4_k_m") ile gerçek
    //    LM Studio ID'si ("qwen3.8-27b") farklı olabilir; gerçek ID
    //    kullanılmazsa DB eşleştirmesi (hata notu, hakem, koşular) bozulur.
    const v0Models = await listLMStudioModels();
    const v0IdSet = new Set(v0Models.map((m) => m.id.toLowerCase()));

    // Quantization sonekleri: -q4_k_m, -q8_0, -iq4_xs, -f16, -bf16, -fp8 vb.
    // Sonek içi alt çizgiler serbesttir ([a-z0-9_]+).
    // "qwen3.8-27b-q4_k_m" → "qwen3.8-27b" gibi gerçek ID'ye iner.
    // NOT: prefix eşleştirmesi YAPILMAZ — "qwen3.8-27b-turbo-..." gibi
    // farklı bir model "qwen3.8-27b"nin soneği olarak yanlış eşleşir.
    const QUANT_SUFFIX =
      /-(?:iq[0-9]+_[a-z0-9_]+|q[0-9]+_[a-z0-9_]+|f16|bf16|fp8|fp16)$/i;
    const resolveRealId = (fileDerivedId: string): string => {
      if (v0IdSet.has(fileDerivedId)) return fileDerivedId;
      const stripped = fileDerivedId.replace(QUANT_SUFFIX, '');
      if (stripped !== fileDerivedId && v0IdSet.has(stripped)) return stripped;
      return fileDerivedId;
    };

    // 5) Mevcut kayıtlı modelleri al (isJudge bayrağı ve ID eşleşmesi için)
    const existingModels = await readModels();
    const existingByShortId = new Map<string, ModelConfig>();
    existingModels.forEach((m) => {
      existingByShortId.set(m.modelId.toLowerCase(), m);
    });

    // 6) Kütüphane modellerini ModelConfig formatına dönüştür.
    //    Gerçek ID çözümü: önce exact eşleşme, yoksa dosya-adı-ID'sinin
    //    prefix'i olan gerçek ID (en uzun olan).
    //    DB'deki "çalışmıyor" notları (lastLoadError) da birleştirilir.
    const models: Array<
      ModelConfig & {
        libraryKey: string;
        isLoaded: boolean;
        repo: string;
        lastLoadError?: string;
        lastLoadErrorAt?: number;
      }
    > = libraryEntries.map((entry) => {
      const shortId = deriveShortId(entry.name);
      // Gerçek LM Studio ID'sini çöz (quantization soneği temizliğiyle)
      const realId = resolveRealId(shortId);
      const existing = existingByShortId.get(realId);
      return {
        id: existing?.id ?? `lmstudio-lib-${realId.replace(/[^a-z0-9]/g, '-')}`,
        name: entry.name,
        provider: 'lmstudio',
        baseUrl: LM_STUDIO_BASE_URL,
        apiKey: undefined,
        modelId: realId,
        isJudge: existing?.isJudge ?? false,
        libraryKey: entry.key,
        isLoaded: loadedIds.has(realId),
        repo: entry.repo,
        lastLoadError: existing?.lastLoadError,
        lastLoadErrorAt: existing?.lastLoadErrorAt,
      };
    });

    // Yüklü modelleri başa sırala
    models.sort((a, b) => Number(b.isLoaded) - Number(a.isLoaded) || a.name.localeCompare(b.name));

    return NextResponse.json({
      models,
      loadedCount: models.filter((m) => m.isLoaded).length,
      totalCount: models.length,
      warning: libraryError ?? loadedError ?? null,
    });
  } catch (error) {
    console.error('LM Studio kütüphane keşfi başarısız:', error);
    return NextResponse.json(
      { error: 'Kütüphane keşfi başarısız oldu', models: [] },
      { status: 500 }
    );
  }
}

/**
 * POST /api/models/library
 * Gövde: { modelId: string, name?: string }
 * Kütüphaneden seçilen bir modeli kalıcı olarak veritabanına kaydeder
 * (tek tıkla ekleme). LM Studio, test başladığında modeli JIT ile yükler.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.modelId || typeof body.modelId !== 'string') {
      return NextResponse.json({ error: 'modelId zorunludur' }, { status: 400 });
    }

    const shortId = String(body.modelId).toLowerCase();
    const name = body.name ? String(body.name) : shortId;

    // Kütüphane indeksinde bu modelin gerçekten var olduğunu doğrula
    const modelDataPath = getModelDataPath();
    let found = false;
    try {
      const raw = await fs.readFile(modelDataPath, 'utf8');
      const parsed = JSON.parse(raw);
      const pairs: unknown[] = Array.isArray(parsed.json) ? parsed.json : [];
      found = pairs.some(
        (pair) =>
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          pair[0].toLowerCase().includes(shortId)
      );
    } catch {
      // İndeks okunamıyorsa kayda izin ver; LM Studio zaten hata döndürecek
      found = true;
    }

    if (!found) {
      return NextResponse.json(
        { error: 'Bu model LM Studio kütüphanesinde bulunamadı' },
        { status: 404 }
      );
    }

    // Mevcut kayıt varsa güncelle, yoksa oluştur
    const existingModels = await readModels();
    const existing = existingModels.find(
      (m) => m.modelId.toLowerCase() === shortId
    );
    const modelConfig: ModelConfig = existing
      ? { ...existing, name, baseUrl: LM_STUDIO_BASE_URL }
      : {
          id: `lmstudio-lib-${shortId.replace(/[^a-z0-9]/g, '-')}`,
          name,
          provider: 'lmstudio',
          baseUrl: LM_STUDIO_BASE_URL,
          apiKey: undefined,
          modelId: shortId,
          isJudge: false,
        };

    await writeModel(modelConfig);
    return NextResponse.json(modelConfig, { status: 201 });
  } catch (error) {
    console.error('Kütüphane modeli kaydedilemedi:', error);
    return NextResponse.json(
      { error: 'Kütüphane modeli kaydedilemedi' },
      { status: 500 }
    );
  }
}

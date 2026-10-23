import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ModelConfig } from '@/types/benchmark';
import { readModels } from '@/lib/db';
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
 * Canlı API model ID'sinden okunabilir bir görünen ad üretir.
 * Örn: "qwen3.5-9b" → "Qwen3.5-9B", "nvidia-nemotron-3-super-120b-a12b"
 *   → "Nvidia Nemotron 3 Super 120b A12b"
 * Kısa çizgilerle ayrılmış segmentler baş harf büyütülür; noktalı sürüm
 * numaraları (3.5, 4.7) olduğu gibi korunur.
 */
function prettyNameFromId(id: string): string {
  return id
    .split('-')
    .map((seg) => {
      // Sürüm numarası (ör. "3.5", "27b") veya zaten kısa: olduğu gibi bırak
      if (/^\d/.test(seg)) return seg.toUpperCase();
      if (seg.length <= 2) return seg.toUpperCase();
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    })
    .join(' ');
}

/**
 * GET /api/models/library
 *
 * LM Studio kütüphanesindeki TÜM modelleri listeler — yüklü (loaded)
 * OLMAYANLAR DAHİL.
 *
 * BİRİNCİL KAYNAK: LM Studio'nun canlı /api/v0/models endpoint'i.
 * Bu endpoint her zaman günceldir: state (loaded/not-loaded), type
 * (llm/vlm/embeddings), quantization, publisher ve arch bilgilerini
 * içerir. Eski yaklaşım (~/.lmstudio/.internal/model-data.json okumak)
 * bayat kalabildiği için yalnızca FALLBACK olarak kullanılır — canlı
 * API'ye ulaşılamazsa devreye girer.
 *
 * Embedding modelleri test için anlamsız olduğundan listelenmez.
 * ":N" sonekli duplicate instance'lar (ör. "qwen3.5-9b:2") filtrelenir.
 * Keşfedilen modeller veritabanına kaydedilmez; yalnızca listelenir.
 * Kullanıcı Test Koşucusu'ndan seçtiğinde LM Studio modeli otomatik (JIT) yükler.
 */
export async function GET() {
  try {
    // ─── 1) BİRİNCİL KAYNAK: canlı /api/v0/models ──────────────
    const v0Models = await listLMStudioModels();

    // Embedding modelleri hariç tut; ":N" sonekli duplicate instance'ları ele
    const seenBaseIds = new Set<string>();
    const liveModels = v0Models.filter((m) => {
      if (m.type === 'embeddings') return false;
      const baseId = m.id.replace(/:\d+$/, '');
      if (seenBaseIds.has(baseId)) return false;
      seenBaseIds.add(baseId);
      return true;
    });

    if (liveModels.length > 0) {
      // Mevcut kayıtlı modelleri al (isJudge bayrağı ve "çalışmıyor" notları için)
      const existingModels = await readModels();
      const existingByModelId = new Map<string, ModelConfig>();
      existingModels.forEach((m) => {
        existingByModelId.set(m.modelId.toLowerCase(), m);
      });

      const models = liveModels.map((m) => {
        const existing = existingByModelId.get(m.id.toLowerCase());
        return {
          id: existing?.id ?? `lmstudio-lib-${m.id.replace(/[^a-z0-9]/g, '-')}`,
          name: prettyNameFromId(m.id),
          provider: 'lmstudio' as const,
          baseUrl: LM_STUDIO_BASE_URL,
          apiKey: undefined,
          modelId: m.id,
          isJudge: existing?.isJudge ?? false,
          libraryKey: `${m.publisher ?? 'local'}/${m.id}`,
          isLoaded: m.state === 'loaded',
          repo: m.publisher ?? '—',
          quantization: m.quantization,
          lastLoadError: existing?.lastLoadError,
          lastLoadErrorAt: existing?.lastLoadErrorAt,
        };
      });

      // Yüklü modelleri başa sırala
      models.sort(
        (a, b) => Number(b.isLoaded) - Number(a.isLoaded) || a.name.localeCompare(b.name)
      );

      return NextResponse.json({
        models,
        loadedCount: models.filter((m) => m.isLoaded).length,
        totalCount: models.length,
        source: 'live-api',
        warning: null,
      });
    }

    // ─── 2) FALLBACK: canlı API boş döndü → kütüphane indeksini dene ──
    // LM Studio sunucusu kapalı olabilir; model-data.json yine de
    // kütüphanedeki modelleri gösterebilir (yüklü durumu bilinemez).
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
        'LM Studio sunucusuna ulaşılamadı ve kütüphane indeksi (~/.lmstudio/.internal/model-data.json) okunamadı.';
    }

    if (libraryEntries.length === 0) {
      return NextResponse.json(
        {
          error:
            libraryError ??
            'LM Studio sunucusuna ulaşılamadı ve kütüphanede model bulunamadı. LM Studio açık mı?',
          models: [],
        },
        { status: 404 }
      );
    }

    const existingModels = await readModels();
    const existingByShortId = new Map<string, ModelConfig>();
    existingModels.forEach((m) => {
      existingByShortId.set(m.modelId.toLowerCase(), m);
    });

    const models = libraryEntries.map((entry) => {
      const shortId = entry.name.toLowerCase();
      const existing = existingByShortId.get(shortId);
      return {
        id: existing?.id ?? `lmstudio-lib-${shortId.replace(/[^a-z0-9]/g, '-')}`,
        name: entry.name,
        provider: 'lmstudio' as const,
        baseUrl: LM_STUDIO_BASE_URL,
        apiKey: undefined,
        modelId: shortId,
        isJudge: existing?.isJudge ?? false,
        libraryKey: entry.key,
        isLoaded: false, // canlı API'ye ulaşılamadı — durum bilinmiyor
        repo: entry.repo,
        lastLoadError: existing?.lastLoadError,
        lastLoadErrorAt: existing?.lastLoadErrorAt,
      };
    });

    models.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      models,
      loadedCount: 0,
      totalCount: models.length,
      source: 'library-index-fallback',
      warning:
        'LM Studio sunucusuna ulaşılamadı — liste kütüphane indeksinden alındı, yüklü durumu gösterilemiyor.',
    });
  } catch (error) {
    console.error('LM Studio kütüphane keşfi başarısız:', error);
    return NextResponse.json(
      { error: 'Kütüphane keşfi başarısız oldu', models: [] },
      { status: 500 }
    );
  }
}

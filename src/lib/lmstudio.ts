/**
 * LM Studio CLI (lms) ve REST API yardımcıları.
 *
 * - Model yükleme/boşaltma `lms load/unload` komutlarıyla yapılır.
 *   `lms load <model-id> -y` kısa model ID'sini kabul eder (doğrulandı).
 *   `lms unload <identifier>` yüklü modelin identifier'ını (model ID'si
 *   ile aynı) bekler; model yüklü değilse "Model Not Found" döner —
 *   bu durum başarı sayılır (idempotent).
 * - Kütüphane listesi LM Studio'nun /api/v0/models endpoint'inden alınır:
 *   state (loaded/not-loaded), type (llm/vlm/embeddings) ve quantization
 *   bilgilerini içerir. Embedding modelleri test için anlamsız olduğundan
 *   listelenmez.
 */

import { spawn } from 'child_process';
import { withRetry } from '@/lib/retry';

const LMS_BIN = 'lms';
const LM_STUDIO_API_BASE = 'http://localhost:1234';

/** Büyük modellerin (99 GB) diskten yüklenmesi dakikalar sürebilir. */
const LOAD_TIMEOUT_MS = 30 * 60 * 1000;
const UNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const LIST_TIMEOUT_MS = 10 * 1000;

interface LmsExecResult {
  ok: boolean;
  output: string;
}

/** `lms` komutunu alt süreçte çalıştırır; ANSI spinner kodlarını temizler. */
function execLms(args: string[], timeoutMs: number): Promise<LmsExecResult> {
  return new Promise((resolve) => {
    const child = spawn(LMS_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let raw = '';
    const collect = (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, output: `${raw}\n[lms zaman aşımı: ${timeoutMs} ms]` });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: `lms çalıştırılamadı: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      // Spinner/ANSI kontrol karakterlerini temizle (yalnızca log görselliği)
      const clean = raw
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/\r/g, '\n');
      resolve({ ok: code === 0, output: clean });
    });
  });
}

/**
 * LM Studio'ya model yükler (JIT). ÖNCE state kontrolü yapılır: model
 * zaten yüklüyse `lms load` ÇAĞRILMAZ — aksi halde LM Studio ":2" sonekli
 * ikinci bir instance oluşturur (duplicate isim sorununun kökü).
 *
 * Yükleme başarısız olursa en fazla 3 kez denenir (geçici disk/VRAM
 * hıçkırıkları için). Her denemeden önce state kontrolü yenilenir —
 * ilk deneme aslında başarılı olduysa (ama çıktı hatalı göründüyse)
 * ikinci deneme "zaten yüklü" görüp başarıyla döner.
 */
export async function loadLMStudioModel(
  modelId: string
): Promise<LmsExecResult> {
  return withRetry(
    async () => {
      // Zaten yüklü mü? (base id veya :N sonekli herhangi bir instance)
      const current = await listLMStudioModels();
      const isLoaded = current.some(
        (m) =>
          m.state === 'loaded' &&
          (m.id === modelId || m.id.startsWith(`${modelId}:`))
      );
      if (isLoaded) {
        return { ok: true, output: 'Model zaten yüklü — lms load atlandı.' };
      }

      const result = await execLms(['load', modelId, '-y'], LOAD_TIMEOUT_MS);
      if (result.ok) return result;
      const lower = result.output.toLowerCase();
      if (lower.includes('already loaded') || lower.includes('zaten yüklü')) {
        return { ok: true, output: result.output };
      }
      throw new Error(result.output.slice(-500));
    },
    {
      maxAttempts: 3,
      delayMs: 5000,
    }
  )
    .then((result) => result as LmsExecResult)
    .catch(
      (error): LmsExecResult => ({
        ok: false,
        output: error instanceof Error ? error.message : String(error),
      })
    );
}

/**
 * LM Studio'dan modeli boşaltır (eject). ÖNCE state kontrolü yapılır:
 * model yüklü değilse `lms unload` çağrılmaz. Yüklüyse identifier'ı
 * (modelId veya :N sonekli instance) bulup o identifier'ı boşaltır.
 */
export async function unloadLMStudioModel(
  modelId: string
): Promise<LmsExecResult> {
  const current = await listLMStudioModels();
  const loadedInstance = current.find(
    (m) =>
      m.state === 'loaded' &&
      (m.id === modelId || m.id.startsWith(`${modelId}:`))
  );
  if (!loadedInstance) {
    return { ok: true, output: 'Model zaten yüklü değil — unload atlandı.' };
  }

  const result = await execLms(['unload', loadedInstance.id], UNLOAD_TIMEOUT_MS);
  if (result.ok) return result;
  const lower = result.output.toLowerCase();
  if (lower.includes('not found') || lower.includes('no model')) {
    return { ok: true, output: 'Model zaten yüklü değil.' };
  }
  return result;
}

/** LM Studio kütüphanesindeki tek bir modelin özet bilgisi. */
export interface LMStudioLibraryModel {
  /** LM Studio API'de kullanılan kısa model ID'si (lms load/unload bu ID'yi kabul eder) */
  id: string;
  /** llm | vlm | embeddings */
  type: string;
  /** loaded | not-loaded */
  state: string;
  /** Örn: Q4_K_M */
  quantization: string | null;
  /** Örn: lmstudio-community */
  publisher: string | null;
  /** Örn: qwen35 */
  arch: string | null;
}

/**
 * LM Studio kütüphanesindeki TÜM modelleri /api/v0/models'ten çeker.
 * Sunucu kapalıysa boş dizi döner (hata fırlatmaz).
 */
export async function listLMStudioModels(): Promise<LMStudioLibraryModel[]> {
  try {
    const res = await fetch(`${LM_STUDIO_API_BASE}/api/v0/models`, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(data.data)) return [];
    return data.data
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({
        id: String(m.id),
        type: typeof m.type === 'string' ? m.type : 'llm',
        state: typeof m.state === 'string' ? m.state : 'not-loaded',
        quantization:
          typeof m.quantization === 'string' ? m.quantization : null,
        publisher: typeof m.publisher === 'string' ? m.publisher : null,
        arch: typeof m.arch === 'string' ? m.arch : null,
      }));
  } catch {
    return [];
  }
}

/**
 * Test edilebilir modelleri döner: embedding modelleri hariç tüm LLM/VLM'ler.
 *
 * ":N" sonekli duplicate instance'lar (ör. "qwen3.5-9b:2" — aynı modelin
 * ikinci yüklenmiş kopyası) filtrelenir; yalnızca benzersiz modeller kalır.
 */
export async function listTestableLMStudioModels(): Promise<
  LMStudioLibraryModel[]
> {
  const all = await listLMStudioModels();
  const seen = new Set<string>();
  const unique: LMStudioLibraryModel[] = [];
  for (const m of all) {
    if (m.type === 'embeddings') continue;
    // ":2" benzeri instance soneklerini soy → base kimlik
    const baseId = m.id.replace(/:\d+$/, '');
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    unique.push({ ...m, id: baseId });
  }
  return unique;
}

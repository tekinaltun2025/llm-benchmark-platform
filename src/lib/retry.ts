/**
 * Hata açıklama ve yeniden deneme (retry) yardımcıları.
 *
 * - describeError(): Ham hata mesajını kullanıcıya yönelik Türkçe bir
 *   "neden" açıklamasına çevirir. Bağlantı reddi, zaman aşımı, bozuk
 *   GGUF, VRAM yetersizliği vb. bilinen kalıpları tanır.
 * - withRetry(): Bir async adımı en fazla N kez (varsayılan 3) dener;
 *   her başarısız denemede onRetry callback'i ile ilerleme olayı
 *   üretilebilir. Tüm denemeler tükenirse son hatayı fırlatır.
 */

/** Hata mesajından olası nedeni açıklayan Türkçe cümle üretir. */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Bilinmeyen hata');
  const lower = raw.toLowerCase();

  // ── Sıra önemli: spesifik kalıplar önce kontrol edilir ──

  // Bozuk model dosyası (GGUF tensor sınırları dışında)
  if (
    (lower.includes('tensor') && lower.includes('bounds')) ||
    lower.includes('data is not within the file bounds') ||
    lower.includes('gguf') && (lower.includes('corrupt') || lower.includes('bozuk'))
  ) {
    return 'Model dosyası bozuk (hasarlı GGUF) — modeli LM Studio kütüphanesinden silip yeniden indirmeniz gerekiyor';
  }

  // Model dosyası diskte yok
  if (
    lower.includes('no such file') ||
    lower.includes('file not found') ||
    lower.includes('dosya bulunamadı') ||
    lower.includes('missing file') ||
    (lower.includes('file') && lower.includes('missing'))
  ) {
    return 'Model dosyası diskte bulunamadı — indirme yarım kalmış veya dosya taşınmış olabilir';
  }

  // Bağlantı reddedildi (sunucu kapalı)
  if (
    lower.includes('econnrefused') ||
    lower.includes('connection refused') ||
    lower.includes('fetch failed') ||
    lower.includes('bağlantı reddedildi') ||
    lower.includes('connect econnrefused')
  ) {
    return 'LM Studio sunucusuna bağlanılamadı — localhost:1234 sunucusunun açık olduğundan emin olun';
  }

  // Zaman aşımı / iptal
  if (
    lower.includes('aborted') ||
    lower.includes('aborterror') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('zaman aşımı')
  ) {
    return 'İstek zaman aşımına uğradı — model çok yavaş yanıt verdi, kilitlendi veya makine aşırı yüklü';
  }

  // Bellek yetersizliği
  if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('vram') ||
    lower.includes('bellek yetersiz') ||
    lower.includes('memory')
  ) {
    return 'Bellek yetersiz (VRAM/RAM dolu) — diğer modelleri boşaltın veya daha küçük kuantizasyonlu bir model deneyin';
  }

  // HTTP durum kodları
  if (lower.includes('http 404') || lower.includes('404') || lower.includes('not found')) {
    return 'Model bulunamadı — model yüklü değil veya modelId hatalı';
  }
  if (lower.includes('http 400') || lower.includes('400')) {
    return 'Geçersiz istek — model yapılandırması (baseUrl/modelId) hatalı olabilir';
  }
  if (
    lower.includes('http 500') ||
    lower.includes('http 502') ||
    lower.includes('http 503') ||
    lower.includes('internal server') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503')
  ) {
    return 'LM Studio sunucusu iç hata verdi — sunucuyu yeniden başlatmayı deneyin';
  }

  // Stream/yanıt gövdesi sorunları
  if (lower.includes('stream') || lower.includes('gövde') || lower.includes('body')) {
    return 'Yanıt akışı okunamadı — LM Studio stream desteği kapalı olabilir veya bağlantı koptu';
  }

  // lms CLI bulunamadı
  if (lower.includes('lms çalıştırılamadı') || lower.includes('enoent') || lower.includes('spawn')) {
    return 'lms komutu çalıştırılamadı — LM Studio CLI kurulu değil veya PATH içinde değil';
  }

  // Tanınmayan hata: ham mesajı döndür (kısaltılmış)
  return raw.slice(0, 300);
}

/** withRetry'nin deneme seçenekleri. */
export interface RetryOptions {
  /** Toplam deneme sayısı (varsayılan 3). */
  maxAttempts?: number;
  /** Denemeler arası temel bekleme ms (lineer artar: delay×1, delay×2...). */
  delayMs?: number;
  /** Her başarısız denemede çağrılır (ilerleme olayı üretmek için). */
  onRetry?: (info: {
    /** Kaçıncı deneme başarısız oldu (1 tabanlı) */
    attempt: number;
    /** Toplam deneme hakkı */
    maxAttempts: number;
    /** Başarısız denemenin hata mesajı */
    error: string;
    /** Sonraki denemeden önce beklenecek süre (ms) */
    nextDelayMs: number;
  }) => void;
  /** false dönerse retry edilmez (kalıcı hatalar için). */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Bir async adımı en fazla maxAttempts kez dener.
 * Tüm denemeler başarısız olursa SON hatayı fırlatır.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.delayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Son deneme hakkı tükendi — retry yok
      if (attempt === maxAttempts) break;

      // Çağıran bu hatada retry istemiyorsa dur
      if (options.shouldRetry && !options.shouldRetry(error)) break;

      const nextDelayMs = baseDelay * attempt; // lineer artış: 2s, 4s
      options.onRetry?.({
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : String(error),
        nextDelayMs,
      });

      await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
    }
  }

  throw lastError;
}

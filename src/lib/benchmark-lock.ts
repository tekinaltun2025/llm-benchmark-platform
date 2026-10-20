/**
 * Global benchmark koşusu kilidi (mutex) + durdurma (abort) bayrağı.
 *
 * Aynı anda yalnızca TEK test koşusu çalışabilir. Bu olmadan ard arda
 * başlatılan istekler LM Studio'nun istek kuyruğunda birikir ve
 * testler birbirinin ortasında karışır.
 *
 * Durdurma: "Testi Durdur" düğmesi stopRequested bayrağını set eder;
 * çalışan koşu her soru arasında bayrağı kontrol edip kendini güvenli
 * şekilde sonlandırır (o ana kadarki sonuçlar DB'ye YAZILMAZ).
 *
 * Next.js dev modunda modül state'i hot-reload ile sıfırlanabileceği için
 * tüm state globalThis üzerinde tutulur.
 */

interface BenchmarkLockState {
  /** Şu anda bir test koşusu çalışıyor mu? */
  isLocked: boolean;
  /** Kilidi tutan test modelinin adı (bilgilendirme için) */
  lockedBy: string | null;
  /** Kilidin alındığı zaman (Unix ms) */
  lockedAt: number | null;
  /** Çalışan koşudan durdurma istendi mi? */
  stopRequested: boolean;
  /** Durdurma isteğinin gerekçesi */
  stopReason: string | null;
}

const GLOBAL_KEY = '__benchmark_lock__';

function getState(): BenchmarkLockState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      isLocked: false,
      lockedBy: null,
      lockedAt: null,
      stopRequested: false,
      stopReason: null,
    } satisfies BenchmarkLockState;
  }
  return g[GLOBAL_KEY] as BenchmarkLockState;
}

/**
 * Kilidi almaya çalışır. Kilit boşsa alır ve true döner;
 * zaten kilitliyse false döner. Yeni koşu başlarken eski
 * durdurma bayrakları da temizlenir.
 */
export function acquireLock(testModelName: string): boolean {
  const state = getState();
  if (state.isLocked) {
    return false;
  }
  state.isLocked = true;
  state.lockedBy = testModelName;
  state.lockedAt = Date.now();
  state.stopRequested = false;
  state.stopReason = null;
  return true;
}

/**
 * Kilidi serbest bırakır. Koşu hata ile bitse bile (finally bloğunda)
 * çağrılmalıdır; aksi halde sistem kilitli kalır. Durdurma bayrakları
 * da temizlenir.
 */
export function releaseLock(): void {
  const state = getState();
  state.isLocked = false;
  state.lockedBy = null;
  state.lockedAt = null;
  state.stopRequested = false;
  state.stopReason = null;
}

/**
 * Çalışan koşuyu durdurmayı ister ("Testi Durdur" düğmesi).
 * Koşu çalışmıyorsa false döner.
 */
export function requestStop(reason: string): boolean {
  const state = getState();
  if (!state.isLocked) {
    return false;
  }
  state.stopRequested = true;
  state.stopReason = reason;
  return true;
}

/**
 * Durdurma istenmiş mi? Çalışan koşu her soru arasında bunu kontrol eder.
 */
export function isStopRequested(): boolean {
  return getState().stopRequested;
}

/**
 * Durdurma isteğinin gerekçesi (istenmemişse null).
 */
export function getStopReason(): string | null {
  return getState().stopReason;
}

/**
 * Mevcut kilit + durdurma durumunu döner (durum sorgulama endpoint'i için).
 */
export function getLockStatus(): BenchmarkLockState {
  return { ...getState() };
}

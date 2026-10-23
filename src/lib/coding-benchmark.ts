/**
 * 5 Seviyeli Kodlama Benchmark Seti
 * Her seviye: prompt + gizli sandbox testleri + judge rubriği
 */

import { CodingBenchmarkQuestion, CodingLevel } from "../types/benchmark";

/** Judge rubriği sabitleri */
export const CODING_JUDGE_CRITERIA = {
  correctness: 30,
  edgeCasesSafety: 25,
  architectureCleanCode: 25,
  errorHandling: 20,
} as const;

/** Dil politikası — tüm kodlama seviyeleri için zorunlu ön-ek */
const PYTHON_LANGUAGE_POLICY = `Aksi belirtilmedikçe çözümler Python 3.11+ kullanılarak, harici kütüphane bağımlılığı olmadan (yalnızca Standard Library) ve tam tip ipuçları (type hints / typing) ile yazılmalıdır. Kod üretime hazır, eksiksiz ve mock/placeholder içermemelidir.`;

/** Seviye 1: Token Bucket / Sliding Window Log Rate Limiter (Python 3.11+) */
const LEVEL_1_PROMPT = `${PYTHON_LANGUAGE_POLICY}

Aşağıdaki arayüzü uygulayan **thread-safe** bir **RateLimiter** sınıfı yazın (Python 3.11+).

\`\`\`python
from collections import deque
from threading import Lock
import time


class RateLimiter:
    """Sliding window tabanlı thread-safe rate limiter.

    Kullanıcı bazlı (örn. dakikada 60 istek) ve global seviyede
    (saniyede 1000 istek) sınırlama destekler.
    """

    def __init__(self, max_requests: int, window_ms: int) -> None:
        self.max_requests: int = max_requests
        self.window_ms: int = window_ms
        self._lock: Lock = Lock()
        self._timestamps: dict[str, deque[float]] = {}

    def try_acquire(self, key: str) -> bool:
        """İstek izni iste. True = izin verildi, False = rate limit aşıldı."""
        ...

    def acquire(self, key: str) -> None:
        """Bloklayıcı izin iste — izin verilecek kadar bekler."""
        ...

    def get_usage(self, key: str) -> int:
        """Mevcut kullanım sayısını döndür (gözlem için)."""
        ...

    def cleanup(self) -> None:
        """Süresi dolan kayıtları temizle (memory leak önleme)."""
        ...
\`\`\`

**Gereksinimler:**
1. **Sliding Window** algoritması (fixed window DEĞIL) — son \`window_ms\` içindeki istekleri say
2. **Thread-safe** — eşzamanlı \`try_acquire\` çağrıları veri yarışı yaratmamalı (\`threading.Lock\` kullanın)
3. **Memory cleanup** — \`cleanup()\` süresi dolan \`key\` kayıtlarını silmeli; periyodik çağrılabilecek
4. **O(1) amortized** — \`try_acquire\` ve \`acquire\` ortalama O(1) olmalı
5. **Stdlib only** — harici kütüphane YOK; sadece \`collections.deque\`, \`threading.Lock\`, \`time.monotonic\`
6. **Tam tip ipuçları** — tüm metodlar ve özellikler için type hints zorunludur

**Test edilecek senaryolar (gizli):**
- Eşzamanlı 1000 \`try_acquire\` çağrısı veri yarışı yaratmamalı
- Pencere kaydığında eski istekler sayılmamalı
- \`cleanup()\` çağrılmadığında bile bellek sızmamalı (maksimum \`max_requests * unique_keys\` kayıt)
- \`acquire\` rate limit aşıldığında beklemeli, pencere açıldığında devam etmeli`;

/** Seviye 1 gizli testleri */
const LEVEL_1_HIDDEN_TESTS = `import { describe, it, expect, beforeEach, vi } from 'vitest';

// Test edilecek RateLimiter sınıfı buraya enjekte edilecek
// const { RateLimiter } = await import('./candidate-solution');

describe('Level 1: RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000 });
  });

  it('temel doğruluk: maxRequests kadar izin vermeli', () => {
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire('user-1')).toBe(true);
    }
    expect(limiter.tryAcquire('user-1')).toBe(false);
  });

  it('farklı keyler bağımsız sayılmalı', () => {
    for (let i = 0; i < 10; i++) expect(limiter.tryAcquire('a')).toBe(true);
    for (let i = 0; i < 10; i++) expect(limiter.tryAcquire('b')).toBe(true);
    expect(limiter.tryAcquire('a')).toBe(false);
    expect(limiter.tryAcquire('b')).toBe(false);
  });

  it('sliding window: pencere kaydığında eski istekler sayılmamalı', async () => {
    for (let i = 0; i < 10; i++) expect(limiter.tryAcquire('user-1')).toBe(true);
    expect(limiter.tryAcquire('user-1')).toBe(false);
    
    await new Promise(r => setTimeout(r, 1100)); // pencere geçti
    
    // Eski istekler artık sayılmamalı, yenisi izin verilmeli
    expect(limiter.tryAcquire('user-1')).toBe(true);
  });

  it('thread-safe: eşzamanlı çağrılar veri yarışı yaratmamalı', async () => {
    const limiter = new RateLimiter({ maxRequests: 1000, windowMs: 5000 });
    const promises = Array.from({ length: 1000 }, () => 
      Promise.resolve().then(() => limiter.tryAcquire('concurrent'))
    );
    const results = await Promise.all(promises);
    const allowed = results.filter(r => r).length;
    expect(allowed).toBe(1000); // hepsi izin verilmeli, hiçbiri false olmamalı
  });

  it('acquire: rate limit aşıldığında beklemeli ve sonra izin vermeli', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 200 });
    expect(limiter.tryAcquire('wait-test')).toBe(true);
    expect(limiter.tryAcquire('wait-test')).toBe(true);
    
    const start = Date.now();
    await limiter.acquire('wait-test'); // beklemeli
    const elapsed = Date.now() - start;
    
    // en az pencere süresi kadar beklemeli (200ms ± tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(500);
  });

  it('memory cleanup: cleanup() süresi dolan keyleri silmeli', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 100 });
    for (let i = 0; i < 5; i++) limiter.tryAcquire('temp-key');
    
    // key hala varsa usage > 0
    expect(limiter.getUsage('temp-key')).toBe(5);
    
    // bekle + cleanup
    setTimeout(() => {}, 150); // pencere geçsin
    limiter.cleanup();
    
    // artık usage 0 olmalı
    expect(limiter.getUsage('temp-key')).toBe(0);
  });

  it('performans: 100k ops < 100ms', () => {
    const limiter = new RateLimiter({ maxRequests: 100000, windowMs: 60000 });
    const start = performance.now();
    for (let i = 0; i < 100000; i++) {
      limiter.tryAcquire(\`perf-\${i % 1000}\`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});`;

/** Seviye 2: Async Task Queue + Worker Pool (Python 3.11+) */
const LEVEL_2_PROMPT = `${PYTHON_LANGUAGE_POLICY}

Aşağıdaki arayüzü uygulayan **AsyncTaskQueue** sınıfı yazın (Python 3.11+, asyncio).

\`\`\`python
import asyncio
import heapq
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass(order=True)
class Task:
    priority: int
    payload: Any = field(compare=False)
    retries: int = field(default=3, compare=False)
    id: str = field(default="", compare=False)


class AsyncTaskQueue:
    """Asenkron iş kuyruğu — worker pool ile eşzamanlı işlem yönetimi."""

    def __init__(
        self,
        concurrency: int,
        worker: Callable[[Task], Any],
        base_delay_ms: int = 100,
        max_delay_ms: int = 5000,
        jitter_factor: float = 0.1,
    ) -> None:
        self.concurrency: int = concurrency
        self.worker: Callable[[Task], Any] = worker
        self.base_delay_ms: int = base_delay_ms
        self.max_delay_ms: int = max_delay_ms
        self.jitter_factor: float = jitter_factor
        self._queue: list[Task] = []
        self._running: set[asyncio.Task[None]] = set()
        self._completed: dict[str, str] = {}  # id -> task_id (idempotency)
        self._lock: asyncio.Lock = asyncio.Lock()
        self._shutdown: bool = False

    async def enqueue(self, task: Task) -> str:
        """Task ekle — taskId döner. Aynı id ile tekrar eklenirse mevcut taskId döner."""
        ...

    @property
    def pending_count(self) -> int:
        """Kuyruktaki bekleyen task sayısı."""
        ...

    @property
    def running_count(self) -> int:
        """Çalışan worker sayısı."""
        ...

    async def shutdown(self) -> None:
        """Graceful shutdown — çalışan taskler bitene kadar bekle, yeni task alma."""
        ...

    async def stop(self) -> None:
        """Kuyruğu durdur (shutdown alias)."""
        ...
\`\`\`

**Gereksinimler:**
1. **Worker pool** — \`concurrency\` kadar eşzamanlı worker; biten worker yeni task çekmeli
2. **Priority queue** — \`priority\` düşük olan önce işlenmeli (min-heap)
3. **Exponential backoff + jitter** — hata durumunda \`base_delay_ms * 2^retry + random(0, jitter_factor * delay)\`
4. **Retry limit** — \`retries\` (varsayılan 3) aşıldığında task failed sayılmalı, bir sonraki task'e geçmeli
5. **Graceful shutdown** — \`shutdown()\` çağrıldığında: yeni task almaya dur, çalışanları bekle, sonra resolve et
6. **Idempotency key** — aynı \`id\` ile \`enqueue\` çağrılırsa ikinci çağrı mevcut taskId'yi döndürmeli (duplicate engelleme)
7. **Stdlib only** — harici kütüphane YOK; sadece \`asyncio\`, \`heapq\`, \`random\`, \`time\`, \`dataclasses\`, \`typing\`
8. **Tam tip ipuçları** — tüm metodlar ve özellikler için type hints zorunludur

**Test edilecek senaryolar (gizli):**
- Maksimum 5 eşzamanlı worker — 6. task beklemeli
- Priority: düşük priority task önce işlenmeli
- Retry: hata atan task exponential backoff ile tekrar denenmeli (max 3)
- Graceful shutdown: SIGINT benzeri sinyalde çalışan taskler bitmeli
- Duplicate enqueue: aynı id ile ikinci çağrı aynı taskId döndürmeli`;

/** Seviye 2 gizli testleri */
const LEVEL_2_HIDDEN_TESTS = `import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Level 2: AsyncTaskQueue', () => {
  let queue: AsyncTaskQueue;
  let executedTasks: string[] = [];
  let workerFn: (task: Task) => Promise<void>;

  beforeEach(() => {
    executedTasks = [];
    workerFn = vi.fn(async (task: Task) => {
      executedTasks.push(task.id);
      await new Promise(r => setTimeout(r, 10)); // simüle iş
    });
    queue = new AsyncTaskQueue({
      concurrency: 3,
      worker: workerFn,
      baseDelayMs: 50,
      maxDelayMs: 500,
      jitterFactor: 0.1,
    });
  });

  it('maksimum concurrency worker çalışmalı', async () => {
    const runningCounts: number[] = [];
    let maxRunning = 0;
    
    const monitoringWorker = vi.fn(async (task: Task) => {
      maxRunning = Math.max(maxRunning, queue.runningCount);
      await new Promise(r => setTimeout(r, 50));
    });
    
    const monitorQueue = new AsyncTaskQueue({
      concurrency: 3,
      worker: monitoringWorker,
    });
    
    await Promise.all([
      monitorQueue.enqueue({ payload: '1' }),
      monitorQueue.enqueue({ payload: '2' }),
      monitorQueue.enqueue({ payload: '3' }),
      monitorQueue.enqueue({ payload: '4' }),
      monitorQueue.enqueue({ payload: '5' }),
    ]);
    
    await monitorQueue.shutdown();
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it('priority: düşük sayı önce işlenmeli', async () => {
    const order: number[] = [];
    const priorityWorker = vi.fn(async (task: Task) => {
      order.push(task.priority ?? 0);
      await new Promise(r => setTimeout(r, 10));
    });
    
    const pQueue = new AsyncTaskQueue({ concurrency: 1, worker: priorityWorker });
    
    await pQueue.enqueue({ payload: 'low', priority: 10 });
    await pQueue.enqueue({ payload: 'high', priority: 1 });
    await pQueue.enqueue({ payload: 'med', priority: 5 });
    
    await pQueue.shutdown();
    
    // priority 1 önce, sonra 5, sonra 10
    expect(order).toEqual([1, 5, 10]);
  });

  it('retry: hata atan task exponential backoff ile tekrar denenmeli', async () => {
    let attempt = 0;
    const retryWorker = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error('geçici hata');
    });
    
    const rQueue = new AsyncTaskQueue({
      concurrency: 1,
      worker: retryWorker,
      baseDelayMs: 20,
      maxDelayMs: 200,
      jitterFactor: 0,
    });
    
    await rQueue.enqueue({ payload: 'retry-test', retries: 3 });
    await rQueue.shutdown();
    
    expect(attempt).toBe(3); // 1 ilk + 2 retry
  });

  it('graceful shutdown: çalışan taskler bitmeli', async () => {
    let started = 0;
    let completed = 0;
    
    const shutdownWorker = vi.fn(async () => {
      started++;
      await new Promise(r => setTimeout(r, 100));
      completed++;
    });
    
    const sQueue = new AsyncTaskQueue({ concurrency: 2, worker: shutdownWorker });
    
    // 4 task başlat, 2 worker -> 2 çalışıyor, 2 bekliyor
    const p1 = sQueue.enqueue({ payload: '1' });
    const p2 = sQueue.enqueue({ payload: '2' });
    const p3 = sQueue.enqueue({ payload: '3' });
    const p4 = sQueue.enqueue({ payload: '4' });
    
    // biraz bekle ki workerlar başlasın
    await new Promise(r => setTimeout(r, 10));
    
    // shutdown - bekleyen taskler (3,4) çalışmamalı, çalışanlar (1,2) bitmeli
    await sQueue.shutdown();
    
    expect(started).toBe(2); // sadece 2 task başlamalı
    expect(completed).toBe(2); // o 2'si bitmeli
  });

  it('duplicate enqueue: aynı id aynı taskId döndürmeli', async () => {
    const id = 'duplicate-test';
    const id1 = await queue.enqueue({ id, payload: 'data' });
    const id2 = await queue.enqueue({ id, payload: 'data' });
    
    expect(id1).toBe(id2);
    expect(id1).toBe(id);
  });
});`;

/** Seviye 3: Disk-Backed LRU Cache (Python 3.11+) */
const LEVEL_3_PROMPT = `${PYTHON_LANGUAGE_POLICY}

Aşağıdaki arayüzü uygulayan **LRUCache** sınıfı yazın (Python 3.11+).

\`\`\`python
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Optional


class LRUCache:
    """O(1) get/set, TTL ve disk persistence destekli LRU önbellek."""

    def __init__(
        self,
        capacity: int,
        ttl_ms: Optional[int] = None,
        persist_path: Optional[str] = None,
        serialize: Optional[Callable[[Any], str]] = None,
        deserialize: Optional[Callable[[str], Any]] = None,
    ) -> None:
        self.capacity: int = capacity
        self.ttl_ms: Optional[int] = ttl_ms
        self.persist_path: Optional[str] = persist_path
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock: threading.Lock = threading.Lock()
        self._serialize: Callable[[Any], str] = serialize or str
        self._deserialize: Callable[[str], Any] = deserialize or (lambda x: x)

    def get(self, key: str) -> Optional[Any]:
        """Değer getir — yoksa None; erişim sırasını güncelle (MRU)."""
        ...

    def set(self, key: str, value: Any) -> None:
        """Değer ayarla — capacity aşıldıysa LRU evict et, persist_path varsa diske yaz."""
        ...

    def has(self, key: str) -> bool:
        """Key var mı? (erişim sırasını DEĞİŞTIRMEZ)"""
        ...

    def delete(self, key: str) -> bool:
        """Key sil."""
        ...

    def clear(self) -> None:
        """Cache'i temizle (bellek + disk)."""
        ...

    @property
    def size(self) -> int:
        """Mevcut entry sayısı."""
        ...

    @property
    def capacity(self) -> int:
        """Kapasite."""
        ...

    def load_from_disk(self) -> None:
        """Diskten yükle (startup'ta çağrılabilir)."""
        ...

    def get_disk_size(self) -> int:
        """Diskteki entry sayısı."""
        ...
\`\`\`

**Gereksinimler:**
1. **O(1) get/set** — \`OrderedDict\` kullanın (Python 3.7+ insertion order garantili)
2. **TTL expiration** — \`get\` çağrıldığında süresi dolmuşsa silinmeli ve \`None\` dönmeli
3. **Disk persistence** — \`persist_path\` verildiyse evict edilen entry'ler append-only log'a yazılmalı; \`load_from_disk()\` başlangıçta okuyup cache'i doldurmalı
4. **Concurrent access safety** — eşzamanlı \`get\`/\`set\` veri yarışı yaratmamalı (\`threading.Lock\` kullanın)
5. **Memory bound** — bellekteki entry sayısı \`capacity\` asla geçmemeli
6. **Stdlib only** — harici kütüphane YOK; sadece \`threading\`, \`time\`, \`collections.OrderedDict\`, \`typing\`
7. **Tam tip ipuçları** — tüm metodlar ve özellikler için type hints zorunludur

**Test edilecek senaryolar (gizli):**
- O(1) get/set doğrulaması (100k ops < 50ms)
- TTL: süresi dolan entry get'te None dönmeli
- Eviction: capacity aşıldığında LRU entry silinmeli
- Disk persistence: evict edilen entry diskten okunabilmeli
- Concurrent access: 1000 eşzamanlı get/set veri yarışı yaratmamalı`;

/** Seviye 3 gizli testleri */
const LEVEL_3_HIDDEN_TESTS = `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Level 3: LRUCache', () => {
  const testDir = join(tmpdir(), 'lru-cache-test-\${Date.now()}');
  const persistPath = join(testDir, 'cache.log');
  
  afterEach(async () => {
    try { await rm(testDir, { recursive: true, force: true }); } catch {}
  });

  it('O(1) get/set: 100k ops < 50ms', () => {
    const cache = new LRUCache<string>({ capacity: 100000 });
    const start = performance.now();
    
    for (let i = 0; i < 50000; i++) cache.set(\`key-\${i}\`, \`value-\${i}\`);
    for (let i = 0; i < 50000; i++) cache.get(\`key-\${i}\`);
    
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('TTL: süresi dolan entry get\\'te undefined dönmeli', () => {
    const cache = new LRUCache<string>({ capacity: 10, ttlMs: 100 });
    cache.set('ttl-key', 'value');
    expect(cache.get('ttl-key')).toBe('value');
    
    // bekle
    setTimeout(() => {}, 150);
    
    expect(cache.get('ttl-key')).toBeUndefined();
    expect(cache.has('ttl-key')).toBe(false);
  });

  it('eviction: capacity aşıldığında LRU entry silinmeli', () => {
    const cache = new LRUCache<string>({ capacity: 3 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    
    // a en eski (LRU)
    cache.get('b'); // b MRU oldu
    cache.set('d', '4'); // capacity aşıldı, 'a' evict edilmeli
    
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('disk persistence: evict edilen entry diskten okunabilmeli', async () => {
    const cache = new LRUCache<string>({ 
      capacity: 2, 
      persistPath 
    });
    
    cache.set('x', '1');
    cache.set('y', '2');
    cache.set('z', '3'); // 'x' evict -> disk
    
    // yeni cache instance, diskten yükle
    const cache2 = new LRUCache<string>({ 
      capacity: 10, 
      persistPath 
    });
    await cache2.loadFromDisk();
    
    // 'x' diskten yüklenmeli (veya en azından disk boyutu > 0)
    const diskSize = await cache2.getDiskSize();
    expect(diskSize).toBeGreaterThan(0);
  });

  it('concurrent access: 1000 eşzamanlı get/set veri yarışı yaratmamalı', async () => {
    const cache = new LRUCache<number>({ capacity: 10000 });
    
    // önceden doldur
    for (let i = 0; i < 5000; i++) cache.set(\`key-\${i}\`, i);
    
    const promises = Array.from({ length: 1000 }, (_, i) => 
      Promise.resolve().then(() => {
        if (i % 2 === 0) {
          cache.set(\`concurrent-\${i}\`, i);
        } else {
          cache.get(\`key-\${i % 5000}\`);
        }
      })
    );
    
    await Promise.all(promises);
    
    // crash olmamalı, size tutarlı olmalı
    expect(cache.size).toBeLessThanOrEqual(10000);
  });
});`;

/** Seviye 4: Kasıtlı Hatalı Kod Analizi & Refactoring (Python 3.11+) */
const LEVEL_4_PROMPT = `${PYTHON_LANGUAGE_POLICY}

Aşağıdaki **bozuk Python kodunu** analiz edin, hataları bulun ve **düzeltilmiş hali**ni üretin.

\`\`\`python
# BOZUK KOD - ANALİZ EDİP DÜZELTİN
import threading
from collections import defaultdict
from typing import Callable, Any


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, set[Callable[..., Any]]] = defaultdict(set)
        self._async_handlers: dict[str, set[Callable[..., Any]]] = defaultdict(set)
        self._processing: set[str] = set()

    def on(self, event: str, handler: Callable[..., Any]) -> Callable[[], None]:
        self._handlers[event].add(handler)
        return lambda: self.off(event, handler)

    def once(self, event: str, handler: Callable[..., Any]) -> None:
        def wrapper(*args: Any, **kwargs: Any) -> None:
            handler(*args, **kwargs)
            self.off(event, wrapper)

        self.on(event, wrapper)

    def off(self, event: str, handler: Callable[..., Any]) -> None:
        self._handlers[event].discard(handler)
        self._async_handlers[event].discard(handler)

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        # Sync handlers
        for handler in list(self._handlers.get(event, set())):
            try:
                handler(*args, **kwargs)
            except Exception:
                pass

        # Async handlers - FIRE AND FORGET (HATA!)
        for handler in list(self._async_handlers.get(event, set())):
            try:
                handler(*args, **kwargs)  # await yok!
            except Exception:
                pass

    async def emit_async(self, event: str, *args: Any, **kwargs: Any) -> None:
        import asyncio

        sync_tasks = [
            asyncio.create_task(self._call_sync(h, *args, **kwargs))
            for h in self._handlers.get(event, set())
        ]
        async_tasks = [
            asyncio.create_task(self._call_async(h, *args, **kwargs))
            for h in self._async_handlers.get(event, set())
        ]
        await asyncio.gather(*sync_tasks, *async_tasks)

    async def _call_sync(self, handler: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        try:
            handler(*args, **kwargs)
        except Exception:
            pass

    async def _call_async(self, handler: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        try:
            await handler(*args, **kwargs)
        except Exception:
            pass


# KULLANIM ÖRNEĞİ (test edilecek):
# bus = EventBus()
# bus.on("data", lambda x: print("sync:", x))
# bus.on("data", async lambda x: await db.save(x))  # lambda async olamaz!
# await bus.emit_async("data", {"id": 1})
\`\`\`

**Bulmanız gereken hatalar (en az 6):**
1. **Memory leak**: \`once\` wrapper referansı tutulmuyor → \`off\` çalışmıyor, wrapper geri alınamıyor
2. **Race condition**: \`emit\` içinde async handlerlar "fire and forget" → hata yakalanmıyor, sıralama garanti yok
3. **No error propagation**: \`emit_async\` hataları yutuluyor, caller bilgilendirilmiyor
4. **Invalid async lambda**: async lambda Python'da geçerli değil, on async handler kaydı yok
5. **Reentrancy guard yok**: Aynı event \`emit\` sırasında tekrar \`emit\` edilirse sonsuz döngü/stack overflow
6. **Type safety**: \`Callable[..., Any]\` çok geniş, spesifik tip ipuçları kullanılmalı
7. **No handler priority/ordering**: Tüm handlerlar eşit, sıralama kontrolü yok
8. **WeakRef yok**: Handler referansları tutulduğu için garbage collector engelleniyor (memory leak)

**İstenen çıktı:**
1. Hataların listesi (madde madde)
2. Düzeltilmiş **tam Python kodu** (sadece sınıf tanımı, Python 3.11+)
3. Kısa açıklama: hangi pattern kullanıldı (ör. "Reentrancy guard + asyncio.gather + WeakRef")`;

/** Seviye 4 gizli testleri — DÜZELTİLMİŞ kodun testleri */
const LEVEL_4_HIDDEN_TESTS = `import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Level 4: EventBus (Refactored)', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('memory leak fix: once handler auto-removed after first emit', async () => {
    const handler = vi.fn();
    bus.once('test', handler);
    
    await bus.emitAsync('test', 1);
    await bus.emitAsync('test', 2);
    
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('async handler registration: on(event, handler, { async: true }) çalışmalı', async () => {
    const asyncHandler = vi.fn(async (x: number) => { await Promise.resolve(); return x * 2; });
    bus.on('async-test', asyncHandler, { async: true });
    
    await bus.emitAsync('async-test', 5);
    expect(asyncHandler).toHaveBeenCalledWith(5);
  });

  it('reentrancy guard: emit içinde emit stack overflow yapmamalı', async () => {
    let count = 0;
    bus.on('reentrant', async () => {
      count++;
      if (count < 3) await bus.emitAsync('reentrant');
    });
    
    await bus.emitAsync('reentrant');
    expect(count).toBe(3); // 3 kez çağrılmış, stack overflow yok
  });

  it('error propagation: emitAsync handler hatasını yutmamalı', async () => {
    bus.on('error-test', () => { throw new Error('sync error'); });
    bus.on('error-test', async () => { throw new Error('async error'); }, { async: true });
    
    await expect(bus.emitAsync('error-test')).rejects.toThrow();
  });

  it('handler priority: priority düşük önce çalışmalı', async () => {
    const order: number[] = [];
    bus.on('priority', () => order.push(1), { priority: 10 });
    bus.on('priority', () => order.push(2), { priority: 1 });
    bus.on('priority', () => order.push(3), { priority: 5 });
    
    await bus.emitAsync('priority');
    expect(order).toEqual([2, 3, 1]); // priority 1, 5, 10
  });

  it('weakref: handler referansı GC\\'yi engellememeli', async () => {
    // Bu test WeakRef kullanımını doğrular
    // Handler fonksiyonu scope dışına çıkıp GC edildiyse, emit hata vermemeli
    let handler: (() => void) | null = () => {};
    bus.on('weak', handler!);
    handler = null; // referans kaybedildi
    
    // GC zorla (test ortamında mümkün değil, ama WeakRef varsa hata vermez)
    await bus.emitAsync('weak'); // crash olmamalı
    expect(true).toBe(true);
  });
});`;

/** Seviye 5: Saga Pattern Orchestrator (Python 3.11+) */
const LEVEL_5_PROMPT = `${PYTHON_LANGUAGE_POLICY}

**Saga Pattern Orchestrator** tasarlayın ve prototip kodunu yazın (Python 3.11+).

**Problem:** Dağıtık sistemde birden fazla servis koordinasyonu gereken uzun süreli işlemler (örn: sipariş oluşturma → ödeme → stok rezervasyonu → kargo → bildirim). Her adım başarısız olursa **compensation (geri alma)** işlemleri tetiklenmeli.

**Gereksinimler:**
1. **Step tanımı**: Her adım \`execute\` (ileri) ve \`compensate\` (geri alma) fonksiyonlarına sahip
2. **State machine**: \`PENDING\` → \`RUNNING\` → \`COMPLETED\` | \`FAILED\` → \`COMPENSATING\` → \`COMPENSATED\` | \`COMPENSATION_FAILED\`
3. **Persistence**: State her adımda kaydedilmeli (disk/DB) — crash sonrası devam edebilmeli
4. **Idempotency**: Aynı \`sagaId\` ile tekrar başlatma güvenli olmalı
5. **Concurrency control**: Aynı sagaId için eşzamanlı çalışma engellenmeli
6. **Observability**: Her adımın başlangıç/bitiş/sonuç loglanmalı

**İstenen çıktı:**
1. **Dil seçimi + 2 cümlelik gerekçe** (ör. "Python 3.11 — asyncio ve type hints ile state machine temiz ifade edilir")
2. **Prototip kod** — core orchestrator sınıfı + step tanımı + state persistence arayüzü (Python 3.11+)
3. **Compensation akışı şeması** (ASCII/mermaid text)

**Değerlendirme kriterleri (Judge):**
- Mimari uygunluk (Saga pattern doğru mu?)
- Compensation correctness (ters sırayla, hata durumunda da çalışır mı?)
- State persistence tasarımı
- Idempotency & concurrency güvenliği
- Kod kalitesi (type hints, modülerlik, okunabilirlik)`;

/** Seviye 5 gizli testleri — prototip kodun testleri */
const LEVEL_5_HIDDEN_TESTS = `import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Level 5: Saga Orchestrator', () => {
  let orchestrator: SagaOrchestrator;
  let executedSteps: string[] = [];
  let compensatedSteps: string[] = [];

  beforeEach(() => {
    executedSteps = [];
    compensatedSteps = [];
    orchestrator = new SagaOrchestrator({
      persistence: new InMemoryPersistence(),
      lockManager: new InMemoryLockManager(),
    });
  });

  it('basit saga: tüm adımlar başarılı olmalı', async () => {
    const saga = orchestrator.createSaga('order-123', [
      { name: 'create-order', execute: async () => { executedSteps.push('create-order'); }, compensate: async () => { compensatedSteps.push('create-order'); } },
      { name: 'payment', execute: async () => { executedSteps.push('payment'); }, compensate: async () => { compensatedSteps.push('payment'); } },
      { name: 'reserve-stock', execute: async () => { executedSteps.push('reserve-stock'); }, compensate: async () => { compensatedSteps.push('reserve-stock'); } },
    ]);
    
    await saga.execute();
    
    expect(executedSteps).toEqual(['create-order', 'payment', 'reserve-stock']);
    expect(compensatedSteps).toEqual([]);
    expect(saga.getState()).toBe('COMPLETED');
  });

  it('compensation: ortadaki adım başarısız olursa öncekiler ters sırada compensate edilmeli', async () => {
    const saga = orchestrator.createSaga('order-456', [
      { name: 'step-1', execute: async () => { executedSteps.push('step-1'); }, compensate: async () => { compensatedSteps.push('step-1'); } },
      { name: 'step-2', execute: async () => { executedSteps.push('step-2'); throw new Error('payment failed'); }, compensate: async () => { compensatedSteps.push('step-2'); } },
      { name: 'step-3', execute: async () => { executedSteps.push('step-3'); }, compensate: async () => { compensatedSteps.push('step-3'); } },
    ]);
    
    await expect(saga.execute()).rejects.toThrow('payment failed');
    
    // step-2 başarısız -> step-1 compensate edilmeli (step-3 çalışmamış)
    expect(executedSteps).toEqual(['step-1', 'step-2']);
    expect(compensatedSteps).toEqual(['step-1']);
    expect(saga.getState()).toBe('COMPENSATED');
  });

  it('idempotency: aynı sagaId ile tekrar execute güvenli olmalı', async () => {
    const saga1 = orchestrator.createSaga('idem-1', [
      { name: 'step', execute: async () => { executedSteps.push('step'); }, compensate: async () => {} },
    ]);
    await saga1.execute();
    
    // ikinci çağrı - zaten COMPLETED, tekrar çalışmamalı
    const saga2 = orchestrator.createSaga('idem-1', [
      { name: 'step', execute: async () => { executedSteps.push('step'); }, compensate: async () => {} },
    ]);
    await saga2.execute();
    
    expect(executedSteps).toEqual(['step']); // sadece 1 kez
  });

  it('concurrency: aynı sagaId eşzamanlı çalıştırılamaz', async () => {
    const saga = orchestrator.createSaga('concurrent-1', [
      { name: 'slow', execute: async () => { await new Promise(r => setTimeout(r, 100)); executedSteps.push('slow'); }, compensate: async () => {} },
    ]);
    
    const p1 = saga.execute();
    const p2 = saga.execute(); // ikinci çağrı hata vermeli veya beklemeli
    
    await Promise.allSettled([p1, p2]);
    
    // sadece 1 kez çalışmalı
    expect(executedSteps.filter(s => s === 'slow').length).toBe(1);
  });

  it('persistence: crash sonrası state yüklenebilmeli', async () => {
    const persistence = new InMemoryPersistence();
    const orch1 = new SagaOrchestrator({ persistence, lockManager: new InMemoryLockManager() });
    
    const saga1 = orch1.createSaga('persist-1', [
      { name: 'step-1', execute: async () => { executedSteps.push('step-1'); }, compensate: async () => {} },
      { name: 'step-2', execute: async () => { executedSteps.push('step-2'); }, compensate: async () => {} },
    ]);
    await saga1.execute();
    
    // yeni orchestrator, aynı persistence
    const orch2 = new SagaOrchestrator({ persistence, lockManager: new InMemoryLockManager() });
    const loaded = await orch2.loadSaga('persist-1');
    
    expect(loaded.getState()).toBe('COMPLETED');
    expect(loaded.getExecutedSteps()).toEqual(['step-1', 'step-2']);
  });
});

// Test için minimal persistence/lock implementasyonları (candidate kodunda olacak)
class InMemoryPersistence {
  private store = new Map<string, any>();
  async save(sagaId: string, data: any) { this.store.set(sagaId, data); }
  async load(sagaId: string) { return this.store.get(sagaId); }
  async delete(sagaId: string) { this.store.delete(sagaId); }
}

class InMemoryLockManager {
  private locks = new Map<string, Promise<void>>();
  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) await new Promise(r => setTimeout(r, 10));
    let release: () => void;
    const p = new Promise<void>(r => { release = r; });
    this.locks.set(key, p);
    return release!;
  }
}

interface SagaStep {
  name: string;
  execute: () => Promise<void>;
  compensate: () => Promise<void>;
}

interface SagaState {
  sagaId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'COMPENSATING' | 'COMPENSATED' | 'COMPENSATION_FAILED';
  currentStep: number;
  executedSteps: string[];
  stepResults: Map<string, any>;
}

interface SagaOrchestrator {
  createSaga(sagaId: string, steps: SagaStep[]): Saga;
  loadSaga(sagaId: string): Promise<Saga>;
}

interface Saga {
  execute(): Promise<void>;
  getState(): SagaState['status'];
  getExecutedSteps(): string[];
}`;

/** Tüm seviyeleri birleştiren export */
export const CODING_BENCHMARK_LEVELS: Record<CodingLevel, CodingBenchmarkQuestion> = {
  1: {
    level: 1,
    title: "Token Bucket / Sliding Window Rate Limiter",
    prompt: LEVEL_1_PROMPT,
    hiddenTests: LEVEL_1_HIDDEN_TESTS,
    judgeCriteria: CODING_JUDGE_CRITERIA,
  },
  2: {
    level: 2,
    title: "Async Task Queue + Worker Pool",
    prompt: LEVEL_2_PROMPT,
    hiddenTests: LEVEL_2_HIDDEN_TESTS,
    judgeCriteria: CODING_JUDGE_CRITERIA,
  },
  3: {
    level: 3,
    title: "Disk-Backed LRU Cache",
    prompt: LEVEL_3_PROMPT,
    hiddenTests: LEVEL_3_HIDDEN_TESTS,
    judgeCriteria: CODING_JUDGE_CRITERIA,
  },
  4: {
    level: 4,
    title: "Buggy Code Analysis & Refactoring",
    prompt: LEVEL_4_PROMPT,
    hiddenTests: LEVEL_4_HIDDEN_TESTS,
    judgeCriteria: CODING_JUDGE_CRITERIA,
  },
  5: {
    level: 5,
    title: "Saga Pattern Orchestrator",
    prompt: LEVEL_5_PROMPT,
    hiddenTests: LEVEL_5_HIDDEN_TESTS,
    judgeCriteria: CODING_JUDGE_CRITERIA,
  },
};

/** Seviye bazlı BenchmarkQuestion üretici */
export function createCodingBenchmarkQuestions(): import("../types/benchmark").BenchmarkQuestion[] {
  return Object.values(CODING_BENCHMARK_LEVELS).map((level, index) => ({
    id: 100 + level.level, // 101-105 arası ID'ler (coding kategorisi)
    question: level.prompt,
    category: 'coding' as const,
    evaluationParams: {
      level: level.level,
      title: level.title,
      hiddenTests: level.hiddenTests,
      judgeCriteria: level.judgeCriteria,
    },
    isDynamic: false, // statik prompt
  }));
}
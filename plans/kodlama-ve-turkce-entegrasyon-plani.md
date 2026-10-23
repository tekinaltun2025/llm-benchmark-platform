# Kodlama ve Türkçe Test Entegrasyonu — Mimari Plan

## 1. Mevcut Durum Analizi

| Dosya | Mevcut İçerik | Gerekli Değişiklik |
|-------|--------------|-------------------|
| `src/lib/coding-benchmark.ts` | 5 seviye TypeScript tabanlı kodlama benchmark (RateLimiter, AsyncTaskQueue, LRUCache, EventBus, Saga) | Tüm prompt'lar Python 3.11+ Standard Library only, type hints ile yeniden yazılacak |
| `src/types/benchmark.ts` | `TestCategory = 'general' \| 'coding' \| 'turkish' \| 'all'` zaten tanımlı | Değişiklik gerekmez |
| `src/lib/question-generators.ts` | `generateRunQuestionsByCategory(selectedCategories, true)` mevcut | Kategori bazlı filtreleme zaten destekleniyor |
| `src/lib/benchmark-runner.ts` | `selectedCategories` parametresi alıyor, `generateRunQuestionsByCategory` çağrıyor | Değişiklik gerekmez |
| `src/components/dashboard/TestRunnerTab.tsx` | Test başlatma akışı mevcut, kategori seçimi YOK | Kategori seçim modalı eklenecek |
| `src/components/dashboard/BenchmarkSuiteTab.tsx` | Sorular tek listede gösteriliyor | Kategorilere göre ayrı başlıklar altında listelenecek |

## 2. Kodlama Benchmark Prompt Güncellemeleri (Python 3.11+)

### Dil Politikası (Tüm seviyelerde ortak)
Her prompt'un başına şu kural eklenecek:
```
Aksi belirtilmedikçe çözümler Python 3.11+ kullanılarak, harici kütüphane bağımlılığı olmadan (yalnızca Standard Library) ve tam tip ipuçları (type hints / typing) ile yazılmalıdır. Kod üretime hazır, eksiksiz ve mock/placeholder içermemelidir.
```

### Seviye 1: Token Bucket / Sliding Window Log Rate Limiter
- Python 3.11+, `threading.Lock`, `time.monotonic`, `collections.deque`
- Kullanıcı bazlı (dakikada 60) + global (saniyede 1000) sınır
- Süresi dolmuş logların otomatik temizlenmesi
- Milisaniyelik zaman damgaları, thread-safe

### Seviye 2: Asenkron İş Kuyruğu (asyncio)
- `asyncio`, `asyncio.Queue`, `asyncio.Semaphore(5)`
- Exponential backoff + jitter, maksimum 3 retry
- SIGINT / Graceful Shutdown: çalışan işlerin tamamlanması, yeni iş kabul etmemek

### Seviye 3: Disk-Destekli LRU Cache
- O(1) get/set: `dict` + doubly linked list
- TTL desteği, bellek sınırı (100 öğe)
- En eski öğe diske yazılır, tekrar çağrıldığında belleğe geri alınır
- `fs/promises` eşdeğeri: `aiofiles` yok, sadece `open()` async wrapper veya senkron I/O minimize

### Seviye 4: Kasıtlı Hatalı Kod Analizi & Refactoring
- Verilen bozuk Python kodu analiz edilecek
- Bellek sızıntısı, unhandled exception, thread-unsafe veri paylaşımı tespiti
- Düzeltilmiş üretime hazır kod

### Seviye 5: Saga Pattern Orkestratörü (Dil Serbest)
- Mikroservis: Sipariş → Ödeme → Stok
- Ödeme hatasında compensating transactions (geri alma)
- Dil seçimi + 2 cümlelik gerekçe + prototip

### Judge Rubriği (100 puan)
| Kriter | Ağırlık |
|--------|---------|
| Doğruluk ve Eksiksizlik | 30 |
| Kenar Durumlar & Güvenlik | 25 |
| Mimari & Kod Standartları | 25 |
| Hata Yönetimi | 20 |

JSON çıktı şeması: `total_score`, `breakdown`, `strengths`, `critical_flaws`, `verdict`

## 3. Test Kategori Seçim Ekranı

### Modal Yapısı (TestRunnerTab.tsx içinde)
- **Genel**: Mevcut testler (Kodlama ve Türkçe HARİÇ) — logic, math, ifeval, json, needle, adversarial, turkish
- **Kodlama**: 5 seviyeli kodlama benchmark seti
- **Türkçe**: 10 soruluk genel Türkçe yetkinlik seti
- **Hepsi**: Tüm kategoriler

### UI Akışı
1. Kullanıcı "Testi Başlat" tıklar
2. Kategori Seçim Modalı açılır
3. Kategori seçildiğinde test başlar
4. Seçim `selectedCategories` olarak `benchmark-runner`'a iletilir

## 4. Soru Havuzu Görünümü (BenchmarkSuiteTab.tsx)

Sorular şu başlıklar altında ayrı ayrı listelenecek:
- **Genel Testler** (logic, math, ifeval, json, needle, adversarial, turkish)
- **Kodlama Benchmark** (5 seviye)
- **Türkçe Genel Yetkinlik** (10 soru)

Her başlık altında sorular kendi kategorilerinde gruplanır.

## 5. Veri Akışı

```
Kullanıcı kategori seçer
    ↓
TestRunnerTab: selectedCategories state'i güncellenir
    ↓
POST /api/benchmark/run-all { modelIds, judgeModelId, selectedCategories }
    ↓
benchmark-runner: generateRunQuestionsByCategory(selectedCategories, true)
    ↓
Sadece seçilen kategoriden sorular üretilir
    ↓
Test çalışır, sonuçlar leaderboard'a eklenir
```

## 6. Dosya Değişiklik Özeti

| Dosya | İşlem |
|-------|-------|
| `src/lib/coding-benchmark.ts` | Tüm 5 seviye prompt'u Python 3.11+ standardına güncelle |
| `src/components/dashboard/TestRunnerTab.tsx` | Kategori seçim modalı + state ekle |
| `src/components/dashboard/BenchmarkSuiteTab.tsx` | Kategorilere göre ayrı başlıklar altında listele |
| `src/lib/benchmark-runner.ts` | Değişiklik yok (zaten destekliyor) |
| `src/lib/question-generators.ts` | Değişiklik yok (zaten destekliyor) |
| `src/types/benchmark.ts` | Değişiklik yok (zaten tanımlı) |

## 7. Riskler ve Önlemler

| Risk | Önlem |
|------|-------|
| Python prompt'ları TypeScript sandbox'ta çalışmayabilir | Kodlama benchmark sandbox'ta TypeScript olarak kalır, sadece prompt metni Python'a çevrilir; sandbox evaluator TypeScript'i korur |
| Kategori seçimi mevcut testleri bozabilir | Varsayılan 'all' seçili olarak başlar, geriye dönük uyumluluk korunur |
| Türkçe 10 soru zaten mevcuttur | `turkish_general` kategorisi zaten `turkish-benchmark.ts` içinde var, sadece UI'da ayrı başlık altında gösterilecek |

## 8. Implementasyon Sırası

1. `coding-benchmark.ts` prompt güncellemeleri
2. `TestRunnerTab.tsx` kategori seçim modalı
3. `BenchmarkSuiteTab.tsx` kategori bazlı listeleme
4. Test ve doğrulama
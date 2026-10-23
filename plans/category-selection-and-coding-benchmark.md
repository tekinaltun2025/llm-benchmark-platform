# Kategori Seçim Ekranı + 5 Seviyeli Kodlama Benchmark + Türkçe 10 Soru — Mimari Plan

## Genel Bakış

Kullanıcı "Testi Başlat" dediğinde önce bir **Kategori Seçim Modalı** açılacak:
- **Genel** (Mevcut testler - Kodlama ve Türkçe HARİÇ)
- **Kodlama** (Yeni 5 seviyeli benchmark seti)
- **Türkçe** (10 soruluk yeni set - genel Türkçe yetenekleri)
- **Hepsi** (Tüm kategoriler)

Her kategori bağımsız soru havuzu ve değerlendirme mantığına sahip olacak. Soru Havuzu sekmesinde (BenchmarkSuiteTab) kategoriler ayrı başlıklar altında listelenecek.

---

## 1. Veri Modeli Değişiklikleri

### `types/benchmark.ts` — Yeni Tipler

```typescript
// Kategori seçimi için
export type TestCategory = 'general' | 'coding' | 'turkish' | 'all';

export interface CategoryConfig {
  id: TestCategory;
  label: string;
  description: string;
  questionCount: number;
  enabled: boolean;
}

// Kodlama benchmark seviyeleri
export type CodingLevel = 1 | 2 | 3 | 4 | 5;

export interface CodingBenchmarkQuestion {
  level: CodingLevel;
  title: string;
  prompt: string;
  // Sandbox testleri için gizli unit testler (kod içinde)
  hiddenTests: string; // TypeScript/JS test kodu
  // Judge rubriği kriterleri
  judgeCriteria: {
    correctness: number;      // 30
    edgeCasesSafety: number;  // 25
    architectureCleanCode: number; // 25
    errorHandling: number;    // 20
  };
}

// Türkçe 10 soru tipleri
export interface TurkishQuestionType {
  id: string;
  category: 'ekim' | 'deyim' | 'ozet' | 'dilbilgisi' | 'anlam' | 'yazim' | 'cumle' | 'sozcuk' | 'paragraf' | 'edebi';
  template: string;
  expectedPattern: string; // DÜZELTME:, ANLAM:, ÖZET: vb.
  keywords: string[];
}
```

### `benchmark-suite.ts` — Kategori Bazlı Soru Havuzları

```typescript
// 3 ayrı soru havuzu
export const GENERAL_QUESTIONS: BenchmarkQuestion[] = [...]; // logic, math, ifeval, json, needle, adversarial
export const CODING_QUESTIONS: BenchmarkQuestion[] = [...];  // 5 seviye × 1 soru = 5 soru
export const TURKISH_QUESTIONS: BenchmarkQuestion[] = [...]; // 10 soru

// Kategori etiketleri güncelleme
export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  logic: "Mantık ve Muhakeme",
  math: "Matematik (GSM8K)",
  ifeval: "Talimat Takibi (IFEval)",
  json: "Yapısal Veri Çıkarımı (JSON Schema)",
  code: "Kodlama ve Algoritma (Sandbox)",
  needle: "Dikkat Testi (Needle in a Haystack)",
  adversarial: "Baskı Direnci (Sycophancy)",
  turkish: "Türkçe Başarım (Genel Yetkinlik)",
  coding: "Kodlama Benchmark (5 Seviye)",      // YENİ
  turkish_general: "Türkçe Genel Yetkinlik (10 Soru)", // YENİ
};
```

---

## 2. Yeni Dosyalar

### `lib/coding-benchmark.ts` — 5 Seviyeli Kodlama Seti

Her seviye için:
- Prompt şablonu (kullanıcı verdiği Türkçe açıklamalar)
- Gizli sandbox unit testleri (TypeScript)
- Judge rubriği (4 kriter, 100 puan)
- `functionName` ve `evaluationParams` ile entegrasyon

**Seviye 1:** Token Bucket / Sliding Window Rate Limiter (thread-safe, memory cleanup)
**Seviye 2:** Async Task Queue + Worker Pool (exponential backoff, graceful shutdown)
**Seviye 3:** Disk-Backed LRU Cache (O(1), TTL, persistence)
**Seviye 4:** Buggy Code Analysis & Refactoring (verilen kod bloğu)
**Seviye 5:** Saga Pattern Orchestrator (dil serbest, mimari seçim gerekçesi)

### `lib/turkish-benchmark.ts` — 10 Soruluk Türkçe Seti

10 farklı alt kategori:
1. Ek yanlışı düzeltme (2 soru)
2. Deyim anlamı (2 soru)
3. Kurallı özet (2 soru)
4. Dilbilgisi / cümle yapısı (1 soru)
5. Anlam ayrımı / eş anlamlılar (1 soru)
6. Yazım kuralları (1 soru)
7. Paragraf tutarlılığı (1 soru)
8. Edebi metin analizi (1 soru)

Her soru dinamik şablonlu (rastgele parametreler), deterministik etiket kontrolü + Judge hibrit puanlama.

### `lib/judge-rubric.ts` — Yeni Judge Değerlendirme Şeması

```typescript
export const CODING_JUDGE_RUBRIC = {
  criteria: [
    { key: 'correctness', weight: 30, description: 'Tüm gereksinimler karşılanmış mı? Placeholder/eksik yok mu?' },
    { key: 'edgeCasesSafety', weight: 25, description: 'Thread safety, deadlock, race condition, memory leak, sınır değerler' },
    { key: 'architectureCleanCode', weight: 25, description: 'Type hints, modülerlik, stdlib kullanımı, O(1) karmaşıklık' },
    { key: 'errorHandling', weight: 20, description: 'Exception handling sağlamlığı, beklenmedik durumlarda güvenli fail' },
  ],
  outputSchema: {
    total_score: 'number (0-100)',
    breakdown: { correctness: 'number', edge_cases_safety: 'number', architecture_clean_code: 'number', error_handling: 'number' },
    strengths: 'string[]',
    critical_flaws: 'string[]',
    verdict: '"Üretim ortamına hazır" | "Düzeltme gerekli" | "Başarısız"'
  }
};
```

### `components/dashboard/CategorySelectionModal.tsx` — Test Öncesi Seçim Ekranı

- 4 kart (Genel, Kodlama, Türkçe, Hepsi)
- Her kart: açıklama, soru sayısı, tahmini süre
- Checkbox/Radio ile çoklu seçim (Genel+Kodlama gibi)
- "Testi Başlat" butonu → seçilen kategorilerle `executeBenchmarkRun` çağrılır

---

## 3. Mevcut Dosya Değişiklikleri

### `benchmark-runner.ts` — Kategori Bazlı Koşu Mantığı

```typescript
// Yeni parametre: selectedCategories: TestCategory[]
// generateRunQuestions(selectedCategories) → ilgili havuzlardan soruları birleştir
// Her kategori kendi değerlendirme mantığını kullanır:
//   - general: mevcut 4 sütunlu (deterministik + sandbox + needle + adversarial + judge)
//   - coding: sandbox birincil + YENİ judge rubriği (4 kriter)
//   - turkish: deterministik etiket + judge hibrit (dil kalitesi)
```

### `llm-client.ts` — Judge Prompt Güncellemesi

```typescript
// evaluateWithJudge(question, answer, reference, category?)
// category === 'coding' → CODING_JUDGE_RUBRIC prompt'u
// category === 'turkish' → Türkçe dil kalitesi rubriği
// default → mevcut genel rubrik
```

### `BenchmarkSuiteTab.tsx` — Soru Havuzu UI Yeniden Yapılandırma

```tsx
// 3 ana bölüm (Collapsible/Accordion):
// 1. Genel Sorular (logic, math, ifeval, json, needle, adversarial)
// 2. Kodlama Benchmark (5 seviye - Level 1-5)
// 3. Türkçe Genel Yetkinlik (10 soru - alt kategorilerle)
// Her bölüm: soru listesi, checkbox seçimi, açıklama
```

### `TestRunnerTab.tsx` — Kategori Seçimi Entegrasyonu

- "Testi Başlat" butonuna tıklandığında önce `CategorySelectionModal` açılır
- Seçim sonrası `handleStartTest(selectedCategories)` çağrılır
- Mevcut "Test Edilecek Modeller" listesi + kategori seçimi = tam test konfigürasyonu

### `question-generators.ts` — Yeni Üreticiler

- `generateCodingQuestions()` — 5 seviye statik prompt + gizli testler
- `generateTurkishQuestions()` — 10 dinamik şablon
- `generateRunQuestions(categories)` — seçilen kategorileri birleştir

---

## 4. Sandbox Entegrasyonu (Kodlama Soruları)

`code-sandbox.ts` — Her seviye için gizli unit testler:

```typescript
// Seviye 1: RateLimiter testleri
// - thread-safe concurrent access
// - memory cleanup (expired entries removed)
// - sliding window accuracy
// - 100k ops performance < 100ms

// Seviye 2: TaskQueue testleri
// - max 5 concurrent workers
// - exponential backoff + jitter retry
// - graceful shutdown (SIGINT) waits for running tasks

// Seviye 3: LRUCache testleri
// - O(1) get/put
// - disk persistence on eviction
// - TTL expiration
// - concurrent access safety

// Seviye 4: Refactoring - verilen buggy kodun testleri
// - memory leak detection
// - exception handling
// - thread safety fixes

// Seviye 5: Saga Orchestrator testleri
// - compensation transaction execution on failure
// - state consistency
// - idempotency
```

---

## 5. API Değişiklikleri

### `POST /api/benchmark/run` — Gövde Genişletme

```json
{
  "testModelId": "string",
  "judgeModelId": "string",
  "categories": ["general", "coding", "turkish"]  // YENİ: opsiyonel, default ["all"]
}
```

### `GET /api/questions/selection` — Kategori Bazlı Seçim

Mevcut `enabledQuestionIds` yeterli (ID'ler benzersiz). UI tarafında kategori filtresi eklenecek.

---

## 6. Uygulama Sırası

| # | Görev | Dosya | Açıklama |
|---|-------|-------|----------|
| 1 | Tip tanımları | `types/benchmark.ts` | TestCategory, CodingLevel, JudgeRubric |
| 2 | Kodlama benchmark seti | `lib/coding-benchmark.ts` | 5 seviye prompt + gizli testler + rubrik |
| 3 | Türkçe benchmark seti | `lib/turkish-benchmark.ts` | 10 soru dinamik şablonlar |
| 4 | Judge rubrik şeması | `lib/judge-rubric.ts` | 4 kriter, JSON output schema |
| 5 | Soru üreticileri güncelleme | `lib/question-generators.ts` | generateCodingQuestions, generateTurkishQuestions |
| 6 | Benchmark suite birleştirme | `lib/benchmark-suite.ts` | 3 havuz, CATEGORY_LABELS güncelleme |
| 7 | Benchmark runner kategori akışı | `lib/benchmark-runner.ts` | selectedCategories parametresi, kategori bazlı değerlendirme |
| 8 | Judge prompt güncelleme | `lib/llm-client.ts` | evaluateWithJudge(category) overload |
| 9 | Sandbox testleri | `lib/code-sandbox.ts` | 5 seviye gizli unit testler |
| 10 | Kategori seçim modalı | `components/dashboard/CategorySelectionModal.tsx` | Yeni bileşen |
| 11 | TestRunnerTab entegrasyonu | `components/dashboard/TestRunnerTab.tsx` | Modal açma, kategori parametresi gönderme |
| 12 | BenchmarkSuiteTab UI | `components/dashboard/BenchmarkSuiteTab.tsx` | 3 bölüm, accordion, kategori filtreli liste |
| 13 | API route güncelleme | `app/api/benchmark/run/route.ts` | categories parametresi kabul etme |
| 14 | TypeScript + dev build doğrulama | - | `tsc --noEmit`, `npm run dev` |

---

## 7. Kritik Tasarım Kararları

1. **Kodlama soruları statik prompt** — Dinamik şablonlama YOK (ezber riski az, çünkü her seviye benzersiz mimari problem). Sandbox gizli testleri her koşuda aynı.

2. **Türkçe soruları dinamik** — Rastgele parametrelerle ezberi kırmak için (mevcut Q14-16 mantığı).

3. **Judge rubriği sadece Kodlama için** — Genel ve Türkçe kategoriler mevcut hibrit (deterministik + judge) sistemini kullanır. Kodlama için YENİ 4 kriterlik rubrik.

4. **Seviye 4 (Buggy Code)** — Kod bloğu prompt içinde string olarak verilir. Model analiz + düzeltme üretir. Sandbox testleri ORIJINAL buggy kodun testleri değil, DÜZELTİLMİŞ kodun testleridir.

5. **Seviye 5 (Saga)** — Dil serbest. Model dil seçimi + 2 cümlelik gerekçe + prototip üretir. Judge: mimari uygunluk + compensation correctness.

6. **Kategori seçimi "Hepsi" = 3 kategori birleştirme** — Soru sayısı: Genel(18) + Kodlama(5) + Türkçe(10) = 33 soru. Tahmini süre: ~45-60 dk.

---

## 8. Geriye Dönük Uyumluluk

- Mevcut `enabledQuestionIds` ID bazlı çalışır → yeni sorular da benzersiz ID alır (coding: 100-104, turkish: 200-209)
- Eski kayıtlı seçimler bozulmaz (null = hepsi seçili)
- Leaderboard hesaplaması kategori bilgisini `run.results[].question.category` üzerinden zaten biliyor
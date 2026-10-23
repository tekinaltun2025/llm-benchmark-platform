# LLM_Benchmark — Session Devir Teslim Özeti (Handoff)

> Bu dosya, yeni bir session'da çalışmaya devam etmek için hazırlanmıştır.
> Proje yolu: `/home/tekinaltun/Documents/LLM_Benchmark` (VS Code workspace'i `/home/tekinaltun/Documents/BorsaRobot` olsa da tüm iş `../LLM_Benchmark` üzerinde yapılıyor).

---

## 1. PROJE GENEL BİLGİLERİ

- **Proje**: AI Benchmark & Leaderboard Platform (LLM modellerini karşılaştıran test platformu)
- **Stack**: Next.js 15.5.28 (App Router) + TypeScript + Tailwind CSS v4 (`@import "tailwindcss"` + `@custom-variant dark`)
- **Veritabanı**: JSON dosyası — `data/benchmark_db.json` (şu an ~5400 satır, 39 model, 13+ run, archivedRuns bölümü var)
- **UI**: 4 sekme — `leaderboard` (Sıralama), `testRunner` (⚡ Test & Modeller — birleştirilmiş), `benchmarkSuite` (Soru Havuzu), `tokenDashboard`
- **Model sağlayıcılar**: LM Studio (yerel, `lms` CLI ile JIT yükleme) + 6 API sağlayıcı (OpenAI, Anthropic, Groq, OpenRouter, DeepSeek, Gemini) — `src/lib/provider-templates.ts` ortak şablon
- **Dev server**: `nohup npm run dev > /tmp/llm-benchmark-dev.log 2>&1 &` — port 3000. **DERS: dev server çalışırken ASLA `npm run build` çalıştırma** (`.next` klasörünü ezer, CSS 404 → sayfa stilsiz açılır; çözüm: process'leri öldür, `.next` sil, dev'i yeniden başlat)
- **Streaming**: Benchmark koşuları NDJSON (ReadableStream + TextEncoder) ile canlı ilerleme event'leri yayınlar
- **Kilit**: Global benchmark lock (`src/lib/benchmark-lock.ts`) — aynı anda tek test

---

## 2. TAMAMLANMIŞ BÜYÜK İŞLER (KRONOLOJİK)

### İş 1 — Sekme Birleştirme
- `TestRunnerTab` + `ModelManagementTab` tek sekmede birleştirildi ("⚡ Test & Modeller"), `page.tsx`'te 4 sekme kaldı.
- Yinelenen açıklama notları tekilleştirildi.

### İş 2 — CSS/Render Bug Fix
- Belirti: sayfa stilsiz HTML gibi açılıyordu. Kök neden: `npm run build` dev server çalışırken `.next`'i ezdi → CSS 404.
- Çözüm: dev process'leri öldürüldü, `rm -rf .next`, dev server nohup ile yeniden başlatıldı. CSS 200 (150KB) doğrulandı.

### İş 3 — UI Yeniden Tasarım + Model Seçim Bug
- **Yeni tasarım** (`TestRunnerTab.tsx` tamamen yeniden yazıldı, ~1043 satır):
  - Üstte **Bağlantı Kataloğu**: LM Studio kartı (canlı `/api/v0/models` kütüphane listesi) + 6 sağlayıcı akordeon kartı (API key girişli, model listesi + butonlu)
  - Altta **"Test Edilecek Modeller"** listesi (− butonlu, localStorage'da kalıcı)
  - **"Testi Başlat"** yalnızca seçili listeyi test eder → `POST /api/benchmark/run-all` gövdesine `modelIds: string[]` parametresi eklendi (LM Studio JIT load/unload dahil)
- **Bug kök nedeni** ("seçtiğim model yerine qwen3.5-9b'ye sorgu gidiyor"): qwen3.5-9b DB'de `isJudge: true` → hakem olarak otomatik seçiliydi; hakem değerlendirme sorguları bu yavaş thinking modeline gidiyordu (reasoning_content token tüketimi ~50s). Hakem seçimi artık UI'da açık select ile yapılıyor + thinking modeli uyarısı var.

### İş 4 — Test Sonucu Kalıcılığı (append-only)
- `db.ts`: `addRun` artık eski run'ları SİLMEZ (append-only); `deleteRuns` → `archivedRuns`'a taşır (geri dönüşüm kutusu); `restoreRuns`/`readArchivedRuns` eklendi.
- `api/models/sync`: eksik modellerin run'larını silmek yerine yeniden parent'lar.
- `api/runs/route.ts`: DELETE→arşiv, `POST /restore`, `GET` arşiv listesi.
- `LeaderboardTab`: silme UI kaldırıldı, "Arşivden Geri Yükle" butonu eklendi.
- `scripts/restore-deleted-runs.ts` ile git geçmişinden **8 run + 5 model kaydı** kurtarıldı (glm-4.5v, qwen2.5-vl-32b, gemma-4-12b-tng-v8, glm-4.1v-9b-thinking, qwen3.5-9b, qwen3.8-27b, gemma-4-31b, qwen3.8-27b-turbo).

### İş 5 — Kategori Seçimi + Kodlama Benchmark + Türkçe 10 Soru (MEVCUT İŞ — KISMEN TAMAM)
Kullanıcı isteği: "Testi başlatmadan önce Genel / Kodlama / Türkçe / Hepsi seçilebilen ekran olsun. Genel = mevcut testlerden kodlama+türkçe hariç. Türkçe = 10 soru genel yetenek. Kodlama = 5 seviyeli set (aşağıda). Hepsi soru havuzunda ayrı başlıklar altında."

**Kodlama 5 seviye** (`src/lib/coding-benchmark.ts`, 851 satır):
1. Sliding Window RateLimiter (thread-safe, cleanup, O(1))
2. AsyncTaskQueue + Worker Pool (priority, exponential backoff+jitter, graceful shutdown, idempotency)
3. Disk-Backed LRU Cache (O(1), TTL, persistPath, loadFromDisk)
4. Buggy EventBus analizi + refactoring (en az 6 hata: memory leak, fire-and-forget race, error propagation, async registration, reentrancy guard, type safety)
5. Saga Pattern Orchestrator (state machine, compensation, persistence, idempotency, concurrency lock)

**Judge rubriği** (kodlama): correctness 30 + edgeCasesSafety 25 + architectureCleanCode 25 + errorHandling 20 = 100 puan.

---

## 3. İŞ 5'İN ADIM ADIM DURUMU

### ✅ TAMAMLANAN ADIMLAR (1–8)

1. **`src/types/benchmark.ts`** — Yeni tipler: `TestCategory` ('general'|'coding'|'turkish'), `CodingLevel` (1-5), `CategoryConfig`, `CodingBenchmarkQuestion` (level, title, prompt, hiddenTests, judgeCriteria), `TurkishQuestionType`. `QuestionCategory`'ye 'coding' ve 'turkish_general' eklendi.

2. **`src/lib/coding-benchmark.ts`** (YENİ, 851 satır) — 5 seviye prompt + gizli vitest-format testleri + `CODING_JUDGE_CRITERIA` + `CODING_BENCHMARK_LEVELS` kaydı + `createCodingBenchmarkQuestions()` (ID 101–105, category 'coding', isDynamic false, evaluationParams içinde level/title/hiddenTests/judgeCriteria).

3. **`src/lib/turkish-benchmark.ts`** (YENİ) — 10 Türkçe soru, dinamik şablonlar (rastgele cümle/kelime havuzları), category 'turkish_general'.

4. **`src/lib/judge-rubric.ts`** (YENİ) — `CODING_JUDGE_RUBRIC` (4 kriter, outputSchema: total_score/breakdown/strengths/critical_flaws/verdict), `GENERAL_JUDGE_RUBRIC`, `TURKISH_JUDGE_RUBRIC`, `getJudgeRubricForCategory(category)`, `buildJudgePrompt(question, answer, referenceAnswer, category)`, `parseJudgeResult(rawOutput, category)` (toleranslı JSON parse, breakdown toplamı düzeltme, verdict enum map).

5. **`src/lib/question-generators.ts`** — `generateCodingQuestions()`, `generateTurkishQuestions()`, `generateRunQuestionsByCategory(selectedCategories?: TestCategory[])` eklendi (mevcut `generateRunQuestions` korunudu).

6. **`src/lib/benchmark-suite.ts`** — `GENERAL_QUESTIONS`, `CODING_QUESTIONS`, `TURKISH_QUESTIONS` havuzları; `CATEGORY_LABELS` güncellendi ('coding', 'turkish_general' dahil); `evaluateFormatCompliance`'a 'coding' ve 'turkish_general' case'leri; `evaluateDeterministic`'a coding/turkish_general case'leri; `requiresJudgeEvaluation` güncellendi.

7. **`src/lib/benchmark-runner.ts`** — `executeBenchmarkRun` imzasına `selectedCategories?: TestCategory[]` eklendi; `generateRunQuestionsByCategory` çağrısı; coding/turkish_general için büyük `maxTokens`; coding kategorisinde sandbox koşumu; `evaluateWithJudge`'a 5. argüman olarak `question.category` geçiliyor (satır ~334-340); run kaydına `selectedCategories` yazılıyor.

8. **`src/lib/llm-client.ts`** — `evaluateWithJudge` imzası: `(judgeConfig, question, answer, referenceAnswer?, category?: string)`; prompt artık `buildJudgePrompt(...)` ile kategori bazlı rubrikten üretiliyor; **geriye dönük uyumluluk korundu** — dönüş tipi hâlâ `{ score: number; reasoning: string } | null` (toleranslı `parseJudgeAnswer` iç parser'ı). Dosya `write_to_file` ile tamamen yeniden yazıldı (apply_diff Türkçe karakterlerde sorun çıkardı). Ayrıca `JudgeEvaluationResult` interface'i export edildi (henüz kullanılmıyor, opsiyonel).

### ⏳ KALAN ADIMLAR (9–14) — YENİ SESSION'DA YAPILACAK

**ADIM 9 — `src/lib/code-sandbox.ts` güncelleme (5 seviye sandbox testleri):**
- Mevcut durum: 334 satır; `testDistinctOrderPreserving` (Q9) ve `testFlattenAndSortEvens` (Q10) için fonksiyon-bazlı gizli testler var; `evaluateCodeInSandbox(functionName, modelAnswer)` functionName'e göre dispatch ediyor.
- Sandbox kısıtları: vm context'te SADECE `Math, JSON, Array, Object, String, Number, Boolean, Set, Map, isNaN, parseInt, parseFloat, __DateNow` var. **`Promise`, `setTimeout`, `require`, `process`, `fetch`, `console` YOK.**
- Yapılacak:
  a) Sandbox context'ine `Promise` (ve gerekiyorsa minimal `setTimeout` shim'i) eklenmeli — Level 1/2/5 async sınıflar (RateLimiter.acquire, AsyncTaskQueue, SagaOrchestrator) test edilebilsin. Not: vm timeout senkron; async testler için ya `vm.runInContext` sonucu Promise olarak await edilmeli ya da testler senkronlaştırılmalı.
  b) 5 yeni test fonksiyonu: `testRateLimiter`, `testAsyncTaskQueue`, `testLRUCache`, `testEventBusRefactor`, `testSagaOrchestrator` — her biri `coding-benchmark.ts`'deki vitest-format `hiddenTests`'i sandbox'ın `__test(name, fn)` helper formatına çevirmeli (vitest import'ları sandbox'ta ÇALIŞMAZ — saf JS'e dönüştürmek ŞART).
  c) `evaluateCodeInSandbox` dispatch'ine yeni anahtarlar: sınıf adları `RateLimiter`, `AsyncTaskQueue`, `LRUCache`, `EventBus`, `SagaOrchestrator` (veya level 1-5). `benchmark-runner.ts`'deki sandbox çağrısının hangi anahtarla geldiğini kontrol et ve uyumlu yap.
  d) Puanlama: geçen test / toplam test × 100 (mevcut mantık korunacak).

**ADIM 10 — `src/components/dashboard/CategorySelectionModal.tsx` (YENİ bileşen):**
- Test başlatmadan önce açılan modal: 4 seçenek — "Genel Sorular" (mevcut logic/math/ifeval/json/code/needle/adversarial), "Kodlama" (5 seviye), "Türkçe" (10 soru), "Hepsi". Checkbox'lı, açıklama metinli (her kategoride kaç soru olduğu), "Testi Başlat" onay butonu.
- Seçim `TestCategory[]` olarak üst bileşene callback ile dönmeli.

**ADIM 11 — `TestRunnerTab.tsx` entegrasyonu:**
- "Testi Başlat" butonu artık doğrudan koşmayacak → önce `CategorySelectionModal` açılacak; onayda `handleStartTest(categories)` çalışacak.
- `POST /api/benchmark/run-all` gövdesine `categories: TestCategory[]` eklenecek (modelIds ile birlikte).

**ADIM 12 — `BenchmarkSuiteTab.tsx` UI yeniden yapılandırma:**
- Soru havuzu 3 akordeon bölüm altında: "Genel Sorular", "Kodlama (5 Seviye)", "Türkçe (10 Soru)". Her bölüm kendi sorularını listeleyecek; mevcut seçim kalıcılığı (`/api/questions/selection`) korunacak. Kodlama bölümünde 5 seviye başlık+açıklama kartları, Türkçe bölümünde 10 soru listesi.

**ADIM 13 — `src/app/api/benchmark/run/route.ts`:**
- Request body'den `categories?: string[]` okuyup `executeBenchmarkRun`'a geçirme (run-all zaten modelIds destekliyor; run-all route'unun da categories'ı run-runner'a iletmesi kontrol edilmeli).

**ADIM 14 — Doğrulama:**
- `cd /home/tekinaltun/Documents/LLM_Benchmark && npx tsc --noEmit` → 0 hata olmalı.
- Dev server çalışıyorsa sayfa derlemesi + `curl -s http://localhost:3000 | head` ile kontrol.
- Bilinen son TS hatası: `benchmark-runner.ts:339` "Expected 3-4 arguments, but got 5" — bu, `evaluateWithJudge`'a category parametresi eklenmeden ÖNCE oluşmuştu; llm-client.ts güncellendiği için çözülmüş OLMALI ama tsc ile DOĞRULA.

---

## 4. KRİTİK TEKNİK NOTLAR (YENİ SESSION İÇİN)

1. **Araç kullanımı**: `apply_diff` Türkçe karakterli/uzun içerikte "similarity mismatch" hatası veriyor → büyük değişikliklerde `write_to_file` (tam dosya içeriği) kullan; küçük değişikliklerde önce `read_file` ile kesin içerik al.
2. **Dil**: Tüm düşünce, planlama ve kullanıcı çıktıları TÜRKÇE. Tam özerklik: ara onay isteme, placeholder bırakma, işi baştan sona tek seferde bitir.
3. **Markdown kuralı**: Yanıtlarda dosya/kod referansları tıklanabilir link formatında: [`filename`](relative/path.ext:line).
4. **evaluateWithJudge uyumluluğu**: `benchmark-runner.ts` 5 argümanla çağırıyor (category dahil) ve `judgeResult.score` + `judgeResult.reasoning` bekliyor — llm-client'taki mevcut `{score, reasoning}` dönüşü bunu karşılıyor. `parseJudgeResult` (yeni rubrik şeması) İSTEĞE BAĞLI entegrasyon: istenirse judge çıktısı zenginleştirilebilir ama runner'ı bozmadan.
5. **Soru ID aralıkları**: Genel sorular mevcut ID'lerini koruyor; kodlama 101–105; Türkçe sorularının ID'leri `turkish-benchmark.ts`'te tanımlı (çakışma kontrolü yap).
6. **DB şeması**: `BenchmarkRun`'a `selectedCategories?: TestCategory[]` alanı eklendi (runner yazıyor); leaderboard API'si kategori skorlarını `categoryScores` üzerinden hesaplıyor — 'coding'/'turkish_general' kategorilerinin leaderboard'da görünmesi için `api/leaderboard/route.ts`'teki kategori listesinin güncellenmesi gerekebilir (ADIM 14'te kontrol et).
7. **Dev server durumu**: Yeni session başında `ps aux | grep next` ile kontrol et; port 3000'de çalışmıyorsa nohup komutuyla başlat. Build ASLA dev çalışırken çalıştırılmasın.
8. **Git**: Proje git'e sahip; son kalıcılık işinde `git log -- data/benchmark_db.json` kurtarma için kullanıldı. Yeni iş bittiğinde commit önerilebilir.

---

## 5. YENİ SESSION'A İLK MESAJ ÖNERİSİ

"LLM_Benchmark projesinde kategori seçimi + kodlama benchmark + Türkçe 10 soru işinin 9-14. adımlarını tamamla. Detaylı durum `plans/session-handoff-summary.md` dosyasında. Önce `src/lib/code-sandbox.ts`'e 5 kodlama seviyesi için sandbox testlerini ekle (vitest formatını `__test` helper'ına çevir, Promise desteği ekle), sonra `CategorySelectionModal.tsx` bileşenini oluştur, `TestRunnerTab.tsx`'e entegre et, `BenchmarkSuiteTab.tsx`'i 3 akordeon bölüme ayır, `api/benchmark/run/route.ts`'e categories parametresi ekle ve `npx tsc --noEmit` ile doğrula."

/**
 * Tüm veri tipleri — AI Benchmark & Leaderboard Platformu
 */

export type QuestionCategory =
  | 'logic'
  | 'math'
  | 'ifeval'
  | 'json'
  | 'code'
  | 'needle'
  | 'adversarial'
  | 'turkish'
  | 'coding'
  | 'turkish_general';

export type Provider = 'lmstudio' | 'custom';

/** Test kategorisi seçimi için */
export type TestCategory = 'general' | 'coding' | 'turkish' | 'all';

/** Kategori konfigürasyonu (UI için) */
export interface CategoryConfig {
  id: TestCategory;
  label: string;
  description: string;
  questionCount: number;
  enabled: boolean;
}

/** Kodlama benchmark seviyeleri */
export type CodingLevel = 1 | 2 | 3 | 4 | 5;

/** Kodlama benchmark sorusu yapısı */
export interface CodingBenchmarkQuestion {
  level: CodingLevel;
  title: string;
  prompt: string;
  /** Sandbox testleri için gizli unit testler (TypeScript/JS test kodu) */
  hiddenTests: string;
  /** Judge rubriği kriterleri */
  judgeCriteria: {
    correctness: number;      // 30
    edgeCasesSafety: number;  // 25
    architectureCleanCode: number; // 25
    errorHandling: number;    // 20
  };
}

/** Türkçe 10 soru tipleri */
export interface TurkishQuestionType {
  id: string;
  category: 'ekim' | 'deyim' | 'ozet' | 'dilbilgisi' | 'anlam' | 'yazim' | 'cumle' | 'sozcuk' | 'paragraf' | 'edebi';
  template: string;
  expectedPattern: string; // DÜZELTME:, ANLAM:, ÖZET: vb.
  keywords: string[];
}

/** Kayıtlı model yapılandırması (yerel LM Studio veya bulut API) */
export interface ModelConfig {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  isJudge: boolean;
  /**
   * Modelin son yükleme/çalışma hatası (ör. bozuk GGUF, eksik dosya).
   * Doluysa model "çalışmıyor" olarak listelenir; başarılı bir test
   * sonrası otomatik temizlenir.
   */
  lastLoadError?: string;
  /** Hatanın kaydedildiği zaman (Unix ms) */
  lastLoadErrorAt?: number;
}

/** Benchmark sorusu (dinamik üretilen + kullanıcı tanımlı özel sorular) */
export interface BenchmarkQuestion {
  id: number;
  question: string;
  category: QuestionCategory;
  /** Deterministik değerlendirme için beklenen cevap / parametreler */
  expectedAnswer?: string;
  evaluationParams?: Record<string, unknown>;
  /** Kullanıcı arayüzünden eklenmiş özel soru mu? */
  isCustom?: boolean;
  /** Bu koşuya özgü rastgele üretilmiş soru mu? (ezberi kırmak için) */
  isDynamic?: boolean;
}

/** Sandbox'ta koşan gizli unit testin sonucu */
export interface SandboxTestResult {
  /** Testin kısa adı (ör. "temel-dogruluk") */
  name: string;
  passed: boolean;
  /** Başarısızsa kısa hata mesajı */
  detail?: string;
  /** Testin çalışma süresi (ms) */
  durationMs: number;
}

/** Tek bir sorunun test sonucu */
export interface QuestionResult {
  questionId: number;
  question: string;
  category: QuestionCategory;
  /** Modelin ham çıktısı (think etiketleri dahil) */
  rawAnswer: string;
  /** Ayrıştırılmış düşünme süreci (reasoning) */
  thinkingProcess: string | null;
  /** Think etiketlerinden temizlenmiş nihai cevap */
  finalAnswer: string;
  deterministicScore: number;
  judgeScore: number | null;
  judgeReasoning: string | null;
  finalScore: number;
  /** Biçim disiplini: cevap istenen formatı (JSON/etiket) ilk denemede tutturdu mu? */
  formatCompliant?: boolean;
  /** Sandbox unit test sonuçları (kod soruları için) */
  sandboxTests?: SandboxTestResult[];
  /** Sycophancy direnci: 100 = doğru cevabı savundu, 50 = boyun eğdi, 0 = baştan yanlış */
  resistanceScore?: number;
  /** Adversarial baskı turunda modelin verdiği cevap */
  adversarialAnswer?: string;
  /** İlk token'a kadar geçen süre (ms) */
  ttft: number;
  /** Saniyede üretilen token sayısı */
  tps: number;
  /** Üretilen toplam token sayısı (yaklaşık) */
  totalTokens: number;
  /** Toplam üretim süresi (ms) — ilk tokendan sona kadar */
  generationMs: number;
  /** Toplam cevap süresi (ms) — istek gönderiminden son token'a kadar (TTFT + üretim) */
  answerDurationMs: number;
}

/** Tam bir benchmark koşusu (2 fazlı test sonucu) */
export interface BenchmarkRun {
  id: string;
  modelConfig: ModelConfig;
  judgeModelConfig: ModelConfig | null;
  totalScore: number;
  avgTTFT: number;
  avgTPS: number;
  /** Ortalama toplam cevap süresi (ms) — tüm soruların answerDurationMs ortalaması */
  avgAnswerDurationMs: number;
  results: QuestionResult[];
  /** Biçim Disiplini: istenen formatı ilk denemede tutturan soru oranı (0-100) */
  formatDiscipline: number;
  /** Koşu tamamlanma zamanı (Unix ms) */
  timestamp: number;
  /** Seçilen test kategorileri */
  selectedCategories?: TestCategory[];
}

/** Leaderboard satırı — modellerin toplulaştırılmış istatistikleri */
export interface LeaderboardEntry {
  id: string;
  runId: string;
  modelName: string;
  provider: Provider;
  totalScore: number;
  categoryScores: {
    logic: number;
    math: number;
    ifeval: number;
    json: number;
    code: number;
    needle: number;
    adversarial: number;
    turkish: number;
    coding: number;
    turkish_general: number;
  };
  avgTTFT: number;
  avgTPS: number;
  /** Ortalama toplam cevap süresi (ms) — değerlendirme kriteri olarak sıralanır */
  avgAnswerDurationMs: number;
  /** Test başına ortalama üretilen token sayısı */
  avgTokens: number;
  /** Biçim Disiplini: format uyumu yüzdesi (0-100) */
  formatDiscipline: number;
  /** Verimlilik Endeksi: Skor ve hız dengesi (0-100) */
  efficiencyIndex: number;
  /** Bu koşuyu puanlayan Hakem AI modelinin adı */
  judgeModelName: string;
  /** Testin tamamlandığı tarih-saat (Unix ms) */
  timestamp: number;
}

/** Test koşusu sırasında NDJSON olarak gönderilen canlı ilerleme olayı */
export interface RunProgressEvent {
  type:
    | 'phase'
    | 'question'
    | 'judge'
    | 'complete'
    | 'error'
    | 'retry' // bir adım başarısız oldu, yeniden deneniyor
    | 'batch' // toplu test: yeni model başlıyor
    | 'batch-complete' // toplu test: bir modelin testi bitti
    | 'stopped'; // kullanıcı durdurdu
  /** Toplam ilerleme yüzdesi (0-100) */
  progress: number;
  /** Kullanıcıya gösterilecek durum mesajı */
  message: string;
  /** 'complete' olayında tam BenchmarkRun verisi */
  run?: BenchmarkRun;
  /** Toplu test: kaçıncı model (1 tabanlı) */
  batchIndex?: number;
  /** Toplu test: toplam model sayısı */
  batchTotal?: number;
  /** Toplu test: model adı */
  batchModelName?: string;
}

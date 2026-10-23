import { promises as fs } from "fs";
import path from "path";
import { ModelConfig, BenchmarkRun, BenchmarkQuestion } from "../types/benchmark";

const DB_PATH = path.join(process.cwd(), "data", "benchmark_db.json");

/** JSON veritabanının şeması. */
interface DBSchema {
  models: ModelConfig[];
  runs: BenchmarkRun[];
  /** Arşivlenmiş koşular (geri dönüşüm kutusu). Koşular asla fiziksel
   *  silinmez; DELETE /api/runs buraya taşır, restore buradan geri getirir. */
  archivedRuns?: BenchmarkRun[];
  customQuestions: BenchmarkQuestion[];
  /** Madde 3: soru havuzundan seçilen standart soru ID'leri.
   *  Tanımsız = hiç ayarlanmamış → tüm sorular seçili kabul edilir. */
  questionSelection?: { enabledQuestionIds: number[] };
}

const EMPTY_DB: DBSchema = {
  models: [],
  runs: [],
  archivedRuns: [],
  customQuestions: [],
};

/**
 * data dizininin ve benchmark_db.json dosyasının varlığini sağlar.
 * Dosya yoksa boş yapıyla otomatik oluşturur.
 */
async function ensureDB(): Promise<void> {
  const dir = path.dirname(DB_PATH);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
  }
}

/**
 * Veritabanını okur. Dosya yoksa veya bozuksa boş yapı döner.
 */
export async function readDB(): Promise<DBSchema> {
  await ensureDB();
  try {
    const data = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(data);
    return {
      models: Array.isArray(parsed.models) ? parsed.models : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      // Eski dosyalarda archivedRuns yoktur — boş diziyle tamamla (migration)
      archivedRuns: Array.isArray(parsed.archivedRuns) ? parsed.archivedRuns : [],
      customQuestions: Array.isArray(parsed.customQuestions)
        ? parsed.customQuestions
        : [],
      questionSelection:
        parsed.questionSelection &&
        Array.isArray(parsed.questionSelection.enabledQuestionIds)
          ? parsed.questionSelection
          : undefined,
    };
  } catch (error) {
    console.error("Veritabanı okunamadı:", error);
    return { ...EMPTY_DB };
  }
}

/**
 * Veritabanının tamamını yazar.
 */
export async function writeDB(data: DBSchema): Promise<void> {
  await ensureDB();
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Veritabanına yazılamadı:", error);
    throw error;
  }
}

// ─── Model işlemleri ────────────────────────────────────────────────

/** Tüm kayıtlı modelleri döner. */
export async function readModels(): Promise<ModelConfig[]> {
  const db = await readDB();
  return db.models;
}

/** ID'ye göre tek bir model döner. */
export async function getModelById(id: string): Promise<ModelConfig | null> {
  const models = await readModels();
  return models.find((m) => m.id === id) ?? null;
}

/**
 * Modeli oluşturur veya günceller (upsert) ve DB'de temsil edilen
 * GERÇEK kaydı döner. Aynı (provider, modelId) çiftinden ikinci bir
 * kayıt asla oluşmaz — dönen kayıt kullanıldığında aynı modelin
 * koşuları her zaman aynı DB kimliği altında toplanır.
 */
export async function writeModel(model: ModelConfig): Promise<ModelConfig> {
  const db = await readDB();
  // 1) Aynı ID'li kayıt varsa güncelle
  const index = db.models.findIndex((m) => m.id === model.id);
  if (index >= 0) {
    db.models[index] = model;
    await writeDB(db);
    return model;
  }
  // 2) Duplicate koruması: aynı (provider, modelId) çiftinden başka bir kayıt
  //    varsa YENİ kayıt oluşturulmaz; mevcut kayıt güncellenir.
  const duplicateIndex = db.models.findIndex(
    (m) =>
      m.provider === model.provider &&
      m.modelId.toLowerCase() === model.modelId.toLowerCase()
  );
  if (duplicateIndex >= 0) {
    // Mevcut kaydın kimliğini koru (koşular bu ID'ye bağlı);
    // yalnızca ad ve hakem bayrağı tazelenir. apiKey ve hata notu
    // yalnızca gelen modelde doluysa güncellenir — aksi halde
    // katalogdan tekrar ekleme mevcut anahtarı/hata notunu EZER.
    const existing = db.models[duplicateIndex];
    const updated: ModelConfig = {
      ...model,
      id: existing.id,
      isJudge: existing.isJudge || model.isJudge,
      apiKey: model.apiKey ?? existing.apiKey,
      lastLoadError: model.lastLoadError ?? existing.lastLoadError,
      lastLoadErrorAt: model.lastLoadErrorAt ?? existing.lastLoadErrorAt,
    };
    db.models[duplicateIndex] = updated;
    await writeDB(db);
    return updated;
  }
  db.models.push(model);
  await writeDB(db);
  return model;
}

/** ID ile model siler. */
export async function deleteModel(id: string): Promise<void> {
  const db = await readDB();
  db.models = db.models.filter((m) => m.id !== id);
  await writeDB(db);
}

/**
 * Bir modelin "çalışmıyor" notunu yazar (ör. yükleme hatası).
 * Model kayıtlı değilse sessizce yok sayılır (kütüphane modeli
 * henüz DB'ye eklenmemiş olabilir).
 */
export async function setModelLoadError(
  provider: string,
  modelId: string,
  errorMessage: string
): Promise<void> {
  const db = await readDB();
  const target = db.models.find(
    (m) =>
      m.provider === provider &&
      m.modelId.toLowerCase() === modelId.toLowerCase()
  );
  if (!target) return;
  target.lastLoadError = errorMessage.slice(0, 500);
  target.lastLoadErrorAt = Date.now();
  await writeDB(db);
}

/**
 * Modelin "çalışmıyor" notunu temizler — başarılı bir test/yükleme
 * sonrası çağrılır. Model kayıtlı değilse sessizce yok sayılır.
 */
export async function clearModelLoadError(
  provider: string,
  modelId: string
): Promise<void> {
  const db = await readDB();
  const target = db.models.find(
    (m) =>
      m.provider === provider &&
      m.modelId.toLowerCase() === modelId.toLowerCase()
  );
  if (!target) return;
  delete target.lastLoadError;
  delete target.lastLoadErrorAt;
  await writeDB(db);
}

/**
 * Bir modeli "Aktif Hakem Model" olarak atar.
 * Tek bir aktif hakem olabileceği için diğerlerinin isJudge bayrağı kaldırılır.
 */
export async function setJudgeModel(id: string): Promise<ModelConfig | null> {
  const db = await readDB();
  const target = db.models.find((m) => m.id === id);
  if (!target) return null;
  db.models = db.models.map((m) => ({ ...m, isJudge: m.id === id }));
  await writeDB(db);
  return target;
}

// ─── Koşu (run) işlemleri ───────────────────────────────────────────

/**
 * Yeni bir benchmark koşusu kaydeder.
 *
 * "En son test geçerli" politikası: Aynı GERÇEK model için yeni bir koşu
 * kaydedildiğinde, o modelin önceki tüm koşuları silinir. Kimlik eşleştirmesi
 * DB kayıt ID'sine değil, gerçek model kimliğine (provider + modelId)
 * göre yapılır — böylece aynı model farklı kayıt yollarından (kütüphane
 * seçimi, toplu test, manuel ekleme) test edilse bile koşuları tek bir
 * kimlik altında toplanır ve leaderboard'da asla ikinci satır oluşmaz.
 *
 * KALICILIK: Koşular APPEND-ONLY'dir — yeni koşu, aynı modelin eski
 * koşularını SİLMEZ. Leaderboard API'si model başına en güncel koşuyu
 * seçerek tek satır gösterir; geçmiş koşular arşiv değeri olarak kalır.
 */
export async function addRun(run: BenchmarkRun): Promise<void> {
  const db = await readDB();
  // Aynı run.id zaten varsa (idempotent tekrar) üzerine yaz; yoksa ekle.
  const existingIndex = db.runs.findIndex((r) => r.id === run.id);
  if (existingIndex >= 0) {
    db.runs[existingIndex] = run;
  } else {
    db.runs.push(run);
  }
  await writeDB(db);
}

/** Bir modele ait tüm koşuları döner. */
export async function getRunsByModel(modelId: string): Promise<BenchmarkRun[]> {
  const db = await readDB();
  return db.runs.filter((run) => run.modelConfig.id === modelId);
}

/** Bir modele ait en güncel koşuyu döner. */
export async function getLatestRunByModel(
  modelId: string
): Promise<BenchmarkRun | null> {
  const runs = await getRunsByModel(modelId);
  if (runs.length === 0) return null;
  runs.sort((a, b) => b.timestamp - a.timestamp);
  return runs[0];
}

/** Bir koşu ID'sine göre koşuyu döner (detay modalı için). */
export async function getRunById(runId: string): Promise<BenchmarkRun | null> {
  const db = await readDB();
  return db.runs.find((r) => r.id === runId) ?? null;
}

// ─── Özel soru işlemleri ────────────────────────────────────────────

/** Kullanıcı tanımlı tüm özel soruları döner. */
export async function readCustomQuestions(): Promise<BenchmarkQuestion[]> {
  const db = await readDB();
  return db.customQuestions;
}

/** Yeni bir özel soru ekler. Standart soru ID'leriyle (1-10) çakışmaması için
 *  ID'ler 100'den başlayarak atanır. */
export async function addCustomQuestion(
  question: Omit<BenchmarkQuestion, "id" | "isCustom">
): Promise<BenchmarkQuestion> {
  const db = await readDB();
  const maxId = db.customQuestions.reduce((max, q) => Math.max(max, q.id), 100);
  const newQuestion: BenchmarkQuestion = {
    ...question,
    id: maxId + 1,
    isCustom: true,
  };
  db.customQuestions.push(newQuestion);
  await writeDB(db);
  return newQuestion;
}

/** ID ile özel soru siler. */
export async function deleteCustomQuestion(id: number): Promise<void> {
  const db = await readDB();
  db.customQuestions = db.customQuestions.filter((q) => q.id !== id);
  await writeDB(db);
}

// ─── Madde 2: Toplu koşu silme ──────────────────────────────────────

/**
 * Verilen run ID'lerine sahip koşuları ARŞİVELER (fiziksel silme YOKTUR).
 * Koşular `runs` dizisinden `archivedRuns`'a taşınır — geri dönüşüm kutusu
 * gibidir; `restoreRuns` ile her zaman geri getirilebilir.
 * @returns Arşivlenen kayıt sayısı.
 */
export async function deleteRuns(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  const db = await readDB();
  const idSet = new Set(runIds);
  const archived: BenchmarkRun[] = [];
  const kept: BenchmarkRun[] = [];
  for (const run of db.runs) {
    if (idSet.has(run.id)) archived.push(run);
    else kept.push(run);
  }
  if (archived.length === 0) return 0;
  db.runs = kept;
  db.archivedRuns = [...(db.archivedRuns ?? []), ...archived];
  await writeDB(db);
  return archived.length;
}

/**
 * Arşivdeki koşuları geri yükler.
 * @param runIds Boş dizi/verilmezse arşivdeki TÜM koşular geri yüklenir.
 * @returns Geri yüklenen kayıt sayısı.
 */
export async function restoreRuns(runIds?: string[]): Promise<number> {
  const db = await readDB();
  const archive = db.archivedRuns ?? [];
  if (archive.length === 0) return 0;
  const restoreAll = !runIds || runIds.length === 0;
  const idSet = new Set(runIds ?? []);
  const toRestore: BenchmarkRun[] = [];
  const remaining: BenchmarkRun[] = [];
  for (const run of archive) {
    if (restoreAll || idSet.has(run.id)) toRestore.push(run);
    else remaining.push(run);
  }
  if (toRestore.length === 0) return 0;
  // Aynı ID'li koşu zaten runs'ta varsa arşivden geleni atla (çakışma yok)
  const existingIds = new Set(db.runs.map((r) => r.id));
  const restored = toRestore.filter((r) => !existingIds.has(r.id));
  db.runs = [...db.runs, ...restored];
  db.archivedRuns = remaining;
  await writeDB(db);
  return restored.length;
}

/**
 * Arşivlenmiş koşuların listesini döner (geri yükleme UI'ı için).
 */
export async function readArchivedRuns(): Promise<BenchmarkRun[]> {
  const db = await readDB();
  return db.archivedRuns ?? [];
}

// ─── Madde 3: Standart soru seçimi ──────────────────────────────────

/**
 * Seçili standart soru ID'lerini döner.
 * Hiç ayarlanmamışsa null döner → çağıran tüm soruların seçili
 * olduğunu varsayar.
 */
export async function readQuestionSelection(): Promise<number[] | null> {
  const db = await readDB();
  return db.questionSelection?.enabledQuestionIds ?? null;
}

/**
 * Seçili standart soru ID'lerini kaydeder.
 * Boş dizi reddedilir — en az bir soru seçili olmalıdır.
 */
export async function writeQuestionSelection(
  enabledQuestionIds: number[]
): Promise<void> {
  if (!Array.isArray(enabledQuestionIds) || enabledQuestionIds.length === 0) {
    throw new Error("En az bir soru seçili olmalıdır.");
  }
  const db = await readDB();
  db.questionSelection = { enabledQuestionIds };
  await writeDB(db);
}

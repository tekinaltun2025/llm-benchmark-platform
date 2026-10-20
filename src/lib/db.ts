import { promises as fs } from "fs";
import path from "path";
import { ModelConfig, BenchmarkRun, BenchmarkQuestion } from "../types/benchmark";

const DB_PATH = path.join(process.cwd(), "data", "benchmark_db.json");

/** JSON veritabanının şeması. */
interface DBSchema {
  models: ModelConfig[];
  runs: BenchmarkRun[];
  customQuestions: BenchmarkQuestion[];
  /** Madde 3: soru havuzundan seçilen standart soru ID'leri.
   *  Tanımsız = hiç ayarlanmamış → tüm sorular seçili kabul edilir. */
  questionSelection?: { enabledQuestionIds: number[] };
}

const EMPTY_DB: DBSchema = { models: [], runs: [], customQuestions: [] };

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
    // yalnızca ad ve hakem bayrağı tazelenir.
    const existing = db.models[duplicateIndex];
    const updated: ModelConfig = {
      ...model,
      id: existing.id,
      isJudge: existing.isJudge || model.isJudge,
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
 * seçimi, toplu test, manuel ekleme) test edilse bile eski koşuları
 * temizlenir ve leaderboard'da asla ikinci bir satır oluşmaz.
 */
export async function addRun(run: BenchmarkRun): Promise<void> {
  const db = await readDB();
  const identity = (r: BenchmarkRun) =>
    `${r.modelConfig.provider}:${r.modelConfig.modelId.toLowerCase()}`;
  const newIdentity = identity(run);
  db.runs = db.runs.filter((r) => identity(r) !== newIdentity);
  db.runs.push(run);
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
 * Verilen run ID'lerine sahip TÜM koşu kayıtlarını kalıcı olarak siler.
 * @returns Silinen kayıt sayısı.
 */
export async function deleteRuns(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;
  const db = await readDB();
  const idSet = new Set(runIds);
  const before = db.runs.length;
  db.runs = db.runs.filter((run) => !idSet.has(run.id));
  const deleted = before - db.runs.length;
  if (deleted > 0) {
    await writeDB(db);
  }
  return deleted;
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

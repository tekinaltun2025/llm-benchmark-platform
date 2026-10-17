import { promises as fs } from "fs";
import path from "path";
import { ModelConfig, BenchmarkRun } from "../types/benchmark";

const DB_PATH = path.join(process.cwd(), "data", "benchmark_db.json");

/**
 * Ensures the data directory and db.json file exist.
 * If the file doesn't exist, it creates an empty structure with models and runs arrays.
 */
async function ensureDB() {
  const dir = path.dirname(DB_PATH);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(
      DB_PATH,
      JSON.stringify({ models: [], runs: [] }),
      "utf8"
    );
  }
}

/**
 * Reads the database and returns an object containing models and runs.
 * If the file doesn't exist or is invalid, returns { models: [], runs: [] }.
 */
export async function readDB(): Promise<{
  models: ModelConfig[];
  runs: BenchmarkRun[];
}> {
  await ensureDB();
  try {
    const data = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(data);
    // Ensure we have the expected structure
    return {
      models: Array.isArray(parsed.models) ? parsed.models : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    console.error("Failed to read benchmark DB:", error);
    return { models: [], runs: [] };
  }
}

/**
 * Writes the entire database object.
 * @param data - An object containing models and runs arrays.
 */
export async function writeDB(data: {
  models: ModelConfig[];
  runs: BenchmarkRun[];
}): Promise<void> {
  await ensureDB();
  try {
    await fs.writeFile(
      DB_PATH,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Failed to write benchmark DB:", error);
    throw error;
  }
}

/**
 * Reads all models from the database.
 */
export async function readModels(): Promise<ModelConfig[]> {
  const db = await readDB();
  return db.models;
}

/**
 * Writes a model to the database (creates or updates).
 * @param model - The model configuration to write.
 */
export async function writeModel(model: ModelConfig): Promise<void> {
  const db = await readDB();
  const index = db.models.findIndex((m) => m.id === model.id);
  if (index >= 0) {
    db.models[index] = model;
  } else {
    db.models.push(model);
  }
  await writeDB(db);
}

/**
 * Deletes a model from the database by its ID.
 * @param id - The ID of the model to delete.
 */
export async function deleteModel(id: string): Promise<void> {
  const db = await readDB();
  db.models = db.models.filter((m) => m.id !== id);
  await writeDB(db);
}

/**
 * Adds a new BenchmarkRun to the database.
 * @param run - The BenchmarkRun to add.
 */
export async function addRun(run: BenchmarkRun): Promise<void> {
  const db = await readDB();
  db.runs.push(run);
  await writeDB(db);
}

/**
 * Gets all runs for a specific model (by modelConfig.id).
 * @param modelId - The ID of the model.
 */
export async function getRunsByModel(modelId: string): Promise<BenchmarkRun[]> {
  const db = await readDB();
  return db.runs.filter((run) => run.modelConfig.id === modelId);
}

/**
 * Gets the latest run for a specific model.
 * @param modelId - The ID of the model.
 */
export async function getLatestRunByModel(modelId: string): Promise<BenchmarkRun | null> {
  const runs = await getRunsByModel(modelId);
  if (runs.length === 0) return null;
  // Sort by timestamp descending and return the first
  runs.sort((a, b) => b.timestamp - a.timestamp);
  return runs[0];
}
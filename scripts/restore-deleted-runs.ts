/**
 * Silinen test sonuçlarını git geçmişinden geri getirir.
 *
 * Kullanım: npx tsx scripts/restore-deleted-runs.ts
 *
 * Mantık:
 *   1. `git log --all --format=%H -- data/benchmark_db.json` ile DB dosyasının
 *      commit edilmiş TÜM sürümlerini bulur.
 *   2. Her commit'ten `git show <sha>:data/benchmark_db.json` içeriğini okur.
 *   3. Koşuları run.id bazında birleştirir (aynı ID → en yeni commit sürümü).
 *   4. Mevcut DB'de olmayan koşuları db.runs'a ekler (mevcutlar korunur).
 *   5. Koşunun modelConfig'ine karşılık gelen model kaydı db.models'te yoksa
 *      koşudaki gömülü kopyadan geri oluşturur (leaderboard + detay için).
 *
 * Not: Koşular artık append-only'dir; bu script yalnızca geçmişte
 * silinmiş koşuları kurtarmak için tek seferlik çalıştırılır.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'benchmark_db.json');
const DB_RELATIVE = 'data/benchmark_db.json';

interface ModelConfigLike {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  isJudge: boolean;
  lastLoadError?: string;
  lastLoadErrorAt?: number;
}

interface RunLike {
  id: string;
  modelConfig: ModelConfigLike;
  judgeModelConfig?: ModelConfigLike;
  timestamp: number;
  totalScore: number;
  results: unknown[];
  [key: string]: unknown;
}

interface DBSchemaLike {
  models: ModelConfigLike[];
  runs: RunLike[];
  archivedRuns?: RunLike[];
  customQuestions: unknown[];
  questionSelection?: { enabledQuestionIds: number[] };
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', PROJECT_ROOT, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function main(): Promise<void> {
  console.log('🔍 Git geçmişinde DB sürümleri taranıyor...');

  // 1) DB dosyasının commit edilmiş tüm sürümlerini listele
  const logOutput = await git([
    'log',
    '--all',
    '--format=%H',
    '--',
    DB_RELATIVE,
  ]);
  const commits = logOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (commits.length === 0) {
    console.log('⚠️  Git geçmişinde DB dosyası bulunamadı — kurtarılacak şey yok.');
    return;
  }
  console.log(`   ${commits.length} commit'te DB anlık görüntüsü bulundu.`);

  // 2) Her commit'ten koşuları topla; run.id bazında birleştir
  //    (aynı ID birden çok sürümde varsa en yeni commit'in sürümü kazanır —
  //    commits dizisi zaten yeni→eski sıradadır, bu yüzden İLK gördüğünü tut)
  const runsById = new Map<string, RunLike>();
  const modelsById = new Map<string, ModelConfigLike>();

  for (const sha of commits) {
    let content: string;
    try {
      content = await git(['show', `${sha}:${DB_RELATIVE}`]);
    } catch {
      continue; // Bu commit'te dosya yok/okunamadı — atla
    }
    let parsed: Partial<DBSchemaLike>;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn(`   ⚠️ ${sha.slice(0, 7)} sürümü bozuk JSON — atlandı.`);
      continue;
    }
    for (const run of parsed.runs ?? []) {
      if (run?.id && run?.modelConfig?.id && !runsById.has(run.id)) {
        runsById.set(run.id, run);
      }
    }
    for (const model of parsed.models ?? []) {
      if (model?.id && !modelsById.has(model.id)) {
        modelsById.set(model.id, model);
      }
    }
  }

  console.log(
    `   Geçmişte toplam ${runsById.size} benzersiz koşu, ${modelsById.size} model kaydı tespit edildi.`
  );

  // 3) Mevcut DB'yi oku
  const currentRaw = await fs.readFile(DB_PATH, 'utf8');
  const current = JSON.parse(currentRaw) as DBSchemaLike;
  current.runs = Array.isArray(current.runs) ? current.runs : [];
  current.models = Array.isArray(current.models) ? current.models : [];
  current.archivedRuns = Array.isArray(current.archivedRuns)
    ? current.archivedRuns
    : [];

  const currentRunIds = new Set(current.runs.map((r) => r.id));
  const archivedRunIds = new Set(current.archivedRuns.map((r) => r.id));

  // 4) Mevcut olmayan koşuları geri getir (arşivdekiler de dahil —
  //    arşiv zaten geri yüklenebilir durumda, ama runs'a taşımak
  //    kullanıcı isteğidir: "sonuçlar ekranda kalmalı")
  const toRestore: RunLike[] = [];
  for (const [id, run] of runsById) {
    if (!currentRunIds.has(id)) {
      toRestore.push(run);
      archivedRunIds.delete(id); // arşivde varsa oradan da çıkar (çift kayıt olmasın)
    }
  }

  // 5) Geri getirilen koşuların modellerini db.models'te garanti et —
  //    koşu kendi modelConfig kopyasını taşır ama model listesi de
  //    tutarlı olsun (detay modalı, getRunsByModel vb. için).
  const currentModelIds = new Set(current.models.map((m) => m.id));
  const restoredModelIds = new Set<string>();
  for (const run of toRestore) {
    const mc = run.modelConfig;
    if (!currentModelIds.has(mc.id)) {
      // Git geçmişindeki model kaydı daha zengin olabilir (apiKey vb.) —
      // önce onu, yoksa koşudaki gömülü kopyayı kullan.
      const historical = modelsById.get(mc.id) ?? mc;
      current.models.push(historical);
      currentModelIds.add(historical.id);
      restoredModelIds.add(historical.id);
    }
  }

  if (toRestore.length === 0) {
    console.log('✅ Kayıp koşu yok — mevcut DB zaten tüm geçmişi içeriyor.');
    return;
  }

  // 6) Yaz ve raporla
  current.runs = [...current.runs, ...toRestore];
  current.archivedRuns = current.archivedRuns.filter(
    (r) => !new Set(toRestore.map((x) => x.id)).has(r.id)
  );

  await fs.writeFile(DB_PATH, JSON.stringify(current, null, 2), 'utf8');

  console.log(`\n✅ ${toRestore.length} koşu geri getirildi:`);
  const byModel = new Map<string, number>();
  for (const run of toRestore) {
    const key = `${run.modelConfig.name} (${run.modelConfig.provider})`;
    byModel.set(key, (byModel.get(key) ?? 0) + 1);
  }
  for (const [model, count] of byModel) {
    console.log(`   • ${model}: ${count} koşu`);
  }
  if (restoredModelIds.size > 0) {
    console.log(`\n   ${restoredModelIds.size} model kaydı da geri oluşturuldu.`);
  }
  console.log(
    `\n🏁 Toplam koşu sayısı: ${current.runs.length} (+${toRestore.length}), ` +
      `arşiv: ${current.archivedRuns.length}.`
  );
}

main().catch((error) => {
  console.error('❌ Kurtarma başarısız:', error);
  process.exit(1);
});

import { NextResponse } from 'next/server';
import { ModelConfig } from '@/types/benchmark';
import { readDB, writeDB } from '@/lib/db';
import { listLMStudioModels } from '@/lib/lmstudio';

/**
 * POST /api/models/sync
 *
 * Kayıtlı modelleri LM Studio kütüphanesiyle senkronize eder:
 *
 *   1. DUPLICATE TEMİZLİĞİ: Aynı modelId'ye (LM Studio'daki gerçek kimlik)
 *      sahip birden fazla kayıt varsa yalnızca en "değerli" olan tutulur
 *      (öncelik: isJudge > en yeni koşusu olan > ilk kayıt). Diğerleri silinir.
 *      KALICILIK: Kaybeden kayda bağlı koşular SİLİNMEZ — kazanan kaydın
 *      ID'sine re-parent edilir, koşu geçmişi korunur.
 *   2. İSİM DÜZELTME: Kayıtlı modelin adı LM Studio'daki gerçek model adıyla
 *      eşleşmiyorsa (ör. "Qwen3.5-9B-Q4_K_M" → "qwen3.5-9b") LM Studio
 *      kimliğine göre düzeltilir.
 *   3. ÖLÜ KAYIT TEMİZLİĞİ: LM Studio kütüphanesinde artık var olmayan
 *      lmstudio sağlayıcılı MODEL KAYITLARI silinir (kütüphane erişilebilirse).
 *      KALICILIK: Bu modellerin KOŞULARI asla silinmez — koşu kendi
 *      modelConfig kopyasını taşır, leaderboard satırı yaşamaya devam eder.
 *
 * Dönen rapor: silinen, yeniden adlandırılan ve değişmeyen model listesi.
 */
export async function POST() {
  try {
    const db = await readDB();
    const library = await listLMStudioModels();
    const libraryIds = new Set(library.map((m) => m.id.toLowerCase()));

    const report = {
      removedDuplicates: [] as string[],
      renamed: [] as Array<{ from: string; to: string }>,
      removedMissing: [] as string[],
      kept: [] as string[],
      libraryModelCount: library.length,
    };

    // ─── 1) Duplicate temizliği: aynı modelId → tek kayıt ──
    const byModelId = new Map<string, ModelConfig[]>();
    for (const model of db.models) {
      const key = `${model.provider}:${model.modelId.toLowerCase()}`;
      const list = byModelId.get(key) ?? [];
      list.push(model);
      byModelId.set(key, list);
    }

    const keptModels: ModelConfig[] = [];
    for (const [, group] of byModelId) {
      if (group.length === 1) {
        keptModels.push(group[0]);
        continue;
      }
      // Aynı modelId'li kayıtlardan hangisi tutulacak?
      // Öncelik: isJudge olan > koşusu olan > en eski (ilk eklenen)
      const runsByModel = new Map<string, number>();
      for (const run of db.runs) {
        runsByModel.set(
          run.modelConfig.id,
          (runsByModel.get(run.modelConfig.id) ?? 0) + 1
        );
      }
      const sorted = [...group].sort((a, b) => {
        if (a.isJudge !== b.isJudge) return a.isJudge ? -1 : 1;
        const runDiff =
          (runsByModel.get(b.id) ?? 0) - (runsByModel.get(a.id) ?? 0);
        if (runDiff !== 0) return runDiff;
        return a.id.localeCompare(b.id);
      });
      const winner = sorted[0];
      keptModels.push(winner);
      for (const loser of sorted.slice(1)) {
        report.removedDuplicates.push(
          `"${loser.name}" (${loser.id}, modelId: ${loser.modelId})`
        );
        // KALICILIK: Kaybeden kaydın koşuları SİLİNMEZ — kazanan kaydın
        // ID'sine re-parent edilir. Koşu geçmişi ve leaderboard satırı
        // aynen korunur; getRunsByModel kazanan ID üzerinden çalışır.
        for (const run of db.runs) {
          if (run.modelConfig.id === loser.id) {
            run.modelConfig = { ...winner, isJudge: run.modelConfig.isJudge };
          }
        }
      }
    }

    // ─── 2) İsim düzeltme + 3) ölü kayıt temizliği ──
    const finalModels: ModelConfig[] = [];
    for (const model of keptModels) {
      if (model.provider !== 'lmstudio') {
        finalModels.push(model);
        report.kept.push(model.name);
        continue;
      }
      const libMatch = library.find(
        (m) => m.id.toLowerCase() === model.modelId.toLowerCase()
      );
      if (!libMatch) {
        // LM Studio kütüphanesinde yok → ölü MODEL KAYDI. Kayıt silinir AMA
        // KALICILIK: koşuları asla silinmez — koşu kendi modelConfig
        // kopyasını gömülü taşır; model erişilemez olsa bile test sonucu
        // leaderboard'da kalır.
        report.removedMissing.push(`"${model.name}" (modelId: ${model.modelId})`);
        continue;
      }
      // İsim LM Studio kimliğiyle tutarlı mı? Kayıtlı isim modelId'den
      // türetilmiş "yanlış" bir ad ise (ör. quantization sonekli) düzelt.
      if (model.name !== libMatch.id && model.name.toLowerCase() !== libMatch.id.toLowerCase()) {
        report.renamed.push({ from: model.name, to: libMatch.id });
        finalModels.push({ ...model, name: libMatch.id });
      } else {
        finalModels.push(model);
        report.kept.push(model.name);
      }
    }

    db.models = finalModels;
    await writeDB(db);

    return NextResponse.json({
      success: true,
      ...report,
      finalModelCount: finalModels.length,
    });
  } catch (error) {
    console.error('Model senkronizasyonu başarısız:', error);
    return NextResponse.json(
      { error: 'Model senkronizasyonu başarısız' },
      { status: 500 }
    );
  }
}

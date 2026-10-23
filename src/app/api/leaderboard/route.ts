import { NextResponse } from 'next/server';
import { LeaderboardEntry, BenchmarkRun } from '@/types/benchmark';
import { readDB } from '@/lib/db';
import { computeEfficiencyIndex } from '@/lib/efficiency';

/**
 * GET /api/leaderboard
 *
 * Her modelin EN GÜNCEL koşusunu baz alarak leaderboard satırları üretir.
 * Satırlar Genel Skor'a göre azalan sıralı döner.
 */
export async function GET() {
  try {
    const { runs } = await readDB();

    if (runs.length === 0) {
      return NextResponse.json([]);
    }

    // Model başına en güncel koşuyu seç.
    // Kimlik: DB kayıt ID'si DEĞİL, gerçek model kimliği (provider+modelId) —
    // aynı model farklı kayıt yollarından test edilse bile tek satır olur.
    const latestRunByModel = new Map<string, BenchmarkRun>();
    for (const run of runs) {
      const identity = `${run.modelConfig.provider}:${run.modelConfig.modelId.toLowerCase()}`;
      const existing = latestRunByModel.get(identity);
      if (!existing || run.timestamp > existing.timestamp) {
        latestRunByModel.set(identity, run);
      }
    }

    const leaderboard: LeaderboardEntry[] = [];

    for (const run of latestRunByModel.values()) {
      // Kategori bazlı ortalama puanlar (9 kategori: 5 standart + needle + adversarial + coding + turkish_general)
      const categoryScores: LeaderboardEntry['categoryScores'] = {
        logic: 0,
        math: 0,
        ifeval: 0,
        json: 0,
        code: 0,
        needle: 0,
        adversarial: 0,
        turkish: 0,
        coding: 0,
        turkish_general: 0,
      };
      const categoryCounts: Record<string, number[]> = {};
      for (const result of run.results) {
        if (!categoryCounts[result.category]) categoryCounts[result.category] = [];
        categoryCounts[result.category].push(result.finalScore);
      }
      (Object.keys(categoryScores) as Array<keyof typeof categoryScores>).forEach(
        (cat) => {
          const scores = categoryCounts[cat] ?? [];
          categoryScores[cat] =
            scores.length > 0
              ? Math.round(
                  (scores.reduce((a, b) => a + b, 0) / scores.length) * 100
                ) / 100
              : 0;
        }
      );

      // Test başına ortalama üretilen token sayısı
      const avgTokens =
        Math.round(
          (run.results.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0) /
            Math.max(1, run.results.length)) *
            100
        ) / 100;

      // Ortalama cevap süresi (ms) — eski koşularda alan yoksa 0 varsay
      // (computeEfficiencyIndex undefined/0'ı nötr faktör olarak ele alır)
      const avgAnswerDurationMs = run.avgAnswerDurationMs ?? 0;

      leaderboard.push({
        id: run.modelConfig.id,
        runId: run.id,
        modelName: run.modelConfig.name,
        provider: run.modelConfig.provider,
        totalScore: run.totalScore,
        categoryScores,
        avgTTFT: run.avgTTFT,
        avgTPS: run.avgTPS,
        avgAnswerDurationMs,
        avgTokens,
        // Biçim Disiplini: eski koşularda alan yoksa 100 varsay (geriye dönük uyumluluk)
        formatDiscipline: run.formatDiscipline ?? 100,
        // Verimlilik: kalite × hız bonusu (TPS + cevap süresi karışımı)
        efficiencyIndex: computeEfficiencyIndex(
          run.totalScore,
          run.avgTPS,
          avgAnswerDurationMs
        ),
        judgeModelName: run.judgeModelConfig?.name ?? '—',
        // Testin tamamlandığı tarih-saat (satırın en sağında gösterilir)
        timestamp: run.timestamp,
      });
    }

    // Genel Skor'a göre azalan sırala
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard oluşturulamadı:', error);
    return NextResponse.json(
      { error: 'Leaderboard oluşturulamadı' },
      { status: 500 }
    );
  }
}

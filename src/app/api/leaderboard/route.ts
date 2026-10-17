import { NextResponse } from 'next/server';
import { ModelConfig, BenchmarkRun } from '@/types/benchmark';
import { readDB } from '@/lib/db';
import { benchmarkQuestions } from '@/lib/benchmark-suite';

export async function GET() {
  try {
    const { models, runs } = await readDB();

    // If there are no runs, return empty array
    if (runs.length === 0) {
      return NextResponse.json([]);
    }

    // Aggregate runs by model to compute average scores, etc.
    const modelStats: Record<
      string,
      {
        modelConfig: ModelConfig;
        totalScoreSum: number;
        count: number;
        categoryScores: Record<string, number[]>;
        avgTTFT: number[];
        avgTPS: number[];
      }
    > = {};

    runs.forEach((run) => {
      const id = run.modelConfig.id;
      if (!modelStats[id]) {
        modelStats[id] = {
          modelConfig: run.modelConfig,
          totalScoreSum: 0,
          count: 0,
          categoryScores: {
            logic: [],
            math: [],
            ifeval: [],
            json: [],
            code: [],
          },
          avgTTFT: [],
          avgTPS: [],
        };
      }
      const stat = modelStats[id];
      stat.totalScoreSum += run.totalScore;
      stat.count += 1;
      stat.avgTTFT.push(run.avgTTFT);
      stat.avgTPS.push(run.avgTPS);

      // Distribute question results to categories
      run.results.forEach((result) => {
        const question = benchmarkQuestions.find((q: { id: number }) => q.id === result.questionId);
        if (question) {
          stat.categoryScores[question.category].push(result.finalScore);
        }
      });
    });

    // Convert to array and compute averages
    const leaderboard: Array<{
      modelName: string;
      provider: 'lmstudio' | 'custom';
      totalScore: number;
      categoryScores: {
        logic: number;
        math: number;
        ifeval: number;
        json: number;
        code: number;
      };
      avgTTFT: number;
      avgTPS: number;
    }> = [];

    for (const id in modelStats) {
      const stat = modelStats[id];
      const avgTotalScore =
        stat.count > 0 ? Math.round((stat.totalScoreSum / stat.count) * 100) / 100 : 0;
      const categoryScores: Record<string, number> = {};
      for (const cat in stat.categoryScores) {
        const scores = stat.categoryScores[cat as keyof typeof stat.categoryScores];
        categoryScores[cat] =
          scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : 0;
      }
      const avgTTFT =
        stat.avgTTFT.length > 0
          ? Math.round(
              (stat.avgTTFT.reduce((a, b) => a + b, 0) / stat.avgTTFT.length) *
                100
            ) / 100
          : 0;
      const avgTPS =
        stat.avgTPS.length > 0
          ? Math.round(
              (stat.avgTPS.reduce((a, b) => a + b, 0) / stat.avgTPS.length) *
                100
            ) / 100
          : 0;

      leaderboard.push({
        modelName: stat.modelConfig.name,
        provider: stat.modelConfig.provider,
        totalScore: avgTotalScore,
        categoryScores: {
          logic: categoryScores.logic || 0,
          math: categoryScores.math || 0,
          ifeval: categoryScores.ifeval || 0,
          json: categoryScores.json || 0,
          code: categoryScores.code || 0,
        },
        avgTTFT,
        avgTPS,
      });
    }

    // Sort by totalScore descending
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Error generating leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to generate leaderboard' },
      { status: 500 }
    );
  }
}
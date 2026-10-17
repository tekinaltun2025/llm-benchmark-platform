import { NextResponse } from 'next/server';
import { ModelConfig, QuestionResult, BenchmarkRun } from '@/types/benchmark';
import { benchmarkQuestions, deterministicEvaluators } from '@/lib/benchmark-suite';
import {
  callLLMWithStreaming,
  extractThinkingProcess,
  evaluateWithJudge,
} from '@/lib/llm-client';
import { addRun } from '@/lib/db';

// Question IDs that require judge AI evaluation (logic and code)
const QUESTIONS_REQUIRING_JUDGE = new Set([1, 2, 9, 10]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { testModel, judgeModel } = body;

    if (!testModel || !judgeModel) {
      return NextResponse.json(
        { error: 'Missing testModel or judgeModel' },
        { status: 400 }
      );
    }

    // Validate that judgeModel is indeed marked as judge (optional but good)
    if (!judgeModel.isJudge) {
      console.warn('Judge model is not marked as isJudge=true');
    }

    // Step 0: Warm-up ping to testModel (ignore timing)
    try {
      await callLLMWithStreaming(testModel, 'Merhaba', { maxTokens: 5 });
    } catch (warmupError) {
      console.warn('Warm-up ping failed:', warmupError);
      // Continue anyway; maybe the model is already loaded
    }

    const results: QuestionResult[] = [];
    let totalTTFT = 0;
    let totalTPS = 0;

    for (const question of benchmarkQuestions) {
      // Phase 1: Get answer from testModel with streaming
      const llmResult = await callLLMWithStreaming(testModel, question.question);
      // Extract thinking tags from the answer string (if any)
      const { answer: cleanedAnswer, thinkingProcess: thinkingFromTags } = extractThinkingProcess(llmResult.answer);
      // Combine thinking from stream (reasoning_content) and from tags
      const thinkingParts = [llmResult.thinkingProcess, thinkingFromTags].filter(Boolean);
      const thinkingProcess = thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null;

      totalTTFT += llmResult.ttft;
      totalTPS += llmResult.tps;

      // Deterministic evaluation
      const deterministicScore = deterministicEvaluators[question.id - 1](cleanedAnswer);

      let judgeScore: number | null = null;
      let judgeReasoning: string | null = null;

      if (QUESTIONS_REQUIRING_JUDGE.has(question.id)) {
        const judgeResult = await evaluateWithJudge(
          judgeModel,
          question.question,
          cleanedAnswer
        );
        judgeScore = judgeResult.score;
        judgeReasoning = judgeResult.reasoning;
      }

      // Compute final score
      let finalScore: number;
      if (judgeScore !== null) {
        finalScore = Math.round((deterministicScore + judgeScore) / 2);
      } else {
        finalScore = deterministicScore;
      }

      results.push({
        questionId: question.id,
        question: question.question,
        category: question.category,
        rawAnswer: llmResult.answer,
        thinkingProcess,
        finalAnswer: cleanedAnswer,
        deterministicScore,
        judgeScore,
        finalScore,
        judgeReasoning,
        ttft: llmResult.ttft,
        tps: llmResult.tps,
      });
    }

    const totalScore =
      Math.round(
        (results.reduce((sum, r) => sum + r.finalScore, 0) / results.length) *
          100
      ) / 100;
    const avgTTFT = totalTTFT / results.length;
    const avgTPS = totalTPS / results.length;

    const run: BenchmarkRun = {
      id: `${testModel.id}-${Date.now()}`,
      modelConfig: testModel,
      judgeModelConfig: judgeModel,
      timestamp: Date.now(),
      results,
      totalScore,
      avgTTFT,
      avgTPS,
    };

    await addRun(run);

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    console.error('Error running benchmark:', error);
    return NextResponse.json(
      { error: 'Failed to run benchmark' },
      { status: 500 }
    );
  }
}
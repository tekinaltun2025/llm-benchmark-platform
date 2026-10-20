/**
 * Paylaşılan benchmark koşu motoru.
 *
 * Tekil test (/api/benchmark/run) ve toplu test (/api/benchmark/run-all)
 * aynı mantığı kullanır: 4 sütunlu dinamik değerlendirme (dinamik şablonlar,
 * sandbox kod testleri, needle, adversarial baskı) + cevap süresi metriği.
 *
 * Durdurma: Her soru arasında isStopRequested() kontrol edilir; istenmişse
 * koşu "stopped" olayıyla sonlandırılır ve o ana kadarki sonuçlar DB'ye
 * YAZILMAZ (yarım test skoru leaderboard'ı kirletmesin).
 */

import {
  ModelConfig,
  QuestionResult,
  BenchmarkRun,
  BenchmarkQuestion,
  RunProgressEvent,
} from '@/types/benchmark';
import {
  evaluateDeterministic,
  evaluateFormatCompliance,
  evaluateAdversarial,
  requiresJudgeEvaluation,
} from '@/lib/benchmark-suite';
import {
  callLLMWithStreaming,
  extractThinkingProcess,
  evaluateWithJudge,
} from '@/lib/llm-client';
import { evaluateCodeInSandbox } from '@/lib/code-sandbox';
import {
  generateRunQuestions,
  generatePressureMessage,
} from '@/lib/question-generators';
import { addRun, readCustomQuestions } from '@/lib/db';
import { isStopRequested, getStopReason } from '@/lib/benchmark-lock';
import { withRetry, describeError } from '@/lib/retry';

/** Koşu sırasında istemciye gönderilecek olay yazarı. */
export type ProgressEmitter = (event: RunProgressEvent) => void;

/** Koşu sonucu: ya tamamlanmış run ya da durduruldu/hata bilgisi. */
export interface RunOutcome {
  status: 'completed' | 'stopped' | 'error';
  run?: BenchmarkRun;
  error?: string;
}

/**
 * Tek bir modelin tam benchmark koşusunu yürütür.
 *
 * @param testModel  Test edilecek model yapılandırması
 * @param judgeModel Hakem AI modeli
 * @param emit       İlerleme olaylarını yazan fonksiyon (NDJSON satırı üretir)
 */
export async function executeBenchmarkRun(
  testModel: ModelConfig,
  judgeModel: ModelConfig,
  emit: ProgressEmitter
): Promise<RunOutcome> {
  // ─── SÜTUN 1: Bu koşuya özel dinamik soruları üret ──
  // Her koşuda isimler, sayılar ve beklenen cevaplar rastgele üretilir.
  const dynamicQuestions = generateRunQuestions(true);

  // Kullanıcı tanımlı özel sorular da eklenir
  const customQuestions = await readCustomQuestions();
  const allQuestions: BenchmarkQuestion[] = [
    ...dynamicQuestions,
    ...customQuestions,
  ];

  // ─── Adım 0: Warm-up Ping ───────────────────────────────
  emit({
    type: 'phase',
    progress: 2,
    message: `Adım 0: Warm-up — ${testModel.name} modeli VRAM'e yükleniyor...`,
  });

  try {
    await callLLMWithStreaming(testModel, 'Merhaba', {
      maxTokens: 5,
      timeoutMs: 8 * 60 * 1000,
    });
  } catch (warmupError) {
    console.warn('Warm-up ping başarısız (devam ediliyor):', warmupError);
    emit({
      type: 'phase',
      progress: 4,
      message: 'Warm-up ping başarısız oldu, test yine de devam ediyor...',
    });
  }

  // ─── Faz 1: Tüm soruların seri üretimi (telemetri) ───────
  // Bu fazda HİÇBİR puanlama yapılmaz; model VRAM'de sıcak kalır.
  // Adversarial sorularda baskı turu (Tur B) de bu fazda gönderilir.
  const phase1Weight = 60; // toplam ilerlemenin %60'ı
  const rawResults: Array<{
    question: BenchmarkQuestion;
    rawAnswer: string;
    thinkingProcess: string | null;
    finalAnswer: string;
    ttft: number;
    tps: number;
    totalTokens: number;
    generationMs: number;
    /** Toplam cevap süresi (ms) — TTFT + üretim süresi */
    answerDurationMs: number;
    /** Adversarial sorularda baskı turunun (Tur B) cevabı */
    adversarialAnswer?: string;
    adversarialThinking?: string | null;
  }> = [];

  for (let i = 0; i < allQuestions.length; i++) {
    const question = allQuestions[i];

    // ─── Durdurma kontrolü: her soru öncesi ──
    if (isStopRequested()) {
      emit({
        type: 'stopped',
        progress: 0,
        message: `⏹️ Test kullanıcı tarafından durduruldu (${getStopReason() ?? 'sebep belirtilmedi'}). Soru ${i + 1}/${allQuestions.length} — bu koşunun sonuçları kaydedilmedi.`,
      });
      return { status: 'stopped' };
    }

    emit({
      type: 'question',
      progress: 5 + Math.round(((i + 1) / allQuestions.length) * phase1Weight),
      message: `Faz 1: Soru ${i + 1}/${allQuestions.length} soruluyor — ${question.category.toUpperCase()}${question.isDynamic ? ' (dinamik)' : ''}`,
    });

    // Thinking modeller (Qwen3.5 vb.) düşünme süreciyle token tüketir;
    // needle/adversarial'da cevaba ulaşamadan kesilmesin diye cömert limit.
    const maxTokens =
      question.category === 'needle' ? 1024 :
      question.category === 'adversarial' ? 2048 : 4096;

    // Cevap üretimi: ağ hatası / geçici kesinti olursa en fazla 3 kez dene.
    // Her başarısız denemede 'retry' olayı emit edilir; 3 deneme de
    // başarısız olursa hata yukarı fırlar ve koşu error ile biter.
    const llmResult = await withRetry(
      () => callLLMWithStreaming(testModel, question.question, { maxTokens }),
      {
        maxAttempts: 3,
        delayMs: 3000,
        onRetry: ({ attempt, maxAttempts, error, nextDelayMs }) => {
          emit({
            type: 'retry',
            progress: 5 + Math.round(((i + 1) / allQuestions.length) * phase1Weight),
            message: `⚠️ Soru ${i + 1} cevabı alınamadı (deneme ${attempt}/${maxAttempts}): ${describeError(error)}. ${nextDelayMs / 1000} saniye sonra tekrar denenecek...`,
          });
        },
      }
    );

    // <think> etiketlerini ve reasoning_content'i ayır
    const { answer: cleanedAnswer, thinkingProcess: thinkingFromTags } =
      extractThinkingProcess(llmResult.answer);
    const thinkingParts = [
      llmResult.thinkingProcess,
      thinkingFromTags,
    ].filter(Boolean) as string[];
    const thinkingProcess =
      thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null;

    // Toplam cevap süresi: istek gönderiminden son token'a kadar
    const answerDurationMs = llmResult.ttft + llmResult.generationMs;

    const raw: (typeof rawResults)[number] = {
      question,
      rawAnswer: llmResult.answer,
      thinkingProcess,
      finalAnswer: cleanedAnswer,
      ttft: llmResult.ttft,
      tps: llmResult.tps,
      totalTokens: llmResult.tokenCount,
      generationMs: llmResult.generationMs,
      answerDurationMs,
    };

    // ─── SÜTUN 4: Adversarial baskı turu (Tur B) ──
    // Model doğru cevabı verdikten hemen sonra, aynı sohbette
    // yanlış bir değer öne sürülerek baskı yapılır. Modelin kendi
    // mantığına sadık kalıp kalmadığı ölçülür.
    if (question.category === 'adversarial' && question.evaluationParams) {
      emit({
        type: 'phase',
        progress: 5 + Math.round(((i + 1) / allQuestions.length) * phase1Weight),
        message: `Faz 1: Soru ${i + 1} — baskı turu (sycophancy testi) gönderiliyor...`,
      });

      const pressureMessage = generatePressureMessage(
        question.evaluationParams,
        cleanedAnswer
      );

      try {
        // Multi-turn: Tur A sorusu + model cevabı + baskı mesajı
        const pressureResult = await callLLMWithStreaming(
          testModel,
          [
            { role: 'user', content: question.question },
            { role: 'assistant', content: cleanedAnswer },
            { role: 'user', content: pressureMessage },
          ],
          { maxTokens: 2048 }
        );

        const { answer: pressureClean } =
          extractThinkingProcess(pressureResult.answer);
        raw.adversarialAnswer = pressureClean;
        raw.adversarialThinking = pressureResult.thinkingProcess ?? null;
      } catch (pressureError) {
        console.warn('Baskı turu başarısız:', pressureError);
        raw.adversarialAnswer = undefined;
      }
    }

    rawResults.push(raw);
  }

  // ─── Faz 2: Çok Katmanlı Puanlama ──────────────────────
  // Deterministik + Sandbox + Hakem AI + Biçim Disiplini
  const results: QuestionResult[] = [];
  const judgeQuestions = allQuestions.filter((q) => requiresJudgeEvaluation(q));
  let judgeIndex = 0;
  let formatCompliantCount = 0;
  let formatEligibleCount = 0;

  for (let i = 0; i < allQuestions.length; i++) {
    const raw = rawResults[i];
    const question = raw.question;

    // ─── Durdurma kontrolü: değerlendirme sırasında da ──
    if (isStopRequested()) {
      emit({
        type: 'stopped',
        progress: 0,
        message: `⏹️ Test kullanıcı tarafından durduruldu (${getStopReason() ?? 'sebep belirtilmedi'}). Değerlendirme fazında durduruldu — sonuçlar kaydedilmedi.`,
      });
      return { status: 'stopped' };
    }

    emit({
      type: 'phase',
      progress: 65 + Math.round(((i + 1) / allQuestions.length) * 30),
      message: `Faz 2: Soru ${i + 1}/${allQuestions.length} değerlendiriliyor...`,
    });

    // ─── Biçim Disiplini (Sütun: metrik paneli) ──
    const formatCompliant = evaluateFormatCompliance(question, raw.finalAnswer);
    formatEligibleCount++;
    if (formatCompliant) formatCompliantCount++;

    // ─── Deterministik kontrol (instance-aware) ──
    let deterministicScore = evaluateDeterministic(question, raw.finalAnswer);

    // ─── SÜTUN 2: Sandbox değerlendirmesi (kod soruları) ──
    let sandboxTests: QuestionResult['sandboxTests'] | undefined;
    if (question.category === 'code' && question.evaluationParams?.functionName) {
      const fnName = String(question.evaluationParams.functionName);
      emit({
        type: 'phase',
        progress: 65 + Math.round(((i + 1) / allQuestions.length) * 30),
        message: `Faz 2: Soru ${i + 1} sandbox'ta gizli unit testlerle çalıştırılıyor (${fnName})...`,
      });
      const sandboxResult = evaluateCodeInSandbox(fnName, raw.finalAnswer);
      sandboxTests = sandboxResult.tests;
      // Sandbox puanı deterministik ön kontrolü ezer:
      // testleri geçen oranda puan verilir.
      deterministicScore = sandboxResult.score;
    }

    // ─── SÜTUN 4: Adversarial direnç puanlaması ──
    let resistanceScore: number | null = null;
    if (question.category === 'adversarial' && question.evaluationParams) {
      const expected = question.evaluationParams.expected as number;
      if (raw.adversarialAnswer !== null && raw.adversarialAnswer !== undefined) {
        const adversarialResult = evaluateAdversarial(
          raw.finalAnswer,
          raw.adversarialAnswer,
          expected
        );
        resistanceScore = adversarialResult.resistanceScore;
        deterministicScore = adversarialResult.score;
      } else {
        // Baskı turu gönderilemediyse yalnızca ilk cevabı puanla
        resistanceScore = null;
      }
    }

    // ─── Hakem AI (hibrit sorular) ──
    let judgeScore: number | null = null;
    let judgeReasoning: string | null = null;

    if (requiresJudgeEvaluation(question)) {
      judgeIndex++;
      emit({
        type: 'judge',
        progress:
          65 +
          Math.round(((i + 1) / allQuestions.length) * 30) +
          Math.round((judgeIndex / (judgeQuestions.length + 1)) * 2),
        message: `Faz 2: Hakem AI (${judgeModel.name}) soru ${i + 1} için değerlendiriyor...`,
      });

      // Dinamik sorularda hakeme doğru cevap da iletilir —
      // rastgele sayıları hakemin ezberden bilmesi mümkün değil.
      // Hakem AI değerlendirmesi: evaluateWithJudge null dönerse (JSON
      // çözümlenemedi / ağ hatası) hata olarak sar ve en fazla 3 kez dene.
      // 3 deneme de başarısız olursa koşu ÖLMEZ: judgeScore null kalır ve
      // deterministik puan tek başına geçerli olur (puanı düşürme politikası).
      let judgeResult: { score: number; reasoning: string } | null = null;
      try {
        judgeResult = await withRetry(
          async () => {
            const result = await evaluateWithJudge(
              judgeModel,
              question.question,
              raw.finalAnswer,
              question.expectedAnswer ?? undefined
            );
            if (result === null) {
              throw new Error(
                'Hakem AI geçerli bir puan döndüremedi (JSON çıktısı çözümlenemedi)'
              );
            }
            return result;
          },
          {
            maxAttempts: 3,
            delayMs: 3000,
            onRetry: ({ attempt, maxAttempts, error, nextDelayMs }) => {
              emit({
                type: 'retry',
                progress:
                  65 +
                  Math.round(((i + 1) / allQuestions.length) * 30) +
                  Math.round((judgeIndex / (judgeQuestions.length + 1)) * 2),
                message: `⚠️ Hakem AI soru ${i + 1} için değerlendirme yapamadı (deneme ${attempt}/${maxAttempts}): ${describeError(error)}. ${nextDelayMs / 1000} saniye sonra tekrar denenecek...`,
              });
            },
          }
        );
      } catch (judgeRetryError) {
        console.warn(
          `Hakem AI soru ${i + 1} için 3 denemede de başarısız:`,
          judgeRetryError
        );
        emit({
          type: 'phase',
          progress:
            65 +
            Math.round(((i + 1) / allQuestions.length) * 30) +
            Math.round((judgeIndex / (judgeQuestions.length + 1)) * 2),
          message: `ℹ️ Hakem AI soru ${i + 1} için 3 denemede de başarısız oldu — bu soru deterministik puanla değerlendirilecek.`,
        });
        judgeResult = null;
      }
      // Hakem başarısızsa (null) puanı düşürme: deterministik puan geçerli
      if (judgeResult) {
        judgeScore = judgeResult.score;
        judgeReasoning = judgeResult.reasoning;
      } else {
        judgeScore = null;
        judgeReasoning = null;
      }
    }

    // Nihai puan: Hakem puanı varsa deterministik + hakem ortalaması,
    // yoksa deterministik puan
    const finalScore =
      judgeScore !== null
        ? Math.round((deterministicScore + judgeScore) / 2)
        : deterministicScore;

    results.push({
      questionId: question.id,
      question: question.question,
      category: question.category,
      rawAnswer: raw.rawAnswer,
      thinkingProcess: raw.thinkingProcess,
      finalAnswer: raw.finalAnswer,
      deterministicScore,
      judgeScore,
      judgeReasoning,
      finalScore,
      formatCompliant,
      sandboxTests,
      resistanceScore: resistanceScore ?? undefined,
      adversarialAnswer: raw.adversarialAnswer ?? undefined,
      ttft: raw.ttft,
      tps: raw.tps,
      totalTokens: raw.totalTokens,
      generationMs: raw.generationMs,
      answerDurationMs: raw.answerDurationMs,
    });
  }

  // ─── Toplam metrikler ve kayıt ──────────────────────────
  const totalScore =
    Math.round(
      (results.reduce((sum, r) => sum + r.finalScore, 0) / results.length) *
        100
    ) / 100;
  const avgTTFT =
    Math.round(
      (results.reduce((sum, r) => sum + r.ttft, 0) / results.length) * 100
    ) / 100;
  const avgTPS =
    Math.round(
      (results.reduce((sum, r) => sum + r.tps, 0) / results.length) * 100
    ) / 100;
  // Ortalama toplam cevap süresi (ms) — değerlendirme kriteri
  const avgAnswerDurationMs =
    Math.round(
      (results.reduce((sum, r) => sum + r.answerDurationMs, 0) /
        results.length) *
        100
    ) / 100;

  // Biçim Disiplini: istenen formatı ilk denemede tutturan soru oranı
  const formatDiscipline =
    formatEligibleCount > 0
      ? Math.round((formatCompliantCount / formatEligibleCount) * 100)
      : 100;

  const run: BenchmarkRun = {
    id: `run-${Date.now()}`,
    modelConfig: testModel,
    judgeModelConfig: judgeModel,
    totalScore,
    avgTTFT,
    avgTPS,
    avgAnswerDurationMs,
    formatDiscipline,
    results,
    timestamp: Date.now(),
  };

  // "En son test geçerli" politikası: aynı modelin eski koşuları
  // addRun içinde otomatik silinir.
  await addRun(run);

  return { status: 'completed', run };
}

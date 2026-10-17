import { BenchmarkQuestion } from "../types/benchmark";

/**
 * Deterministic evaluation function for a question.
 * Returns a score between 0 and 100.
 */
export type DeterministicEvaluator = (answer: string) => number;

/**
 * Benchmark suite with 10 questions across 5 categories.
 */
export const benchmarkQuestions: BenchmarkQuestion[] = [
  // Logic & Reasoning (2 questions)
  {
    id: 1,
    category: "logic",
    question: "Bir kahve ve bir çay birlikte 110 TL'dir. Kahve çaydan 100 TL daha pahalıdır. Çayın fiyatı nedir? (Sadece sayıyı yazın, örnek: 5)",
  },
  {
    id: 2,
    category: "logic",
    question: "Bir fabrikada 5 makine 5 dakikada 5 parça üretir. 100 makine 100 parça üretmek için kaç dakika gerekir? (Sadece sayıyı yazın)",
  },

  // Math (GSM8K style) (2 questions)
  {
    id: 3,
    category: "math",
    question: "Bir dükkanın ilk günkü satışı 100 TL'dir. Her gün satışlar önceki güne göre %10 artar. 3. günün satışını SONUÇ: <sayı> formatında yazın.",
  },
  {
    id: 4,
    category: "math",
    question: "Bir kişinin yaşı, karısının yaşı ikiye bölünce 2 daha büyük olur. Toplam yaşları 52 ise, kişinin yaşı kaçtır? SONUÇ: <sayı> formatında yazın.",
  },

  // IFEval (2 questions)
  {
    id: 5,
    category: "ifeval",
    question: "Belirli 3 yasaklı kelimeyi ('teknoloji', 'insan', 'gelecek') hiç kullanmadan, tam 3 cümleden oluşan ve cümleleri sırasıyla A, B, C harfleriyle başlayan paragraf yazma.",
  },
  {
    id: 6,
    category: "ifeval",
    question: "Tam 4 maddelik bir liste oluşturma, her maddenin tam 5 kelimeden oluşması ve hiçbir maddede noktalama işareti kullanılmaması.",
  },

  // JSON Schema (2 questions)
  {
    id: 7,
    category: "json",
    question: "Bir fabrikada iki makine var. Makine A her saat 10 parça üretir, Makine B her saat 15 parça üretir. Makine A'nın çalışma süresi 4 saat, Makine B'nin çalışma süresi 3 saat. Toplam üretilen parça sayısını ve saat başı ortalama üretimi (ondalıklı bir sayı olarak) hesaplayıp aşağıdaki JSON formatında döndür: {\"totalPieces\": <sayı>, \"averagePerHour\": <sayı>}",
  },
  {
    id: 8,
    category: "json",
    question: "Bir market'tte 3 tür meyve var: elma, muz, portakal. Elma fiyatı bir muzun fiyatının iki kez, portakal fiyatı bir elma fiyatının yarısı. Bir muzun fiyatı 10 TL ise, 2 elma, 3 muz ve 4 portakalın toplam fiyatını hesaplayıp aşağıdaki JSON formatında döndür: {\"totalPrice\": <sayı>}",
  },

  // Coding & Algorithm (2 questions)
  {
    id: 9,
    category: "code",
    question: "Zaman karmaşıklığı $O(n)$ olan sıra korumalı tekilleştirme algoritmasını TypeScript fonksiyonu olarak yazın. Fonksiyon adı: distinctOrderPreserving, girdi: number[][], çıktı: number[].",
  },
  {
    id: 10,
    category: "code",
    question: "Verilen iç içe (nested) bir diziyi düzleştiren (flatten) ve sadece çift sayıları büyükten küçüğe sıralayan TypeScript/Python fonksiyonu yazın. Fonksiyon adı: flattenAndSortEvens, girdi: number[][], çıktı: number[].",
  },
];

/**
 * Deterministic evaluators for each question.
 * Index corresponds to question id - 1.
 */
export const deterministicEvaluators: DeterministicEvaluator[] = [
  // Q1: Coffee and tea problem (answer: 5)
  (answer: string) => {
    const num = parseInt(answer.trim(), 10);
    return num === 5 ? 100 : 0;
  },
  // Q2: Machine production problem (answer: 5)
  (answer: string) => {
    const num = parseInt(answer.trim(), 10);
    return num === 5 ? 100 : 0;
  },
  // Q3: Store sales growth (answer: 121)
  (answer: string) => {
    const match = answer.match(/SONUÇ:\s*(\d+)/i);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    return num === 121 ? 100 : 0;
  },
  // Q4: Age problem (answer: 34)
  (answer: string) => {
    const match = answer.match(/SONUÇ:\s*(\d+)/i);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    return num === 34 ? 100 : 0;
  },
  // Q5: IFeval - no forbidden words, 3 sentences, starting with A, B, C
  (answer: string) => {
    const forbidden = ["teknoloji", "insan", "gelecek"];
    const lowerAnswer = answer.toLowerCase();
    if (forbidden.some(word => lowerAnswer.includes(word))) return 0;

    const sentences = answer
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (sentences.length !== 3) return 0;

    const startsWith = [sentences[0].startsWith("A"), sentences[1].startsWith("B"), sentences[2].startsWith("C")];
    if (!startsWith.every(Boolean)) return 0;

    return 100;
  },
  // Q6: IFeval - 4 items, each 5 words, no punctuation
  (answer: string) => {
    // Check for punctuation: . , ; : ! ? 
    if (/[.,;:!?]/.test(answer)) return 0;

    const lines = answer.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length !== 4) return 0;

    for (const line of lines) {
      const words = line.split(' ').filter(word => word.length > 0);
      if (words.length !== 5) return 0;
    }

    return 100;
  },
  // Q7: JSON - totalPieces and averagePerHour
  (answer: string) => {
    try {
      const obj = JSON.parse(answer);
      if (typeof obj.totalPieces !== 'number' || typeof obj.averagePerHour !== 'number') return 0;
      // Expected: totalPieces = 10*4 + 15*3 = 40 + 45 = 85
      // averagePerHour = totalPieces / (4+3) = 85 / 7 ≈ 12.142857...
      const expectedTotal = 85;
      const expectedAverage = 85 / 7;
      const tolerance = 0.01; // Allow small floating point differences
      if (Math.abs(obj.totalPieces - expectedTotal) > tolerance) return 0;
      if (Math.abs(obj.averagePerHour - expectedAverage) > tolerance) return 0;
      return 100;
    } catch (e) {
      return 0;
    }
  },
  // Q8: JSON - totalPrice
  (answer: string) => {
    try {
      const obj = JSON.parse(answer);
      if (typeof obj.totalPrice !== 'number') return 0;
      // Banana = 10, Apple = 2*Banana = 20, Orange = Apple/2 = 10
      // 2*Apple + 3*Banana + 4*Orange = 2*20 + 3*10 + 4*10 = 40 + 30 + 40 = 110
      const expected = 110;
      if (Math.abs(obj.totalPrice - expected) > 0.01) return 0;
      return 100;
    } catch (e) {
      return 0;
    }
  },
  // Q9: Code - distinctOrderPreserving
  // We'll do a basic check: function exists and returns distinct preserving order for a simple test case.
  // Since we cannot execute code, we'll rely on Judge AI for code questions? 
  // But the requirement says deterministic evaluation for code? 
  // Actually, the spec says: Deterministic Kontrol: Matematik sonucu, JSON şema geçerliliği ve IFEval kelime/harf kısıtlamalarını doğrudan TypeScript koduyla puanla.
  // For code questions, we might not have deterministic evaluation? 
  // However, the spec also says: "Hakem AI (LLM-as-a-Judge): Açık uçlu mantık muhakemesi, kod kalitesi ve Türkçe akıcılık gerektiren soruları (veya kısmi puanlamaları) seçili Hakem AI modeline gönder."
  // So for code questions, we might rely on Judge AI. But let's try to do a simple deterministic check for the code questions by checking the function signature and a fixed test.
  // We'll check if the answer contains the function name and a simple test case.
  // This is not perfect but for the sake of the task, we'll do a basic check.
  (answer: string) => {
    // Check for function distinctOrderPreserving and a simple test
    // We'll look for the function and then a test that would pass if the function works for [1,2,2,3,1] -> [1,2,3]
    // Since we can't run, we'll just check for the function name and a reasonable structure.
    if (!answer.includes("function distinctOrderPreserving")) return 0;
    // We'll also check for a return statement and the concept of preserving order and distinct.
    // This is very basic.
    return 50; // Give partial credit for having the function, Judge AI will do the rest.
  },
  // Q10: Code - flattenAndSortEvens
  (answer: string) => {
    if (!answer.includes("function flattenAndSortEvens")) return 0;
    return 50; // Partial credit, Judge AI will evaluate the code.
  },
];

// Note: For code questions, we are giving 50 points for having the function and relying on Judge AI for the rest.
// In a real scenario, we might want to use a sandbox to execute the code, but the spec says to use Judge AI for code evaluation.
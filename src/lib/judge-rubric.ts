/**
 * Judge Değerlendirme Rubrikleri
 * Kodlama benchmark için 4 kriterlik özel rubrik + genel/Türkçe için mevcut rubrik
 */

import { CodingLevel } from "../types/benchmark";

/** Kodlama Judge Rubriği — 4 Kriter, 100 Puan */
export const CODING_JUDGE_RUBRIC = {
  criteria: [
    {
      key: 'correctness',
      weight: 30,
      label: 'Doğruluk (Correctness)',
      description: 'Tüm fonksiyonel gereksinimler karşılanmış mı? Placeholder/eksik kod/yapılmamış kısım yok mu?',
      scoringGuide: {
        30: 'Tüm gereksinimler eksiksiz karşılanmış, kod tam çalışır durumda',
        20: 'Ana gereksinimler karşılanmış, küçük eksikler/placeholder var',
        10: 'Temel yapı var ama önemli gereksinimler eksik',
        0: 'Gereksinimlerin çoğu karşılanmamış veya kod çalışmıyor',
      },
    },
    {
      key: 'edgeCasesSafety',
      weight: 25,
      label: 'Kenar Durumlar ve Güvenlik (Edge Cases & Safety)',
      description: 'Thread safety, deadlock, race condition, memory leak, sınır değerler, boş/geçersiz girdi handling',
      scoringGuide: {
        25: 'Tüm kenar durumlar ele alınmış, thread-safe, memory leak yok, sınır değerler test edilmiş',
        15: 'Temel kenar durumlar var ama race condition/memory leak riski olabilir',
        5: 'Sadece happy path çalışıyor, hata/kenar durumu handling yok',
        0: 'Hiçbir güvenlik önlemi yok, açıkça hatalı/tehlikeli kod',
      },
    },
    {
      key: 'architectureCleanCode',
      weight: 25,
      label: 'Mimari ve Temiz Kod (Architecture & Clean Code)',
      description: 'Type hints, modülerlik, stdlib kullanımı, O(1) karmaşıklık, SOLID prensipleri, okunabilirlik',
      scoringGuide: {
        25: 'Mükemmel mimari: modüler, type-safe, stdlib optimal kullanım, O(1) karmaşıklık, self-documenting',
        15: 'İyi mimari: modüler ve okunabilir, küçük type/karmaşıklık eksiklikleri',
        5: 'Çalışır ama spaghetti kod, type yok, O(n²) veya daha kötü karmaşıklık',
        0: 'Karmaşık, okunamaz, anti-patternler, yanlış veri yapıları',
      },
    },
    {
      key: 'errorHandling',
      weight: 20,
      label: 'Hata Yönetimi (Error Handling)',
      description: 'Exception handling sağlamlığı, beklenmedik durumlarda güvenli fail, graceful degradation',
      scoringGuide: {
        20: 'Kapsamlı error handling: try/catch, custom error types, graceful shutdown, retry logic',
        12: 'Temel try/catch var, ama custom error/retry/graceful shutdown eksik',
        5: 'Sadece console.error veya hiç hata yakalama yok',
        0: 'Hata durumunda crash, unhandled rejection, veri kaybı riski',
      },
    },
  ],
  totalWeight: 100,
  outputSchema: {
    type: 'object',
    properties: {
      total_score: { type: 'number', minimum: 0, maximum: 100, description: 'Toplam puan (0-100)' },
      breakdown: {
        type: 'object',
        properties: {
          correctness: { type: 'number', minimum: 0, maximum: 30 },
          edge_cases_safety: { type: 'number', minimum: 0, maximum: 25 },
          architecture_clean_code: { type: 'number', minimum: 0, maximum: 25 },
          error_handling: { type: 'number', minimum: 0, maximum: 20 },
        },
        required: ['correctness', 'edge_cases_safety', 'architecture_clean_code', 'error_handling'],
        additionalProperties: false,
      },
      strengths: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Güçlü yönler (madde madde)' 
      },
      critical_flaws: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Kritik hatalar/eksiklikler (madde madde)' 
      },
      verdict: { 
        type: 'string', 
        enum: ['Üretim ortamına hazır', 'Düzeltme gerekli', 'Başarısız'],
        description: 'Genel hüküm' 
      },
    },
    required: ['total_score', 'breakdown', 'strengths', 'critical_flaws', 'verdict'],
    additionalProperties: false,
  },
} as const;

/** Genel Judge Rubriği (mevcut sistem - logic, math, ifeval, json, needle, adversarial) */
export const GENERAL_JUDGE_RUBRIC = {
  criteria: [
    {
      key: 'accuracy',
      weight: 40,
      label: 'Doğruluk',
      description: 'Cevap faktüel olarak doğru mu? Mantıksal tutarlılık var mı?',
    },
    {
      key: 'completeness',
      weight: 25,
      label: 'Kapsamlılık',
      description: 'Sorunun tüm bölümleri cevaplandı mı? Eksik kısım var mı?',
    },
    {
      key: 'reasoning_quality',
      weight: 20,
      label: 'Muhakeme Kalitesi',
      description: 'Adım adım mantık, kanıt, açıklama kalitesi',
    },
    {
      key: 'format_compliance',
      weight: 15,
      label: 'Format Uyumu',
      description: 'İstenen format (JSON, etiket, liste) takip edilmiş mi?',
    },
  ],
  totalWeight: 100,
  outputSchema: {
    type: 'object',
    properties: {
      total_score: { type: 'number', minimum: 0, maximum: 100 },
      breakdown: {
        type: 'object',
        properties: {
          accuracy: { type: 'number', minimum: 0, maximum: 40 },
          completeness: { type: 'number', minimum: 0, maximum: 25 },
          reasoning_quality: { type: 'number', minimum: 0, maximum: 20 },
          format_compliance: { type: 'number', minimum: 0, maximum: 15 },
        },
        required: ['accuracy', 'completeness', 'reasoning_quality', 'format_compliance'],
      },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string', enum: ['Mükemmel', 'İyi', 'Orta', 'Zayıf', 'Başarısız'] },
    },
    required: ['total_score', 'breakdown', 'strengths', 'weaknesses', 'verdict'],
  },
} as const;

/** Türkçe Judge Rubriği (dil kalitesi odaklı) */
export const TURKISH_JUDGE_RUBRIC = {
  criteria: [
    {
      key: 'linguistic_accuracy',
      weight: 35,
      label: 'Dilbilgisel Doğruluk',
      description: 'Yazım, imla, dilbilgisi, ek kullanımı, cümle yapısı doğru mu?',
    },
    {
      key: 'semantic_accuracy',
      weight: 30,
      label: 'Anlamsal Doğruluk',
      description: 'Anlam doğru mu? Deyim/terim doğru kullanılmış mı? Anlam kayması var mı?',
    },
    {
      key: 'expression_quality',
      weight: 20,
      label: 'İfade Kalitesi',
      description: 'Akıcılık, kelime zenginliği, cümle çeşitliliği, edebi kalite',
    },
    {
      key: 'format_compliance',
      weight: 15,
      label: 'Format Uyumu',
      description: 'İstenen etiket formatı (DÜZELTME:, ANLAM:, ÖZET: vb.) takip edilmiş mi?',
    },
  ],
  totalWeight: 100,
  outputSchema: {
    type: 'object',
    properties: {
      total_score: { type: 'number', minimum: 0, maximum: 100 },
      breakdown: {
        type: 'object',
        properties: {
          linguistic_accuracy: { type: 'number', minimum: 0, maximum: 35 },
          semantic_accuracy: { type: 'number', minimum: 0, maximum: 30 },
          expression_quality: { type: 'number', minimum: 0, maximum: 20 },
          format_compliance: { type: 'number', minimum: 0, maximum: 15 },
        },
        required: ['linguistic_accuracy', 'semantic_accuracy', 'expression_quality', 'format_compliance'],
      },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      verdict: { type: 'string', enum: ['Mükemmel', 'İyi', 'Orta', 'Zayıf', 'Başarısız'] },
    },
    required: ['total_score', 'breakdown', 'strengths', 'weaknesses', 'verdict'],
  },
} as const;

/** Kategori bazlı rubrik seçici */
export function getJudgeRubricForCategory(category: string) {
  switch (category) {
    case 'coding':
      return CODING_JUDGE_RUBRIC;
    case 'turkish_general':
      return TURKISH_JUDGE_RUBRIC;
    default:
      return GENERAL_JUDGE_RUBRIC;
  }
}

/** Judge prompt şablonu oluşturucu */
export function buildJudgePrompt(
  question: string,
  answer: string,
  referenceAnswer: string | undefined,
  category: string
): string {
  const rubric = getJudgeRubricForCategory(category);
  const criteriaList = rubric.criteria.map(c => 
    `- **${c.label} (${c.weight} puan)**: ${c.description}`
  ).join('\n');

  const outputSchema = JSON.stringify(rubric.outputSchema, null, 2);

  return `Sen bir **AI Hakem (Judge)** modelisin. Aşağıdaki soruya verilen cevabı, verilen kriterlere göre **kesin ve objektif** bir şekilde değerlendir.

## SORU
${question}

## MODEL CEVABI
${answer}

${referenceAnswer ? `## BEKLENEN CEVAP / REFERANS
${referenceAnswer}` : ''}

## DEĞERLENDİRME KRİTERLERİ
${criteriaList}

## ÇIKTI FORMATI (KESİNLİKLE BU JSON ŞEMASINA UY)
\`\`\`json
${outputSchema}
\`\`\`

## ÖNEMLİ KURALLAR
1. **Sadece JSON** çıktısı ver, açıklama/markdown YAZMA
2. Her kriter için puanını **weight** sınırında ver (ör. correctness max 30)
3. \`total_score\` = breakdown toplamı olmalı (0-100)
4. \`strengths\` ve \`critical_flaws\`/\`weaknesses\` en az 1 madde olmalı
5. \`verdict\` enum değerlerinden BİRİ olmalı
6. **Kodlama (coding) kategorisinde**: Sandbox test sonuçları varsa onları da dikkate al (passed testler = correctness artırır)
7. **Türkçe (turkish_general) kategorisinde**: Dilbilgisel hataları cezalandır, format etiketlerini (DÜZELTME:, ANLAM:, ÖZET:) kontrol et
8. **Genel kategorilerde**: Format compliance (JSON, liste, etiket) 15 puanlık kriterdir

Değerlendirmeyi yap:`;
}

/** Judge sonucunu parse et ve doğrula */
export function parseJudgeResult(rawOutput: string, category: string): {
  total_score: number;
  breakdown: Record<string, number>;
  strengths: string[];
  critical_flaws: string[];
  verdict: string;
} | null {
  try {
    // JSON bloğunu çıkar (markdown code block içinde olabilir)
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const rubric = getJudgeRubricForCategory(category);
    
    // Şema doğrulama
    if (typeof parsed.total_score !== 'number' || 
        parsed.total_score < 0 || parsed.total_score > 100) {
      return null;
    }
    
    if (!parsed.breakdown || typeof parsed.breakdown !== 'object') {
      return null;
    }
    
    // Breakdown toplamı total_score'a yakın mı? (±5 tolerans)
    const breakdownValues = Object.values(parsed.breakdown) as unknown[];
    const breakdownSum = breakdownValues.reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0);
    if (Math.abs(breakdownSum - parsed.total_score) > 5) {
      // Toplamı düzelt
      parsed.total_score = Math.round(breakdownSum);
    }
    
    // Verdict enum kontrolü
    const validVerdicts = rubric.outputSchema.properties.verdict.enum;
    if (!validVerdicts.includes(parsed.verdict)) {
      // Otomatik map et
      if (parsed.total_score >= 80) parsed.verdict = validVerdicts[0];
      else if (parsed.total_score >= 60) parsed.verdict = validVerdicts[1];
      else if (parsed.total_score >= 40) parsed.verdict = validVerdicts[2];
      else if (parsed.total_score >= 20) parsed.verdict = validVerdicts[3];
      else parsed.verdict = validVerdicts[4];
    }
    
    // Arrays kontrolü
    parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
    parsed.critical_flaws = Array.isArray(parsed.critical_flaws) ? parsed.critical_flaws : 
                           (Array.isArray(parsed.weaknesses) ? parsed.weaknesses : []);
    
    return {
      total_score: parsed.total_score,
      breakdown: parsed.breakdown,
      strengths: parsed.strengths,
      critical_flaws: parsed.critical_flaws,
      verdict: parsed.verdict,
    };
  } catch {
    return null;
  }
}
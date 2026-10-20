import { ModelConfig } from "../types/benchmark";

/** Sohbet mesajı — multi-turn (adversarial baskı turu) için. */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Streaming LLM çağrısının sonucu: cevap, düşünme süreci ve hız metrikleri. */
export interface LLMStreamResult {
  answer: string;
  thinkingProcess?: string;
  /** İlk anlamlı token gelene kadar geçen süre (ms) */
  ttft: number;
  /** Üretim hızı: saniyede token (TPS) */
  tps: number;
  /** Üretilen toplam token sayısı (yaklaşık) */
  tokenCount: number;
  /** Toplam üretim süresi (ms) — ilk tokendan akış sonuna kadar */
  generationMs: number;
}

/** Varsayılan istek zaman aşımı: 10 dakika (LM Studio model yükleme ve
 * yavaş thinking modellerin uzun üretimleri dahil). */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Base URL'in sonundaki eğik çizgiyi temizler.
 */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * OpenAI uyumlu /chat/completions uç noktasına streaming istek atar.
 * TTFT ve TPS metriklerini ölçer; <think> etiketlerini ve
 * reasoning_content alanını ayrıştırır.
 *
 * @param modelConfig Model yapılandırması (baseUrl, apiKey, modelId)
 * @param prompt Kullanıcı istemi
 * @param options maxTokens ve timeoutMs ayarları
 */
export async function callLLMWithStreaming(
  modelConfig: ModelConfig,
  prompt: string | ChatMessage[],
  options?: { maxTokens?: number; timeoutMs?: number; temperature?: number }
): Promise<LLMStreamResult> {
  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let fullAnswer = "";
  let thinkingProcess = "";

  // Multi-turn: prompt bir mesaj dizisiyse doğrudan kullan (sycophancy turu),
  // tek string ise tek kullanıcılı sohbete sar.
  const messages: ChatMessage[] =
    typeof prompt === "string"
      ? [{ role: "user", content: prompt }]
      : prompt;

  const requestBody = {
    model: modelConfig.modelId,
    messages,
    stream: true,
    temperature: options?.temperature ?? 0.1,
    max_tokens: options?.maxTokens ?? 2048,
  };

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${normalizeBaseUrl(modelConfig.baseUrl)}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(modelConfig.apiKey
            ? { Authorization: `Bearer ${modelConfig.apiKey}` }
            : {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `LLM isteği başarısız (HTTP ${response.status}): ${errorText.slice(0, 200)}`
      );
    }

    if (!response.body) {
      throw new Error("Yanıt gövdesi okunamıyor (stream desteklenmiyor olabilir)");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Tamamlanmamış satırı buffer'da tut

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const content: string = delta?.content ?? "";
          // Bazı sağlayıcılar düşünmeyi ayrı alanda gönderir (ör. DeepSeek R1)
          const reasoning: string = delta?.reasoning_content ?? "";

          if (content || reasoning) {
            if (firstTokenTime === null) {
              firstTokenTime = Date.now();
            }
            if (content) {
              fullAnswer += content;
              // Yaklaşık token sayısı: 1 token ≈ 4 karakter
              tokenCount += Math.max(1, Math.ceil(content.length / 4));
            }
            if (reasoning) {
              thinkingProcess += reasoning;
            }
          }
        } catch {
          // Tekil chunk JSON hatası akışı bozmasın
        }
      }
    }

    const endTime = Date.now();
    const ttft = firstTokenTime !== null ? firstTokenTime - startTime : 0;

    // TPS: ilk tokendan sonra geçen üretim süresine göre hesaplanır.
    // İlk token hiç gelmediyse 0 döner.
    const generationMs =
      firstTokenTime !== null ? endTime - firstTokenTime : 0;
    const tps = generationMs > 0 ? tokenCount / (generationMs / 1000) : 0;

    return {
      answer: fullAnswer,
      thinkingProcess: thinkingProcess || undefined,
      ttft,
      tps,
      tokenCount,
      generationMs,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Cevap metnindeki  bloklarını ayıklar.
 * Düşünme metnini ayrı, temiz nihai cevabı ayrı döner.
 * Birden fazla think bloğu varsa hepsi toplanır.
 */
export function extractThinkingProcess(answer: string): {
  answer: string;
  thinkingProcess?: string;
} {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  const matches = [...answer.matchAll(thinkRegex)];

  if (matches.length === 0) {
    return { answer: answer.trim(), thinkingProcess: undefined };
  }

  const thinkingParts = matches.map((m) => m[1].trim()).filter(Boolean);
  const cleanedAnswer = answer.replace(thinkRegex, "").trim();

  return {
    answer: cleanedAnswer,
    thinkingProcess: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : undefined,
  };
}

/**
 * Hakem AI (LLM-as-a-Judge) değerlendirmesi.
 * Hakem modele soru + cevabı gönderir ve
 * {"score": 0-100, "reasoning": "..."} formatında JSON çıktı alır.
 */
export async function evaluateWithJudge(
  judgeConfig: ModelConfig,
  question: string,
  answer: string,
  referenceAnswer?: string
): Promise<{ score: number; reasoning: string } | null> {
  // Dinamik sorularda doğru cevap her koşuda rastgele üretilir; hakeme
  // referans olarak iletilir — aksi halde rastgele sayıları bilemez.
  const referenceSection = referenceAnswer
    ? `\nBilinen Doğru Cevap (referans — puanlamada kullan):\n${referenceAnswer}\n`
    : "";

  const judgePrompt = `Sen bir yapay zeka değerlendirme uzmanısın (Hakem AI). Aşağıda verilen soruya bir modelin verdiği cevabı değerlendireceksin.

Değerlendirme kriterleri:
1. Doğruluk: Cevap sorunun doğru çözümünü/nihai cevabını içeriyor mu?
2. Eksiksizlik: Cevap sorunun istediği tüm bileşenleri içeriyor mu?
3. Kalite: Kod sorularında algoritma doğru, verimli (istenen karmaşıklıkta) ve çalışıyor mu? Metin sorularında akıcı ve tutarlı mı?

Cevabı 0 ile 100 arasında bir puanla değerlendir. 100 = kusursuz, 50 = kısmen doğru, 0 = tamamen yanlış veya alakasız.

ÖNEMLİ: Düşünme yapma, adım adım akıl yürütme YAPMA, <think> etiketi KULLANMA. Doğrudan ve SADECE aşağıdaki JSON formatında yanıt ver. İlk karakterin { ve son karakterin } olmalı:
{"score": <0-100 arası tam sayı>, "reasoning": "<kısa değerlendirme gerekçesi, en fazla 2 cümle>"}

Soru:
${question}
${referenceSection}
Değerlendirilecek Cevap:
${answer}

JSON çıktın:`;

  /**
   * Hakem yanıtından puanı toleranslı şekilde çıkarır:
   * 1) Kod bloğu içindeki JSON, 2) düz metindeki JSON objesi,
   * 3) JSON.parse başarısız olursa regex ile "score"/"reasoning" alanlarını arar.
   */
  const parseJudgeAnswer = (
    judgeAnswer: string
  ): { score: number; reasoning: string } | null => {
    const trimmed = judgeAnswer.trim();

    // Aday JSON dizeleri: önce kod blokları, sonra ilk { ... } aralığı
    const candidates: string[] = [];
    const codeBlockMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
    for (const m of codeBlockMatches) candidates.push(m[1].trim());
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      candidates.push(trimmed.slice(first, last + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.score === "number" &&
          typeof parsed.reasoning === "string"
        ) {
          return {
            score: Math.max(0, Math.min(100, Math.round(parsed.score))),
            reasoning: parsed.reasoning.trim(),
          };
        }
      } catch {
        // sıradaki adaya geç
      }
    }

    // Toleranslı regex çıkarımı: küçük modeller JSON sözdizimini bozabilir
    const scoreMatch = trimmed.match(/"score"\s*:\s*"?(\d{1,3})"?/i);
    const reasoningMatch = trimmed.match(
      /"reasoning"\s*:\s*"([^"]*(?:"[^"]*"[^"]*)*)"/i
    );
    if (scoreMatch) {
      const score = Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10)));
      const reasoning = reasoningMatch
        ? reasoningMatch[1].trim()
        : "Hakem AI gerekçe alanı döndürmedi.";
      return { score, reasoning };
    }

    return null;
  };

  // İlk deneme + iki retry (thinking modeller düşünmeyle token tüketebilir)
  const maxAttempts = 3;
  let lastError: string = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callLLMWithStreaming(judgeConfig, judgePrompt, {
        maxTokens: 1024,
        temperature: 0.1,
      });

      const parsed = parseJudgeAnswer(result.answer);
      if (parsed) {
        return parsed;
      }
      lastError = "Hakem AI çıktısında geçerli score/reasoning bulunamadı";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) {
      console.warn(
        `Hakem AI deneme ${attempt} başarısız (${lastError}), tekrar deneniyor...`
      );
    }
  }

  console.error("Hakem AI değerlendirmesi başarısız:", lastError);
  // Null döndür: hakem başarısızsa puanı DÜŞÜRMESİN — deterministik puan
  // tek başına geçerli olsun (run route null kontrolü yapar).
  return null;
}

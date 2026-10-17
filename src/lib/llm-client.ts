import { ModelConfig } from "../types/benchmark";

/**
 * Represents a chunk of data received from the LLM stream.
 */
interface StreamChunk {
  content: string;
  thinking?: string; // If the model outputs thinking in a separate field
}

/**
 * Calls the LLM endpoint with streaming and measures TTFT and TPS.
 * @param modelConfig - The model configuration.
 * @param prompt - The prompt to send to the model.
 * @param options - Optional overrides (e.g., maxTokens for warm-up).
 * @returns A promise that resolves to an object containing the full answer, thinking process (if extracted), TTFT, and TPS.
 */
export async function callLLMWithStreaming(
  modelConfig: ModelConfig,
  prompt: string,
  options?: { maxTokens?: number }
): Promise<{
  answer: string;
  thinkingProcess?: string;
  ttft: number; // milliseconds
  tps: number; // tokens per second
}> {
  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  let fullAnswer = "";
  let thinkingProcess = "";

  // Prepare the request body in OpenAI chat completions format
  const requestBody = {
    model: modelConfig.modelId,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.1, // As per spec for phase 1
    max_tokens: options?.maxTokens ?? 2048, // We can set a reasonable max
  };

  const controller = new AbortController();
  const signal = controller.signal;

  try {
    const response = await fetch(`${modelConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // For LM Studio, no API key is needed by default, but we can add if provided
        ...(modelConfig.apiKey && { Authorization: `Bearer ${modelConfig.apiKey}` }),
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Check if the response body is readable
    if (!response.body) {
      throw new Error("Response body is not readable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // Read the stream chunk by chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep the incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            // Extract content from the chunk
            const content = json.choices?.[0]?.delta?.content ?? "";
            // Some models might put thinking in a different field, e.g., reasoning_content
            const thinking = json.choices?.[0]?.delta?.reasoning_content ?? "";

            if (content || thinking) {
              if (firstTokenTime === null) {
                firstTokenTime = Date.now();
              }
              if (content) {
                fullAnswer += content;
                // Approximate token count: assuming 1 token ~ 4 characters
                tokenCount += Math.ceil(content.length / 4);
              }
              if (thinking) {
                thinkingProcess += thinking;
              }
            }
          } catch (e) {
            // Ignore parsing errors in individual chunks
            console.warn("Failed to parse chunk as JSON:", data);
          }
        }
      }
    }

    // After the stream ends, calculate TTFT and TPS
    const endTime = Date.now();
    const ttft = firstTokenTime !== null ? firstTokenTime - startTime : 0;
    const totalTime = endTime - startTime; // in milliseconds
    // TPS: (total tokens) / (total time in seconds)
    const tps = totalTime > 0 ? (tokenCount / (totalTime / 1000)) : 0;

    return {
      answer: fullAnswer,
      thinkingProcess: thinkingProcess || undefined,
      ttft,
      tps,
    };
  } catch (error) {
    console.error("Error calling LLM:", error);
    throw error;
  } finally {
    controller.abort();
  }
}

/**
 * Extracts thinking process from the answer if it's tagged with 
 * <think>...</think> or similar.
 * This function is used if the model outputs thinking in the answer string itself.
 * @param answer - The raw answer string from the model.
 * @returns An object with the answer (thinking removed) and the thinking process.
 */
export function extractThinkingProcess(answer: string): {
  answer: string;
  thinkingProcess?: string;
} {
  // Try to find <think> ... </think> tags
  const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
  const match = answer.match(thinkRegex);
  if (match) {
    const thinking = match[1].trim();
    // Remove the think tags from the answer
    const cleanedAnswer = answer.replace(thinkRegex, "").trim();
    return {
      answer: cleanedAnswer,
      thinkingProcess: thinking,
    };
  }
  // If no think tags, return the answer as is and no thinking process
  return {
    answer: answer,
    thinkingProcess: undefined,
  };
}

/**
 * Evaluates the given answer using the Judge AI model.
 * @param judgeConfig - The judge model configuration.
 * @param question - The original question.
 * @param answer - The answer to evaluate.
 * @returns A promise that resolves to an object with score (0-100) and reasoning.
 */
export async function evaluateWithJudge(
  judgeConfig: ModelConfig,
  question: string,
  answer: string
): Promise<{ score: number; reasoning: string }> {
  // Construct the prompt for the judge
  const judgePrompt = `
You are an AI judge tasked with evaluating the answer to a given question.
Please evaluate the answer based on correctness, completeness, and relevance.
Provide your evaluation in the following JSON format exactly:
{
  "score": <number between 0 and 100>,
  "reasoning": "<a brief explanation of your score>"
}

Question: ${question}

Answer: ${answer}

Your evaluation (JSON only):
`;

  try {
    const result = await callLLMWithStreaming(judgeConfig, judgePrompt);
    // The judge should return a JSON object. We'll try to parse the answer.
    const { answer: judgeAnswer } = result;
    // Extract JSON from the judge's answer
    // We'll look for the first { and last } to parse
    const jsonMatch = judgeAnswer.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Judge did not return a valid JSON object");
    }
    const jsonStr = jsonMatch[0];
    const judgeResult = JSON.parse(jsonStr);
    // Validate the judgeResult
    if (typeof judgeResult.score !== "number" || typeof judgeResult.reasoning !== "string") {
      throw new Error("Judge result missing required fields");
    }
    // Clamp score between 0 and 100
    const score = Math.max(0, Math.min(100, Math.round(judgeResult.score)));
    return {
      score,
      reasoning: judgeResult.reasoning.trim(),
    };
  } catch (error) {
    console.error("Error in judge evaluation:", error);
    // Fallback: return a low score and the error as reasoning
    return {
      score: 0,
      reasoning: `Judge evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
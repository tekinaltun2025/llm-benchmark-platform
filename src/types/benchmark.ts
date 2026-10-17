export interface ModelConfig {
  id: string;
  name: string;
  provider: 'lmstudio' | 'custom';
  baseUrl: string;
  apiKey: string;
  modelId: string;
  isJudge: boolean;
}

export interface BenchmarkQuestion {
  id: number;
  question: string;
  category: 'logic' | 'math' | 'ifeval' | 'json' | 'code';
  expectedAnswer?: string; // For deterministic evaluation
  evaluationParams?: any; // Additional params for evaluators
}

export interface QuestionResult {
  questionId: number;
  question: string;
  category: 'logic' | 'math' | 'ifeval' | 'json' | 'code';
  rawAnswer: string;
  thinkingProcess: string | null;
  finalAnswer: string;
  deterministicScore: number;
  judgeScore: number | null;
  judgeReasoning: string | null;
  finalScore: number;
  ttft: number; // Time to first token in ms
  tps: number; // Tokens per second
}

export interface BenchmarkRun {
  id: string;
  modelConfig: ModelConfig;
  judgeModelConfig: ModelConfig | null;
  totalScore: number;
  avgTTFT: number;
  avgTPS: number;
  results: QuestionResult[];
  timestamp: number; // Unix milliseconds when the run was completed
}

export interface LeaderboardEntry {
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
  id: string;
}
/**
 * Hazır online API sağlayıcı şablonları — Bağlantı Kataloğu ve
 * Model & API Yönetimi bölümlerinin ikisi de bu ortak listeyi kullanır.
 *
 * Her sağlayıcı OpenAI uyumlu /chat/completions uç noktası sunar;
 * hakem (judge) mekanizması sağlayıcıdan bağımsız çalışır.
 */
export interface ProviderModelTemplate {
  /** Sağlayıcıya gönderilecek gerçek model kimliği */
  modelId: string;
  /** UI'da gösterilen okunur ad */
  name: string;
}

export interface ProviderTemplate {
  /** Kart başlığı (OpenAI, Groq...) */
  label: string;
  /** OpenAI uyumlu taban URL */
  baseUrl: string;
  /** API anahtarının alınacağı yer hakkında ipucu */
  hint: string;
  /** Sağlayıcının hazır model listesi */
  models: ProviderModelTemplate[];
}

export const API_PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'platform.openai.com API anahtarı',
    models: [
      { modelId: 'gpt-4o', name: 'GPT-4o' },
      { modelId: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { modelId: 'o3-mini', name: 'o3-mini (akıl yürütme)' },
    ],
  },
  {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'console.anthropic.com API anahtarı',
    models: [
      { modelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      { modelId: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
      { modelId: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku (hızlı)' },
    ],
  },
  {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: 'console.groq.com — ücretsiz katman, çok hızlı',
    models: [
      { modelId: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
      { modelId: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { modelId: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
    ],
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'openrouter.ai — 300+ model tek anahtarla',
    models: [
      { modelId: 'openai/gpt-4o', name: 'GPT-4o (yönlendirilmiş)' },
      { modelId: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (yönlendirilmiş)' },
      { modelId: 'deepseek/deepseek-chat', name: 'DeepSeek Chat (yönlendirilmiş)' },
      { modelId: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (yönlendirilmiş)' },
    ],
  },
  {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: 'platform.deepseek.com API anahtarı',
    models: [
      { modelId: 'deepseek-chat', name: 'DeepSeek Chat (V3)' },
      { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
    ],
  },
  {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    hint: 'aistudio.google.com API anahtarı',
    models: [
      { modelId: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { modelId: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
      { modelId: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    ],
  },
];

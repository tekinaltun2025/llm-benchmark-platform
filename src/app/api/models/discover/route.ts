import { NextResponse } from 'next/server';
import { ModelConfig } from '@/types/benchmark';

// Default LM Studio endpoint
const LM_STUDIO_BASE_URL = 'http://localhost:1234/v1';

/**
 * Generates a deterministic ID for a model based on baseUrl and modelId.
 * This ensures the same model always gets the same ID across discoveries.
 */
function generateModelId(baseUrl: string, modelId: string): string {
  // Create a simple hash-like string by removing non-alphanumeric characters and combining
  const cleanBaseUrl = baseUrl.replace(/[^a-zA-Z0-9]/g, '-');
  const cleanModelId = modelId.replace(/[^a-zA-Z0-9]/g, '-');
  return `lmstudio-${cleanBaseUrl}-${cleanModelId}`;
}

export async function GET() {
  try {
    // Fetch models from LM Studio's OpenAI-compatible endpoint
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models from LM Studio: ${response.status}`);
    }

    const data = await response.json();

    // LM Studio returns { object: 'list', data: [ { id: 'model-1', ... }, ... ] }
    if (!data.data || !Array.isArray(data.data)) {
      return NextResponse.json([]); // Return empty array if no models
    }

    const models: ModelConfig[] = data.data.map((model: any) => ({
      id: generateModelId(LM_STUDIO_BASE_URL, model.id),
      name: model.id, // Using model ID as name for now; could be enhanced
      provider: 'lmstudio',
      baseUrl: LM_STUDIO_BASE_URL,
      apiKey: undefined, // LM Studio doesn't require API key by default
      modelId: model.id,
      isJudge: false, // By default, discovered models are not set as judge
    }));

    return NextResponse.json(models);
  } catch (error) {
    console.error('Error discovering LM Studio models:', error);
    // Return empty array on error to avoid breaking the UI
    return NextResponse.json([]);
  }
}
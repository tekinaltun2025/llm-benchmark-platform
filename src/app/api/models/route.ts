import { NextResponse } from 'next/server';
import { ModelConfig } from '@/types/benchmark';
import { readModels, writeModel, deleteModel } from '@/lib/db';

// GET /api/models - returns all models
export async function GET() {
  try {
    const models = await readModels();
    return NextResponse.json(models);
  } catch (error) {
    console.error('Error reading models:', error);
    return NextResponse.json({ error: 'Failed to read models' }, { status: 500 });
  }
}

// POST /api/models - adds a new model
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Validate the body has required fields
    if (!body.name || !body.provider || !body.baseUrl || !body.modelId) {
      return NextResponse.json(
        { error: 'Missing required fields: name, provider, baseUrl, modelId' },
        { status: 400 }
      );
    }
    // Validate provider
    if (body.provider !== 'lmstudio' && body.provider !== 'custom') {
      return NextResponse.json(
        { error: "Provider must be either 'lmstudio' or 'custom'" },
        { status: 400 }
      );
    }
    const newModel: ModelConfig = {
      id: Date.now().toString(), // simple ID generation
      name: body.name,
      provider: body.provider as 'lmstudio' | 'custom',
      baseUrl: body.baseUrl,
      apiKey: body.apiKey || undefined,
      modelId: body.modelId,
      isJudge: body.isJudge ?? false,
    };
    await writeModel(newModel);
    return NextResponse.json(newModel, { status: 201 });
  } catch (error) {
    console.error('Error adding model:', error);
    return NextResponse.json({ error: 'Failed to add model' }, { status: 500 });
  }
}

// DELETE /api/models - deletes a model by id
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing model id' }, { status: 400 });
    }
    await deleteModel(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting model:', error);
    return NextResponse.json({ error: 'Failed to delete model' }, { status: 500 });
  }
}
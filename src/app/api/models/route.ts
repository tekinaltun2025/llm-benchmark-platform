import { NextResponse } from 'next/server';
import { ModelConfig } from '@/types/benchmark';
import { readModels, writeModel, deleteModel, setJudgeModel } from '@/lib/db';

// GET /api/models — tüm kayıtlı modelleri döner
export async function GET() {
  try {
    const models = await readModels();
    return NextResponse.json(models);
  } catch (error) {
    console.error('Modeller okunamadı:', error);
    return NextResponse.json({ error: 'Modeller okunamadı' }, { status: 500 });
  }
}

// POST /api/models — model ekler (upsert). Aynı (provider, modelId)
// zaten kayıtlıysa yeni kayıt OLUŞTURULMAZ; mevcut kayıt güncellenir ve
// DB'de temsil edilen gerçek kayıt döner. Böylece aynı model ikinci kez
// eklendiğinde duplicate isim/koşu bölünmesi oluşmaz.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.name || !body.provider || !body.baseUrl || !body.modelId) {
      return NextResponse.json(
        { error: 'Zorunlu alanlar eksik: name, provider, baseUrl, modelId' },
        { status: 400 }
      );
    }

    if (body.provider !== 'lmstudio' && body.provider !== 'custom') {
      return NextResponse.json(
        { error: "provider yalnızca 'lmstudio' veya 'custom' olabilir" },
        { status: 400 }
      );
    }

    const incomingModel: ModelConfig = {
      id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(body.name),
      provider: body.provider as 'lmstudio' | 'custom',
      baseUrl: String(body.baseUrl).replace(/\/+$/, ''),
      apiKey: body.apiKey ? String(body.apiKey) : undefined,
      modelId: String(body.modelId),
      isJudge: Boolean(body.isJudge),
    };

    // Upsert: writeModel duplicate korumalıdır ve DB'de temsil edilen
    // GERÇEK kaydı döner (aynı model varsa mevcut kaydın ID'siyle).
    const savedModel = await writeModel(incomingModel);

    // Model hakem olarak atanıyorsa diğerlerinden bayrağı kaldır
    if (savedModel.isJudge) {
      await setJudgeModel(savedModel.id);
    }

    return NextResponse.json(savedModel, { status: 201 });
  } catch (error) {
    console.error('Model eklenemedi:', error);
    return NextResponse.json({ error: 'Model eklenemedi' }, { status: 500 });
  }
}

// PATCH /api/models — bir modeli "Aktif Hakem Model" olarak atar
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: 'Model id gerekli' }, { status: 400 });
    }
    const updated = await setJudgeModel(String(body.id));
    if (!updated) {
      return NextResponse.json({ error: 'Model bulunamadı' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Hakem modeli atanamadı:', error);
    return NextResponse.json({ error: 'Hakem modeli atanamadı' }, { status: 500 });
  }
}

// DELETE /api/models?id=... — modeli siler
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Model id gerekli' }, { status: 400 });
    }
    await deleteModel(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Model silinemedi:', error);
    return NextResponse.json({ error: 'Model silinemedi' }, { status: 500 });
  }
}

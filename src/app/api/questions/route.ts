import { NextResponse } from 'next/server';
import { QuestionCategory } from '@/types/benchmark';
import {
  readCustomQuestions,
  addCustomQuestion,
  deleteCustomQuestion,
} from '@/lib/db';

const VALID_CATEGORIES: QuestionCategory[] = [
  'logic',
  'math',
  'ifeval',
  'json',
  'code',
];

/**
 * GET /api/questions
 * Kullanıcı tanımlı özel test sorularını döner.
 */
export async function GET() {
  try {
    const questions = await readCustomQuestions();
    return NextResponse.json(questions);
  } catch (error) {
    console.error('Özel sorular okunamadı:', error);
    return NextResponse.json(
      { error: 'Özel sorular okunamadı' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/questions
 * Yeni bir özel test sorusu ekler.
 * Gövde: { question, category, expectedAnswer?, evaluationParams? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.question || typeof body.question !== 'string' || !body.question.trim()) {
      return NextResponse.json(
        { error: 'Soru metni zorunludur' },
        { status: 400 }
      );
    }

    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json(
        {
          error: `category şu değerlerden biri olmalıdır: ${VALID_CATEGORIES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const newQuestion = await addCustomQuestion({
      question: String(body.question).trim(),
      category: body.category as QuestionCategory,
      expectedAnswer: body.expectedAnswer
        ? String(body.expectedAnswer).trim()
        : undefined,
      evaluationParams:
        body.evaluationParams &&
        typeof body.evaluationParams === 'object' &&
        !Array.isArray(body.evaluationParams)
          ? body.evaluationParams
          : undefined,
    });

    return NextResponse.json(newQuestion, { status: 201 });
  } catch (error) {
    console.error('Özel soru eklenemedi:', error);
    return NextResponse.json(
      { error: 'Özel soru eklenemedi' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/questions?id=...
 * ID ile özel soru siler.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');
    if (!idParam) {
      return NextResponse.json({ error: 'Soru id gerekli' }, { status: 400 });
    }
    const id = parseInt(idParam, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: 'Geçersiz soru id' },
        { status: 400 }
      );
    }
    await deleteCustomQuestion(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Özel soru silinemedi:', error);
    return NextResponse.json(
      { error: 'Özel soru silinemedi' },
      { status: 500 }
    );
  }
}

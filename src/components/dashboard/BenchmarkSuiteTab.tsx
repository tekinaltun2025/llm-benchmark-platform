'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BenchmarkQuestion, QuestionCategory } from '@/types/benchmark';
import { benchmarkQuestions, CATEGORY_LABELS } from '@/lib/benchmark-suite';
import { Plus, Trash2, Loader2, ClipboardList } from 'lucide-react';

const CATEGORIES: QuestionCategory[] = ['logic', 'math', 'ifeval', 'json', 'code', 'turkish'];

/** Kategori bazlı değerlendirme kriterleri açıklaması. */
const CRITERIA_BY_CATEGORY: Record<QuestionCategory, string> = {
  logic: 'Dinamik sayılar + deterministik kontrol (CEVAP etiketi) + Hakem AI hibrit puanlama',
  math: 'Dinamik sayılar + deterministik kontrol: "SONUÇ: <sayı>" etiketi Regex ile kesin doğrulanır',
  ifeval: 'Kod ile %100 kesin kontrol: yasaklı kelime, cümle sayısı, harf başlangıcı, kelime sayısı, noktalama',
  json: 'JSON.parse geçerliliği + alan değerlerinin sayısal doğruluğu kontrol edilir',
  code: 'Canlı sandbox çalıştırma: gizli unit testler (doğruluk + 100k performans + uç senaryolar) + Hakem AI',
  needle: 'Rastgele üretilmiş gizli şifrenin uzun metin yığınında bulunması (case-insensitive eşleşme)',
  adversarial: '2 turlu baskı testi: doğru cevabı savunursa 100, boyun eğerse 50 puan (sycophancy direnci)',
  turkish: 'Türkçe ekim/deyim/özet: deterministik anahtar kelime + etiket kontrolü + Hakem AI hibrit dil kalitesi puanı',
};

export default function BenchmarkSuiteTab() {
  const [customQuestions, setCustomQuestions] = useState<BenchmarkQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');

  // Yeni soru formu
  const [form, setForm] = useState<{
    question: string;
    category: QuestionCategory;
    expectedAnswer: string;
  }>({
    question: '',
    category: 'logic',
    expectedAnswer: '',
  });

  const fetchCustomQuestions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/questions');
      if (res.ok) {
        const data: BenchmarkQuestion[] = await res.json();
        setCustomQuestions(data);
      }
    } catch (e) {
      console.error('Özel sorular yüklenemedi:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomQuestions();
  }, [fetchCustomQuestions]);

  const showStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(message);
    setStatusType(type);
  };

  const handleAddQuestion = async () => {
    if (!form.question.trim()) {
      showStatus('Soru metni boş olamaz.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: form.question,
          category: form.category,
          expectedAnswer: form.expectedAnswer || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Soru eklenemedi');
      }
      setForm({ question: '', category: 'logic', expectedAnswer: '' });
      setShowForm(false);
      await fetchCustomQuestions();
      showStatus('Özel soru eklendi. Bir sonraki test koşusunda kullanılacak.', 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuestion = async (id: number) => {
    if (!window.confirm('Bu özel soruyu silmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`/api/questions?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Silme başarısız');
      await fetchCustomQuestions();
      showStatus('Soru silindi.', 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-sky-400" /> Soru Havuzu (Benchmark Suite)
      </h2>

      <div className="space-y-6 max-w-4xl">
        {/* Durum mesajı */}
        {status && (
          <div
            className={`p-3 rounded text-sm border ${
              statusType === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                : statusType === 'error'
                ? 'bg-red-500/10 border-red-500/40 text-red-300'
                : 'bg-sky-500/10 border-sky-500/40 text-sky-300'
            }`}
          >
            {status}
          </div>
        )}

        {/* Standart 10 soru */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <h3 className="font-semibold mb-4 text-gray-200">
            Standart Test Soruları ({benchmarkQuestions.length} soru)
          </h3>
          <div className="space-y-4">
            {benchmarkQuestions.map((q) => (
              <div key={q.id} className="pb-4 border-b border-gray-700 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                    Soru {q.id}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                    {CATEGORY_LABELS[q.category]}
                  </span>
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{q.question}</p>
                <p className="mt-2 text-xs text-gray-500">
                  <b className="text-gray-400">Değerlendirme:</b> {CRITERIA_BY_CATEGORY[q.category]}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Özel sorular */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-200">
              Özel Test Soruları ({customQuestions.length})
            </h3>
            <button
              onClick={() => setShowForm((prev) => !prev)}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
            >
              <Plus className="h-4 w-4" />
              {showForm ? 'Vazgeç' : 'Yeni Soru Ekle'}
            </button>
          </div>

          {/* Yeni soru formu */}
          {showForm && (
            <div className="mb-6 p-4 bg-gray-900/60 rounded-lg border border-gray-700 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Soru Metni *</label>
                <textarea
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  rows={4}
                  placeholder="Test sorusunu buraya yazın..."
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 resize-y"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Kategori *</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value as QuestionCategory })
                    }
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Beklenen Cevap (opsiyonel)
                  </label>
                  <input
                    value={form.expectedAnswer}
                    onChange={(e) => setForm({ ...form, expectedAnswer: e.target.value })}
                    placeholder="örn. 42 veya key=value, key2=value2"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Matematik/mantık için sayı; JSON için key=value formatı. Boşsa yalnızca Hakem AI puanlar.
                  </p>
                </div>
              </div>
              <button
                onClick={handleAddQuestion}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Soruyu Kaydet
              </button>
            </div>
          )}

          {/* Özel soru listesi */}
          {loading ? (
            <p className="text-gray-400 text-sm">Yükleniyor...</p>
          ) : customQuestions.length === 0 ? (
            <p className="text-gray-400 text-sm">
              Henüz özel soru eklenmedi. Yukarıdaki formu kullanarak kendi test sorularınızı
              ekleyebilirsiniz — bunlar standart 10 soruya ek olarak çalıştırılır.
            </p>
          ) : (
            <div className="space-y-4">
              {customQuestions.map((q) => (
                <div key={q.id} className="pb-4 border-b border-gray-700 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300">
                        Özel Soru #{q.id}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                        {CATEGORY_LABELS[q.category]}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Sil
                    </button>
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{q.question}</p>
                  {q.expectedAnswer && (
                    <p className="mt-1 text-xs text-gray-500">
                      Beklenen cevap: <b className="text-gray-400">{q.expectedAnswer}</b>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

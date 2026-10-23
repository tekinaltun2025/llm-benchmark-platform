'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BenchmarkQuestion, QuestionCategory } from '@/types/benchmark';
import {
  benchmarkQuestions,
  CODING_QUESTIONS,
  TURKISH_QUESTIONS,
  CATEGORY_LABELS,
} from '@/lib/benchmark-suite';
import { Plus, Trash2, Loader2, ClipboardList, Code2, Languages, LayoutGrid } from 'lucide-react';

const CATEGORIES: QuestionCategory[] = ['logic', 'math', 'ifeval', 'json', 'code', 'turkish'];

/**
 * Tüm standart sorular tek listede toplanır; kategori bazlı gruplama
 * useMemo ile türetilir. ID aralıkları:
 *   - Genel: 1-27 (benchmarkQuestions şablonları)
 *   - Kodlama: 101-105 (5 seviye)
 *   - Türkçe genel: 200-209 (10 soru)
 */
const ALL_STANDARD_QUESTIONS: BenchmarkQuestion[] = [
  ...benchmarkQuestions,
  ...CODING_QUESTIONS,
  ...TURKISH_QUESTIONS,
];

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
  coding: 'Kodlama benchmark (Python 3.11+): 5 seviye — sandbox gizli testler + 4 kriterlik Hakem AI rubriği (doğruluk 30, kenar durumlar 25, mimari 25, hata yönetimi 20)',
  turkish_general: 'Türkçe genel yetkinlik (10 soru): etiket kontrolü (DÜZELTME/ANLAM/ÖZET vb.) + Hakem AI hibrit dil kalitesi puanı',
};

export default function BenchmarkSuiteTab() {
  const [customQuestions, setCustomQuestions] = useState<BenchmarkQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');

  // ─── Madde 3: Standart soru seçimi ─────────────────────
  // Default: TÜM standart sorular (Genel + Kodlama + Türkçe) seçili.
  // DB'de kayıt yoksa (null) hepsi seçili kabul edilir.
  const [enabledIds, setEnabledIds] = useState<number[]>(
    ALL_STANDARD_QUESTIONS.map((q) => q.id)
  );
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [selectionSaving, setSelectionSaving] = useState(false);

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

  // Madde 3: Kayıtlı soru seçimini yükle
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/questions/selection');
        if (res.ok) {
          const body: { enabledQuestionIds: number[] | null } = await res.json();
          if (body.enabledQuestionIds !== null) {
            setEnabledIds(body.enabledQuestionIds);
          }
        }
      } catch (e) {
        console.error('Soru seçimi yüklenemedi:', e);
      } finally {
        setSelectionLoaded(true);
      }
    })();
  }, []);

  // Madde 3: Tek sorunun seçimini değiştir + DB'ye kaydet
  const toggleQuestion = async (id: number) => {
    const next = enabledIds.includes(id)
      ? enabledIds.filter((qid) => qid !== id)
      : [...enabledIds, id];
    if (next.length === 0) {
      showStatus('En az 1 soru seçili kalmalıdır.', 'error');
      return;
    }
    setEnabledIds(next);
    setSelectionSaving(true);
    try {
      const res = await fetch('/api/questions/selection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledQuestionIds: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Seçim kaydedilemedi');
      }
      showStatus(
        `Soru seçimi kaydedildi: ${next.length}/${ALL_STANDARD_QUESTIONS.length} soru testte kullanılacak.`,
        'success'
      );
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSelectionSaving(false);
    }
  };

  // Madde 3: Tümünü seç / temizle (en az 1 soru kalmalı)
  const toggleAllQuestions = async () => {
    const allSelected = enabledIds.length === ALL_STANDARD_QUESTIONS.length;
    const next = allSelected
      ? ALL_STANDARD_QUESTIONS.slice(0, 1).map((q) => q.id)
      : ALL_STANDARD_QUESTIONS.map((q) => q.id);
    setEnabledIds(next);
    setSelectionSaving(true);
    try {
      const res = await fetch('/api/questions/selection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledQuestionIds: next }),
      });
      if (!res.ok) throw new Error('Seçim kaydedilemedi');
      showStatus(
        allSelected
          ? 'Tüm seçimler temizlendi (yalnızca Soru 1 aktif).'
          : 'Tüm sorular seçildi.',
        'success'
      );
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSelectionSaving(false);
    }
  };

  const showStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(message);
    setStatusType(type);
  };

  // ─── Kategori bazlı gruplama: Genel / Kodlama / Türkçe ──
  // ID aralıklarına göre ayrılır; her grup kendi başlığı altında listelenir.
  const groupedQuestions = useMemo(() => {
    const general = ALL_STANDARD_QUESTIONS.filter((q) => q.id < 100);
    const coding = ALL_STANDARD_QUESTIONS.filter((q) => q.id >= 100 && q.id < 200);
    const turkish = ALL_STANDARD_QUESTIONS.filter((q) => q.id >= 200);
    return { general, coding, turkish };
  }, []);

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

        {/* Standart sorular — kategori başlıkları altında gruplu */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <h3 className="font-semibold text-gray-200">
              Standart Test Soruları ({ALL_STANDARD_QUESTIONS.length} soru)
            </h3>
            {/* Madde 3: seçim kontrolleri */}
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium ${
                  enabledIds.length === ALL_STANDARD_QUESTIONS.length
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }`}
              >
                ✅ {enabledIds.length}/{ALL_STANDARD_QUESTIONS.length} soru testte aktif
                {selectionSaving && ' (kaydediliyor...)'}
              </span>
              <button
                onClick={toggleAllQuestions}
                disabled={selectionSaving || !selectionLoaded}
                className="text-xs font-medium py-1.5 px-3 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 transition-colors"
              >
                {enabledIds.length === ALL_STANDARD_QUESTIONS.length
                  ? 'Tümünü Kaldır'
                  : 'Tümünü Seç'}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            İşaretli sorular bir sonraki test koşusunda kullanılır. İşaretsizler atlanır.
            Seçim otomatik kaydedilir; en az 1 soru seçili kalmalıdır.
          </p>

          {/* ─── Grup 1: Genel Testler ─── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700">
              <LayoutGrid className="h-4 w-4 text-sky-400" />
              <h4 className="text-sm font-semibold text-sky-300">
                Genel Testler ({groupedQuestions.general.length} soru)
              </h4>
              <span className="text-xs text-gray-500">
                — mantık, matematik, IFEval, JSON, kod, needle, baskı direnci, Türkçe başarım
              </span>
            </div>
            <div className="space-y-4">
              {groupedQuestions.general.map((q) => {
                const checked = enabledIds.includes(q.id);
                return (
                <div
                  key={q.id}
                  className={`pb-4 border-b border-gray-700 last:border-b-0 last:pb-0 ${
                    checked ? '' : 'opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuestion(q.id)}
                      disabled={selectionSaving}
                      className="h-4 w-4 accent-sky-500 cursor-pointer flex-shrink-0"
                      title={checked ? 'Testten çıkar' : 'Teste dahil et'}
                    />
                    <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                      Soru {q.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                      {CATEGORY_LABELS[q.category]}
                    </span>
                    {!checked && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                        Testte değil
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{q.question}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    <b className="text-gray-400">Değerlendirme:</b> {CRITERIA_BY_CATEGORY[q.category]}
                  </p>
                </div>
                );
              })}
            </div>
          </div>

          {/* ─── Grup 2: Kodlama Benchmark ─── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700">
              <Code2 className="h-4 w-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-emerald-300">
                Kodlama Benchmark ({groupedQuestions.coding.length} soru)
              </h4>
              <span className="text-xs text-gray-500">
                — 5 seviye (Python 3.11+): Rate Limiter, Async Task Queue, LRU Cache, Kod
                Analizi, Saga Pattern
              </span>
            </div>
            <div className="space-y-4">
              {groupedQuestions.coding.map((q) => {
                const checked = enabledIds.includes(q.id);
                return (
                <div
                  key={q.id}
                  className={`pb-4 border-b border-gray-700 last:border-b-0 last:pb-0 ${
                    checked ? '' : 'opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuestion(q.id)}
                      disabled={selectionSaving}
                      className="h-4 w-4 accent-emerald-500 cursor-pointer flex-shrink-0"
                      title={checked ? 'Testten çıkar' : 'Teste dahil et'}
                    />
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      Soru {q.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                      {CATEGORY_LABELS[q.category]}
                    </span>
                    {!checked && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                        Testte değil
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap line-clamp-3">
                    {q.question.length > 400 ? `${q.question.slice(0, 400)}…` : q.question}
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    <b className="text-gray-400">Değerlendirme:</b> {CRITERIA_BY_CATEGORY[q.category]}
                  </p>
                </div>
                );
              })}
            </div>
          </div>

          {/* ─── Grup 3: Türkçe Genel Yetkinlik ─── */}
          <div>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700">
              <Languages className="h-4 w-4 text-violet-400" />
              <h4 className="text-sm font-semibold text-violet-300">
                Türkçe Genel Yetkinlik ({groupedQuestions.turkish.length} soru)
              </h4>
              <span className="text-xs text-gray-500">
                — ekim, deyim, özet, dilbilgisi, anlam, yazım, cümle, sözcük, paragraf, edebi
              </span>
            </div>
            <div className="space-y-4">
              {groupedQuestions.turkish.map((q) => {
                const checked = enabledIds.includes(q.id);
                return (
                <div
                  key={q.id}
                  className={`pb-4 border-b border-gray-700 last:border-b-0 last:pb-0 ${
                    checked ? '' : 'opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuestion(q.id)}
                      disabled={selectionSaving}
                      className="h-4 w-4 accent-violet-500 cursor-pointer flex-shrink-0"
                      title={checked ? 'Testten çıkar' : 'Teste dahil et'}
                    />
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300">
                      Soru {q.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                      {CATEGORY_LABELS[q.category]}
                    </span>
                    {!checked && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                        Testte değil
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{q.question}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    <b className="text-gray-400">Değerlendirme:</b> {CRITERIA_BY_CATEGORY[q.category]}
                  </p>
                </div>
                );
              })}
            </div>
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

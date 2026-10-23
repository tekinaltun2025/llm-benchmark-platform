'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ModelConfig, RunProgressEvent, BenchmarkRun, TestCategory } from '@/types/benchmark';
import { API_PROVIDER_TEMPLATES, ProviderModelTemplate, ProviderTemplate } from '@/lib/provider-templates';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Scale,
  HardDriveDownload,
  Square,
  RefreshCw,
  ClipboardList,
  Cloud,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Server,
  AlertTriangle,
  Menu,
  X,
  Check,
  Radio,
} from 'lucide-react';

/** Kütüphane modeli: yüklü olmayanlar dahil LM Studio indeksindeki tüm modeller. */
interface LibraryModel extends ModelConfig {
  libraryKey: string;
  isLoaded: boolean;
  repo: string;
  /** Modelin son yükleme/çalışma hatası — doluysa "çalışmıyor" */
  lastLoadError?: string;
  lastLoadErrorAt?: number;
}

/** "Test Edilecek Modeller" listesindeki bir kayıt (DB model kimliğiyle). */
interface SelectedTestModel {
  /** DB'deki ModelConfig kimliği — run-all'a bu gönderilir */
  id: string;
  /** UI'da gösterilen ad */
  name: string;
  provider: 'lmstudio' | 'custom';
  /** Gerçek model kimliği (LM Studio / API sağlayıcı) */
  modelId: string;
}

/** Canlı durum günlüğü satırı: mesaj + renk sınıfı için tür. */
interface StatusMessage {
  text: string;
  kind: 'info' | 'retry' | 'error';
}

/** Soru havuzundan seçili standart soru sayısı (Madde 3 göstergesi). */
interface QuestionSelectionInfo {
  enabledQuestionIds: number[] | null;
  totalStandardQuestions: number;
}

interface TestRunnerTabProps {
  /** Test tamamlandığında çağrılır — üst bileşen Leaderboard sekmesine yönlendirir. */
  onRunComplete: (run: BenchmarkRun) => void;
  /** Test çalışma durumu değiştiğinde çağrılır (üst bardaki canlı gösterge için). */
  onRunningChange?: (isRunning: boolean) => void;
}

/** Düşünme (thinking) modeli ipuçları — hakem olarak seçilirse yavaş puanlama uyarısı. */
const THINKING_MODEL_PATTERN = /think|reason|qwq|-r1|r1-|o1|o3/i;

/** localStorage anahtarı — test listesi sayfa yenilenince kaybolmasın. */
const TEST_LIST_STORAGE_KEY = 'benchmark.selectedTestModels';

export default function TestRunnerTab({ onRunningChange }: TestRunnerTabProps) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [libraryModels, setLibraryModels] = useState<LibraryModel[]>([]);
  /** Katalogdan + ile eklenen test edilecek modeller */
  const [selectedTestModels, setSelectedTestModels] = useState<SelectedTestModel[]>([]);
  const [judgeModelId, setJudgeModelId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessages, setStatusMessages] = useState<StatusMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<BenchmarkRun | null>(null);
  const [serverLocked, setServerLocked] = useState(false);
  const [serverLockedBy, setServerLockedBy] = useState<string | null>(null);
  /** Toplu test durumu: [i, total, modelName] */
  const [batchInfo, setBatchInfo] = useState<{
    index: number;
    total: number;
    modelName: string | null;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  /** "Çalışmıyor" notlu olduğu için kütüphane listesinden gizlenen model sayısı */
  const [hiddenBrokenCount, setHiddenBrokenCount] = useState(0);
  /** Açık olan API sağlayıcı kartları (accordion) */
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  /** Sağlayıcı bazında girilen API anahtarları (oturumluk) */
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({});
  /** Anahtar inputu açık olan sağlayıcı etiketi */
  const [keyInputFor, setKeyInputFor] = useState<string | null>(null);
  /** Kategori seçim modalı açık mı? */
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  /** Seçilen test kategorisi (Genel / Kodlama / Türkçe / Hepsi) */
  const [selectedCategory, setSelectedCategory] = useState<TestCategory>('all');
  const statusLogRef = useRef<HTMLDivElement>(null);

  // Kayıtlı modelleri yükle; isJudge işaretli modeli varsayılan hakem seç
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data: ModelConfig[] = await res.json();
        setModels(data);
        const judge = data.find((m) => m.isJudge);
        if (judge) setJudgeModelId(judge.id);
      }
    } catch (e) {
      console.error('Model listesi alınamadı:', e);
    }
  }, []);

  // LM Studio kütüphanesindeki TÜM modelleri çek (yüklü olmayanlar dahil).
  // "Çalışmıyor" notlu modeller (bozuk GGUF vb.) listeden GİZLENİR —
  // kullanıcı bunları test etmeye çalışmasın.
  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch('/api/models/library');
      if (res.ok) {
        const data = await res.json();
        const all: LibraryModel[] = data.models ?? [];
        const working = all.filter((m) => !m.lastLoadError);
        setLibraryModels(working);
        setHiddenBrokenCount(all.length - working.length);
      }
    } catch (e) {
      console.error('Kütüphane listesi alınamadı:', e);
    }
  }, []);

  // Sunucudaki global test kilidini sorgula (başka bir benchmark çalışıyor mu?)
  const fetchLockStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/benchmark/status');
      if (res.ok) {
        const status: { isLocked: boolean; lockedBy: string | null } = await res.json();
        setServerLocked(status.isLocked);
        setServerLockedBy(status.lockedBy);
      }
    } catch (e) {
      console.error('Kilit durumu alınamadı:', e);
    }
  }, []);

  // Madde 3: Soru havuzu seçimini yükle — kullanıcıya hangi
  // soruların test edileceğini göstermek için.
  const [questionSelection, setQuestionSelection] =
    useState<QuestionSelectionInfo>({ enabledQuestionIds: null, totalStandardQuestions: 24 });

  const fetchQuestionSelection = useCallback(async () => {
    try {
      const res = await fetch('/api/questions/selection');
      if (res.ok) {
        const body: { enabledQuestionIds: number[] | null } = await res.json();
        setQuestionSelection((prev) => ({
          ...prev,
          enabledQuestionIds: body.enabledQuestionIds,
        }));
      }
    } catch (e) {
      console.error('Soru seçimi yüklenemedi:', e);
    }
  }, []);

  // İlk yükleme: veriler + localStorage'daki test listesi
  useEffect(() => {
    fetchModels();
    fetchLibrary();
    fetchLockStatus();
    fetchQuestionSelection();
    try {
      const stored = localStorage.getItem(TEST_LIST_STORAGE_KEY);
      if (stored) {
        const parsed: SelectedTestModel[] = JSON.parse(stored);
        if (Array.isArray(parsed)) setSelectedTestModels(parsed);
      }
    } catch {
      // Bozuk kayıt — yok say
    }
  }, [fetchModels, fetchLibrary, fetchLockStatus, fetchQuestionSelection]);

  // Test listesindeki ID'ler DB'de artık yoksa (silinmişse) listeden temizle
  useEffect(() => {
    if (models.length === 0) return;
    setSelectedTestModels((prev) => {
      const validIds = new Set(models.map((m) => m.id));
      const filtered = prev.filter((m) => validIds.has(m.id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [models]);

  // Test listesi değişince localStorage'a yaz
  useEffect(() => {
    try {
      localStorage.setItem(TEST_LIST_STORAGE_KEY, JSON.stringify(selectedTestModels));
    } catch {
      // localStorage dolu/kapalı olabilir — kritik değil
    }
  }, [selectedTestModels]);

  // Sunucuda başka bir test çalışıyorsa 5 saniyede bir kontrol et;
  // o test bitince uyarı otomatik olarak kalkar.
  useEffect(() => {
    if (!serverLocked || isRunning) return;
    const interval = setInterval(fetchLockStatus, 5000);
    return () => clearInterval(interval);
  }, [serverLocked, isRunning, fetchLockStatus]);

  // Durum mesajları eklendikçe otomatik kaydır
  useEffect(() => {
    if (statusLogRef.current) {
      statusLogRef.current.scrollTop = statusLogRef.current.scrollHeight;
    }
  }, [statusMessages]);

  const addStatus = (message: string, kind?: 'retry' | 'error') => {
    const time = new Date().toLocaleTimeString('tr-TR');
    setStatusMessages((prev) => [
      ...prev,
      { text: `[${time}] ${message}`, kind: kind ?? 'info' },
    ]);
  };

  // ─── Katalog → Test listesi ekleme/çıkarma ──────────────────

  const addToTestList = (item: SelectedTestModel) => {
    setSelectedTestModels((prev) => {
      if (prev.some((m) => m.id === item.id)) {
        addStatus(`ℹ️ "${item.name}" zaten test listesinde.`);
        return prev;
      }
      addStatus(`➕ "${item.name}" test edilecek modeller listesine eklendi.`);
      return [...prev, item];
    });
  };

  // LM Studio kütüphane modelini DB'ye kaydet ve test listesine ekle
  const handleAddLMStudioModel = async (libModel: LibraryModel) => {
    try {
      const res = await fetch('/api/models/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: libModel.modelId, name: libModel.name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Model kaydedilemedi');
      }
      const saved: ModelConfig = await res.json();
      await fetchModels();
      addToTestList({
        id: saved.id,
        name: saved.name,
        provider: 'lmstudio',
        modelId: saved.modelId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // LM Studio kütüphanesindeki tüm çalışan modelleri tek seferde listeye ekle
  const handleAddAllLMStudioModels = async () => {
    for (const lm of libraryModels) {
      await handleAddLMStudioModel(lm);
    }
    addStatus(`📚 ${libraryModels.length} LM Studio modeli test listesine eklendi.`);
  };

  // Sağlayıcı için anahtar hazır mı? (oturumluk girilmiş VEYA DB'de anahtarlı kayıt var)
  const providerKeyReady = (tpl: ProviderTemplate): boolean => {
    if ((providerApiKeys[tpl.label] ?? '').trim()) return true;
    return models.some(
      (m) => m.provider === 'custom' && m.baseUrl === tpl.baseUrl && Boolean(m.apiKey)
    );
  };

  // API sağlayıcı modelini DB'ye kaydet ve test listesine ekle.
  // Kayıt DB'de zaten varsa anahtar istenmez; yoksa sağlayıcı için
  // girilmiş anahtar kullanılır, o da yoksa anahtar inputu açılır.
  const handleAddApiModel = async (tpl: ProviderTemplate, model: ProviderModelTemplate) => {
    // DB'de zaten kayıtlı mı? (aynı baseUrl + modelId)
    const existing = models.find(
      (m) =>
        m.provider === 'custom' &&
        m.baseUrl === tpl.baseUrl &&
        m.modelId.toLowerCase() === model.modelId.toLowerCase()
    );
    if (existing) {
      addToTestList({
        id: existing.id,
        name: existing.name,
        provider: 'custom',
        modelId: existing.modelId,
      });
      return;
    }

    const apiKey = (providerApiKeys[tpl.label] ?? '').trim();
    if (!apiKey) {
      setKeyInputFor(tpl.label);
      setExpandedProviders((prev) => new Set(prev).add(tpl.label));
      addStatus(`🔑 "${tpl.label} ${model.name}" eklemek için önce API anahtarı girin.`);
      return;
    }

    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${tpl.label} ${model.name}`,
          provider: 'custom',
          baseUrl: tpl.baseUrl,
          modelId: model.modelId,
          apiKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'API modeli kaydedilemedi');
      }
      const saved: ModelConfig = await res.json();
      await fetchModels();
      addToTestList({
        id: saved.id,
        name: saved.name,
        provider: 'custom',
        modelId: saved.modelId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Sağlayıcı anahtarını oturumluk kaydet
  const handleSaveProviderKey = (tpl: ProviderTemplate) => {
    const key = (providerApiKeys[tpl.label] ?? '').trim();
    if (!key) {
      addStatus(`🔑 ${tpl.label} için anahtar boş — girilen anahtar kaydedilmedi.`, 'error');
      return;
    }
    setKeyInputFor(null);
    addStatus(`🔑 ${tpl.label} API anahtarı kaydedildi — artık modellerini + ile ekleyebilirsiniz.`);
  };

  const handleRemoveFromTestList = (item: SelectedTestModel) => {
    setSelectedTestModels((prev) => prev.filter((m) => m.id !== item.id));
    addStatus(`➖ "${item.name}" test listesinden çıkarıldı.`);
  };

  const toggleProviderExpanded = (label: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  // ─── Senkronizasyon / durdurma ──────────────────────────────

  // Kayıtlı modelleri LM Studio kütüphanesiyle senkronize et:
  // duplicate'leri siler, isimleri düzeltir, ölü kayıtları temizler
  const handleSyncModels = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/models/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Senkronizasyon başarısız');

      const parts: string[] = [];
      if (data.removedDuplicates?.length)
        parts.push(`${data.removedDuplicates.length} duplicate silindi`);
      if (data.renamed?.length)
        parts.push(`${data.renamed.length} isim düzeltildi`);
      if (data.removedMissing?.length)
        parts.push(`${data.removedMissing.length} geçersiz kayıt silindi`);
      addStatus(
        `🔄 Senkronizasyon tamamlandı: ${parts.join(', ') || 'değişiklik gerekmedi'} — ${data.finalModelCount} model kayıtlı.`
      );
      await fetchModels();
      await fetchLibrary();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Senkronizasyon hatası: ${message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Çalışan testi sunucuda durdurmayı iste (bir sonraki kontrol noktasında durur)
  const handleStopTest = async () => {
    try {
      const res = await fetch('/api/benchmark/stop', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        addStatus('⏹️ Durdurma isteği gönderildi — test bir sonraki soruda duracak.');
      } else {
        setError(data?.message ?? 'Durdurma isteği başarısız.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ─── Testi Başlat: ÖNCE kategori seçim modalı açılır ────────
  // Doğrulamalar yapılır; başarılıysa kategori seçim modalı gösterilir.
  // Kullanıcı kategoriyi seçince startBenchmark(category) çağrılır.
  const handleStartTest = () => {
    if (selectedTestModels.length === 0) {
      setError('Test edilecek modeller listesi boş. Yukarıdaki katalogdan + ile model ekleyin.');
      return;
    }
    if (!judgeModelId) {
      setError('Lütfen Hakem AI modelini seçin.');
      return;
    }
    if (serverLocked || isRunning) {
      setError('Şu anda başka bir test çalışıyor.');
      return;
    }
    setShowCategoryModal(true);
  };

  // ─── Gerçek test koşumu: kategori seçildikten sonra ─────────
  // /api/benchmark/run-all { modelIds, judgeModelId, selectedCategories }
  // — seçili modeller sırayla yüklenir (LM Studio), test edilir ve boşaltılır.
  const startBenchmark = async (category: TestCategory) => {
    setShowCategoryModal(false);

    setIsRunning(true);
    onRunningChange?.(true);
    setProgress(0);
    setStatusMessages([]);
    setError(null);
    setCompleted(null);
    setBatchInfo(null);
    const categoryLabel =
      category === 'all' ? 'Hepsi' :
      category === 'general' ? 'Genel' :
      category === 'coding' ? 'Kodlama' : 'Türkçe';
    addStatus(
      `🚀 Test başlatılıyor [${categoryLabel}]: ${selectedTestModels.length} model sırayla test edilecek (${selectedTestModels.map((m) => m.name).join(', ')}).`
    );

    try {
      const res = await fetch('/api/benchmark/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelIds: selectedTestModels.map((m) => m.id),
          judgeModelId,
          selectedCategories: [category],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (res.status === 409) {
          setServerLocked(true);
          setServerLockedBy(errData?.lockedBy ?? null);
        }
        throw new Error(errData?.error ?? `Test başlatılamadı (HTTP ${res.status})`);
      }
      if (!res.body) throw new Error('Sunucu akış (stream) döndürmedi');

      // NDJSON akışını satır satır oku
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: RunProgressEvent = JSON.parse(line);
            setProgress(event.progress);
            addStatus(
              event.message,
              event.type === 'retry' ? 'retry' : event.type === 'error' ? 'error' : undefined
            );

            if (event.batchIndex !== undefined && event.batchTotal !== undefined) {
              setBatchInfo({
                index: event.batchIndex,
                total: event.batchTotal,
                modelName: event.batchModelName ?? null,
              });
            }
            if (event.type === 'stopped') {
              addStatus('⏹️ Test durduruldu.');
            }
            if (event.type === 'complete') {
              addStatus('🏁 Test tamamlandı! Sonuçlar Leaderboard sekmesinde.');
            }
            if (event.type === 'error') {
              setError(event.message);
            }
          } catch {
            // tekil satır hatası akışı bozmasın
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addStatus(`❌ Hata: ${message}`);
    } finally {
      setIsRunning(false);
      onRunningChange?.(false);
      setBatchInfo(null);
      fetchModels();
      fetchLockStatus();
    }
  };

  // ─── Türetilmiş veriler ─────────────────────────────────────

  const judgeModel = models.find((m) => m.id === judgeModelId);
  const judgeIsThinking = judgeModel
    ? THINKING_MODEL_PATTERN.test(judgeModel.modelId) || THINKING_MODEL_PATTERN.test(judgeModel.name)
    : false;
  const lmStudioInCatalog = libraryModels.length > 0;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Zap className="h-5 w-5 text-sky-400" /> Test Koşucusu (Live Benchmark)
      </h2>

      {/* Madde 3: Bu koşuda hangi soruların test edileceği göstergesi */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-gray-800/60 rounded-lg px-4 py-3 border border-gray-700">
        <div className="text-sm text-gray-300">
          <ClipboardList className="inline h-4 w-4 mr-1 text-sky-400" />
          Bu koşuda{' '}
          <b className={questionSelection.enabledQuestionIds === null || questionSelection.enabledQuestionIds.length === questionSelection.totalStandardQuestions ? 'text-emerald-300' : 'text-amber-300'}>
            {questionSelection.enabledQuestionIds === null
              ? `tüm ${questionSelection.totalStandardQuestions} standart soru`
              : `${questionSelection.enabledQuestionIds.length}/${questionSelection.totalStandardQuestions} standart soru`}
          </b>{' '}
          test edilecek
          {questionSelection.enabledQuestionIds !== null &&
            questionSelection.enabledQuestionIds.length < questionSelection.totalStandardQuestions && (
              <span className="text-gray-500"> (Soru Havuzu sekmesinden seçildi)</span>
            )}
        </div>
        <button
          onClick={fetchQuestionSelection}
          className="text-xs text-gray-400 hover:text-sky-300 transition-colors"
          title="Soru havuzu seçimini yeniden yükle"
        >
          ↻ Yenile
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          BAĞLANTI KATALOĞU — üst bölüm
          LM Studio + hazır API sağlayıcıları; her modelin yanında
          + butonu: alttaki "Test Edilecek Modeller" listesine ekler.
          ═══════════════════════════════════════════════════════ */}
      <section className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="font-semibold text-gray-200 flex items-center gap-2">
            <Server className="h-4 w-4 text-sky-400" />
            Bağlantı Kataloğu
          </h3>
          <button
            onClick={fetchLibrary}
            disabled={isRunning}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
            title="LM Studio kütüphanesini yeniden tara"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Listeyi Tara
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── LM Studio bağlantı kartı ─── */}
          <div className="rounded-lg border border-emerald-700/50 bg-gray-900/60 overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-emerald-900/30 border-b border-emerald-800/50 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-emerald-200 flex items-center gap-2 text-sm">
                  <HardDriveDownload className="h-4 w-4 shrink-0" /> LM Studio (Yerel)
                </div>
                <div className="text-xs text-gray-400 truncate">
                  <code className="text-emerald-300">http://localhost:1234/v1</code> — Developer → Start Server
                </div>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                  lmStudioInCatalog
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/20 text-red-300'
                }`}
              >
                {lmStudioInCatalog ? `${libraryModels.length} model` : 'Bağlantı yok'}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-800 flex-1">
              {hiddenBrokenCount > 0 && (
                <p className="text-xs text-red-400/80 px-3 py-1.5">
                  {hiddenBrokenCount} çalışmayan model gizlendi.
                </p>
              )}
              {libraryModels.length === 0 ? (
                <p className="text-xs text-gray-500 px-3 py-3">
                  LM Studio kütüphanesi okunamadı. LM Studio'nun açık ve sunucusunun
                  çalıştığından emin olun, ardından "Listeyi Tara"ya basın.
                </p>
              ) : (
                libraryModels.map((lm) => (
                  <div
                    key={lm.libraryKey}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                      <span className="text-sm truncate text-gray-200">{lm.name}</span>
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                        lm.isLoaded
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-gray-600/40 text-gray-400'
                      }`}
                    >
                      {lm.isLoaded ? '● Yüklü' : '○ Kütüphanede'}
                    </span>
                    <button
                      onClick={() => handleAddLMStudioModel(lm)}
                      disabled={isRunning}
                      title={`"${lm.name}" modelini test listesine ekle`}
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded bg-sky-600/80 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
            {libraryModels.length > 1 && (
              <div className="px-3 py-2 border-t border-gray-800">
                <button
                  onClick={handleAddAllLMStudioModels}
                  disabled={isRunning}
                  className="text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50 transition-colors"
                >
                  + Tümünü Ekle ({libraryModels.length} model)
                </button>
              </div>
            )}
          </div>

          {/* ─── Hazır API sağlayıcı kartları (accordion) ─── */}
          <div className="space-y-2">
            {API_PROVIDER_TEMPLATES.map((tpl) => {
              const expanded = expandedProviders.has(tpl.label);
              const keyReady = providerKeyReady(tpl);
              return (
                <div
                  key={tpl.label}
                  className="rounded-lg border border-violet-700/40 bg-gray-900/60 overflow-hidden"
                >
                  <button
                    onClick={() => toggleProviderExpanded(tpl.label)}
                    className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-gray-800/60 transition-colors text-left"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-500 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-500 shrink-0" />
                      )}
                      <Cloud className="h-4 w-4 text-violet-400 shrink-0" />
                      <span className="font-medium text-violet-200 text-sm">{tpl.label}</span>
                      <span className="text-xs text-gray-500 truncate hidden sm:inline">
                        {tpl.hint}
                      </span>
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded shrink-0 flex items-center gap-1 ${
                        keyReady
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {keyReady ? '✓ Anahtar hazır' : <><KeyRound className="h-3 w-3" /> Anahtar gerekli</>}
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-800">
                      <div className="divide-y divide-gray-800">
                        {tpl.models.map((model) => (
                          <div
                            key={model.modelId}
                            className="flex items-center gap-2 px-4 py-2 hover:bg-gray-800/60 transition-colors"
                          >
                            <span className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-sm truncate text-gray-200">{model.name}</span>
                              <code className="text-xs text-gray-500 truncate hidden md:inline">
                                {model.modelId}
                              </code>
                            </span>
                            <button
                              onClick={() => handleAddApiModel(tpl, model)}
                              disabled={isRunning}
                              title={`"${model.name}" modelini test listesine ekle`}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded bg-sky-600/80 hover:bg-sky-500 disabled:opacity-40 text-white transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      {/* Anahtar inputu — anahtar yoksa otomatik açılır */}
                      {!keyReady && (
                        <div className="px-4 py-3 border-t border-gray-800 bg-amber-500/5">
                          <label className="block text-xs text-amber-300 mb-1.5 flex items-center gap-1.5">
                            <KeyRound className="h-3.5 w-3.5" />
                            {tpl.label} API anahtarı ({tpl.hint})
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={providerApiKeys[tpl.label] ?? ''}
                              onChange={(e) =>
                                setProviderApiKeys((prev) => ({
                                  ...prev,
                                  [tpl.label]: e.target.value,
                                }))
                              }
                              placeholder="sk-..."
                              className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500"
                            />
                            <button
                              onClick={() => handleSaveProviderKey(tpl)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded transition-colors"
                            >
                              Kaydet
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          TEST EDİLECEK MODELLER — alt bölüm
          Katalogdan + ile eklenir, − ile çıkarılır.
          "Testi Başlat" YALNIZCA bu listedeki modelleri çalıştırır.
          ═══════════════════════════════════════════════════════ */}
      <section className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
        <h3 className="font-semibold text-gray-200 flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-sky-400" />
          Test Edilecek Modeller
          <span className="text-xs font-normal text-gray-500">
            ({selectedTestModels.length} model — "Testi Başlat" yalnızca bu listeyi çalıştırır)
          </span>
        </h3>

        {selectedTestModels.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center border border-dashed border-gray-700 rounded">
            Henüz model eklenmedi. Yukarıdaki <b className="text-gray-400">Bağlantı Kataloğu</b>'ndan
            bir modelin yanındaki <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-sky-600 text-white align-middle mx-0.5"><Plus className="h-3.5 w-3.5" /></span> tuşuna basın.
          </p>
        ) : (
          <div className="rounded border border-gray-700 divide-y divide-gray-700/50 max-h-56 overflow-y-auto">
            {selectedTestModels.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-2 bg-sky-500/5 hover:bg-gray-700/40 transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  {item.provider === 'lmstudio' ? (
                    <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <Cloud className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                  )}
                  <span className="text-sm truncate text-sky-100">{item.name}</span>
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                    item.provider === 'lmstudio'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-violet-500/20 text-violet-300'
                  }`}
                >
                  {item.provider === 'lmstudio' ? 'LM Studio' : '☁ API'}
                </span>
                <button
                  onClick={() => handleRemoveFromTestList(item)}
                  disabled={isRunning}
                  title={`"${item.name}" modelini listeden çıkar`}
                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded bg-red-600/70 hover:bg-red-500 disabled:opacity-40 text-white transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hakem modeli seçimi */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            <Scale className="inline h-4 w-4 mr-1 text-violet-400" />
            Hakem AI Modeli (Judge)
            <span className="ml-2 text-xs text-gray-500 font-normal">
              — test modellerinden bağımsız; yalnızca puanlama sorguları alır
            </span>
          </label>
          <select
            value={judgeModelId}
            onChange={(e) => setJudgeModelId(e.target.value)}
            disabled={isRunning}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white disabled:opacity-50"
          >
            <option value="">-- Hakem Modeli Seçin --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isJudge ? ' ★ (Aktif Hakem)' : ''}
              </option>
            ))}
          </select>
          {judgeModel && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-900/60 rounded px-3 py-2 border border-gray-700">
                <Scale className="h-3.5 w-3.5 shrink-0 mt-0.5 text-violet-400" />
                <span>
                  Hakem: <b className="text-gray-200">{judgeModel.name}</b>{' '}
                  (<code className="text-gray-500">{judgeModel.modelId}</code>). Test
                  sorgularınız yalnızca yukarıdaki listedeki modellere gider; hakem modeli
                  yalnızca cevapları puanlamak için ayrı sorgular alır.
                </span>
              </div>
              {judgeIsThinking && (
                <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 rounded px-3 py-2 border border-amber-500/40">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Hakem olarak bir <b>düşünme (thinking) modeli</b> seçili: bu model her
                    puanlamada önce uzun düşünme üretir, puanlama belirgin şekilde yavaşlar.
                    Hızlı bir model (örn. küçük bir sohbet modeli) hakem olarak önerilir.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Başlat + Durdur + Senkronize düğmeleri */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <button
            onClick={handleStartTest}
            disabled={isRunning || serverLocked || selectedTestModels.length === 0 || !judgeModelId}
            title={
              selectedTestModels.length === 0
                ? 'Önce katalogdan + ile model ekleyin'
                : `Yalnızca listedeki ${selectedTestModels.length} model test edilecek`
            }
            className="flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded transition-colors"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Test Çalışıyor...
              </>
            ) : serverLocked ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Başka Bir Test Çalışıyor...
              </>
            ) : (
              <>
                <Play className="h-5 w-5" /> Testi Başlat ({selectedTestModels.length} model)
              </>
            )}
          </button>

          <button
            onClick={handleSyncModels}
            disabled={syncing || isRunning}
            title="Duplicate kayıtları siler, isimleri LM Studio kimlikleriyle düzeltir, kütüphanede olmayan modelleri temizler"
            className="flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white font-medium py-3 px-4 rounded transition-colors text-sm"
          >
            {syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Senkronize ediliyor...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> Model Listesini Senkronize Et
              </>
            )}
          </button>
        </div>

        {(isRunning || serverLocked) && (
          <div className="mt-3">
            <button
              onClick={handleStopTest}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded transition-colors"
            >
              <Square className="h-4 w-4" /> Testi Durdur
            </button>
          </div>
        )}

        {/* Toplu test ilerleme göstergesi */}
        {isRunning && batchInfo && (
          <div className="mt-4 p-3 bg-sky-500/10 border border-sky-500/40 rounded">
            <div className="flex items-center justify-between text-sm text-sky-300 mb-1">
              <span className="font-medium">Test Sırası</span>
              <span>
                Model {batchInfo.index}/{batchInfo.total}
                {batchInfo.modelName ? ` — ${batchInfo.modelName}` : ''}
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-sky-500 transition-all duration-500"
                style={{ width: `${(batchInfo.index / batchInfo.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* İlerleme çubuğu */}
        {(isRunning || progress > 0) && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>İlerleme</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  error ? 'bg-red-500' : completed ? 'bg-emerald-500' : 'bg-gradient-to-r from-sky-500 to-violet-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Sunucuda başka bir test çalışıyor uyarısı */}
        {serverLocked && !isRunning && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/40 rounded text-sm text-amber-300">
            <Loader2 className="h-5 w-5 shrink-0 mt-0.5 animate-spin" />
            <span>
              Şu anda sunucuda başka bir benchmark testi çalışıyor
              {serverLockedBy ? ` (${serverLockedBy})` : ''}. Bir test tam olarak
              tamamlanmadan yenisi başlatılamaz; bu uyarı, o test bittiğinde otomatik kalkar.
            </span>
          </div>
        )}

        {/* Hata mesajı */}
        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-300">
            <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Tamamlandı bilgisi */}
        {completed && !isRunning && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/40 rounded text-sm text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <span>
              Test tamamlandı! Genel Skor: <b>{completed.totalScore}/100</b> — Sonuçlar
              Leaderboard sekmesinde.
            </span>
          </div>
        )}

        {/* Canlı durum mesajları */}
        {statusMessages.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-gray-500 mb-1">Canlı Durum:</div>
            <div
              ref={statusLogRef}
              className="p-3 bg-gray-950/70 rounded border border-gray-700 max-h-56 overflow-y-auto text-xs font-mono space-y-1"
            >
              {statusMessages.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.kind === 'retry'
                      ? 'text-amber-400'
                      : msg.kind === 'error'
                        ? 'text-red-400'
                        : 'text-gray-400'
                  }
                >
                  {msg.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4 Sütunlu dinamik değerlendirme motoru açıklaması */}
      <div className="text-xs text-gray-500 border-t border-gray-700 pt-3 space-y-2">
        <p className="font-medium text-gray-400">4 Sütunlu Dinamik Değerlendirme Motoru (13 soru):</p>
        <p>
          <b className="text-sky-300">1. Dinamik Şablonlama:</b> Sorular her koşuda rastgele
          isim/sayılarla yeniden üretilir — ezber (data contamination) kırılır, gerçek cebirsel
          çözüm ölçülür.
        </p>
        <p>
          <b className="text-emerald-300">2. Canlı Kod Çalıştırma:</b> Kod cevapları izole
          sandbox'ta gizli unit testlerden geçer: doğruluk + 100.000 elemanlı dizide O(n)
          performans testi + derin recursion stresi.
        </p>
        <p>
          <b className="text-amber-300">3. Needle in a Haystack:</b> 2k ve 8k token anlamsız metin
          yığınlarının içine rastgele gizli şifre saklanır; uzun context'te dikkat kaybı ölçülür.
        </p>
        <p>
          <b className="text-violet-300">4. Baskı Testi (Sycophancy):</b> Model doğru cevap
          verdikten sonra yanlış değerle baskı yapılır: cevabını savunursa 100, boyun eğerse 50 puan.
        </p>
        <p className="text-gray-400">
          📊 <b>Metrik paneli:</b> Doğruluk Skoru (0-100) · TTFT/TPS (hız) · Biçim Disiplini
          (istenen formatı ilk denemede tutturma oranı — retry maliyetini ölçer).
        </p>
        <p className="text-gray-500">
          VRAM dostu akış korunur: Warm-up ping → Faz 1: tüm sorular + baskı turu (model sıcak
          kalır) → Faz 2: Deterministik + Sandbox + Hakem AI puanlaması. LM Studio modelleri
          test başlamadan otomatik VRAM'e yüklenir (JIT loading) — ilk istek yavaş görünebilir.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════
          KATEGORİ SEÇİM MODALI — "Testi Başlat" sonrası açılır
          Genel / Kodlama / Türkçe / Hepsi
          ═══════════════════════════════════════════════════════ */}
      {showCategoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowCategoryModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal başlık */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h3 className="font-semibold text-gray-100 flex items-center gap-2">
                <Menu className="h-5 w-5 text-sky-400" />
                Test Kategorisi Seç
              </h3>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                title="Kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal içerik */}
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-400">
                Bu koşuda hangi test setinin çalışacağını seçin. Seçim yalnızca bu koşuyu
                etkiler; soru havuzu seçimleriniz (Soru Havuzu sekmesi) aynen geçerli kalır.
              </p>

              {/* Genel */}
              <button
                onClick={() => {
                  setSelectedCategory('general');
                  startBenchmark('general');
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 bg-gray-800/60 hover:border-sky-500/60 hover:bg-sky-500/10 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <ClipboardList className="h-5 w-5 text-sky-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-100 group-hover:text-sky-200">
                        Genel
                      </div>
                      <div className="text-xs text-gray-400">
                        Mevcut testler — Kodlama ve Türkçe HARİÇ (mantık, matematik, IFEval,
                        JSON, kod, needle, baskı direnci, Türkçe başarım)
                      </div>
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-sky-400 opacity-0 group-hover:opacity-100 shrink-0" />
                </div>
              </button>

              {/* Kodlama */}
              <button
                onClick={() => {
                  setSelectedCategory('coding');
                  startBenchmark('coding');
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 bg-gray-800/60 hover:border-emerald-500/60 hover:bg-emerald-500/10 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="h-5 w-5 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-100 group-hover:text-emerald-200">
                        Kodlama
                      </div>
                      <div className="text-xs text-gray-400">
                        5 seviyeli kodlama benchmark seti (Python 3.11+): Rate Limiter, Async
                        Task Queue, LRU Cache, Kod Analizi, Saga Pattern
                      </div>
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-emerald-400 opacity-0 group-hover:opacity-100 shrink-0" />
                </div>
              </button>

              {/* Türkçe */}
              <button
                onClick={() => {
                  setSelectedCategory('turkish');
                  startBenchmark('turkish');
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 bg-gray-800/60 hover:border-violet-500/60 hover:bg-violet-500/10 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Radio className="h-5 w-5 text-violet-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-100 group-hover:text-violet-200">
                        Türkçe
                      </div>
                      <div className="text-xs text-gray-400">
                        10 soruluk genel Türkçe yetkinlik seti (ekim, deyim, özet, dilbilgisi,
                        anlam, yazım, cümle, sözcük, paragraf, edebi)
                      </div>
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-violet-400 opacity-0 group-hover:opacity-100 shrink-0" />
                </div>
              </button>

              {/* Hepsi */}
              <button
                onClick={() => {
                  setSelectedCategory('all');
                  startBenchmark('all');
                }}
                className="w-full text-left p-4 rounded-lg border border-gray-700 bg-gray-800/60 hover:border-amber-500/60 hover:bg-amber-500/10 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Zap className="h-5 w-5 text-amber-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-100 group-hover:text-amber-200">
                        Hepsi
                      </div>
                      <div className="text-xs text-gray-400">
                        Tüm kategoriler: Genel + Kodlama + Türkçe (en kapsamlı koşu, en uzun
                        süre)
                      </div>
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-amber-400 opacity-0 group-hover:opacity-100 shrink-0" />
                </div>
              </button>
            </div>

            {/* Modal alt bilgi */}
            <div className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
              Seçilen kategori, test motoruna <code className="text-gray-400">selectedCategories</code>{' '}
              parametresiyle iletilir; yalnızca o kategorinin soruları üretilir ve puanlanır.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

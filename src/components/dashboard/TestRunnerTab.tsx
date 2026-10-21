'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ModelConfig, RunProgressEvent, BenchmarkRun } from '@/types/benchmark';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Scale,
  HardDriveDownload,
  Layers,
  Square,
  RefreshCw,
  ClipboardList,
  Cloud,
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

export default function TestRunnerTab({ onRunComplete, onRunningChange }: TestRunnerTabProps) {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [libraryModels, setLibraryModels] = useState<LibraryModel[]>([]);
  const [testModelId, setTestModelId] = useState('');
  const [judgeModelId, setJudgeModelId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
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

  useEffect(() => {
    fetchModels();
    fetchLibrary();
    fetchLockStatus();
    fetchQuestionSelection();
  }, [fetchModels, fetchLibrary, fetchLockStatus, fetchQuestionSelection]);

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

  // Kütüphaneden model seçilince kaydet ve seçili test modeli yap
  const handleSelectLibraryModel = async (libModel: LibraryModel) => {
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
      setTestModelId(saved.id);
      addStatus(
        `📚 "${saved.name}" kütüphaneden seçildi. Test başladığında LM Studio modeli otomatik yükleyecek.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  // Toplu test: kütüphanedeki TÜM modelleri sırayla yükle → test → eject
  const handleStartBatchTest = async () => {
    if (serverLocked || isRunning) {
      setError('Şu anda başka bir test çalışıyor.');
      return;
    }

    setIsBatchRunning(true);
    setIsRunning(true);
    onRunningChange?.(true);
    setProgress(0);
    setStatusMessages([]);
    setError(null);
    setCompleted(null);
    setBatchInfo(null);
    addStatus('🚀 Toplu test başlatılıyor: kütüphanedeki tüm modeller sırayla test edilecek...');

    try {
      const res = await fetch('/api/benchmark/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(judgeModelId ? { judgeModelId } : {}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error ?? `Toplu test başlatılamadı (HTTP ${res.status})`);
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
            addStatus(event.message);

            if (event.batchIndex !== undefined && event.batchTotal !== undefined) {
              setBatchInfo({
                index: event.batchIndex,
                total: event.batchTotal,
                modelName: event.batchModelName ?? null,
              });
            }
            if (event.type === 'stopped') {
              addStatus('⏹️ Toplu test durduruldu.');
            }
            if (event.type === 'complete') {
              addStatus('🏁 Toplu test tamamlandı! Sonuçlar Leaderboard\'ta.');
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
      setIsBatchRunning(false);
      setIsRunning(false);
      onRunningChange?.(false);
      setBatchInfo(null);
      fetchModels();
      fetchLockStatus();
    }
  };

  const handleStartTest = async () => {
    if (!testModelId || !judgeModelId) {
      setError('Lütfen hem test edilecek modeli hem de Hakem AI modelini seçin.');
      return;
    }
    if (serverLocked) {
      setError('Şu anda başka bir benchmark testi çalışıyor. Lütfen tamamlanmasını bekleyin.');
      return;
    }

    setIsRunning(true);
    onRunningChange?.(true);
    setProgress(0);
    setStatusMessages([]);
    setError(null);
    setCompleted(null);
    addStatus('Test başlatılıyor...');

    try {
      const res = await fetch('/api/benchmark/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testModelId, judgeModelId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (res.status === 409) {
          // Sunucuda başka bir benchmark çalışıyor — kilit durumunu yansıt
          setServerLocked(true);
          setServerLockedBy(errData?.lockedBy ?? null);
          throw new Error(
            errData?.error ??
              'Şu anda başka bir benchmark testi çalışıyor. Lütfen o test tamamlanana kadar bekleyin.'
          );
        }
        throw new Error(errData?.error ?? `Benchmark başlatılamadı (HTTP ${res.status})`);
      }
      if (!res.body) {
        throw new Error('Sunucu akış (stream) döndürmedi');
      }

      // NDJSON akışını satır satır oku
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalRun: BenchmarkRun | null = null;

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

            if (event.type === 'complete' && event.run) {
              finalRun = event.run;
              setCompleted(event.run);
            }
            if (event.type === 'error') {
              setError(event.message);
            }
          } catch {
            // tekil satır hatası akışı bozmasın
          }
        }
      }

      if (finalRun) {
        addStatus(`✅ Test başarıyla tamamlandı — Genel Skor: ${finalRun.totalScore}/100`);
        // 2 saniye bekle, sonra kullanıcıyı Leaderboard'a yönlendir
        setTimeout(() => onRunComplete(finalRun!), 2000);
      } else if (!error) {
        setError('Test akışı beklenmedik şekilde sonlandı.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addStatus(`❌ Hata: ${message}`);
    } finally {
      setIsRunning(false);
      onRunningChange?.(false);
      // Kendi testimiz bitti; sunucudaki kilit durumunu tazele
      fetchLockStatus();
    }
  };

  // Harici API modelleri (LM Studio olmayan) — birleşik listede gösterilir
  const apiModels = models.filter((m) => m.provider !== 'lmstudio');

  const testModel = models.find((m) => m.id === testModelId);
  const judgeModel = models.find((m) => m.id === judgeModelId);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Zap className="h-5 w-5 text-sky-400" /> Test Koşucusu (Live Benchmark)
      </h2>

      {/* Madde 3: Bu koşuda hangi soruların test edileceği göstergesi */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2 bg-gray-800/60 rounded-lg px-4 py-3 border border-gray-700 max-w-3xl">
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

      <div className="bg-gray-800/60 rounded-lg p-6 space-y-5 border border-gray-700 max-w-3xl">
        {/* ─── Tekilleştirilmiş model seçimi ────────────────────
            Tek liste: LM Studio kütüphanesi (canlı tarama) +
            harici API modelleri. Radyo butonuyla tek model seçilir. */}
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <label className="block text-sm font-medium text-gray-300">
              <Zap className="inline h-4 w-4 mr-1 text-sky-400" />
              Test Edilecek Model — listeden seçin
              <span className="ml-2 text-xs text-gray-500 font-normal">
                ({libraryModels.length} LM Studio + {apiModels.length} API modeli)
              </span>
            </label>
            <button
              onClick={fetchLibrary}
              disabled={isRunning}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
              title="LM Studio kütüphanesini yeniden tara"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Listeyi Tara
            </button>
          </div>
          {hiddenBrokenCount > 0 && (
            <p className="text-xs text-red-400/80 mb-1">
              {hiddenBrokenCount} çalışmayan model gizlendi.
            </p>
          )}
          {libraryModels.length === 0 && apiModels.length === 0 ? (
            <p className="text-xs text-gray-500">
              Model bulunamadı. LM Studio ile model indirin veya Model Yönetimi'nden API modeli ekleyin.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700/50">
              {/* LM Studio kütüphane modelleri */}
              {libraryModels.map((lm) => {
                const selected = testModelId === lm.id;
                return (
                  <label
                    key={lm.libraryKey}
                    className={`w-full flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      selected
                        ? 'bg-sky-500/15'
                        : lm.lastLoadError
                          ? 'bg-red-500/5 hover:bg-red-500/10'
                          : 'hover:bg-gray-700/50'
                    }`}
                    title={
                      lm.lastLoadError
                        ? `⚠️ Çalışmıyor: ${lm.lastLoadError}`
                        : 'Seçmek için tıklayın'
                    }
                  >
                    <input
                      type="radio"
                      name="testModel"
                      checked={selected}
                      onChange={() => handleSelectLibraryModel(lm)}
                      disabled={isRunning}
                      className="h-4 w-4 accent-sky-500 shrink-0"
                    />
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <HardDriveDownload
                        className={`h-3.5 w-3.5 shrink-0 ${
                          lm.lastLoadError ? 'text-red-400' : 'text-gray-500'
                        }`}
                      />
                      <span
                        className={`text-sm truncate ${
                          lm.lastLoadError
                            ? 'text-red-300'
                            : selected
                              ? 'text-sky-200 font-medium'
                              : 'text-gray-200'
                        }`}
                      >
                        {lm.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {lm.lastLoadError && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                          ⚠️ Çalışmıyor
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          lm.isLoaded
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-gray-600/40 text-gray-400'
                        }`}
                      >
                        {lm.isLoaded ? '● Yüklü' : '○ Kütüphanede'}
                      </span>
                    </span>
                  </label>
                );
              })}
              {/* Harici API modelleri */}
              {apiModels.map((m) => {
                const selected = testModelId === m.id;
                return (
                  <label
                    key={m.id}
                    className={`w-full flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      selected ? 'bg-sky-500/15' : 'hover:bg-gray-700/50'
                    }`}
                    title="Seçmek için tıklayın"
                  >
                    <input
                      type="radio"
                      name="testModel"
                      checked={selected}
                      onChange={() => setTestModelId(m.id)}
                      disabled={isRunning}
                      className="h-4 w-4 accent-sky-500 shrink-0"
                    />
                    <span className="flex items-center gap-2 min-w-0 flex-1">
                      <Cloud className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span
                        className={`text-sm truncate ${
                          selected ? 'text-sky-200 font-medium' : 'text-gray-200'
                        }`}
                      >
                        {m.name}
                      </span>
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 shrink-0">
                      ☁ API
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">
            LM Studio modeli seçtiğinizde kaydedilir; test başladığında otomatik VRAM'e yüklenir (JIT loading).
            Liste "Listeyi Tara" ile her zaman güncellenebilir.
          </p>
        </div>

        {/* Hakem modeli — tek dropdown olarak kalır */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            <Scale className="inline h-4 w-4 mr-1 text-violet-400" />
            Hakem AI Modeli (Judge)
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
        </div>

        {/* Seçilen modellerin özeti */}
        {(testModel || judgeModel) && (
          <div className="text-xs text-gray-500 space-y-1">
            {testModel && (
              <p>
                Test modeli: <span className="text-gray-300">{testModel.modelId}</span> @ {testModel.baseUrl}
              </p>
            )}
            {judgeModel && (
              <p>
                Hakem modeli: <span className="text-gray-300">{judgeModel.modelId}</span> @ {judgeModel.baseUrl}
              </p>
            )}
          </div>
        )}

        {/* Başlat + Toplu Test + Durdur + Senkronize düğmeleri */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={handleStartTest}
            disabled={isRunning || serverLocked || !testModelId || !judgeModelId}
            className="flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded transition-colors"
          >
            {isRunning && !isBatchRunning ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Test Çalışıyor...
              </>
            ) : serverLocked ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Başka Bir Test Çalışıyor...
              </>
            ) : (
              <>
                <Play className="h-5 w-5" /> Testi Başlat
              </>
            )}
          </button>

          <button
            onClick={handleStartBatchTest}
            disabled={isRunning || serverLocked || !judgeModelId}
            title="LM Studio kütüphanesindeki tüm modelleri sırayla yükle → test et → boşalt (eject)"
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded transition-colors"
          >
            {isBatchRunning ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Toplu Test Çalışıyor...
              </>
            ) : (
              <>
                <Layers className="h-5 w-5" /> Tüm Modelleri Test Et
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Durdur — yalnızca bir test çalışırken aktif */}
          {(isRunning || isBatchRunning || serverLocked) && (
            <button
              onClick={handleStopTest}
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded transition-colors"
            >
              <Square className="h-4 w-4" /> Testi Durdur
            </button>
          )}

          {/* Model listesini LM Studio ile senkronize et */}
          <button
            onClick={handleSyncModels}
            disabled={syncing || isRunning}
            title="Duplicate kayıtları siler, isimleri LM Studio kimlikleriyle düzeltir, kütüphanede olmayan modelleri temizler"
            className="flex items-center justify-center gap-2 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded transition-colors text-sm"
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

        {/* Toplu test ilerleme göstergesi */}
        {isBatchRunning && batchInfo && (
          <div className="p-3 bg-violet-500/10 border border-violet-500/40 rounded">
            <div className="flex items-center justify-between text-sm text-violet-300 mb-1">
              <span className="font-medium flex items-center gap-2">
                <Layers className="h-4 w-4" /> Toplu Test
              </span>
              <span>
                Model {batchInfo.index}/{batchInfo.total}
                {batchInfo.modelName ? ` — ${batchInfo.modelName}` : ''}
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-violet-500 transition-all duration-500"
                style={{ width: `${(batchInfo.index / batchInfo.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* İlerleme çubuğu */}
        {(isRunning || progress > 0) && (
          <div>
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
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/40 rounded text-sm text-amber-300">
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
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-300">
            <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Tamamlandı bilgisi */}
        {completed && !isRunning && (
          <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/40 rounded text-sm text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <span>
              Test tamamlandı! Genel Skor: <b>{completed.totalScore}/100</b> — Leaderboard'a yönlendiriliyorsunuz...
            </span>
          </div>
        )}

        {/* Canlı durum mesajları */}
        {statusMessages.length > 0 && (
          <div>
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
            kalır) → Faz 2: Deterministik + Sandbox + Hakem AI puanlaması.
          </p>
        </div>
      </div>
    </div>
  );
}

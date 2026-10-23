'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LeaderboardEntry, BenchmarkRun, QuestionResult } from '@/types/benchmark';
import { CATEGORY_LABELS } from '@/lib/benchmark-suite';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
  Radar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
  ResponsiveContainer,
} from 'recharts';
import { Trophy, Brain, Calculator, ListChecks, Braces, Code2, Gauge, Timer, X, ChevronUp, ChevronDown, Coins, FileCheck, Search, ShieldAlert, Hourglass, Languages, ArchiveRestore, Radar as RadarIcon } from 'lucide-react';

/** Sıralanabilir sütun anahtarları. */
type SortKey =
  | 'rank'
  | 'modelName'
  | 'provider'
  | 'totalScore'
  | 'logic'
  | 'math'
  | 'ifeval'
  | 'json'
  | 'code'
  | 'needle'
  | 'adversarial'
  | 'turkish'
  | 'avgTPS'
  | 'avgTTFT'
  | 'avgAnswerDurationMs'
  | 'avgTokens'
  | 'formatDiscipline'
  | 'efficiencyIndex'
  | 'judgeModelName'
  | 'timestamp';

const CHART_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6'];

export default function LeaderboardTab() {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('totalScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [detailRun, setDetailRun] = useState<BenchmarkRun | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Arşiv (geri dönüşüm kutusu) — koşular asla kalıcı silinmez
  const [archivedCount, setArchivedCount] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  // Leaderboard verisini yükle
  const loadLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data: LeaderboardEntry[] = await res.json();
        setLeaderboardData(data);
      }
    } catch (error) {
      console.error('Leaderboard verisi yüklenemedi:', error);
      setLeaderboardData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeaderboard();
    loadArchivedCount();
  }, []);

  // Arşivdeki koşu sayısını yükle (geri yükleme düğmesi göstergesi)
  const loadArchivedCount = async () => {
    try {
      const res = await fetch('/api/runs');
      if (res.ok) {
        const archived: Array<{ id: string }> = await res.json();
        setArchivedCount(archived.length);
      }
    } catch {
      // Arşiv okunamadıysa gösterge 0 kalır — kritik değil
    }
  };

  // Arşivdeki TÜM koşuları geri yükle
  const handleRestoreAll = async () => {
    if (archivedCount === 0) return;
    if (
      !window.confirm(
        `Arşivdeki ${archivedCount} test sonucu leaderboard'a geri yüklenecek. Devam edilsin mi?`
      )
    ) {
      return;
    }
    setRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetch('/api/runs/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Geri yükleme başarısız');
      }
      const body = await res.json();
      setRestoreMessage(`${body.restored} test sonucu geri yüklendi.`);
      await loadLeaderboard();
      await loadArchivedCount();
    } catch (error) {
      console.error('Geri yükleme hatası:', error);
      setRestoreMessage(
        error instanceof Error ? error.message : 'Geri yükleme başarısız'
      );
    } finally {
      setRestoring(false);
    }
  };

  // Model seçimini yönet (maks. 4)
  const handleModelToggle = (id: string) => {
    setSelectedModelIds((prev) => {
      if (prev.includes(id)) return prev.filter((pid) => pid !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  // Sıralama
  const sortedData = useMemo(() => {
    const data = [...leaderboardData];
    data.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'rank':
          cmp =
            leaderboardData.findIndex((e) => e.id === a.id) -
            leaderboardData.findIndex((e) => e.id === b.id);
          break;
        case 'modelName':
          cmp = a.modelName.localeCompare(b.modelName, 'tr');
          break;
        case 'provider':
          cmp = a.provider.localeCompare(b.provider);
          break;
        case 'logic':
          cmp = a.categoryScores.logic - b.categoryScores.logic;
          break;
        case 'math':
          cmp = a.categoryScores.math - b.categoryScores.math;
          break;
        case 'ifeval':
          cmp = a.categoryScores.ifeval - b.categoryScores.ifeval;
          break;
        case 'json':
          cmp = a.categoryScores.json - b.categoryScores.json;
          break;
        case 'code':
          cmp = a.categoryScores.code - b.categoryScores.code;
          break;
        case 'needle':
          cmp = a.categoryScores.needle - b.categoryScores.needle;
          break;
        case 'adversarial':
          cmp = a.categoryScores.adversarial - b.categoryScores.adversarial;
          break;
        case 'turkish':
          cmp = (a.categoryScores.turkish ?? 0) - (b.categoryScores.turkish ?? 0);
          break;
        case 'formatDiscipline':
          cmp = (a.formatDiscipline ?? 100) - (b.formatDiscipline ?? 100);
          break;
        case 'avgTPS':
          cmp = a.avgTPS - b.avgTPS;
          break;
        case 'avgTTFT':
          cmp = a.avgTTFT - b.avgTTFT;
          break;
        case 'avgAnswerDurationMs':
          cmp = (a.avgAnswerDurationMs ?? 0) - (b.avgAnswerDurationMs ?? 0);
          break;
        case 'avgTokens':
          cmp = (a.avgTokens ?? 0) - (b.avgTokens ?? 0);
          break;
        case 'efficiencyIndex':
          cmp = a.efficiencyIndex - b.efficiencyIndex;
          break;
        case 'judgeModelName':
          cmp = a.judgeModelName.localeCompare(b.judgeModelName, 'tr');
          break;
        case 'timestamp':
          cmp = (a.timestamp ?? 0) - (b.timestamp ?? 0);
          break;
        case 'totalScore':
        default:
          cmp = a.totalScore - b.totalScore;
      }
      return sortAsc ? cmp : -cmp;
    });
    return data;
  }, [leaderboardData, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Radar grafiği verisi: 7 yetenek ekseni (5 standart + needle + adversarial)
  const selectedModels = leaderboardData.filter((m) => selectedModelIds.includes(m.id));
  const radarData = useMemo(() => {
    const axes = [
      { axis: 'Mantık', key: 'logic' as const },
      { axis: 'Matematik', key: 'math' as const },
      { axis: 'IFEval', key: 'ifeval' as const },
      { axis: 'JSON', key: 'json' as const },
      { axis: 'Kodlama', key: 'code' as const },
      { axis: 'Dikkat', key: 'needle' as const },
      { axis: 'Baskı Direnci', key: 'adversarial' as const },
      { axis: 'Türkçe', key: 'turkish' as const },
    ];
    return axes.map(({ axis, key }) => {
      const row: Record<string, string | number> = { axis };
      selectedModels.forEach((m) => {
        row[m.modelName] = m.categoryScores[key];
      });
      return row;
    });
  }, [selectedModels]);

  // Bar grafiği verisi: TPS + Skor kıyaslaması
  const barData = selectedModels.map((m) => ({
    name: m.modelName.length > 18 ? `${m.modelName.slice(0, 18)}…` : m.modelName,
    'Genel Skor': m.totalScore,
    'Verimlilik': m.efficiencyIndex,
  }));

  // Satıra tıklandığında detay modalı için koşuyu çek
  const openDetail = async (entry: LeaderboardEntry) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/runs/${entry.runId}`);
      if (res.ok) {
        const run: BenchmarkRun = await res.json();
        setDetailRun(run);
      }
    } catch (error) {
      console.error('Koşu detayı alınamadı:', error);
    } finally {
      setDetailLoading(false);
    }
  };

  const SortHeader = ({ label, sortKeyName, icon }: { label: string; sortKeyName: SortKey; icon?: React.ReactNode }) => (
    <th
      onClick={() => handleSort(sortKeyName)}
      className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-200 whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-1">
        {icon}
        {label}
        {sortKey === sortKeyName &&
          (sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" /> Başarım Sıralaması
        </h2>
        <p className="text-gray-400">Yükleniyor...</p>
      </div>
    );
  }

  if (leaderboardData.length === 0) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" /> Başarım Sıralaması
          </h2>
          <span className="text-xs text-gray-500">
            📊 Tüm puanlar <b className="text-gray-300">0-100</b> arası: Genel Skor = soru puanlarının ortalaması ·
            Verimlilik = Skor × Hız dengesi · TPS = saniyede token · TTFT = ilk token gecikmesi
          </span>
        </div>
        <p className="text-gray-400">
          Henüz test koşusu yok. Test Koşucusu sekmesinden bir benchmark başlatın.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-yellow-500" /> Başarım Sıralaması
      </h2>

      {/* Kalıcılık çubuğu: test sonuçları asla silinmez; arşivden geri yükleme */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-500">
          📊 Tüm puanlar <b className="text-gray-300">0-100</b> arası · Radar grafiği için
          satırdaki <RadarIcon className="inline h-3 w-3 text-sky-400" /> ikonuna tıklayarak 2-4 model seçin ·
          Test sonuçları kalıcıdır, asla silinmez
        </span>
        <div className="flex items-center gap-2">
          {restoreMessage && (
            <span className="text-xs text-emerald-300">{restoreMessage}</span>
          )}
          {archivedCount > 0 && (
            <button
              onClick={handleRestoreAll}
              disabled={restoring}
              className="flex items-center gap-2 text-sm font-medium py-2 px-3 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
              title="Arşivlenmiş test sonuçlarını leaderboard'a geri yükle"
            >
              <ArchiveRestore className="h-4 w-4" />
              {restoring
                ? 'Geri yükleniyor...'
                : `Arşivden Geri Yükle (${archivedCount})`}
            </button>
          )}
        </div>
      </div>

      {/* Grafikler */}
      {selectedModels.length >= 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700">
            <h3 className="font-semibold mb-4 text-gray-200">Yetenek Karşılaştırması (Radar)</h3>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
                {selectedModels.map((model, index) => (
                  <Radar
                    key={model.id}
                    name={model.modelName}
                    dataKey={model.modelName}
                    stroke={CHART_COLORS[index % CHART_COLORS.length]}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                    fillOpacity={0.25}
                  />
                ))}
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700">
            <h3 className="font-semibold mb-4 text-gray-200">Skor / Verimlilik Kıyaslaması</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={barData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Genel Skor" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Verimlilik" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Sıralama tablosu */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="min-w-full bg-gray-800/60 divide-y divide-gray-700">
          <thead className="bg-gray-900/80">
            <tr>
              {/* Madde 1: radar karşılaştırma sütunu başlığı (hücre hizası için) */}
              <th className="px-2 py-3" title="Radar grafiğinde karşılaştır">
                <RadarIcon className="h-3.5 w-3.5 text-gray-500" />
              </th>
              <SortHeader label="#" sortKeyName="rank" />
              <SortHeader label="Model Adı" sortKeyName="modelName" />
              <SortHeader label="Sağlayıcı" sortKeyName="provider" />
              <SortHeader label="Genel Skor" sortKeyName="totalScore" icon={<Trophy className="h-3 w-3 text-yellow-500" />} />
              <SortHeader label="Mantık" sortKeyName="logic" icon={<Brain className="h-3 w-3" />} />
              <SortHeader label="Matematik" sortKeyName="math" icon={<Calculator className="h-3 w-3" />} />
              <SortHeader label="IFEval" sortKeyName="ifeval" icon={<ListChecks className="h-3 w-3" />} />
              <SortHeader label="JSON" sortKeyName="json" icon={<Braces className="h-3 w-3" />} />
              <SortHeader label="Kodlama" sortKeyName="code" icon={<Code2 className="h-3 w-3" />} />
              <SortHeader label="Dikkat (Needle)" sortKeyName="needle" icon={<Search className="h-3 w-3" />} />
              <SortHeader label="Baskı Direnci" sortKeyName="adversarial" icon={<ShieldAlert className="h-3 w-3" />} />
              <SortHeader label="Türkçe" sortKeyName="turkish" icon={<Languages className="h-3 w-3 text-red-400" />} />
              <SortHeader label="Ort. TPS (tok/sn)" sortKeyName="avgTPS" icon={<Gauge className="h-3 w-3" />} />
              <SortHeader label="Ort. Token" sortKeyName="avgTokens" icon={<Coins className="h-3 w-3" />} />
              <SortHeader label="Ort. TTFT (ms)" sortKeyName="avgTTFT" icon={<Timer className="h-3 w-3" />} />
              <SortHeader label="Ort. Cevap Süresi" sortKeyName="avgAnswerDurationMs" icon={<Hourglass className="h-3 w-3" />} />
              <SortHeader label="Biçim Disiplini" sortKeyName="formatDiscipline" icon={<FileCheck className="h-3 w-3" />} />
              <SortHeader label="Verimlilik" sortKeyName="efficiencyIndex" />
              <SortHeader label="Hakem Model" sortKeyName="judgeModelName" />
              <SortHeader label="Test Tarihi" sortKeyName="timestamp" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {sortedData.map((entry) => {
              const originalRank = leaderboardData.findIndex((e) => e.id === entry.id) + 1;
              return (
                <tr
                  key={entry.id}
                  onClick={() => openDetail(entry)}
                  className="hover:bg-gray-700/50 cursor-pointer transition-colors"
                  title="Detayları görmek için tıklayın"
                >
                  {/* Madde 1: radar karşılaştırma seçimi satıra taşındı */}
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleModelToggle(entry.id)}
                      className={`p-1.5 rounded transition-colors ${
                        selectedModelIds.includes(entry.id)
                          ? 'bg-sky-500/30 text-sky-300'
                          : 'text-gray-500 hover:text-sky-400 hover:bg-gray-700/50'
                      }`}
                      title={
                        selectedModelIds.includes(entry.id)
                          ? 'Karşılaştırmadan çıkar'
                          : 'Radar grafiğinde karşılaştır (maks. 4)'
                      }
                    >
                      <RadarIcon className="h-4 w-4" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-white">
                    {originalRank === 1 ? '🥇' : originalRank === 2 ? '🥈' : originalRank === 3 ? '🥉' : originalRank}
                  </td>
                  <td className="px-4 py-3 text-sm text-white font-medium max-w-xs truncate">
                    {entry.modelName}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        entry.provider === 'lmstudio'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-violet-500/20 text-violet-300'
                      }`}
                    >
                      {entry.provider === 'lmstudio' ? 'LM Studio' : 'API'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-sky-300">{entry.totalScore}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.logic}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.math}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.ifeval}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.json}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.code}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.needle}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.adversarial}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.categoryScores.turkish ?? 0}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.avgTPS.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{(entry.avgTokens ?? 0).toFixed(0)}</td>
                  <td className="px-4 py-3 text-sm text-gray-200">{entry.avgTTFT.toFixed(0)}</td>
                  <td className="px-4 py-3 text-sm">
                    {entry.avgAnswerDurationMs !== undefined ? (
                      <span
                        className={`font-medium ${
                          entry.avgAnswerDurationMs < 15000
                            ? 'text-emerald-300'
                            : entry.avgAnswerDurationMs < 45000
                              ? 'text-amber-300'
                              : 'text-red-300'
                        }`}
                      >
                        {(entry.avgAnswerDurationMs / 1000).toFixed(1)} sn
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={`font-medium ${
                        (entry.formatDiscipline ?? 100) >= 80
                          ? 'text-emerald-300'
                          : (entry.formatDiscipline ?? 100) >= 50
                            ? 'text-amber-300'
                            : 'text-red-300'
                      }`}
                    >
                      {entry.formatDiscipline ?? 100}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-emerald-300">{entry.efficiencyIndex}</td>
                  <td className="px-4 py-3 text-sm text-gray-400 max-w-[10rem] truncate">{entry.judgeModelName}</td>
                  <td
                    className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap tabular-nums"
                    title={entry.timestamp ? new Date(entry.timestamp).toLocaleString('tr-TR') : undefined}
                  >
                    {entry.timestamp
                      ? new Date(entry.timestamp).toLocaleString('tr-TR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detay Modalı */}
      {(detailRun || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            setDetailRun(null);
            setDetailLoading(false);
          }}
        >
          <div
            className="bg-gray-800 rounded-xl border border-gray-700 max-w-4xl w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">
                {detailRun ? `${detailRun.modelConfig.name} — Detaylı Sonuçlar` : 'Yükleniyor...'}
              </h3>
              <button
                onClick={() => {
                  setDetailRun(null);
                  setDetailLoading(false);
                }}
                className="p-1 rounded hover:bg-gray-700 text-gray-400"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailRun && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
                  <StatCard label="Genel Skor (0-100)" value={`${detailRun.totalScore}/100`} color="text-sky-300" />
                  <StatCard label="Ort. TTFT" value={`${detailRun.avgTTFT.toFixed(0)} ms`} color="text-amber-300" />
                  <StatCard label="Ort. TPS" value={`${detailRun.avgTPS.toFixed(2)} tok/sn`} color="text-emerald-300" />
                  <StatCard
                    label="Ort. Cevap Süresi"
                    value={
                      detailRun.avgAnswerDurationMs !== undefined
                        ? `${(detailRun.avgAnswerDurationMs / 1000).toFixed(1)} sn`
                        : '—'
                    }
                    color="text-orange-300"
                  />
                  <StatCard
                    label="Ort. Token / Soru"
                    value={(
                      detailRun.results.reduce((s, r) => s + (r.totalTokens ?? 0), 0) /
                      Math.max(1, detailRun.results.length)
                    ).toFixed(0)}
                    color="text-cyan-300"
                  />
                  <StatCard
                    label="Biçim Disiplini"
                    value={`${detailRun.formatDiscipline ?? 100}%`}
                    color={(detailRun.formatDiscipline ?? 100) >= 80 ? 'text-emerald-300' : 'text-amber-300'}
                  />
                  <StatCard label="Hakem AI" value={detailRun.judgeModelConfig?.name ?? '—'} color="text-violet-300" />
                </div>

                <div className="space-y-4">
                  {detailRun.results.map((result: QuestionResult) => (
                    <div key={result.questionId} className="bg-gray-900/60 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex-1">
                          <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                            Soru {result.questionId} · {CATEGORY_LABELS[result.category]}
                          </span>
                          <p className="mt-2 text-sm text-gray-300">{result.question}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xl font-bold text-white">
                            {result.finalScore}
                            <span className="text-sm text-gray-500">/100</span>
                          </div>
                          <div className="text-xs text-gray-500">puan</div>
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-3">
                        <span>Deterministik (0-100): <b className="text-gray-300">{result.deterministicScore}/100</b></span>
                        {result.judgeScore !== null && (
                          <span>Hakem AI (0-100): <b className="text-gray-300">{result.judgeScore}/100</b></span>
                        )}
                        {result.formatCompliant !== undefined && (
                          <span>
                            Biçim Uyumu:{' '}
                            <b className={result.formatCompliant ? 'text-emerald-300' : 'text-red-300'}>
                              {result.formatCompliant ? '✓ İlk denemede uydu' : '✗ Formatı bozdu'}
                            </b>
                          </span>
                        )}
                        {result.resistanceScore !== undefined && (
                          <span>
                            Baskı Direnci:{' '}
                            <b className={result.resistanceScore === 100 ? 'text-emerald-300' : result.resistanceScore === 50 ? 'text-amber-300' : 'text-red-300'}>
                              {result.resistanceScore === 100 ? '🛡️ Cevabını savundu' : result.resistanceScore === 50 ? '⚠️ Boyun eğdi' : '✗ Baştan yanlış'}
                            </b>
                          </span>
                        )}
                        {result.answerDurationMs !== undefined && (
                          <span>
                            Cevap Süresi:{' '}
                            <b className="text-orange-300">{(result.answerDurationMs / 1000).toFixed(1)} sn</b>
                          </span>
                        )}
                        <span>TTFT: <b className="text-gray-300">{result.ttft} ms</b></span>
                        <span>TPS: <b className="text-gray-300">{result.tps.toFixed(2)} tok/sn</b></span>
                        <span>Token: <b className="text-gray-300">{result.totalTokens ?? '—'}</b></span>
                        <span>Üretim: <b className="text-gray-300">{result.generationMs ? `${result.generationMs} ms` : '—'}</b></span>
                      </div>

                      {result.sandboxTests && result.sandboxTests.length > 0 && (
                        <div className="mt-3 p-3 bg-gray-950/60 rounded border border-gray-700">
                          <div className="text-xs text-gray-400 font-medium mb-2">
                            🧪 Sandbox Unit Testleri ({result.sandboxTests.filter((t) => t.passed).length}/{result.sandboxTests.length} geçti):
                          </div>
                          <div className="space-y-1">
                            {result.sandboxTests.map((test) => (
                              <div key={test.name} className="flex items-start gap-2 text-xs">
                                <span className={test.passed ? 'text-emerald-400' : 'text-red-400'}>
                                  {test.passed ? '✓' : '✗'}
                                </span>
                                <span className="text-gray-300">{test.name}</span>
                                <span className="text-gray-600">({test.durationMs} ms)</span>
                                {test.detail && !test.passed && (
                                  <span className="text-red-400/80 truncate max-w-md" title={test.detail}>
                                    — {test.detail}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {result.adversarialAnswer && (
                        <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                          <div className="text-xs text-amber-300 font-medium mb-1">
                            🛡️ Baskı Turu Cevabı (sycophancy testi):
                          </div>
                          <pre className="text-xs text-gray-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {result.adversarialAnswer}
                          </pre>
                        </div>
                      )}

                      {result.thinkingProcess && (
                        <details className="mt-3">
                          <summary className="text-xs text-amber-400/80 cursor-pointer hover:text-amber-300">
                            🧠 Düşünme süreci (reasoning)
                          </summary>
                          <pre className="mt-2 p-3 bg-gray-950/60 rounded text-xs text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {result.thinkingProcess}
                          </pre>
                        </details>
                      )}

                      <div className="mt-3">
                        <div className="text-xs text-gray-500 mb-1">Model Cevabı:</div>
                        <pre className="p-3 bg-gray-950/60 rounded text-sm text-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {result.finalAnswer || '(boş cevap)'}
                        </pre>
                      </div>

                      {result.judgeReasoning && (
                        <div className="mt-3 p-3 bg-violet-500/10 border border-violet-500/30 rounded">
                          <div className="text-xs text-violet-300 font-medium mb-1">
                            ⚖️ Hakem AI Gerekçesi:
                          </div>
                          <p className="text-sm text-gray-300">{result.judgeReasoning}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-900/60 rounded-lg p-3 border border-gray-700">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${color} truncate`}>{value}</div>
    </div>
  );
}

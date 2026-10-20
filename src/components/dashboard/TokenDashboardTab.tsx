'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  Coins,
  Cpu,
  Gauge,
  RotateCcw,
  Zap,
} from 'lucide-react';

/**
 * LM Studio Token Sayacı — canlı, model bazlı token kullanım paneli.
 *
 * Veri kaynağı: token-counter.py daemon (127.0.0.1:8790), LM Studio'nun
 * motor seviyesi sunucu loglarını parse eder. Uygulama içi sohbet + API
 * dahil TÜM tahminleri kapsar. Bu bileşen /api/token-stats proxy'sinden
 * 1 saniyede bir çeker.
 */

/** Daemon /stats yanıtının kullanılan alanları. */
interface TokenStats {
  totals: { prompt_tokens: number; completion_tokens: number; predictions: number };
  today: { date: string; prompt_tokens: number; completion_tokens: number; predictions: number };
  models: Record<
    string,
    {
      prompt_tokens: number;
      completion_tokens: number;
      predictions: number;
      last_ts: number;
      label: string;
    }
  >;
  recent: Array<{
    ts: number;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    tokens_per_second: number | null;
  }>;
  in_flight_tokens: number;
  last_event_ts: number;
  log_tail: {
    files_parsed: number;
    last_file: string | null;
    offset: number;
    last_error: string | null;
  };
}

/** Tarih aralığı state'i: null = filtre yok. */
interface DateRange {
  from: string | null;
  to: string | null;
}

const nf = new Intl.NumberFormat('tr-TR');

/** Unix saniyeyi tr-TR saat metnine çevirir. */
function fmtTime(unix: number): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleTimeString('tr-TR');
}

/** YYYY-MM-DD üretir (yerel saat). */
function localIso(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function TokenDashboardTab() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [resetting, setResetting] = useState(false);
  /** Daemon'a canlı bağlantı durumu (nokta rengi için). */
  const [live, setLive] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  // ─── Veri çekme: 1 saniyede bir canlı yenile ──
  const load = useCallback(async () => {
    const { from, to } = rangeRef.current;
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    try {
      const res = await fetch(`/api/token-stats${qs.toString() ? `?${qs}` : ''}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const data: TokenStats = await res.json();
      setStats(data);
      setLive(true);
      setError(null);
    } catch (e) {
      setLive(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 1000);
    return () => clearInterval(interval);
  }, [load]);

  // ─── Tarih filtresi yardımcıları ──
  const applyRange = (from: string | null, to: string | null) =>
    setRange({ from, to });

  const setToday = () => {
    const d = localIso(new Date());
    applyRange(d, d);
  };
  const setYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const s = localIso(d);
    applyRange(s, s);
  };
  const set7 = () => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    applyRange(localIso(d), localIso(new Date()));
  };
  const setAll = () => applyRange(null, null);

  // ─── Sayaç sıfırlama ──
  const handleReset = async () => {
    if (
      !window.confirm(
        'Tüm token sayaçları sıfırlansın mı? (Log konumları korunur, çift sayım olmaz.)'
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch('/api/token-stats/reset', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  };

  // ─── Türetilmiş değerler ──
  const totals = stats?.totals;
  const totalTokens =
    (totals?.completion_tokens ?? 0) + (totals?.prompt_tokens ?? 0);
  const busy = stats?.in_flight_tokens ?? 0;
  const ageSec = stats?.last_event_ts
    ? Math.max(0, Math.round(Date.now() / 1000 - stats.last_event_ts))
    : null;

  const models = stats
    ? Object.entries(stats.models)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => b.completion_tokens - a.completion_tokens)
    : [];
  const maxModelTokens = Math.max(1, ...models.map((m) => m.completion_tokens));

  const rangeLabel =
    range.from || range.to
      ? `Seçili aralık: ${range.from ?? '…'} — ${range.to ?? '…'}`
      : 'Tüm zamanlar';

  return (
    <div className="space-y-5">
      {/* Başlık + canlı bağlantı göstergesi */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                !live
                  ? 'bg-red-500'
                  : busy > 0
                    ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,166,35,0.5)]'
                    : 'bg-emerald-400'
              }`}
            />
            LM Studio Token Sayacı
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Uygulama içi sohbet + API dahil tüm tahminler, model bazlı canlı
            toplam — motor seviyesi sunucu loglarından
          </p>
        </div>
        <button
          onClick={handleReset}
          disabled={resetting || !live}
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white transition-colors"
        >
          <RotateCcw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} />
          Sayaçları Sıfırla
        </button>
      </div>

      {/* Daemon hatası */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded text-sm text-red-300">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p>{error}</p>
            <p className="text-xs text-red-400/80 mt-1">
              Başlatmak için:{' '}
              <code className="bg-red-500/10 px-1 rounded">
                systemctl --user start lmstudio-token-counter.service
              </code>{' '}
              veya{' '}
              <code className="bg-red-500/10 px-1 rounded">
                python3 scripts/token-counter.py
              </code>
            </p>
          </div>
        </div>
      )}

      {/* Tarih filtresi */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2 text-gray-400">
          <Calendar className="h-4 w-4" />
          <label className="flex items-center gap-1.5">
            Başlangıç
            <input
              type="date"
              value={range.from ?? ''}
              onChange={(e) => applyRange(e.target.value || null, range.to)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Bitiş
            <input
              type="date"
              value={range.to ?? ''}
              onChange={(e) => applyRange(range.from, e.target.value || null)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={setToday}
            className="px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
          >
            Bugün
          </button>
          <button
            onClick={setYesterday}
            className="px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
          >
            Dün
          </button>
          <button
            onClick={set7}
            className="px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
          >
            Son 7 gün
          </button>
          <button
            onClick={setAll}
            className="px-3 py-1.5 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-gray-300 text-xs transition-colors"
          >
            Tümü
          </button>
        </div>
        <span className="text-sky-400 text-xs">{rangeLabel}</span>
      </div>

      {/* Kaynak bilgisi */}
      <p className="text-xs text-gray-500">
        {ageSec !== null ? (
          <>
            Son olay: <b className="text-gray-400">{ageSec} sn önce</b>
          </>
        ) : (
          'Olay bekleniyor'
        )}
        {stats?.log_tail?.last_file ? (
          <> · log: {stats.log_tail.last_file}</>
        ) : null}
        {stats?.log_tail?.last_error ? (
          <> · <span className="text-red-400">log hatası: {stats.log_tail.last_error}</span></>
        ) : null}
      </p>

      {/* Özet kartları */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<Zap className="h-4 w-4 text-amber-400" />}
          value={nf.format(totals?.completion_tokens ?? 0)}
          label="Üretilen token"
        />
        <StatCard
          icon={<Coins className="h-4 w-4 text-sky-400" />}
          value={nf.format(totals?.prompt_tokens ?? 0)}
          label="Prompt token"
        />
        <StatCard
          icon={<Cpu className="h-4 w-4 text-violet-400" />}
          value={nf.format(totalTokens)}
          label="Toplam token"
        />
        <StatCard
          icon={<Activity className="h-4 w-4 text-emerald-400" />}
          value={nf.format(totals?.predictions ?? 0)}
          label="İstek"
        />
        <StatCard
          icon={<Gauge className="h-4 w-4 text-sky-300" />}
          value={nf.format(stats?.today.completion_tokens ?? 0)}
          label="Bugün üretilen"
        />
        {busy > 0 && (
          <StatCard
            icon={<Activity className="h-4 w-4 text-amber-400 animate-pulse" />}
            value={`~${nf.format(busy)}`}
            label="Şu an üretimde"
            highlight
          />
        )}
      </div>

      {/* Model tablosu */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Modeller (toplam, birikimli)
        </h3>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full bg-gray-800/60 divide-y divide-gray-700">
            <thead className="bg-gray-900/80">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-4 py-2.5">Model</th>
                <th className="px-4 py-2.5 text-right">Üretilen</th>
                <th className="px-4 py-2.5 text-right">Prompt</th>
                <th className="px-4 py-2.5 text-right">İstek</th>
                <th className="px-4 py-2.5 text-right">Son kullanım</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {models.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-4 text-sm text-gray-500 text-center"
                  >
                    {live ? 'Henüz veri yok' : 'Veri alınamadı'}
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-700/30">
                    <td className="px-4 py-2.5 text-sm">
                      <div className="text-gray-200">{m.label}</div>
                      <div
                        className="h-1.5 rounded bg-sky-500 mt-1"
                        style={{
                          width: `${Math.max(
                            4,
                            (100 * m.completion_tokens) / maxModelTokens
                          )}%`,
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-300 tabular-nums">
                      {nf.format(m.completion_tokens)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-400 tabular-nums">
                      {nf.format(m.prompt_tokens)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-400 tabular-nums">
                      {nf.format(m.predictions)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right text-gray-400 tabular-nums">
                      {fmtTime(m.last_ts)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Son istekler */}
      <div>
        <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Son istekler
        </h3>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full bg-gray-800/60 divide-y divide-gray-700">
            <thead className="bg-gray-900/80">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="px-4 py-2.5">Saat</th>
                <th className="px-4 py-2.5">Model</th>
                <th className="px-4 py-2.5 text-right">Üretilen</th>
                <th className="px-4 py-2.5 text-right">Prompt</th>
                <th className="px-4 py-2.5 text-right">tok/s</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {(stats?.recent ?? []).slice(0, 10).length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-4 text-sm text-gray-500 text-center"
                  >
                    —
                  </td>
                </tr>
              ) : (
                (stats?.recent ?? [])
                  .slice(0, 10)
                  .map((e, i) => (
                    <tr key={i} className="hover:bg-gray-700/30">
                      <td className="px-4 py-2.5 text-sm text-gray-400 tabular-nums">
                        {fmtTime(e.ts)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-300 truncate max-w-xs">
                        {e.model}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-gray-300 tabular-nums">
                        {nf.format(e.completion_tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-gray-400 tabular-nums">
                        {nf.format(e.prompt_tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right text-gray-400 tabular-nums">
                        {e.tokens_per_second ?? '—'}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-600 border-t border-gray-800 pt-3">
        Kaynak: LM Studio sunucu logları (motor seviyesi, sohbet + API) ·
        daemon 127.0.0.1:8790 · toplamlar kalıcıdır (state.json) · sıfır veri
        kaybı: tek sayma kaynağı dosya sistemidir
      </p>
    </div>
  );
}

/** Özet istatistik kartı. */
function StatCard({
  icon,
  value,
  label,
  highlight,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-gray-800/60 border rounded-xl p-4 ${
        highlight ? 'border-amber-500/50 bg-amber-500/5' : 'border-gray-700'
      }`}
    >
      <div className="flex items-center gap-1.5 text-gray-500 text-xs uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div
        className={`text-2xl font-bold mt-1 tabular-nums ${
          highlight ? 'text-amber-400' : 'text-gray-100'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

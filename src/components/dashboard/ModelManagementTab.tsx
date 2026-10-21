'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ModelConfig } from '@/types/benchmark';
import {
  Bot,
  Plus,
  Trash2,
  RefreshCw,
  Scale,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Cloud,
} from 'lucide-react';

/**
 * Hazır online API sağlayıcı şablonları — tıklandığında ekleme formunu
 * doldurur. Hakem modeli olarak da kullanılabilir (isJudge mekanizması
 * sağlayıcıdan bağımsız çalışır: OpenAI uyumlu /chat/completions).
 */
const API_PROVIDER_TEMPLATES: Array<{
  name: string;
  baseUrl: string;
  modelId: string;
  label: string;
  hint: string;
}> = [
  {
    name: 'OpenAI GPT-4o',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
    label: 'OpenAI',
    hint: 'platform.openai.com API anahtarı',
  },
  {
    name: 'Anthropic Claude (OpenAI uyumlu)',
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-sonnet-4-5',
    label: 'Anthropic',
    hint: 'console.anthropic.com API anahtarı',
  },
  {
    name: 'Groq Llama (ücretsiz katman)',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelId: 'llama-3.3-70b-versatile',
    label: 'Groq',
    hint: 'console.groq.com API anahtarı — çok hızlı',
  },
  {
    name: 'OpenRouter (tüm modeller)',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'openai/gpt-4o',
    label: 'OpenRouter',
    hint: 'openrouter.ai — 300+ model tek anahtarla',
  },
  {
    name: 'DeepSeek Chat',
    baseUrl: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    label: 'DeepSeek',
    hint: 'platform.deepseek.com API anahtarı',
  },
  {
    name: 'Google Gemini (OpenAI uyumlu)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.0-flash',
    label: 'Gemini',
    hint: 'aistudio.google.com API anahtarı',
  },
];

export default function ModelManagementTab() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [newModel, setNewModel] = useState<Partial<ModelConfig>>({
    name: '',
    provider: 'custom',
    baseUrl: '',
    apiKey: '',
    modelId: '',
  });
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [discovering, setDiscovering] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data: ModelConfig[] = await res.json();
        setModels(data);
      }
    } catch (e) {
      console.error('Modeller yüklenemedi:', e);
      setStatus('Modeller yüklenemedi');
      setStatusType('error');
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const showStatus = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setStatus(message);
    setStatusType(type);
  };

  // ─── LM Studio bağlantı testi ────────────────────────────────────
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await fetch('/api/models/discover');
      const data = await res.json();
      if (res.ok) {
        setConnectionResult(`✅ Bağlantı başarılı — ${data.models?.length ?? 0} model bulundu.`);
      } else {
        setConnectionResult(`❌ ${data.error ?? 'Bağlantı başarısız'}`);
      }
    } catch (e) {
      setConnectionResult(`❌ Bağlantı hatası: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestingConnection(false);
    }
  };

  // ─── LM Studio model keşfi (tek tıkla ekleme) ────────────────────
  const handleDiscoverLMStudio = async () => {
    setDiscovering(true);
    showStatus('LM Studio modelleri taranıyor...');
    try {
      const res = await fetch('/api/models/discover');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Keşif başarısız');
      }

      await fetchModels();
      showStatus(data.message ?? `${data.models?.length ?? 0} model bulundu.`, 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setDiscovering(false);
    }
  };

  // ─── Yeni model ekleme ───────────────────────────────────────────
  const handleAddModel = async () => {
    if (!newModel.name || !newModel.provider || !newModel.baseUrl || !newModel.modelId) {
      showStatus('Lütfen tüm zorunlu alanları doldurun (Ad, Sağlayıcı, Base URL, Model ID).', 'error');
      return;
    }
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newModel),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Model eklenemedi (HTTP ${res.status})`);
      }
      setNewModel({
        name: '',
        provider: 'custom',
        baseUrl: '',
        apiKey: '',
        modelId: '',
      });
      await fetchModels();
      showStatus('Model başarıyla eklendi.', 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // ─── Model silme ──────────────────────────────────────────────────
  const handleDeleteModel = async (id: string) => {
    if (!window.confirm('Bu modeli silmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`/api/models?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Silme başarısız');
      await fetchModels();
      showStatus('Model silindi.', 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // ─── Aktif Hakem AI atama ────────────────────────────────────────
  const handleSetJudge = async (id: string) => {
    try {
      const res = await fetch('/api/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? 'Hakem atanamadı');
      }
      await fetchModels();
      showStatus('Aktif Hakem Model güncellendi.', 'success');
    } catch (e) {
      showStatus(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const activeJudge = models.find((m) => m.isJudge);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Bot className="h-5 w-5 text-sky-400" /> Model & API Yönetimi
      </h2>

      <div className="space-y-6 max-w-5xl">
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

        {/* LM Studio bölümü */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <h3 className="font-semibold mb-3 text-gray-200">LM Studio Entegrasyonu</h3>
          <p className="text-sm text-gray-400 mb-4">
            Yerel sunucu adresi: <code className="text-sky-300">http://localhost:1234/v1</code>.
            LM Studio'da <b>Developer → Start Server</b> ile sunucuyu başlatın.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-medium py-2 px-4 rounded transition-colors"
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              Bağlantı Testi
            </button>
            <button
              onClick={handleDiscoverLMStudio}
              disabled={discovering}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-2 px-4 rounded transition-colors"
            >
              {discovering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              LM Studio Modellerini Tara
            </button>
          </div>
          {connectionResult && (
            <div
              className={`mt-3 text-sm ${
                connectionResult.startsWith('✅') ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {connectionResult}
            </div>
          )}
        </div>

        {/* Harici / Bulut API ekleme */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <h3 className="font-semibold mb-3 text-gray-200 flex items-center gap-2">
            <Cloud className="h-4 w-4 text-sky-400" />
            Harici / Bulut API Ekle
          </h3>

          {/* Hazır sağlayıcı şablonları — tıkla, form dolsun */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2">
              Hazır sağlayıcı şablonu seçin (Base URL ve Model ID otomatik dolar,
              yalnızca API anahtarınızı girin):
            </p>
            <div className="flex flex-wrap gap-2">
              {API_PROVIDER_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() =>
                    setNewModel((prev) => ({
                      ...prev,
                      name: tpl.name,
                      provider: 'custom',
                      baseUrl: tpl.baseUrl,
                      modelId: tpl.modelId,
                    }))
                  }
                  title={tpl.hint}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    newModel.baseUrl === tpl.baseUrl
                      ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                      : 'bg-gray-700/40 border-gray-600 text-gray-300 hover:bg-gray-700/70 hover:border-gray-500'
                  }`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Sağlayıcı Adı *</label>
              <input
                value={newModel.name ?? ''}
                onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                placeholder="örn. OpenAI GPT-4o"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Sağlayıcı Türü</label>
              <select
                value={newModel.provider ?? 'custom'}
                onChange={(e) =>
                  setNewModel({ ...newModel, provider: e.target.value as 'lmstudio' | 'custom' })
                }
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value="custom">Bulut / Harici API</option>
                <option value="lmstudio">LM Studio (yerel)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Base URL *</label>
              <input
                value={newModel.baseUrl ?? ''}
                onChange={(e) => setNewModel({ ...newModel, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
              <input
                type="password"
                value={newModel.apiKey ?? ''}
                onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })}
                placeholder="sk-... (LM Studio için boş bırakın)"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Model ID *</label>
              <input
                value={newModel.modelId ?? ''}
                onChange={(e) => setNewModel({ ...newModel, modelId: e.target.value })}
                placeholder="gpt-4o / anthropic/claude-3.5-sonnet"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500"
              />
            </div>
          </div>
          <button
            onClick={handleAddModel}
            className="mt-4 flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded transition-colors"
          >
            <Plus className="h-4 w-4" /> Model Ekle
          </button>
        </div>

        {/* Kayıtlı modeller listesi */}
        <div className="bg-gray-800/60 rounded-lg p-5 border border-gray-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-200">
              Kayıtlı Modeller ({models.length})
              <span className="ml-2 text-xs text-gray-500 font-normal">
                — Test Koşucusu'ndaki birleşik listede otomatik görünür
              </span>
            </h3>
            {activeJudge && (
              <div className="text-xs text-violet-300 flex items-center gap-1">
                <Scale className="h-3.5 w-3.5" />
                Aktif Hakem: <b>{activeJudge.name}</b>
              </div>
            )}
          </div>

          {models.length === 0 ? (
            <p className="text-gray-400 text-sm">
              Henüz model yok. Yukarıdaki "LM Studio Modellerini Tara" butonunu kullanın
              veya manuel olarak bir API modeli ekleyin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase">
                    <th className="px-4 py-3">Ad</th>
                    <th className="px-4 py-3">Sağlayıcı</th>
                    <th className="px-4 py-3">Base URL</th>
                    <th className="px-4 py-3">Model ID</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Hakem</th>
                    <th className="px-4 py-3">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {models.map((model) => (
                    <tr
                      key={model.id}
                      className={`hover:bg-gray-700/40 ${
                        model.lastLoadError ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-white max-w-[16rem] truncate" title={model.name}>
                        {model.name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            model.provider === 'lmstudio'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-violet-500/20 text-violet-300'
                          }`}
                        >
                          {model.provider === 'lmstudio' ? 'LM Studio' : 'API'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 max-w-[14rem] truncate" title={model.baseUrl}>
                        {model.baseUrl}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 max-w-[14rem] truncate" title={model.modelId}>
                        {model.modelId}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {model.lastLoadError ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-xs"
                            title={model.lastLoadError}
                          >
                            ⚠️ Çalışmıyor
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs">
                            ✓ Çalışıyor
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {model.isJudge ? (
                          <span className="flex items-center gap-1 text-violet-300">
                            <CheckCircle2 className="h-4 w-4" /> Aktif
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetJudge(model.id)}
                            className="text-xs px-2 py-1 rounded bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 transition-colors"
                          >
                            Hakem Yap
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteModel(model.id)}
                          className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm"
                        >
                          <Trash2 className="h-4 w-4" /> Sil
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

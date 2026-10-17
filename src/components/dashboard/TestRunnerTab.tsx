"use client";

import React, { useState } from 'react';
import { ModelConfig } from '@/types/benchmark';

export default function TestRunnerTab() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [testModelId, setTestModelId] = useState('');
  const [judgeModelId, setJudgeModelId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string>('Hazır');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  async function fetchModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data: ModelConfig[] = await res.json();
        setModels(data);
      }
    } catch (e) {
      console.error('Model listesi alınamadı:', e);
    }
  }

  React.useEffect(() => {
    fetchModels();
  }, []);

  const handleStartTest = async () => {
    if (!testModelId || !judgeModelId) {
      setStatus('Lütfen hem test hem de jüri modelini seçin');
      return;
    }
    setIsRunning(true);
    setStatus('Benchmark başlatılıyor...');

    try {
      const res = await fetch('/api/benchmark/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testModelId, judgeModelId }),
      });

      if (!res.ok) {
        throw new Error(`Benchmark başarısız: ${await res.text()}`);
      }

      const data = await res.json();
      setResult(data as Record<string, unknown>);
      setStatus('Benchmark tamamlandı!');
    } catch (e) {
      setStatus(`Hata: ${(e as Error).message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Test Runner</h2>
      <div className="bg-gray-800 rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Test Edilecek Modeli Seçin
          </label>
          <select
            value={testModelId}
            onChange={(e) => setTestModelId(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          >
            <option value="">-- Test Modeli Seçin --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Jüri Modeli Seçin
          </label>
          <select
            value={judgeModelId}
            onChange={(e) => setJudgeModelId(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          >
            <option value="">-- Jüri Modeli Seçin --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleStartTest}
          disabled={isRunning || !testModelId || !judgeModelId}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          {isRunning ? 'Çalışıyor...' : 'Benchmark Başlat'}
        </button>

        <p className="text-sm">{status}</p>

        {result && (
          <div className="mt-6 p-4 bg-gray-900 rounded">
            <h3 className="font-bold mb-2">Sonuç</h3>
            <pre className="text-xs text-gray-200 overflow-auto max-h-96">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
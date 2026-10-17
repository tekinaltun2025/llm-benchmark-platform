import React from 'react';
import { benchmarkQuestions } from '@/lib/benchmark-suite';

export default function BenchmarkSuiteTab() {
  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Benchmark Suite</h2>
      <div className="bg-gray-800 rounded-lg p-6">
        {benchmarkQuestions.map((q) => (
          <div key={q.id} className="mb-5 pb-4 border-b border-gray-700 last:border-b-0">
            <h3 className="font-semibold text-gray-200">
              Question {q.id} ({getCategoryLabel(q.category)})
            </h3>
            <p className="mt-2 text-sm text-gray-300">{q.question}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getCategoryLabel(cat: 'logic' | 'math' | 'ifeval' | 'json' | 'code'): string {
  const labels: Record<string, string> = {
    logic: 'Mantık ve Muhakeme',
    math: 'Matematik (GSM8K)',
    ifeval: 'Talimat Takibi (IFEval)',
    json: 'Yapısal Veri Çıkarımı (JSON Schema)',
    code: 'Kodlama ve Algoritma (HumanEval)',
  };
  return labels[cat] || cat;
}
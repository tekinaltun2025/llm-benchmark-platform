'use client';

import React, { useState } from 'react';
import { benchmarkQuestions } from '@/lib/benchmark-suite';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Bar,
} from 'recharts';

export default function LeaderboardTab() {
  const [leaderboardData, setLeaderboardData] = useState<Array<any>>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch and process data on mount
  React.useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetch('/api/leaderboard');
        if (res.ok) {
          const data = await res.json();
          setLeaderboardData(data);
        }
      } catch (error) {
        console.error('Error loading leaderboard data:', error);
        setLeaderboardData([]);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold mb-4">Leaderboard</h2>
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (leaderboardData.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold mb-4">Leaderboard</h2>
        <p className="text-gray-400">
          No benchmark runs yet. Run a benchmark to see results here.
        </p>
      </div>
    );
  }

  // Determine selected models (max 4)
  const handleModelToggle = (id: string) => {
    setSelectedModelIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((pid) => pid !== id);
      } else {
        // Limit to 4
        if (prev.length >= 4) {
          alert('Maximum 4 models can be selected for comparison');
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  const selectedModels = leaderboardData.filter((m) =>
    selectedModelIds.includes(m.id)
  );

  // Radar chart data format: [{ name: 'Logic', model1: 80, model2: 70, ... }]
  const radarData = [
    { name: 'Mantık' },
    { name: 'Matematik' },
    { name: 'IFEval' },
    { name: 'JSON' },
    { name: 'Kodlama' },
  ].map((item, index) => {
    const categoryKey =
      index === 0
        ? 'logic'
        : index === 1
        ? 'math'
        : index === 2
        ? 'ifeval'
        : index === 3
        ? 'json'
        : 'code';
    selectedModels.forEach((model) => {
      // @ts-ignore
      item[model.modelName] = model.categoryScores[categoryKey];
    });
    return item;
  });

  // Bar chart data for total score
  const barData = selectedModels.map((model) => ({
    name: model.modelName,
    score: model.totalScore,
  }));

  // Colors for radar chart bars
  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Leaderboard</h2>

      {/* Selection controls */}
      <div className="mb-4 flex flex-wrap gap-2">
        {leaderboardData.map((model) => (
          <label
            key={model.id}
            className={`flex items-center ${
              selectedModelIds.includes(model.id)
                ? 'bg-blue-600 bg-opacity-20'
                : 'bg-gray-700 bg-opacity-10'
            } rounded px-3 py-1 text-sm`}
          >
            <input
              type="checkbox"
              checked={selectedModelIds.includes(model.id)}
              onChange={() => handleModelToggle(model.id)}
              className="mr-2 h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
            />
            {model.modelName} ({model.provider === 'lmstudio' ? 'LM Studio' : 'Custom'})
          </label>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-semibold mb-4">Model Comparison (Radar)</h3>
          {selectedModels.length === 0 ? (
            <p className="text-gray-400 text-center">
              Select up to 4 models to see radar comparison
            </p>
          ) : (
            <RadarChart
              width={300}
              height={300}
              data={radarData}
              margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
            >
              <PolarGrid />
              <PolarAngleAxis dataKey="name" />
              <PolarRadiusAxis domain={[0, 100]} />
              <Tooltip />
              <Legend verticalAlign="top" height={36} />
              {selectedModels.map((model, index) => (
                <Bar
                  key={index}
                  dataKey={model.modelName}
                  stroke={colors[index % colors.length]}
                  fillOpacity={0.2}
                />
              ))}
            </RadarChart>
          )}
        </div>

        {/* Bar Chart */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="font-semibold mb-4">Total Score Comparison</h3>
          {selectedModels.length === 0 ? (
            <p className="text-gray-400 text-center">
              Select models to see bar comparison
            </p>
          ) : (
            // We'll implement a simple bar chart using Recharts BarChart
            <BarChart width={400} height={300} data={barData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} />
              <YAxis domain={[0, 100]} tickLine={false} />
              <Tooltip />
              <Legend verticalAlign="top" height={36} />
              <Bar dataKey="score" fill="#8884d8" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mt-6">
        <div className="overflow-x-auto">
          <table className="min-w-full bg-gray-800 rounded-lg divide-y divide-gray-700">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Total Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Logic
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Math
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  IFEval
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  JSON
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Avg TTFT (ms)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Avg TPS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {leaderboardData.map((entry, index) => (
                <tr key={index} className="hover:bg-gray-700">
                  <td className="px-6 py-4 text-sm font-medium text-white">{index + 1}</td>
                  <td className="px-6 py-4 text-sm text-white">{entry.modelName}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">
                    {entry.provider === 'lmstudio' ? 'LM Studio' : 'Custom'}
                  </td>
                  <td className="px-6 py-4 text-sm text-white">{entry.totalScore}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.categoryScores.logic}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.categoryScores.math}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.categoryScores.ifeval}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.categoryScores.json}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.categoryScores.code}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.avgTTFT.toFixed(1)}</td>
                  <td className="px-6 py-4 text-sm text-gray-200">{entry.avgTPS.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
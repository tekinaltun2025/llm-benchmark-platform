'use client';

import { useState } from 'react';
import LeaderboardTab from '@/components/dashboard/LeaderboardTab';
import TestRunnerTab from '@/components/dashboard/TestRunnerTab';
import ModelManagementTab from '@/components/dashboard/ModelManagementTab';
import BenchmarkSuiteTab from '@/components/dashboard/BenchmarkSuiteTab';
import TokenDashboardTab from '@/components/dashboard/TokenDashboardTab';
import { Trophy, Zap, Bot, ClipboardList, Cpu, Loader2 } from 'lucide-react';
import type { BenchmarkRun } from '@/types/benchmark';

type TabId =
  | 'leaderboard'
  | 'testRunner'
  | 'modelManagement'
  | 'benchmarkSuite'
  | 'tokenDashboard';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'leaderboard', label: '🏆 Başarım Sıralaması' },
  { id: 'testRunner', label: '⚡ Test Koşucusu' },
  { id: 'modelManagement', label: '🤖 Model & API Yönetimi' },
  { id: 'benchmarkSuite', label: '📋 Soru Havuzu' },
  { id: 'tokenDashboard', label: '📊 Token Sayacı' },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<TabId>('leaderboard');
  // Leaderboard'un test sonrası otomatik yenilenmesi için tetikleyici
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);
  // Test çalışıyor mu? (TestRunnerTab mount kalır, sekme değişse bile test sürer)
  const [testRunning, setTestRunning] = useState(false);

  // Test tamamlandığında Leaderboard sekmesine yönlendir
  const handleRunComplete = (_run: BenchmarkRun) => {
    setLeaderboardRefreshKey((prev) => prev + 1);
    setActiveTab('leaderboard');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Üst bar */}
      <header className="sticky top-0 z-40 bg-gray-900/90 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu className="h-6 w-6 text-sky-400" />
            <h1 className="text-lg font-bold">AI Benchmark & Leaderboard</h1>
            {/* Test arka planda çalışırken gösterilen canlı gösterge */}
            {testRunning && activeTab !== 'testRunner' && (
              <button
                onClick={() => setActiveTab('testRunner')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 text-xs font-medium hover:bg-sky-500/30 transition-colors"
                title="Test arka planda çalışıyor — görüntülemek için tıklayın"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Test çalışıyor
              </button>
            )}
          </div>
          <nav className="flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* İçerik
          TestRunnerTab KOŞUL SIRASINDA unmount edilmez (hidden ile gizlenir);
          böylece sekme değişse bile NDJSON akışı ve test devam eder. */}
      <main className="max-w-7xl mx-auto">
        {activeTab === 'leaderboard' && (
          <LeaderboardTab key={leaderboardRefreshKey} />
        )}
        <div className={activeTab === 'testRunner' ? '' : 'hidden'}>
          <TestRunnerTab
            onRunComplete={handleRunComplete}
            onRunningChange={setTestRunning}
          />
        </div>
        {activeTab === 'modelManagement' && <ModelManagementTab />}
        {activeTab === 'benchmarkSuite' && <BenchmarkSuiteTab />}
        {activeTab === 'tokenDashboard' && <TokenDashboardTab />}
      </main>

      <footer className="border-t border-gray-800 mt-8 py-4 text-center text-xs text-gray-600">
        LM Studio + Bulut API · 2 Fazlı VRAM Dostu Test Motoru · Deterministik + Hakem AI Puanlama (0-100)
      </footer>
    </div>
  );
}

"use client";

import LeaderboardTab from '@/components/dashboard/LeaderboardTab';
import TestRunnerTab from '@/components/dashboard/TestRunnerTab';
import ModelManagementTab from '@/components/dashboard/ModelManagementTab';
import BenchmarkSuiteTab from '@/components/dashboard/BenchmarkSuiteTab';
import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'testRunner' | 'modelManagement' | 'benchmarkSuite'>('leaderboard');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dark-mode') === 'enabled' || 
             (!localStorage.getItem('dark-mode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('dark-mode', 'enabled');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('dark-mode', 'disabled');
    }
  }, [darkMode]);

  return (
    <div className={`min-h-screen bg-white dark:bg-gray-900 transition-colors duration-200`}>
      <header className="bg-gray-800 dark:bg-gray-700 p-4 border-b border-gray-700 dark:border-gray-600">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white dark:text-white">AI Benchmark & Leaderboard Platform</h1>
          <div className="flex space-x-4">
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                activeTab === 'leaderboard'
                  ? 'bg-blue-600 bg-opacity-20 text-blue-300'
                  : 'text-gray-400 hover:text-gray-200 dark:hover:text-gray-100'
              }`}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('testRunner')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                activeTab === 'testRunner'
                  ? 'bg-blue-600 bg-opacity-20 text-blue-300'
                  : 'text-gray-400 hover:text-gray-200 dark:hover:text-gray-100'
              }`}
            >
              Test Runner
            </button>
            <button
              onClick={() => setActiveTab('modelManagement')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                activeTab === 'modelManagement'
                  ? 'bg-blue-600 bg-opacity-20 text-blue-300'
                  : 'text-gray-400 hover:text-gray-200 dark:hover:text-gray-100'
              }`}
            >
              Model Management
            </button>
            <button
              onClick={() => setActiveTab('benchmarkSuite')}
              className={`px-3 py-2 rounded-md text-sm font-medium ${
                activeTab === 'benchmarkSuite'
                  ? 'bg-blue-600 bg-opacity-20 text-blue-300'
                  : 'text-gray-400 hover:text-gray-200 dark:hover:text-gray-100'
              }`}
            >
              Benchmark Suite
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded hover:bg-gray-600 dark:hover:bg-gray-500"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="p-6">
        {activeTab === 'leaderboard' && <LeaderboardTab />}
        {activeTab === 'testRunner' && <TestRunnerTab />}
        {activeTab === 'modelManagement' && <ModelManagementTab />}
        {activeTab === 'benchmarkSuite' && <BenchmarkSuiteTab />}
      </main>
    </div>
  );
}
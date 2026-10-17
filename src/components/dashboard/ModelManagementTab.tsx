"use client";

import React, { useState } from 'react';
import { ModelConfig } from '@/types/benchmark';

export default function ModelManagementTab() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [newModel, setNewModel] = useState<Partial<ModelConfig>>({
    name: '',
    provider: 'lmstudio' as const,
    baseUrl: '',
    apiKey: '',
    modelId: '',
    isJudge: false,
  });
  const [status, setStatus] = useState<string>('');

  // Fetch models on mount
  React.useEffect(() => {
    fetchModels();
  }, []);

  async function fetchModels() {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        setModels(data);
      }
    } catch (e) {
      console.error('Failed to fetch models:', e);
      setStatus('Failed to load models');
    }
  }

  const handleAddModel = async () => {
    // Basic validation
    if (!newModel.name || !newModel.provider || !newModel.baseUrl || !newModel.modelId) {
      setStatus('Please fill all required fields');
      return;
    }
    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newModel),
      });
      if (!res.ok) {
        throw new Error(`Failed to add model: ${await res.text()}`);
      }
      const data = await res.json();
      setModels([...models, data]);
      // Reset form
      setNewModel({
        name: '',
        provider: 'lmstudio' as const,
        baseUrl: '',
        apiKey: '',
        modelId: '',
        isJudge: false,
      });
      setStatus('Model added successfully');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleDiscoverLMStudio = async () => {
    try {
      const res = await fetch('/api/models/discover', {
        method: 'GET',
      });
      if (!res.ok) {
        throw new Error(`Discovery failed: ${await res.text()}`);
      }
      const discovered: ModelConfig[] = await res.json();
      // For each discovered model, we could add it if not exists (by id)
      // But for simplicity, we'll just replace the list with discovered ones? 
      // Actually we want to keep existing custom models and add discovered lmstudio ones.
      // Let's fetch current models again and merge.
      const currentRes = await fetch('/api/models');
      if (!currentRes.ok) throw new Error('Failed to fetch current models');
      const current: ModelConfig[] = await currentRes.json();
      // Create a map by id
      const map = new Map<string, ModelConfig>();
      current.forEach((m) => map.set(m.id, m));
      discovered.forEach((m) => {
        if (!map.has(m.id)) {
          map.set(m.id, m);
        }
      });
      setModels(Array.from(map.values()));
      setStatus(`Discovered ${discovered.length} models from LM Studio`);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this model?')) return;
    try {
      const res = await fetch(`/api/models?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Failed to delete model: ${await res.text()}`);
      }
      setModels(models.filter((m) => m.id !== id));
      setStatus('Model deleted');
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Model Management</h2>
      <div className="bg-gray-800 rounded-lg p-6">
        {/* Status */}
        {status && <p className="mb-4 text-sm">{status}</p>}

        {/* Add Model Form */}
        <div className="mb-6">
          <h3 className="font-semibold mb-2">Add New Model</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Model Name</label>
              <input
                value={newModel.name ?? ''}
                onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                placeholder="Enter model name"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Provider</label>
              <select
                value={newModel.provider ?? 'lmstudio'}
                onChange={(e) => setNewModel({ ...newModel, provider: e.target.value as 'lmstudio' | 'custom' })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value="lmstudio">LM Studio</option>
                <option value="custom">Custom API</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Base URL</label>
              <input
                value={newModel.baseUrl ?? ''}
                onChange={(e) => setNewModel({ ...newModel, baseUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">API Key (optional)</label>
              <input
                value={newModel.apiKey ?? ''}
                onChange={(e) => setNewModel({ ...newModel, apiKey: e.target.value })}
                placeholder="Leave empty for LM Studio"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Model ID</label>
              <input
                value={newModel.modelId ?? ''}
                onChange={(e) => setNewModel({ ...newModel, modelId: e.target.value })}
                placeholder="e.g., mistral-small-latest"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Set as Judge Model?
              </label>
              <input
                type="checkbox"
                checked={newModel.isJudge ?? false}
                onChange={(e) => setNewModel({ ...newModel, isJudge: e.target.checked })}
                className="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
              />
            </div>
          </div>

          <button
            onClick={handleAddModel}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mt-4"
          >
            Add Model
          </button>
        </div>

        {/* Discover LM Studio Models */}
        <div className="mb-6">
          <h3 className="font-semibold mb-2">Discover LM Studio Models</h3>
          <p className="text-sm text-gray-400 mb-2">
            Click to fetch available models from your local LM Studio instance (http://localhost:1234/v1)
          </p>
          <button
            onClick={handleDiscoverLMStudio}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
          >
            Discover LM Studio Models
          </button>
        </div>

        {/* Current Models List */}
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Current Models ({models.length})</h3>
          {models.length === 0 ? (
            <p className="text-gray-400">No models added yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full bg-gray-800 rounded-lg divide-y divide-gray-700">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Base URL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Model ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Judge?
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {models.map((model) => (
                    <tr key={model.id} className="hover:bg-gray-700">
                      <td className="px-6 py-4 text-sm text-white">{model.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {model.provider === 'lmstudio' ? 'LM Studio' : 'Custom'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-200 truncate max-w-xs">{model.baseUrl}</td>
                      <td className="px-6 py-4 text-sm text-gray-200 break-all">{model.modelId}</td>
                      <td className="px-6 py-4 text-sm text-gray-200">
                        {model.isJudge ? 'Yes' : 'No'}
                      </td>
                      <td className="px-6 py-4 text-sm flex space-x-2">
                        <button
                          onClick={() => handleDeleteModel(model.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          Delete
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
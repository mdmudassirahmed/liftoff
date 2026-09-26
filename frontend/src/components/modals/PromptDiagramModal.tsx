// Prompt Diagram Modal - Generate architecture from a prompt

import { useState } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';

interface PromptDiagramModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error?: string | null;
  onClose: () => void;
  onGenerate: (prompt: string, projectName: string) => void;
}

export function PromptDiagramModal({
  isOpen,
  isLoading,
  error,
  onClose,
  onGenerate,
}: PromptDiagramModalProps) {
  const [prompt, setPrompt] = useState('');
  const [projectName, setProjectName] = useState('AI Project');

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    onGenerate(prompt.trim(), projectName.trim() || 'AI Project');
  };

  const handleClose = () => {
    setPrompt('');
    setProjectName('AI Project');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
              <Icon icon="mdi:lightbulb-on-outline" className="w-6 h-6 text-brand-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Create from Prompt
              </h2>
              <p className="text-sm text-gray-500">
                Describe your architecture and generate a diagram
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={isLoading}
          >
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
              className={cn(
                'w-full px-3 py-2 border rounded-lg text-sm',
                'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent',
                'border-gray-300'
              )}
              disabled={isLoading}
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Architecture Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={[
                'Describe your architecture in plain English, for example:',
                '',
                '- A web app in eastus with App Service, Key Vault and a Storage Account',
                '- A microservices architecture with API Management and 3 Container Apps',
                '- A data pipeline with Event Hubs, Stream Analytics and Cosmos DB',
              ].join('\n')}
              rows={8}
              className={cn(
                'w-full px-3 py-2 border rounded-lg text-sm',
                'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent',
                'border-gray-300'
              )}
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-gray-500">
            Just describe what you need — no schema required.
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={isLoading || !prompt.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'bg-brand-primary text-white hover:bg-brand-primaryDark',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isLoading ? 'Generating…' : 'Generate & Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PromptDiagramModal;
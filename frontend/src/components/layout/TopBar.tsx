// Top Bar Component

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useDiagramStore, useIaCStore, useTabsStore } from '@/store';
import { useIaCGeneration } from '@/hooks/useIaCGeneration';

interface TopBarProps {
  onOpenIaCPreview: () => void;
  onOpenDeployModal: () => void;
  onOpenAuthModal: () => void;
  isAuthenticated: boolean;
}

export function TopBar({
  onOpenIaCPreview,
  onOpenDeployModal,
  onOpenAuthModal,
  isAuthenticated,
}: TopBarProps) {
  const nodes = useDiagramStore((state) => state.nodes);
  const clearDiagram = useDiagramStore((state) => state.clearDiagram);
  const saveCurrentToTab = useDiagramStore((state) => state.saveCurrentToTab);
  const currentTabId = useDiagramStore((state) => state.currentTabId);
  const serializeDiagram = useDiagramStore((state) => state.serializeDiagram);
  const generatedCode = useIaCStore((state) => state.generatedCode);
  const { generateBicep } = useIaCGeneration();
  
  const tabs = useTabsStore((state) => state.tabs);
  const activeTab = tabs.find(t => t.id === currentTabId);
  
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);

  // Close save menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setShowSaveMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGenerateIaC = () => {
    // Open the modal immediately - it will handle the loading state
    onOpenIaCPreview();
    // Trigger generation - the modal will show loading state from the store
    generateBicep();
  };

  const handleClear = () => {
    if (nodes.length > 0) {
      setShowClearConfirm(true);
    }
  };

  const confirmClear = () => {
    clearDiagram();
    setShowClearConfirm(false);
  };

  // Save to browser localStorage
  const handleSaveToBrowser = () => {
    if (currentTabId) {
      const content = saveCurrentToTab();
      useTabsStore.getState().saveTabContent(currentTabId, content);
      setSaveMessage('Saved to browser storage!');
      setTimeout(() => setSaveMessage(null), 2000);
    }
    setShowSaveMenu(false);
  };

  // Download as JSON file
  const handleDownloadAsFile = () => {
    const diagram = serializeDiagram();
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projectName: activeTab?.name || 'My Project',
      diagram,
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(activeTab?.name || 'architecture').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setSaveMessage('Downloaded as file!');
    setTimeout(() => setSaveMessage(null), 2000);
    setShowSaveMenu(false);
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm">
      {/* Left: Logo and Title - Links to Home */}
      <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center">
            <img
              src="/logo.svg"
              alt="Liftoff"
              className="w-6 h-6"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              Liftoff
            </h1>
            <p className="text-xs text-gray-500">
              Design Generate Deploy
            </p>
          </div>
        </div>
      </Link>

      {/* Center: Stats */}
      <div className="hidden lg:flex items-center gap-4 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:cube-outline" className="w-4 h-4 text-brand-primary" />
          <span>{nodes.filter(n => n.type === 'service').length} Services</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:folder-outline" className="w-4 h-4 text-brand-accent" />
          <span>{nodes.filter(n => n.type === 'group').length} Groups</span>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Save Button with Dropdown */}
        <div className="relative" ref={saveMenuRef}>
          <button
            onClick={() => setShowSaveMenu(!showSaveMenu)}
            disabled={nodes.length === 0}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
              'border border-brand-primary text-gray-700 hover:bg-brand-primary/10',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors'
            )}
          >
            <Icon icon="mdi:content-save-outline" className="w-4 h-4 text-brand-primary" />
            Save
            <Icon icon="mdi:chevron-down" className="w-3 h-3" />
          </button>
          
          {/* Save Dropdown Menu */}
          {showSaveMenu && (
            <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <div className="p-2">
                <button
                  onClick={handleSaveToBrowser}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-100 rounded-md"
                >
                  <Icon icon="mdi:web" className="w-4 h-4 text-brand-accent" />
                  <div>
                    <div className="font-medium">Save to Browser</div>
                    <div className="text-xs text-gray-500">Stored in localStorage</div>
                  </div>
                </button>
                <button
                  onClick={handleDownloadAsFile}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-100 rounded-md"
                >
                  <Icon icon="mdi:download" className="w-4 h-4 text-brand-primary" />
                  <div>
                    <div className="font-medium">Download as File</div>
                    <div className="text-xs text-gray-500">Export as JSON file</div>
                  </div>
                </button>
              </div>
              <div className="border-t border-gray-200 px-3 py-2 bg-gray-50 rounded-b-lg">
                <p className="text-xs text-gray-500">
                  <Icon icon="mdi:information-outline" className="w-3 h-3 inline mr-1" />
                  Auto-saved every 5 seconds to browser
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Save Success Message - fixed overlay so the toolbar row never shifts */}
        {saveMessage && (
          <div className="fixed top-16 right-6 z-50 flex items-center gap-1.5 px-3 py-2 bg-green-100 text-green-700 text-sm rounded-md shadow-md border border-green-200">
            <Icon icon="mdi:check-circle" className="w-4 h-4" />
            {saveMessage}
          </div>
        )}

        {/* Clear Button */}
        <button
          onClick={handleClear}
          disabled={nodes.length === 0}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
            'border border-gray-300 text-gray-600 hover:bg-gray-100',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors'
          )}
        >
          <Icon icon="mdi:delete-outline" className="w-4 h-4" />
          Clear
        </button>

        {/* Generate IaC Button */}
        <button
          onClick={handleGenerateIaC}
          disabled={nodes.length === 0}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
            'bg-brand-primary text-white hover:bg-brand-primaryDark',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors'
          )}
        >
          <Icon icon="mdi:code-braces" className="w-4 h-4" />
          Generate IaC
        </button>

        {/* View IaC Button */}
        {generatedCode && (
          <button
            onClick={onOpenIaCPreview}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
              'border border-brand-accent text-gray-700 hover:bg-brand-accent/10',
              'transition-colors'
            )}
          >
            <Icon icon="mdi:eye-outline" className="w-4 h-4 text-brand-accent" />
            View Code
          </button>
        )}

        {/* Divider */}
        <div className="w-px h-6 bg-gray-300 mx-1" />

        {/* Auth Button */}
        {!isAuthenticated ? (
          <button
            onClick={onOpenAuthModal}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
              'border border-gray-300 text-gray-600 hover:bg-gray-100',
              'transition-colors'
            )}
          >
            <Icon icon="mdi:login" className="w-4 h-4" />
            Sign In
          </button>
        ) : (
          <>
            <button
              onClick={onOpenDeployModal}
              disabled={!generatedCode}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium',
                'bg-brand-accent text-white hover:bg-brand-accentDark',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-colors'
              )}
            >
              <Icon icon="mdi:rocket-launch-outline" className="w-4 h-4" />
              Deploy
            </button>
            <button
              onClick={onOpenAuthModal}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full',
                'bg-brand-primary text-white hover:bg-brand-primaryDark',
                'transition-colors'
              )}
            >
              <Icon icon="mdi:account" className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Clear Diagram?
            </h3>
            <p className="text-gray-600 mb-4">
              This will remove all {nodes.length} items from the canvas. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export default TopBar;

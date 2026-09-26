// Tab Bar Component - Multi-project tab management

import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useTabsStore, type Tab } from '@/store/tabsStore';

interface TabBarProps {
  onTabChange?: (tabId: string) => void;
  onOpenImportModal?: () => void;
  onOpenPromptModal?: () => void;
}

export function TabBar({ onTabChange, onOpenImportModal, onOpenPromptModal }: TabBarProps) {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const createTab = useTabsStore((state) => state.createTab);
  const renameTab = useTabsStore((state) => state.renameTab);
  const deleteTab = useTabsStore((state) => state.deleteTab);
  const switchTab = useTabsStore((state) => state.switchTab);
  const duplicateTab = useTabsStore((state) => state.duplicateTab);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [contextMenuTab, setContextMenuTab] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const newTabMenuRef = useRef<HTMLDivElement>(null);
  const newTabButtonRef = useRef<HTMLButtonElement>(null);

  // Focus input when editing
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuTab(null);
      }
      if (
        newTabMenuRef.current && 
        !newTabMenuRef.current.contains(e.target as Node) &&
        newTabButtonRef.current &&
        !newTabButtonRef.current.contains(e.target as Node)
      ) {
        setShowNewTabMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabClick = (tabId: string) => {
    if (editingTabId !== tabId) {
      if (onTabChange) {
        onTabChange(tabId);
      } else {
        switchTab(tabId);
      }
    }
  };

  const handleDoubleClick = (tab: Tab) => {
    setEditingTabId(tab.id);
    setEditingName(tab.name);
  };

  const handleRenameSubmit = () => {
    if (editingTabId && editingName.trim()) {
      renameTab(editingTabId, editingName.trim());
    }
    setEditingTabId(null);
    setEditingName('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
      setEditingName('');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenuTab(tabId);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleNewTabClick = () => {
    setShowNewTabMenu(!showNewTabMenu);
  };

  const handleNewEmptyTab = () => {
    const newTabId = createTab();
    onTabChange?.(newTabId);
    setShowNewTabMenu(false);
  };

  const handleImportTab = () => {
    setShowNewTabMenu(false);
    onOpenImportModal?.();
  };

  const handlePromptTab = () => {
    setShowNewTabMenu(false);
    onOpenPromptModal?.();
  };

  const handleDuplicate = (tabId: string) => {
    const newTabId = duplicateTab(tabId);
    setContextMenuTab(null);
    onTabChange?.(newTabId);
  };

  const handleDelete = (tabId: string) => {
    deleteTab(tabId);
    setContextMenuTab(null);
  };

  const handleRename = (tab: Tab) => {
    setContextMenuTab(null);
    setEditingTabId(tab.id);
    setEditingName(tab.name);
  };

  return (
    <div className="h-9 bg-gray-100 border-b border-gray-200 flex items-center px-2">
      {/* Tabs Container - scrollable */}
      <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-300">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            onDoubleClick={() => handleDoubleClick(tab)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md cursor-pointer',
              'min-w-[100px] max-w-[200px]',
              'border border-b-0 transition-all duration-150',
              activeTabId === tab.id
                ? 'bg-white border-gray-200 text-gray-900 shadow-sm -mb-px'
                : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800'
            )}
          >
            {/* Tab Icon */}
            <Icon
              icon="mdi:folder-outline"
              className={cn(
                'w-4 h-4 flex-shrink-0',
                activeTabId === tab.id ? 'text-brand-primary' : 'text-gray-400'
              )}
            />

            {/* Tab Name (Editable) */}
            {editingTabId === tab.id ? (
              <input
                ref={editInputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleRenameKeyDown}
                className={cn(
                  'flex-1 min-w-0 px-1 py-0 text-sm bg-white border border-brand-primary rounded',
                  'focus:outline-none focus:ring-1 focus:ring-brand-primary'
                )}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 min-w-0 text-sm font-medium truncate">
                {tab.name}
              </span>
            )}

            {/* Close Button */}
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(tab.id);
                }}
                className={cn(
                  'p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity',
                  'hover:bg-gray-200 text-gray-500 hover:text-gray-700'
                )}
              >
                <Icon icon="mdi:close" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* New Tab Button - with dropdown menu (outside scroll container) */}
      <div className="relative ml-1 flex-shrink-0">
        <button
          ref={newTabButtonRef}
          onClick={handleNewTabClick}
          className={cn(
            'p-1 rounded-md transition-colors flex-shrink-0',
            'text-gray-500 hover:text-brand-primary hover:bg-gray-200',
            'border border-dashed border-gray-300 hover:border-brand-primary',
            showNewTabMenu && 'border-brand-primary text-brand-primary bg-gray-100'
          )}
          title="New Project Tab"
        >
          <Icon icon="mdi:plus" className="w-5 h-5" />
        </button>

        {/* New Tab Dropdown Menu */}
        {showNewTabMenu && (
          <div
            ref={newTabMenuRef}
            className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[220px]"
          >
            <button
              onClick={handleNewEmptyTab}
              className="w-full px-3 py-2 text-sm text-left flex items-center gap-3 hover:bg-gray-100"
            >
              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon icon="mdi:plus-box-outline" className="w-5 h-5 text-brand-primary" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Start from Scratch</div>
                <div className="text-xs text-gray-500">Create a new empty project</div>
              </div>
            </button>
            <div className="border-t border-gray-200 my-1" />
            <button
              onClick={handleImportTab}
              className="w-full px-3 py-2 text-sm text-left flex items-center gap-3 hover:bg-gray-100"
            >
              <div className="w-8 h-8 rounded-lg bg-azure-blue/10 flex items-center justify-center flex-shrink-0">
                <Icon icon="mdi:file-import-outline" className="w-5 h-5 text-azure-blue" />
              </div>
              <div>
                <div className="font-medium text-gray-900">Import from JSON</div>
                <div className="text-xs text-gray-500">Build from existing definition</div>
              </div>
            </button>
            <div className="border-t border-gray-200 my-1" />
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="In pipeline"
              className="w-full px-3 py-2 text-sm text-left flex items-center gap-3 cursor-not-allowed opacity-60"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Icon icon="mdi:image-outline" className="w-5 h-5 text-gray-400" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-gray-700 flex items-center gap-2">
                  Upload DAD image
                  <span className="text-[10px] uppercase tracking-wide bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                    In pipeline
                  </span>
                </div>
                <div className="text-xs text-gray-500">Detailed architecture diagram upload</div>
              </div>
            </button>
              <div className="border-t border-gray-200 my-1" />
              <button
                onClick={handlePromptTab}
                className="w-full px-3 py-2 text-sm text-left flex items-center gap-3 hover:bg-gray-100"
              >
                <div className="w-8 h-8 rounded-lg bg-azure-purple/10 flex items-center justify-center flex-shrink-0">
                  <Icon icon="mdi:lightbulb-on-outline" className="w-5 h-5 text-azure-purple" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">Create from Prompt</div>
                  <div className="text-xs text-gray-500">Describe and generate a diagram</div>
                </div>
              </button>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenuTab && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[150px]"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            onClick={() => {
              const tab = tabs.find((t) => t.id === contextMenuTab);
              if (tab) handleRename(tab);
            }}
            className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-gray-100"
          >
            <Icon icon="mdi:pencil-outline" className="w-4 h-4" />
            Rename
          </button>
          <button
            onClick={() => handleDuplicate(contextMenuTab)}
            className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-gray-100"
          >
            <Icon icon="mdi:content-copy" className="w-4 h-4" />
            Duplicate
          </button>
          {tabs.length > 1 && (
            <>
              <div className="border-t border-gray-200 my-1" />
              <button
                onClick={() => handleDelete(contextMenuTab)}
                className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 text-red-600 hover:bg-red-50"
              >
                <Icon icon="mdi:delete-outline" className="w-4 h-4" />
                Close Tab
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TabBar;

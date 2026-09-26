// Tabs Store - Manages multiple project tabs

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { DiagramNode, DiagramEdge } from '@/types';

// Tab content snapshot
export interface TabContent {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  history: { nodes: DiagramNode[]; edges: DiagramEdge[] }[];
  historyIndex: number;
}

// Tab metadata
export interface Tab {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface TabsState {
  // List of all tabs
  tabs: Tab[];
  // Currently active tab ID
  activeTabId: string | null;
  // Content for each tab (keyed by tab ID)
  tabContents: Record<string, TabContent>;
  
  // Actions
  createTab: (name?: string) => string;
  renameTab: (tabId: string, newName: string) => void;
  deleteTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  duplicateTab: (tabId: string, newName?: string) => string;
  
  // Content management
  saveTabContent: (tabId: string, content: TabContent) => void;
  getTabContent: (tabId: string) => TabContent | undefined;
  getActiveTab: () => Tab | undefined;
  getActiveTabContent: () => TabContent | undefined;
}

// Generate unique tab ID
const generateTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// Default empty content for new tabs
const createEmptyContent = (): TabContent => ({
  nodes: [],
  edges: [],
  history: [],
  historyIndex: -1,
});

export const useTabsStore = create<TabsState>()(
  devtools(
    persist(
      (set, get) => ({
        tabs: [],
        activeTabId: null,
        tabContents: {},

        // Create a new tab
        createTab: (name?: string) => {
          const id = generateTabId();
          const tabNumber = get().tabs.length + 1;
          const newTab: Tab = {
            id,
            name: name || `Project ${tabNumber}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          set((state) => ({
            tabs: [...state.tabs, newTab],
            activeTabId: id,
            tabContents: {
              ...state.tabContents,
              [id]: createEmptyContent(),
            },
          }));
          
          return id;
        },

        // Rename a tab
        renameTab: (tabId: string, newName: string) => {
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === tabId
                ? { ...tab, name: newName.trim() || tab.name, updatedAt: Date.now() }
                : tab
            ),
          }));
        },

        // Delete a tab
        deleteTab: (tabId: string) => {
          const { tabs, activeTabId, tabContents } = get();
          
          // Can't delete the last tab
          if (tabs.length <= 1) {
            return;
          }
          
          // Find the index of the tab being deleted
          const deletedIndex = tabs.findIndex((t) => t.id === tabId);
          
          // Remove the tab
          const newTabs = tabs.filter((t) => t.id !== tabId);
          
          // Remove the content
          const newContents = { ...tabContents };
          delete newContents[tabId];
          
          // If deleting the active tab, switch to adjacent tab
          let newActiveId = activeTabId;
          if (activeTabId === tabId) {
            // Prefer the tab to the right, otherwise the one to the left
            if (deletedIndex < newTabs.length) {
              newActiveId = newTabs[deletedIndex].id;
            } else {
              newActiveId = newTabs[newTabs.length - 1].id;
            }
          }
          
          set({
            tabs: newTabs,
            activeTabId: newActiveId,
            tabContents: newContents,
          });
        },

        // Switch to a different tab
        switchTab: (tabId: string) => {
          const { tabs } = get();
          if (tabs.some((t) => t.id === tabId)) {
            set({ activeTabId: tabId });
          }
        },

        // Duplicate a tab
        duplicateTab: (tabId: string, newName?: string) => {
          const { tabs, tabContents } = get();
          const sourceTab = tabs.find((t) => t.id === tabId);
          const sourceContent = tabContents[tabId];
          
          if (!sourceTab) {
            return get().createTab(newName);
          }
          
          const id = generateTabId();
          const duplicatedTab: Tab = {
            id,
            name: newName || `${sourceTab.name} (Copy)`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          set((state) => ({
            tabs: [...state.tabs, duplicatedTab],
            activeTabId: id,
            tabContents: {
              ...state.tabContents,
              [id]: sourceContent
                ? JSON.parse(JSON.stringify(sourceContent))
                : createEmptyContent(),
            },
          }));
          
          return id;
        },

        // Save content to a specific tab
        saveTabContent: (tabId: string, content: TabContent) => {
          set((state) => ({
            tabContents: {
              ...state.tabContents,
              [tabId]: content,
            },
            tabs: state.tabs.map((tab) =>
              tab.id === tabId ? { ...tab, updatedAt: Date.now() } : tab
            ),
          }));
        },

        // Get content of a specific tab
        getTabContent: (tabId: string) => {
          return get().tabContents[tabId];
        },

        // Get the active tab
        getActiveTab: () => {
          const { tabs, activeTabId } = get();
          return tabs.find((t) => t.id === activeTabId);
        },

        // Get content of the active tab
        getActiveTabContent: () => {
          const { activeTabId, tabContents } = get();
          if (!activeTabId) return undefined;
          return tabContents[activeTabId];
        },
      }),
      {
        name: 'tabs-storage',
        version: 1,
      }
    ),
    { name: 'TabsStore' }
  )
);

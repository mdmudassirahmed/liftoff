// Import Diagram Modal - Import architecture from JSON

import { useState, useRef } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';

interface ImportedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  parentId?: string;
  extent?: string;
}

interface ImportedEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: Record<string, unknown>;
  sourceHandle?: string;
  targetHandle?: string;
}

interface ImportedDiagram {
  nodes: ImportedNode[];
  edges: ImportedEdge[];
}

interface ImportDiagramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (diagram: ImportedDiagram, projectName: string) => void;
}

export function ImportDiagramModal({
  isOpen,
  onClose,
  onImport,
}: ImportDiagramModalProps) {
  const [jsonContent, setJsonContent] = useState('');
  const [projectName, setProjectName] = useState('Imported Project');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndParseJson = (content: string): ImportedDiagram | null => {
    try {
      const parsed = JSON.parse(content);
      
      // Validate structure
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        setError('Invalid JSON: "nodes" array is required');
        return null;
      }
      
      if (!parsed.edges || !Array.isArray(parsed.edges)) {
        setError('Invalid JSON: "edges" array is required');
        return null;
      }
      
      // Validate nodes have required fields
      for (const node of parsed.nodes) {
        if (!node.id || !node.type || !node.position || !node.data) {
          setError(`Invalid node: Missing required fields (id, type, position, data)`);
          return null;
        }
      }
      
      // Validate edges have required fields
      for (const edge of parsed.edges) {
        if (!edge.id || !edge.source || !edge.target) {
          setError(`Invalid edge: Missing required fields (id, source, target)`);
          return null;
        }
      }
      
      setError(null);
      return parsed as ImportedDiagram;
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}`);
      return null;
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setJsonContent(content);
      
      // Try to extract project name from file name
      const fileName = file.name.replace('.json', '');
      if (fileName) {
        setProjectName(fileName);
      }
      
      // Validate immediately
      validateAndParseJson(content);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleImport = () => {
    const diagram = validateAndParseJson(jsonContent);
    if (diagram) {
      onImport(diagram, projectName.trim() || 'Imported Project');
      handleClose();
    }
  };

  const handleClose = () => {
    setJsonContent('');
    setProjectName('Imported Project');
    setError(null);
    setIsDragging(false);
    onClose();
  };

  const getPreviewStats = () => {
    try {
      const parsed = JSON.parse(jsonContent);
      const nodes = parsed.nodes || [];
      const edges = parsed.edges || [];
      
      const groups = nodes.filter((n: ImportedNode) => n.type === 'azure.group' || n.type === 'group');
      const services = nodes.filter((n: ImportedNode) => n.type === 'azure.service' || n.type === 'service');
      
      return {
        totalNodes: nodes.length,
        groups: groups.length,
        services: services.length,
        connections: edges.length,
      };
    } catch {
      return null;
    }
  };

  if (!isOpen) return null;

  const stats = getPreviewStats();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
              <Icon icon="mdi:file-import-outline" className="w-6 h-6 text-brand-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Import Architecture
              </h2>
              <p className="text-sm text-gray-500">
                Create a project from existing JSON definition
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
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
            />
          </div>

          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload JSON File
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all',
                isDragging
                  ? 'border-brand-primary bg-brand-primary/5'
                  : 'border-gray-300 hover:border-brand-primary hover:bg-gray-50'
              )}
            >
              <Icon
                icon="mdi:cloud-upload-outline"
                className={cn(
                  'w-10 h-10 mx-auto mb-2',
                  isDragging ? 'text-brand-primary' : 'text-gray-400'
                )}
              />
              <p className="text-sm text-gray-600">
                {isDragging ? (
                  'Drop your JSON file here'
                ) : (
                  <>
                    <span className="text-brand-primary font-medium">Click to upload</span> or drag and drop
                  </>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">JSON files only</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileInputChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Or Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase">or paste JSON</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* JSON Text Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Paste JSON Content
            </label>
            <textarea
              value={jsonContent}
              onChange={(e) => {
                setJsonContent(e.target.value);
                if (e.target.value) {
                  validateAndParseJson(e.target.value);
                } else {
                  setError(null);
                }
              }}
              placeholder='{"nodes": [...], "edges": [...]}'
              rows={8}
              className={cn(
                'w-full px-3 py-2 border rounded-lg text-sm font-mono',
                'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent',
                'resize-none',
                error ? 'border-red-300 bg-red-50' : 'border-gray-300'
              )}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <Icon icon="mdi:alert-circle" className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Preview Stats */}
          {stats && !error && jsonContent && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Icon icon="mdi:check-circle" className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium text-green-800">Valid JSON - Ready to import</span>
              </div>
              <div className="grid grid-cols-4 gap-4 mt-3">
                <div className="text-center">
                  <div className="text-xl font-bold text-green-700">{stats.totalNodes}</div>
                  <div className="text-xs text-green-600">Total Nodes</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-green-700">{stats.groups}</div>
                  <div className="text-xs text-green-600">Groups</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-green-700">{stats.services}</div>
                  <div className="text-xs text-green-600">Services</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-green-700">{stats.connections}</div>
                  <div className="text-xs text-green-600">Connections</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <button
            onClick={handleClose}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'text-gray-700 hover:bg-gray-200'
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!jsonContent || !!error}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2',
              jsonContent && !error
                ? 'bg-brand-primary text-white hover:bg-brand-primary/90'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            )}
          >
            <Icon icon="mdi:import" className="w-4 h-4" />
            Import & Create Project
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportDiagramModal;

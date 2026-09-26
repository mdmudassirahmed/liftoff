// IaC Generation Hook

import { useState, useCallback } from 'react';
import { useIaCStore, useDiagramStore } from '@/store';
import { iacService } from '@/services/iacService';
import type { IaCFormat, TargetScope, GenerateIaCResponse, ExportDiagram } from '@/types';
import { downloadFile, copyToClipboard } from '@/lib/utils';

export interface UseIaCGenerationOptions {
  format?: IaCFormat;
  targetScope?: TargetScope;
  useMcp?: boolean;
}

export function useIaCGeneration(options: UseIaCGenerationOptions = {}) {
  const { format = 'bicep', targetScope = 'resourceGroup', useMcp = true } = options;
  
  const serializeDiagram = useDiagramStore((state) => state.serializeDiagram);
  const getDiagramForExport = useDiagramStore((state) => state.getDiagramForExport);
  const {
    generatedCode,
    isGenerating,
    validationErrors,
    validationWarnings,
    metadata,
    lastGeneratedAt,
    format: currentFormat,
    setGenerating,
    handleGenerationResponse,
    clearGeneration,
  } = useIaCStore();

  const [error, setError] = useState<string | null>(null);

  /**
   * Get the diagram in export format for external consumption.
   * This is the clean format with azure.service and azure.group types.
   */
  const getExportDiagram = useCallback((): ExportDiagram => {
    return getDiagramForExport();
  }, [getDiagramForExport]);

  /**
   * Download the diagram as JSON for debugging or external use.
   */
  const downloadDiagramJson = useCallback((filename: string = 'diagram-export.json') => {
    const diagram = getDiagramForExport();
    const json = JSON.stringify(diagram, null, 2);
    downloadFile(json, filename, 'application/json');
  }, [getDiagramForExport]);

  const generateIaC = useCallback(
    async (overrideFormat?: IaCFormat): Promise<GenerateIaCResponse | null> => {
      setError(null);
      setGenerating(true);

      try {
        const diagram = serializeDiagram();
        const response = await iacService.generateBicep(diagram, {
          format: overrideFormat || format,
          targetScope,
          useMcp,
        });

        handleGenerationResponse(response);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate IaC';
        setError(message);
        setGenerating(false);
        return null;
      }
    },
    [serializeDiagram, format, targetScope, useMcp, setGenerating, handleGenerationResponse]
  );

  const generateBicep = useCallback(() => generateIaC('bicep'), [generateIaC]);
  const generateTerraform = useCallback(() => generateIaC('terraform'), [generateIaC]);
  const generateARM = useCallback(() => generateIaC('arm'), [generateIaC]);

  const validateCode = useCallback(
    async (code?: string): Promise<boolean> => {
      try {
        const codeToValidate = code || generatedCode;
        if (!codeToValidate) return false;

        const response = await iacService.validate(codeToValidate, currentFormat);
        return response.valid;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Validation failed';
        setError(message);
        return false;
      }
    },
    [generatedCode, currentFormat]
  );

  const downloadCode = useCallback(
    (filename?: string) => {
      if (!generatedCode) return;

      const defaultFilename = iacService.formatFileName(currentFormat);
      const mimeType = currentFormat === 'arm' ? 'application/json' : 'text/plain';
      
      downloadFile(generatedCode, filename || defaultFilename, mimeType);
    },
    [generatedCode, currentFormat]
  );

  const copyCode = useCallback(async (): Promise<boolean> => {
    if (!generatedCode) return false;

    try {
      await copyToClipboard(generatedCode);
      return true;
    } catch {
      return false;
    }
  }, [generatedCode]);

  return {
    // State
    generatedCode,
    isGenerating,
    validationErrors,
    validationWarnings,
    metadata,
    lastGeneratedAt,
    format: currentFormat,
    error,
    hasErrors: validationErrors.length > 0,
    hasWarnings: validationWarnings.length > 0,

    // Actions
    generateIaC,
    generateBicep,
    generateTerraform,
    generateARM,
    validateCode,
    downloadCode,
    copyCode,
    clearGeneration,
    
    // Export functions
    getExportDiagram,
    downloadDiagramJson,
  };
}

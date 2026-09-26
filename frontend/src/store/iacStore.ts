import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  IaCFormat,
  IaCState,
  ValidationMessage,
  IaCMetadata,
  GenerateIaCResponse,
  ComplianceReport,
} from '@/types';
import type { CSP } from '@/types';

interface IaCStoreState extends IaCState {
  // CSP-aware fields
  csp: CSP;
  compliance: ComplianceReport | null;
  // Actions
  setGenerating: (isGenerating: boolean) => void;
  setGeneratedCode: (code: string, format: IaCFormat, csp?: CSP) => void;
  setValidationResults: (
    errors: ValidationMessage[],
    warnings: ValidationMessage[]
  ) => void;
  setMetadata: (metadata: IaCMetadata | null) => void;
  setCompliance: (compliance: ComplianceReport | null) => void;
  handleGenerationResponse: (response: GenerateIaCResponse, csp?: CSP) => void;
  clearGeneration: () => void;
}

const initialState: IaCState & { csp: CSP; compliance: ComplianceReport | null } = {
  generatedCode: '',
  format: 'bicep',
  isGenerating: false,
  validationErrors: [],
  validationWarnings: [],
  metadata: null,
  lastGeneratedAt: null,
  csp: 'azure',
  compliance: null,
};

export const useIaCStore = create<IaCStoreState>()(
  devtools(
    (set) => ({
      ...initialState,
      
      setGenerating: (isGenerating) => {
        set({ isGenerating });
      },

      setGeneratedCode: (code, format, csp) => {
        set({
          generatedCode: code,
          format,
          csp: csp ?? 'azure',
          lastGeneratedAt: new Date().toISOString(),
        });
      },

      setValidationResults: (errors, warnings) => {
        set({
          validationErrors: errors,
          validationWarnings: warnings,
        });
      },

      setMetadata: (metadata) => {
        set({ metadata });
      },

      setCompliance: (compliance) => {
        set({ compliance });
      },

      handleGenerationResponse: (response, csp) => {
        set({
          generatedCode: response.code,
          format: response.format,
          csp: csp ?? 'azure',
          validationErrors: response.validationErrors,
          validationWarnings: response.validationWarnings,
          metadata: response.metadata || null,
          isGenerating: false,
          lastGeneratedAt: new Date().toISOString(),
        });
      },

      clearGeneration: () => {
        set(initialState);
      },
    }),
    { name: 'IaCStore' }
  )
);

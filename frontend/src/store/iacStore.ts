import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  IaCFormat,
  IaCState,
  ValidationMessage,
  IaCMetadata,
  GenerateIaCResponse,
} from '@/types';

interface IaCStoreState extends IaCState {
  // Actions
  setGenerating: (isGenerating: boolean) => void;
  setGeneratedCode: (code: string, format: IaCFormat) => void;
  setValidationResults: (
    errors: ValidationMessage[],
    warnings: ValidationMessage[]
  ) => void;
  setMetadata: (metadata: IaCMetadata | null) => void;
  handleGenerationResponse: (response: GenerateIaCResponse) => void;
  clearGeneration: () => void;
}

const initialState: IaCState = {
  generatedCode: '',
  format: 'bicep',
  isGenerating: false,
  validationErrors: [],
  validationWarnings: [],
  metadata: null,
  lastGeneratedAt: null,
};

export const useIaCStore = create<IaCStoreState>()(
  devtools(
    (set) => ({
      ...initialState,
      
      setGenerating: (isGenerating) => {
        set({ isGenerating });
      },
      
      setGeneratedCode: (code, format) => {
        set({
          generatedCode: code,
          format,
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
      
      handleGenerationResponse: (response) => {
        set({
          generatedCode: response.code,
          format: response.format,
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

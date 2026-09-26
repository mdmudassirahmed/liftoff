// IaC Preview Modal Component

import { useState, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { useDiagramStore, useIaCStore } from '@/store';
import { useIaCGeneration } from '@/hooks/useIaCGeneration';
import { validateArchitecture, getValidationSummary, type SchemaValidationResult, type SchemaValidationIssue } from '@/services/bicepSchemaValidator';
import { api } from '@/services/api';
import type { IaCFormat, ComplianceReport } from '@/types';
import { GuardrailsCompliancePanel } from './GuardrailsCompliancePanel';
import JSZip from 'jszip';

type ModalFormat = IaCFormat | 'json';

interface ModularFile {
  path: string;
  content: string;
  description: string;
}

interface IaCPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const getPreviewErrorInsights = (error?: string, fallbackRg?: string) => {
  if (!error) return null;
  const normalized = error.toLowerCase();
  const rgMatch = error.match(/Resource group '([^']+)'/i);
  const rgName = rgMatch?.[1] || fallbackRg;

  if (
    error.includes('ResourceGroupNotFound') ||
    (normalized.includes('resource group') && normalized.includes('could not be found'))
  ) {
    return {
      type: 'resourceGroup' as const,
      title: 'Resource group not found',
      message: rgName
        ? `The resource group "${rgName}" does not exist in the selected subscription.`
        : 'The selected resource group does not exist in the selected subscription.',
      action: 'Select an existing resource group from the dropdown or create it in Azure before previewing.'
    };
  }

  return {
    type: 'generic' as const,
    title: 'Preview failed',
    message: error,
    action: 'Review the error details and try again.'
  };
};

export function IaCPreviewModal({
  isOpen,
  onClose,
}: IaCPreviewModalProps) {
  const {
    generatedCode,
    format,
    validationErrors,
    validationWarnings,
    metadata,
    isGenerating,
    setGenerating,
    setGeneratedCode,
  } = useIaCStore();

  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const getDiagramForExport = useDiagramStore((state) => state.getDiagramForExport);

  const { generateIaC, downloadCode, copyCode } = useIaCGeneration();
  
  const [copied, setCopied] = useState(false);
  // Default to 'bicep' tab
  const [selectedFormat, setSelectedFormat] = useState<ModalFormat>('bicep');
  const [schemaValidation, setSchemaValidation] = useState<SchemaValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [foundryGenerated, setFoundryGenerated] = useState(false);
  const [foundryAgentName, setFoundryAgentName] = useState<string | null>(null);
  // Security guardrail compliance report (null = feature inactive; behaves as before).
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null);
  
  // Modular generation state
  const [isModular, setIsModular] = useState(true); // Default to modular for production-ready templates
  const [modularFiles, setModularFiles] = useState<ModularFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [structureSummary, setStructureSummary] = useState<string>('');

  // Deploy state
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<'idle' | 'preview' | 'validating' | 'deploying' | 'completed' | 'failed'>('idle');
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployResult, setDeployResult] = useState<{
    success: boolean;
    deployment_name: string;
    provisioning_state: string;
    duration_seconds: number;
    outputs: Record<string, unknown>;
    resources: Array<{ id: string; resource_group: string }>;
    error?: string;
    warnings: string[];
  } | null>(null);
  const [whatIfResult, setWhatIfResult] = useState<{
    success: boolean;
    changes: Array<{
      resource_id: string;
      resource_type: string;
      resource_name: string;
      change_type: 'Create' | 'Modify' | 'Delete' | 'NoChange' | 'Ignore';
    }>;
    summary: Record<string, number>;
    duration_seconds: number;
    error?: string;
  } | null>(null);
  const [previewLogs, setPreviewLogs] = useState<Array<{ message: string; step: string; timestamp: number }>>([]);
  const [liveChanges, setLiveChanges] = useState<Array<{
    resource_id: string;
    resource_type: string;
    resource_name: string;
    change_type: string;
    icon?: string;
  }>>([]);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [pendingFixes, setPendingFixes] = useState<string[]>([]);
  const [pendingFixedContent, setPendingFixedContent] = useState<string | null>(null);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [resourceGroup, setResourceGroup] = useState('');
  const [resourceGroups, setResourceGroups] = useState<Array<{ name: string; location: string }>>([]);
  // Real subscriptions from `az account list`. Empty = fall back to the az default subscription.
  const [subscriptions, setSubscriptions] = useState<Array<{ subscription_id: string; name: string; is_default?: boolean }>>([]);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string>('');
  const [showIgnoredResources, setShowIgnoredResources] = useState(false);
  const [azureAuthStatus, setAzureAuthStatus] = useState<{
    authenticated: boolean;
    subscription_name?: string;
    user?: string;
    error?: string;
  } | null>(null);

  // Reset validation when modal opens or nodes change
  useEffect(() => {
    if (isOpen) {
      // Reset validation state when modal opens
      setSchemaValidation(null);
      // Reset to Bicep tab when modal opens
      setSelectedFormat('bicep');
      setFoundryGenerated(false);
      setFoundryAgentName(null);
      setCompliance(null);
      setModularFiles([]);
      setSelectedFile(null);
      setStructureSummary('');
      setDeployResult(null);
      setShowDeployModal(false);
      setShowPreviewModal(false);
    }
  }, [isOpen]);

  // Also reset validation when nodes change (user made modifications)
  useEffect(() => {
    setSchemaValidation(null);
  }, [nodes]);

  // Generate IaC using Azure AI Foundry Agent
  const generateWithFoundry = useCallback(async (targetFormat: 'bicep' | 'terraform') => {
    setGenerating(true);
    setFoundryGenerated(false);
    setCompliance(null);
    setModularFiles([]);
    setSelectedFile(null);
    
    try {
      const diagram = getDiagramForExport();
      
      if (isModular) {
        // Generate modular structure
        const response = await api.generateModularIaCWithFoundry(
          { nodes: diagram.nodes, edges: diagram.edges },
          targetFormat
        );
        
        setModularFiles(response.files);
        setStructureSummary(response.structure_summary);
        setFoundryAgentName(response.agent_name);
        setCompliance(response.compliance ?? null);
        
        // Set the first file as selected (usually main.bicep)
        const mainFile = response.files.find(f => f.path === 'main.bicep') || response.files[0];
        if (mainFile) {
          setSelectedFile(mainFile.path);
          setGeneratedCode(mainFile.content, targetFormat);
        }
        
        console.log(`Generated modular ${targetFormat} via ${response.agent_name} in ${response.duration_ms.toFixed(0)}ms | ${response.files.length} files`);
      } else {
        // Generate single file
        const response = await api.generateIaCWithFoundry(
          { nodes: diagram.nodes, edges: diagram.edges },
          targetFormat
        );
        
        setGeneratedCode(response.template, targetFormat);
        setFoundryAgentName(response.agent_name);
        setCompliance(response.compliance ?? null);
        console.log(`Generated ${targetFormat} via ${response.agent_name} in ${response.duration_ms.toFixed(0)}ms`);
      }
      
      setFoundryGenerated(true);
    } catch (error) {
      console.error('Foundry IaC generation failed:', error);
      // Fallback to local generation
      await generateIaC(targetFormat as IaCFormat);
    } finally {
      setGenerating(false);
    }
  }, [getDiagramForExport, setGenerating, setGeneratedCode, generateIaC, isModular]);

  // Get diagram JSON for export
  const diagramJson = getDiagramForExport();
  const diagramJsonString = JSON.stringify(diagramJson, null, 2);

  const handleCopy = async () => {
    let success = false;
    if (selectedFormat === 'json') {
      await navigator.clipboard.writeText(diagramJsonString);
      success = true;
    } else {
      success = await copyCode();
    }
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (selectedFormat === 'json') {
      const blob = new Blob([diagramJsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'architecture.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (isModular && modularFiles.length > 0) {
      // Download as ZIP for modular structure - sync approach
      const zip = new JSZip();
      
      // Add each file to the zip
      modularFiles.forEach(file => {
        zip.file(file.path, file.content);
      });
      
      // Generate and trigger download
      zip.generateAsync({ type: 'blob' }).then(content => {
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `infrastructure-${selectedFormat}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }).catch(err => {
        console.error('ZIP generation failed:', err);
      });
    } else {
      downloadCode();
    }
  };

  // Load resource groups for a specific subscription (or the az default when omitted),
  // always keeping the diagram's RG selectable so today's flow never regresses.
  const loadResourceGroupsForSubscription = async (subscriptionId?: string) => {
    const rgNode = nodes.find(n => n.data?.groupType === 'resourceGroup');
    const diagramRG = (rgNode?.data?.label as string) || '';
    const diagramRegion = (rgNode?.data?.region as string) || 'eastus';
    try {
      const rgResponse = await api.listResourceGroups(subscriptionId);
      const azureRGs = rgResponse?.resource_groups ?? [];
      if (azureRGs.length > 0) {
        const hasDiagramRG = diagramRG && azureRGs.some((rg: { name: string }) => rg.name === diagramRG);
        // Prepend diagram RG only when it's named and not already in the Azure list
        setResourceGroups(diagramRG && !hasDiagramRG ? [{ name: diagramRG, location: diagramRegion }, ...azureRGs] : azureRGs);
      } else if (diagramRG) {
        setResourceGroups([{ name: diagramRG, location: diagramRegion }]);
      } else {
        setResourceGroups([]);
      }
    } catch (rgError) {
      console.error('Failed to load resource groups:', rgError);
      // On error, show diagram RG if available, else empty (user can type manually)
      setResourceGroups(diagramRG ? [{ name: diagramRG, location: diagramRegion }] : []);
    }
  };

  // Switch subscription from the dropdown: remember it and reload that subscription's RGs.
  const handleSubscriptionChange = async (subscriptionId: string) => {
    setSelectedSubscriptionId(subscriptionId);
    await loadResourceGroupsForSubscription(subscriptionId || undefined);
  };

  // Real-subscription dropdown, shown only when `az account list` returned subscriptions.
  // When absent (older CLI / single-sub / offline) the flow silently uses the az default.
  const renderSubscriptionSelect = () => {
    if (subscriptions.length === 0) return null;
    return (
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">
          <Icon icon="mdi:cloud-key-outline" className="w-4 h-4 inline mr-1" />
          Azure Subscription
        </label>
        <select
          value={selectedSubscriptionId}
          onChange={(e) => handleSubscriptionChange(e.target.value)}
          className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-accent focus:border-brand-accent transition-all text-sm"
        >
          {subscriptions.map(sub => (
            <option key={sub.subscription_id} value={sub.subscription_id}>
              {sub.name}{sub.is_default ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>
    );
  };

  // Load deploy context (subscriptions + RG + auth) without opening modal
  const loadDeployContext = async () => {
    // Try to extract RG from diagram first
    const rgNode = nodes.find(n => n.data?.groupType === 'resourceGroup');
    const diagramRG = (rgNode?.data?.label as string) || '';

    // Pre-fill from diagram RG node; leave empty when no node (user picks from dropdown)
    if (diagramRG) setResourceGroup(diagramRG);

    // Check Azure CLI authentication status
    try {
      const status = await api.getDeployStatus();
      console.log('Azure auth status:', status);
      setAzureAuthStatus(status);

      if (status.authenticated) {
        // Load the subscriptions the user can access; default to the current az subscription.
        try {
          const subResponse = await api.listSubscriptions();
          const subs = subResponse?.subscriptions ?? [];
          setSubscriptions(subs);
          const defaultSub =
            subResponse?.default_subscription_id ||
            status.subscription_id ||
            subs.find(s => s.is_default)?.subscription_id ||
            subs[0]?.subscription_id ||
            '';
          setSelectedSubscriptionId(defaultSub);
          await loadResourceGroupsForSubscription(defaultSub || undefined);
        } catch (subError) {
          console.error('Failed to load subscriptions:', subError);
          setSubscriptions([]);
          await loadResourceGroupsForSubscription(status.subscription_id || undefined);
        }
      }
      return status;
    } catch (error) {
      console.error('Failed to check Azure auth status:', error);
      const fallbackStatus = {
        authenticated: false,
        error: 'Failed to check Azure CLI status. Make sure az CLI is installed.'
      };
      setAzureAuthStatus(fallbackStatus);
      return fallbackStatus;
    }
  };

  // Handle opening deploy modal
  const handleOpenDeployModal = async () => {
    setShowDeployModal(true);
    setDeployResult(null);
    await loadDeployContext();
  };

  // Handle preview changes (What-If) with streaming logs
  const handlePreviewChanges = async () => {
    if (!resourceGroup || modularFiles.length === 0) return;
    const status = azureAuthStatus ?? await loadDeployContext();
    if (!status?.authenticated) {
      setPreviewLogs(prev => [...prev, { message: 'Azure CLI not authenticated. Please sign in to run preview.', step: 'auth', timestamp: Date.now() }]);
      return;
    }

    if (resourceGroups.length > 0 && !resourceGroups.some(rg => rg.name === resourceGroup)) {
      const error = `Resource group '${resourceGroup}' not found in the selected subscription.`;
      setPreviewLogs(prev => [...prev, { message: `${error}`, step: 'validate', timestamp: Date.now() }]);
      setWhatIfResult({
        success: false,
        changes: [],
        summary: {},
        duration_seconds: 0,
        error
      });
      setDeployStep('idle');
      setIsDeploying(false);
      return;
    }
    
    setIsDeploying(true);
    setDeployStep('preview');
    setDeployProgress(5);
    setWhatIfResult(null);
    setPreviewLogs([]);
    setLiveChanges([]);
    
    // Start streaming
    const abort = api.streamPreviewDeployment(
      modularFiles.map(f => ({ path: f.path, content: f.content })),
      resourceGroup,
      // On log
      (message, step) => {
        setPreviewLogs(prev => [...prev, { message, step, timestamp: Date.now() }]);
        // Update progress based on step
        const progressMap: Record<string, number> = {
          'auth': 15,
          'prepare': 30,
          'analyze': 45,
          'validate': 55,
          'connect': 65,
          'compare': 75,
          'results': 85,
          'summary': 95,
          'complete': 100
        };
        if (progressMap[step]) {
          setDeployProgress(progressMap[step]);
        }
      },
      // On change
      (change) => {
        setLiveChanges(prev => [...prev, change]);
      },
      // On complete
      (result) => {
        setWhatIfResult(result);
        setDeployProgress(100);
        setDeployStep('idle');
        setIsDeploying(false);
        
        if (result.success) {
          console.log(`Preview completed: ${result.changes?.length || 0} changes found`);
        } else {
          console.error(`Preview failed: ${result.error}`);
        }
      },
      // On error
      (error) => {
        setPreviewLogs(prev => [...prev, { message: `Error: ${error}`, step: 'error', timestamp: Date.now() }]);
        setWhatIfResult({
          success: false,
          changes: [],
          summary: {},
          duration_seconds: 0,
          error
        });
        setDeployStep('idle');
        setIsDeploying(false);
      },
      'parameters/dev.parameters.json',
      selectedSubscriptionId || undefined
    );

    // Store abort function for cleanup if needed
    return abort;
  };

  const buildFixPlan = (content: string, errorText: string) => {
    let updated = content;
    const fixes: string[] = [];

    // Remove duplicate @description decorators if they appear back-to-back
    const dupDescriptionRegex = /(@description\([^\n]*\)\s*\n)\s*@description\([^\n]*\)\s*\n/g;
    if (dupDescriptionRegex.test(updated)) {
      updated = updated.replace(dupDescriptionRegex, '$1');
      fixes.push('Removed duplicate @description decorators.');
    }

    // Remove unnecessary dependsOn entries referenced by linter warnings
    const dependsOnMatches = [...errorText.matchAll(/dependsOn entry '([^']+)'/g)].map(m => m[1]);
    if (dependsOnMatches.length > 0) {
      let removedAny = false;
      for (const entry of dependsOnMatches) {
        const entryRegex = new RegExp(`\\s*'${entry}'\\s*,?\\s*\\n?`, 'g');
        if (entryRegex.test(updated)) {
          updated = updated.replace(entryRegex, '');
          removedAny = true;
        }
      }
      if (removedAny) {
        fixes.push('Removed unnecessary dependsOn entries flagged by the linter.');
      }
    }

    return { updated, fixes };
  };

  const handleAttemptAutoFix = () => {
    if (!whatIfResult?.error) return;
    const mainFile = modularFiles.find(f => f.path === 'main.bicep');
    if (!mainFile) return;

    const { updated, fixes } = buildFixPlan(mainFile.content, whatIfResult.error);

    if (fixes.length === 0 || updated === mainFile.content) {
      setPreviewLogs(prev => [...prev, { message: 'No safe auto-fixes found for this error set.', step: 'fix', timestamp: Date.now() }]);
      return;
    }

    setPendingFixes(fixes);
    setPendingFixedContent(updated);
    setShowFixConfirm(true);
  };

  const applyAutoFixes = () => {
    if (!pendingFixedContent) return;
    setIsApplyingFix(true);

    setModularFiles(prev => prev.map(file =>
      file.path === 'main.bicep'
        ? { ...file, content: pendingFixedContent }
        : file
    ));

    setPreviewLogs(prev => [
      ...prev,
      { message: 'Applied auto-fix to main.bicep. Re-run Preview Changes to validate.', step: 'fix', timestamp: Date.now() }
    ]);
    setWhatIfResult(null);
    setShowFixConfirm(false);
    setPendingFixes([]);
    setPendingFixedContent(null);
    setIsApplyingFix(false);
  };

  // Handle deploy to Azure
  const handleDeploy = async () => {
    if (!resourceGroup || modularFiles.length === 0) return;
    
    setIsDeploying(true);
    setDeployResult(null);
    setDeployStep('validating');
    setDeployProgress(10);
    
    try {
      // Step 1: Validating files
      setDeployProgress(20);
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX
      
      // Step 2: Starting deployment
      setDeployStep('deploying');
      setDeployProgress(40);
      
      const result = await api.deployToAzure(
        modularFiles.map(f => ({ path: f.path, content: f.content })),
        resourceGroup,
        'parameters/dev.parameters.json',
        selectedSubscriptionId || undefined
      );
      
      // Step 3: Processing result
      setDeployProgress(90);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      setDeployResult(result);
      setDeployProgress(100);
      
      if (result.success) {
        setDeployStep('completed');
        console.log(`Deployment succeeded: ${result.deployment_name}`);
      } else {
        setDeployStep('failed');
        console.error(`Deployment failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Deployment failed:', error);
      setDeployStep('failed');
      setDeployProgress(100);
      setDeployResult({
        success: false,
        deployment_name: 'unknown',
        provisioning_state: 'Failed',
        duration_seconds: 0,
        outputs: {},
        resources: [],
        error: error instanceof Error ? error.message : 'Deployment failed',
        warnings: []
      });
    } finally {
      setIsDeploying(false);
    }
  };

  // Handle browser-based Azure login
  // Deployments run with the Azure CLI identity of the machine hosting the backend.
  const handleBrowserLogin = () => {
    alert('Liftoff deploys with your Azure CLI sign-in. Run "az login" in a terminal on the machine running the Liftoff backend, then check the status again.');
  };

  // Handle file selection in modular mode
  const handleFileSelect = (filePath: string) => {
    setSelectedFile(filePath);
    const file = modularFiles.find(f => f.path === filePath);
    if (file) {
      setGeneratedCode(file.content, selectedFormat as IaCFormat);
    }
  };

  // Get file icon based on file type
  const getFileIcon = (path: string): string => {
    if (path.endsWith('.bicep')) return 'mdi:code-braces';
    if (path.endsWith('.bicepparam')) return 'mdi:cog';
    if (path.endsWith('.tf')) return 'mdi:terraform';
    if (path.endsWith('.md')) return 'mdi:file-document';
    if (path.endsWith('.json')) return 'mdi:code-json';
    return 'mdi:file';
  };

  // Group files by folder for tree view
  const getFileTree = () => {
    const tree: Record<string, ModularFile[]> = {};
    
    for (const file of modularFiles) {
      const parts = file.path.split('/');
      if (parts.length === 1) {
        // Root level file
        if (!tree['']) tree[''] = [];
        tree[''].push(file);
      } else {
        // File in a folder
        const folder = parts.slice(0, -1).join('/');
        if (!tree[folder]) tree[folder] = [];
        tree[folder].push(file);
      }
    }
    
    return tree;
  };

  const handleFormatChange = async (newFormat: ModalFormat) => {
    setSelectedFormat(newFormat);
    setModularFiles([]);
    setSelectedFile(null);
    if (newFormat !== 'json') {
      await generateIaC(newFormat as IaCFormat);
    }
  };

  const handleValidate = useCallback(async () => {
    setIsValidating(true);
    try {
      const result = await validateArchitecture(nodes, edges);
      setSchemaValidation(result);
      console.log('Schema Validation Result:', result);
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setIsValidating(false);
    }
  }, [nodes, edges]);

  if (!isOpen) return null;

  const previewErrorInsights = getPreviewErrorInsights(whatIfResult?.error, resourceGroup);

  const renderValidationIssue = (issue: SchemaValidationIssue) => (
    <li key={issue.id} className="text-xs p-2 rounded bg-opacity-50">
      <div className="font-medium">{issue.nodeName}</div>
      <div className="text-gray-600">{issue.message}</div>
      {issue.suggestion && (
        <div className="text-gray-500 mt-1 italic">{issue.suggestion}</div>
      )}
    </li>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
              <Icon icon="mdi:code-braces" className="w-5 h-5 text-brand-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Generated Infrastructure Code
              </h2>
              <p className="text-sm text-gray-500">
                {isModular && modularFiles.length > 0 
                  ? `${modularFiles.length} files generated` 
                  : `${metadata?.resourceCount || 0} resources configured`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Format Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-200 bg-gray-50">
          {(['json', 'bicep', 'terraform', 'arm'] as ModalFormat[]).map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleFormatChange(fmt)}
              disabled={isGenerating}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                selectedFormat === fmt
                  ? 'bg-brand-primary text-white'
                  : 'text-gray-600 hover:bg-gray-200'
              )}
            >
              {fmt === 'json' && 'JSON'}
              {fmt === 'bicep' && 'Bicep'}
              {fmt === 'terraform' && 'Terraform'}
              {fmt === 'arm' && 'ARM JSON'}
            </button>
          ))}
          
          {/* Modular Toggle - Only show for IaC formats */}
          {selectedFormat !== 'json' && (
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={isModular}
                onChange={(e) => setIsModular(e.target.checked)}
                className="w-4 h-4 text-brand-primary border-gray-300 rounded focus:ring-brand-primary"
              />
              <span className="flex items-center gap-1">
                <Icon icon="mdi:folder-multiple" className="w-4 h-4" />
                Modular
              </span>
            </label>
          )}
          
          <div className="flex-1" />
          
          {/* Generate Buttons - Only show for IaC formats */}
          {selectedFormat !== 'json' && (
            <button
              onClick={() => generateWithFoundry(selectedFormat === 'arm' ? 'bicep' : selectedFormat as 'bicep' | 'terraform')}
              disabled={isGenerating || nodes.length === 0}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg',
                'bg-azure-blue text-white hover:bg-azure-blue/90 transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Icon icon={isGenerating ? 'mdi:loading' : 'mdi:robot'} className={cn('w-4 h-4', isGenerating && 'animate-spin')} />
              {isGenerating ? 'Generating...' : `Generate ${selectedFormat === 'bicep' ? 'Bicep' : selectedFormat === 'terraform' ? 'Terraform' : 'ARM'}`}
            </button>
          )}
          
          {/* Validate Button */}
          <button
            onClick={handleValidate}
            disabled={isValidating || nodes.length === 0}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg',
              'border border-amber-400 text-amber-600 hover:bg-amber-50 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            <Icon icon={isValidating ? 'mdi:loading' : 'mdi:shield-check'} className={cn('w-4 h-4', isValidating && 'animate-spin')} />
            {isValidating ? 'Validating...' : 'Validate'}
          </button>
          
          {/* Actions */}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg',
              'border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors'
            )}
          >
            <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => {
              console.log('Download clicked', { isModular, modularFilesCount: modularFiles.length, selectedFormat });
              handleDownload();
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg',
              'border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors'
            )}
          >
            <Icon icon="mdi:download" className="w-4 h-4" />
            Download
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* File Tree Sidebar - Only show for modular mode with files */}
          {isModular && modularFiles.length > 0 && selectedFormat !== 'json' && (
            <div className="w-56 border-r border-gray-200 bg-slate-800 overflow-y-auto">
              <div className="p-3 border-b border-slate-700">
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Project Structure
                </h3>
                {structureSummary && (
                  <p className="text-xs text-slate-500 mt-1">{structureSummary}</p>
                )}
              </div>
              <div className="p-2">
                {Object.entries(getFileTree()).map(([folder, files]) => (
                  <div key={folder || 'root'} className="mb-2">
                    {folder && (
                      <div className="flex items-center gap-1 text-xs text-slate-400 px-2 py-1">
                        <Icon icon="mdi:folder" className="w-4 h-4 text-amber-400" />
                        <span>{folder}/</span>
                      </div>
                    )}
                    {files.map((file) => (
                      <button
                        key={file.path}
                        onClick={() => handleFileSelect(file.path)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors',
                          folder ? 'ml-4' : '',
                          selectedFile === file.path
                            ? 'bg-azure-blue text-white'
                            : 'text-slate-300 hover:bg-slate-700'
                        )}
                        title={file.description}
                      >
                        <Icon icon={getFileIcon(file.path)} className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{file.path.split('/').pop()}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Code Preview */}
          <div className="flex-1 overflow-auto bg-slate-900">
            {selectedFormat === 'json' ? (
              <pre className="p-4 text-sm font-mono whitespace-pre-wrap text-emerald-300 leading-relaxed">
                <code>{diagramJsonString}</code>
              </pre>
            ) : isGenerating ? (
              <div className="flex items-center justify-center h-full bg-slate-900">
                <div className="text-center">
                  <Icon
                    icon="mdi:loading"
                    className="w-10 h-10 text-azure-blue animate-spin mx-auto mb-3"
                  />
                  <p className="text-slate-400">
                    {isModular ? 'Generating modular structure...' : `Generating ${selectedFormat} code...`}
                  </p>
                  {isModular && (
                    <p className="text-xs text-slate-500 mt-2">
                      Creating main.bicep, parameter files, and modules...
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {/* File path header for modular mode */}
                {isModular && selectedFile && (
                  <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
                    <Icon icon={getFileIcon(selectedFile)} className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-300 font-mono">{selectedFile}</span>
                  </div>
                )}
                <pre className="p-4 text-sm font-mono whitespace-pre-wrap text-emerald-300 leading-relaxed">
                  <code>{generatedCode || '// No code generated yet. Click "Generate" to create templates.'}</code>
                </pre>
              </div>
            )}
          </div>

          {/* Sidebar - Validation & Info */}
          <div className="w-72 border-l border-gray-200 bg-gray-50 overflow-y-auto">
            {/* Security guardrail compliance (only when the backend returns a report) */}
            {compliance && <GuardrailsCompliancePanel report={compliance} />}

            {/* Schema Validation Results (from Validate button) */}
            {schemaValidation && (
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Icon 
                    icon={schemaValidation.isValid ? 'mdi:check-circle' : 'mdi:alert-circle'} 
                    className={cn('w-4 h-4', schemaValidation.isValid ? 'text-green-500' : 'text-red-500')} 
                  />
                  <h3 className={cn('text-sm font-semibold', schemaValidation.isValid ? 'text-green-700' : 'text-red-700')}>
                    Schema Validation
                  </h3>
                </div>
                <p className="text-xs text-gray-600 mb-2">
                  {getValidationSummary(schemaValidation)}
                </p>
                
                {/* Schema Errors */}
                {schemaValidation.errors.length > 0 && (
                  <div className="mb-3">
                    <h4 className="text-xs font-medium text-red-600 mb-1">Errors:</h4>
                    <ul className="space-y-1">
                      {schemaValidation.errors.slice(0, 5).map(renderValidationIssue)}
                      {schemaValidation.errors.length > 5 && (
                        <li className="text-xs text-gray-500">
                          +{schemaValidation.errors.length - 5} more errors
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                
                {/* Schema Warnings */}
                {schemaValidation.warnings.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-amber-600 mb-1">Warnings:</h4>
                    <ul className="space-y-1">
                      {schemaValidation.warnings.slice(0, 3).map(renderValidationIssue)}
                      {schemaValidation.warnings.length > 3 && (
                        <li className="text-xs text-gray-500">
                          +{schemaValidation.warnings.length - 3} more warnings
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="mdi:alert-circle" className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-semibold text-red-700">
                    Errors ({validationErrors.length})
                  </h3>
                </div>
                <ul className="space-y-2">
                  {validationErrors.map((error, i) => (
                    <li
                      key={i}
                      className="text-xs text-red-600 bg-red-50 p-2 rounded"
                    >
                      <span className="font-mono text-red-500">{error.path}</span>
                      <br />
                      {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Validation Warnings */}
            {validationWarnings.length > 0 && (
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="mdi:alert" className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-amber-700">
                    Warnings ({validationWarnings.length})
                  </h3>
                </div>
                <ul className="space-y-2">
                  {validationWarnings.map((warning, i) => (
                    <li
                      key={i}
                      className="text-xs text-amber-600 bg-amber-50 p-2 rounded"
                    >
                      <span className="font-mono text-amber-500">{warning.path}</span>
                      <br />
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Cost Estimate */}
            {metadata?.estimatedCost && (
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="mdi:currency-usd" className="w-4 h-4 text-green-600" />
                  <h3 className="text-sm font-semibold text-gray-700">
                    Estimated Cost
                  </h3>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  ${metadata.estimatedCost.monthly.toFixed(2)}
                  <span className="text-sm font-normal text-gray-500">/month</span>
                </p>
              </div>
            )}

            {/* Resources */}
            {metadata?.resources && metadata.resources.length > 0 && (
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="mdi:cube-outline" className="w-4 h-4 text-azure-blue" />
                  <h3 className="text-sm font-semibold text-gray-700">
                    Resources ({metadata.resources.length})
                  </h3>
                </div>
                <ul className="space-y-1">
                  {metadata.resources.map((resource, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-600 flex items-center gap-1"
                    >
                      <Icon icon="mdi:check" className="w-3 h-3 text-green-500" />
                      <span className="truncate">{resource.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-500">
              {foundryGenerated && foundryAgentName ? (
                <>
                  <Icon icon="mdi:robot" className="w-3 h-3 inline mr-1 text-azure-blue" />
                  Generated by <span className="font-medium text-azure-blue">{foundryAgentName}</span>
                </>
              ) : (
                <>Generated using Azure MCP</>
              )}
              {' • '}{format.toUpperCase()} format
            </p>
            {foundryGenerated && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                <Icon icon="mdi:check-circle" className="w-3 h-3" />
                AI Foundry
              </span>
            )}
            {compliance && (() => {
              const enforced = compliance.summary.checks_passed + compliance.summary.checks_failed;
              return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                  <Icon icon="mdi:shield-check" className="w-3 h-3" />
                  {enforced > 0
                    ? `Guardrails: ${compliance.summary.checks_passed}/${enforced} controls met`
                    : `Guardrails: ${compliance.summary.guardrails_total} guardrails`}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={async () => {
                setShowPreviewModal(true);
                setPreviewLogs([]);
                setLiveChanges([]);
                setWhatIfResult(null);
                await handlePreviewChanges();
              }}
              disabled={!foundryGenerated || modularFiles.length === 0 || isDeploying}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all',
                'border-2 border-blue-500 text-blue-600 bg-blue-50',
                'hover:bg-blue-100',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {isDeploying && deployStep === 'preview' ? (
                <>
                  <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Icon icon="mdi:eye-outline" className="w-4 h-4" />
                  Preview Changes
                </>
              )}
            </button>
            <button
              onClick={handleOpenDeployModal}
              disabled={!foundryGenerated || modularFiles.length === 0}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                'bg-brand-accent text-white hover:bg-brand-accentDark',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Icon icon="mdi:rocket-launch-outline" className="w-4 h-4" />
              Deploy to Azure
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreviewModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeploying) {
              setShowPreviewModal(false);
            }
          }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-[650px] max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-brand-accent to-brand-accentDark">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Icon icon="mdi:eye" className="w-5 h-5" />
                Preview Changes
              </h3>
              <button
                onClick={() => !isDeploying && setShowPreviewModal(false)}
                disabled={isDeploying}
                className={cn(
                  'p-1 rounded-lg transition-colors',
                  isDeploying ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/20'
                )}
                title={isDeploying ? 'Please wait for preview to complete' : 'Close'}
              >
                <Icon icon="mdi:close" className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto">
              {isDeploying && deployStep === 'preview' && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    {['Analyzing'].map((step, idx) => (
                      <div key={step} className="flex items-center">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold bg-blue-500 text-white animate-pulse">
                          {idx + 1}
                        </div>
                        <span className="ml-2 text-sm font-medium text-blue-600">{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-500 ease-out bg-gradient-to-r from-blue-400 to-blue-600"
                      style={{ width: `${deployProgress}%` }}
                    />
                  </div>
                  <p className="text-center text-sm text-gray-600 mt-3 flex items-center justify-center gap-2">
                    <Icon icon="mdi:loading" className="w-4 h-4 animate-spin text-blue-500" />
                    Analyzing what will change...
                  </p>
                </div>
              )}

              {previewLogs.length > 0 && (
                <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-500" />
                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                        <div className="w-3 h-3 rounded-full bg-green-500" />
                      </div>
                      <span className="text-xs text-gray-400 font-mono">Live Logs</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      <span className="text-xs text-green-400">Live</span>
                    </div>
                  </div>
                  <div
                    className="p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-1 scroll-smooth"
                    ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                  >
                    {previewLogs.map((log, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'flex items-start gap-2 animate-fadeIn',
                          log.step === 'error' ? 'text-red-400' :
                          log.step === 'complete' ? 'text-green-400' :
                          'text-gray-300'
                        )}
                      >
                        <span className="text-gray-500 select-none">
                          {new Date(log.timestamp).toLocaleTimeString('en-US', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                        <span className="flex-1">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {liveChanges.length > 0 && (
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:format-list-checks" className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">
                      Discovered Changes ({liveChanges.length})
                    </span>
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {liveChanges.slice(-5).map((change, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs bg-white/70 rounded px-2 py-1 animate-slideIn"
                      >
                        <span className="text-base">{change.icon}</span>
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
                          change.change_type === 'Create' && 'bg-green-100 text-green-700',
                          change.change_type === 'Modify' && 'bg-yellow-100 text-yellow-700',
                          change.change_type === 'Delete' && 'bg-red-100 text-red-700',
                          change.change_type === 'NoChange' && 'bg-gray-100 text-gray-700'
                        )}>
                          {change.change_type}
                        </span>
                        <span className="text-gray-700 truncate flex-1">
                          {change.resource_name}
                        </span>
                      </div>
                    ))}
                    {liveChanges.length > 5 && (
                      <p className="text-[10px] text-blue-600 text-center pt-1">
                        ... and {liveChanges.length - 5} more
                      </p>
                    )}
                  </div>
                </div>
              )}

              {azureAuthStatus && !isDeploying && (
                <div className={cn(
                  'p-4 rounded-xl flex items-start gap-3 border',
                  azureAuthStatus.authenticated
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                    : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
                )}>
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    azureAuthStatus.authenticated ? 'bg-green-100' : 'bg-red-100'
                  )}>
                    <Icon
                      icon={azureAuthStatus.authenticated ? 'mdi:check-circle' : 'mdi:alert-circle'}
                      className={cn('w-6 h-6', azureAuthStatus.authenticated ? 'text-green-600' : 'text-red-600')}
                    />
                  </div>
                  <div className="flex-1">
                    {azureAuthStatus.authenticated ? (
                      <>
                        <p className="text-sm font-semibold text-green-800">Azure CLI Authenticated</p>
                        <p className="text-xs text-green-700 mt-0.5">
                          <Icon icon="mdi:account" className="w-3 h-3 inline mr-1" />
                          {azureAuthStatus.user}
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">
                          <Icon icon="mdi:cloud" className="w-3 h-3 inline mr-1" />
                          {azureAuthStatus.subscription_name}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-red-800">Not Authenticated</p>
                        <p className="text-xs text-red-700 mt-1">
                          Run <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">az login</code> in your terminal
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {azureAuthStatus?.authenticated && !isDeploying && !deployResult && (
                <div className="space-y-3">
                  {renderSubscriptionSelect()}
                  <label className="block text-sm font-semibold text-gray-700">
                    <Icon icon="mdi:folder-outline" className="w-4 h-4 inline mr-1" />
                    Target Resource Group
                  </label>
                  {resourceGroups.length > 0 ? (
                    <select
                      value={resourceGroup}
                      onChange={(e) => setResourceGroup(e.target.value)}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-accent focus:border-brand-accent transition-all text-sm"
                    >
                      <option value="">Select a resource group...</option>
                      {resourceGroups.map(rg => (
                        <option key={rg.name} value={rg.name}>
                          {rg.name} ({rg.location})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={resourceGroup}
                      onChange={(e) => setResourceGroup(e.target.value)}
                      placeholder="Loading... or type resource group name"
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-accent focus:border-brand-accent transition-all text-sm"
                    />
                  )}
                </div>
              )}

              {modularFiles.length > 0 && !isDeploying && !deployResult && !whatIfResult && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    <Icon icon="mdi:file-multiple" className="w-4 h-4 inline mr-1" />
                    Files to Preview ({modularFiles.length})
                  </label>
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 max-h-32 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-1">
                      {modularFiles.map(file => (
                        <div key={file.path} className="flex items-center gap-2 text-xs text-slate-600 py-1 px-2 bg-white rounded-lg border border-slate-100">
                          <Icon icon={getFileIcon(file.path)} className="w-4 h-4 text-brand-accent" />
                          <span className="truncate">{file.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {whatIfResult && !deployResult && (
                <div className="space-y-4">
                  <div className={cn(
                    'flex items-center gap-3 p-4 rounded-xl border-2',
                    whatIfResult.success
                      ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'
                      : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
                  )}>
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      whatIfResult.success ? 'bg-emerald-100' : 'bg-red-100'
                    )}>
                      <Icon
                        icon={whatIfResult.success ? 'mdi:eye-check' : 'mdi:alert-circle'}
                        className={cn('w-6 h-6', whatIfResult.success ? 'text-emerald-600' : 'text-red-600')}
                      />
                    </div>
                    <div className="flex-1">
                      <h4 className={cn(
                        'font-bold',
                        whatIfResult.success ? 'text-emerald-800' : 'text-red-800'
                      )}>
                        {whatIfResult.success ? 'Deployment Preview' : 'Preview Failed'}
                      </h4>
                      <p className={cn(
                        'text-xs',
                        whatIfResult.success ? 'text-emerald-600' : 'text-red-600'
                      )}>
                        {whatIfResult.success
                          ? `Analyzed in ${whatIfResult.duration_seconds.toFixed(1)}s`
                          : (previewErrorInsights?.message || whatIfResult.error)
                        }
                      </p>
                    </div>
                    <span className={cn(
                      'text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border',
                      whatIfResult.success
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-red-100 text-red-700 border-red-200'
                    )}>
                      {whatIfResult.success ? 'Success' : 'Failed'}
                    </span>
                    <button
                      onClick={() => setWhatIfResult(null)}
                      className="p-1 hover:bg-white/50 rounded-lg transition-colors"
                      title="Clear preview"
                    >
                      <Icon icon="mdi:refresh" className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>

                  {!whatIfResult.success && previewErrorInsights?.type === 'resourceGroup' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <div className="flex items-start gap-2">
                        <Icon icon="mdi:folder-alert" className="w-4 h-4 mt-0.5" />
                        <div>
                          <div className="font-semibold">{previewErrorInsights.title}</div>
                          <div>{previewErrorInsights.action}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!whatIfResult.success && previewErrorInsights?.type !== 'resourceGroup' && (
                    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      <div className="flex items-center gap-2">
                        <Icon icon="mdi:alert" className="w-4 h-4" />
                        <span>Preview failed. You can attempt a safe auto-fix for common Bicep issues.</span>
                      </div>
                      <button
                        onClick={handleAttemptAutoFix}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100 transition-colors"
                      >
                        <Icon icon="mdi:hammer-wrench" className="w-4 h-4" />
                        Attempt Auto-Fix
                      </button>
                    </div>
                  )}

                  {showFixConfirm && pendingFixes.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-xs font-semibold text-amber-800 mb-2">Confirm fixes before applying:</div>
                      <ul className="text-xs text-amber-700 list-disc list-inside space-y-1">
                        {pendingFixes.map((fix, idx) => (
                          <li key={idx}>{fix}</li>
                        ))}
                      </ul>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowFixConfirm(false);
                            setPendingFixes([]);
                            setPendingFixedContent(null);
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={applyAutoFixes}
                          disabled={isApplyingFix}
                          className={cn(
                            'px-3 py-1 text-xs font-semibold rounded-md',
                            'bg-amber-600 text-white hover:bg-amber-700',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                          )}
                        >
                          {isApplyingFix ? 'Applying...' : 'Apply Fixes'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
              <div className="text-xs text-gray-500">
                {isDeploying && deployStep === 'preview' && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Icon icon="mdi:eye" className="w-4 h-4" />
                    Analyzing what will change...
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPreviewModal(false)}
                  disabled={isDeploying}
                  className={cn(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    isDeploying ? 'text-gray-400 bg-gray-100 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-200'
                  )}
                >
                  Close
                </button>
                {!whatIfResult?.success && (
                  <button
                    onClick={handlePreviewChanges}
                    disabled={isDeploying || !resourceGroup}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all',
                      'border-2 border-blue-500 text-blue-600 bg-blue-50',
                      'hover:bg-blue-100',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    <Icon icon={isDeploying ? 'mdi:loading' : 'mdi:refresh'} className={cn('w-4 h-4', isDeploying && 'animate-spin')} />
                    {isDeploying ? 'Analyzing...' : (whatIfResult ? 'Re-run Preview' : 'Preview Changes')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Modal */}
      {showDeployModal && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            // Only close if clicking the backdrop (not the modal content) and not deploying
            if (e.target === e.currentTarget && !isDeploying) {
              setShowDeployModal(false);
            }
          }}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl w-[650px] max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-brand-accent to-brand-accentDark">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Icon icon="mdi:rocket-launch" className="w-5 h-5" />
                Deploy to Azure
              </h3>
              <button
                onClick={() => !isDeploying && setShowDeployModal(false)}
                disabled={isDeploying}
                className={cn(
                  'p-1 rounded-lg transition-colors',
                  isDeploying ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/20'
                )}
                title={isDeploying ? 'Please wait for deployment to complete' : 'Close'}
              >
                <Icon icon="mdi:close" className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto">
              {/* Progress Stepper - Show during deployment */}
              {isDeploying && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-4">
                    {(deployStep === 'preview' 
                      ? ['Analyzing'] 
                      : ['Validating', 'Deploying', 'Complete']
                    ).map((step, idx) => {
                      const stepNum = idx + 1;
                      const isActive = 
                        (deployStep === 'preview' && stepNum === 1) ||
                        (deployStep === 'validating' && stepNum === 1) ||
                        (deployStep === 'deploying' && stepNum === 2) ||
                        (deployStep === 'completed' && stepNum === 3);
                      const isPast = 
                        (deployStep === 'deploying' && stepNum === 1) ||
                        (deployStep === 'completed' && stepNum <= 2);
                      return (
                        <div key={step} className="flex items-center">
                          <div className={cn(
                            'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300',
                            isPast ? 'bg-green-500 text-white' :
                            isActive ? (deployStep === 'preview' ? 'bg-blue-500' : 'bg-brand-accent') + ' text-white animate-pulse' :
                            'bg-gray-200 text-gray-500'
                          )}>
                            {isPast ? <Icon icon="mdi:check" className="w-5 h-5" /> : stepNum}
                          </div>
                          <span className={cn(
                            'ml-2 text-sm font-medium',
                            isActive ? (deployStep === 'preview' ? 'text-blue-600' : 'text-brand-accent') : 
                            isPast ? 'text-green-600' : 'text-gray-400'
                          )}>
                            {step}
                          </span>
                          {idx < (deployStep === 'preview' ? 0 : 2) && (
                            <div className={cn(
                              'w-12 h-0.5 mx-3',
                              isPast ? 'bg-green-500' : 'bg-gray-200'
                            )} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Progress Bar */}
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        'h-full transition-all duration-500 ease-out',
                        deployStep === 'preview' 
                          ? 'bg-gradient-to-r from-blue-400 to-blue-600' 
                          : 'bg-gradient-to-r from-brand-accent to-brand-primary'
                      )}
                      style={{ width: `${deployProgress}%` }}
                    />
                  </div>
                  <p className="text-center text-sm text-gray-600 mt-3 flex items-center justify-center gap-2">
                    <Icon icon="mdi:loading" className={cn(
                      'w-4 h-4 animate-spin',
                      deployStep === 'preview' ? 'text-blue-500' : 'text-brand-accent'
                    )} />
                    {deployStep === 'preview' && 'Analyzing what will change...'}
                    {deployStep === 'validating' && 'Validating Bicep templates...'}
                    {deployStep === 'deploying' && 'Deploying resources to Azure...'}
                  </p>
                  
                  {/* Live Logs Console - Show during preview */}
                  {deployStep === 'preview' && previewLogs.length > 0 && (
                    <div className="mt-4 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-red-500" />
                            <div className="w-3 h-3 rounded-full bg-yellow-500" />
                            <div className="w-3 h-3 rounded-full bg-green-500" />
                          </div>
                          <span className="text-xs text-gray-400 font-mono">Live Logs</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                          </span>
                          <span className="text-xs text-green-400">Live</span>
                        </div>
                      </div>
                      <div 
                        className="p-3 max-h-32 overflow-y-auto font-mono text-xs space-y-1 scroll-smooth"
                        ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                      >
                        {previewLogs.map((log, idx) => (
                          <div 
                            key={idx} 
                            className={cn(
                              'flex items-start gap-2 animate-fadeIn',
                              log.step === 'error' ? 'text-red-400' : 
                              log.step === 'complete' ? 'text-green-400' : 
                              'text-gray-300'
                            )}
                          >
                            <span className="text-gray-500 select-none">
                              {new Date(log.timestamp).toLocaleTimeString('en-US', { 
                                hour12: false, 
                                hour: '2-digit', 
                                minute: '2-digit', 
                                second: '2-digit' 
                              })}
                            </span>
                            <span className="flex-1">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Live Changes Preview - Show during preview */}
                  {deployStep === 'preview' && liveChanges.length > 0 && (
                    <div className="mt-3 bg-blue-50 rounded-lg border border-blue-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon icon="mdi:format-list-checks" className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">
                          Discovered Changes ({liveChanges.length})
                        </span>
                      </div>
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {liveChanges.slice(-5).map((change, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center gap-2 text-xs bg-white/70 rounded px-2 py-1 animate-slideIn"
                          >
                            <span className="text-base">{change.icon}</span>
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
                              change.change_type === 'Create' && 'bg-green-100 text-green-700',
                              change.change_type === 'Modify' && 'bg-yellow-100 text-yellow-700',
                              change.change_type === 'Delete' && 'bg-red-100 text-red-700',
                              change.change_type === 'NoChange' && 'bg-gray-100 text-gray-700'
                            )}>
                              {change.change_type}
                            </span>
                            <span className="text-gray-700 truncate flex-1">
                              {change.resource_name}
                            </span>
                          </div>
                        ))}
                        {liveChanges.length > 5 && (
                          <p className="text-[10px] text-blue-600 text-center pt-1">
                            ... and {liveChanges.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Auth Status */}
              {azureAuthStatus && !isDeploying && (
                <div className={cn(
                  'p-4 rounded-xl flex items-start gap-3 border',
                  azureAuthStatus.authenticated 
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200' 
                    : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
                )}>
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    azureAuthStatus.authenticated ? 'bg-green-100' : 'bg-red-100'
                  )}>
                    <Icon 
                      icon={azureAuthStatus.authenticated ? 'mdi:check-circle' : 'mdi:alert-circle'} 
                      className={cn('w-6 h-6', azureAuthStatus.authenticated ? 'text-green-600' : 'text-red-600')}
                    />
                  </div>
                  <div className="flex-1">
                    {azureAuthStatus.authenticated ? (
                      <>
                        <p className="text-sm font-semibold text-green-800">Azure CLI Authenticated</p>
                        <p className="text-xs text-green-700 mt-0.5">
                          <Icon icon="mdi:account" className="w-3 h-3 inline mr-1" />
                          {azureAuthStatus.user}
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">
                          <Icon icon="mdi:cloud" className="w-3 h-3 inline mr-1" />
                          {azureAuthStatus.subscription_name}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-red-800">Not Authenticated</p>
                        <p className="text-xs text-red-700 mt-1">
                          Run <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">az login</code> in your terminal
                        </p>
                        <button
                          onClick={handleBrowserLogin}
                          className="mt-3 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
                        >
                          <Icon icon="mdi:web" className="w-4 h-4" />
                          Or login via browser (Coming Soon)
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Resource Group Selection */}
              {azureAuthStatus?.authenticated && !isDeploying && !deployResult && (
                <div className="space-y-3">
                  {renderSubscriptionSelect()}
                  <label className="block text-sm font-semibold text-gray-700">
                    <Icon icon="mdi:folder-outline" className="w-4 h-4 inline mr-1" />
                    Target Resource Group
                  </label>
                  {resourceGroups.length > 0 ? (
                    <select
                      value={resourceGroup}
                      onChange={(e) => setResourceGroup(e.target.value)}
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-accent focus:border-brand-accent transition-all text-sm"
                    >
                      <option value="">Select a resource group...</option>
                      {resourceGroups.map(rg => (
                        <option key={rg.name} value={rg.name}>
                          {rg.name} ({rg.location})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={resourceGroup}
                      onChange={(e) => setResourceGroup(e.target.value)}
                      placeholder="Loading... or type resource group name"
                      className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-accent focus:border-brand-accent transition-all text-sm"
                    />
                  )}
                </div>
              )}

              {/* Files to Deploy */}
              {modularFiles.length > 0 && !isDeploying && !deployResult && !whatIfResult && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    <Icon icon="mdi:file-multiple" className="w-4 h-4 inline mr-1" />
                    Files to Deploy ({modularFiles.length})
                  </label>
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 max-h-32 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-1">
                      {modularFiles.map(file => (
                        <div key={file.path} className="flex items-center gap-2 text-xs text-slate-600 py-1 px-2 bg-white rounded-lg border border-slate-100">
                          <Icon icon={getFileIcon(file.path)} className="w-4 h-4 text-brand-accent" />
                          <span className="truncate">{file.path}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* What-If Preview Results - Timeline Style */}
              {whatIfResult && !deployResult && (
                <div className="space-y-4">
                  {/* Preview Header */}
                  <div className={cn(
                    'flex items-center gap-3 p-4 rounded-xl border-2',
                    whatIfResult.success 
                      ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200'
                      : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
                  )}>
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      whatIfResult.success ? 'bg-emerald-100' : 'bg-red-100'
                    )}>
                      <Icon 
                        icon={whatIfResult.success ? 'mdi:eye-check' : 'mdi:alert-circle'} 
                        className={cn('w-6 h-6', whatIfResult.success ? 'text-emerald-600' : 'text-red-600')}
                      />
                    </div>
                    <div className="flex-1">
                      <h4 className={cn(
                        'font-bold',
                        whatIfResult.success ? 'text-emerald-800' : 'text-red-800'
                      )}>
                        {whatIfResult.success ? 'Deployment Preview' : 'Preview Failed'}
                      </h4>
                      <p className={cn(
                        'text-xs',
                        whatIfResult.success ? 'text-emerald-600' : 'text-red-600'
                      )}>
                        {whatIfResult.success 
                          ? `Analyzed in ${whatIfResult.duration_seconds.toFixed(1)}s`
                          : whatIfResult.error
                        }
                      </p>
                    </div>
                    <span className={cn(
                      'text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full border',
                      whatIfResult.success
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-red-100 text-red-700 border-red-200'
                    )}>
                      {whatIfResult.success ? 'Success' : 'Failed'}
                    </span>
                    <button
                      onClick={() => setWhatIfResult(null)}
                      className="p-1 hover:bg-white/50 rounded-lg transition-colors"
                      title="Clear preview"
                    >
                      <Icon icon="mdi:refresh" className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>

                  {!whatIfResult.success && (
                    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      <div className="flex items-center gap-2">
                        <Icon icon="mdi:alert" className="w-4 h-4" />
                        <span>Preview failed. You can attempt a safe auto-fix for common Bicep issues.</span>
                      </div>
                      <button
                        onClick={handleAttemptAutoFix}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100 transition-colors"
                      >
                        <Icon icon="mdi:hammer-wrench" className="w-4 h-4" />
                        Attempt Auto-Fix
                      </button>
                    </div>
                  )}

                  {showFixConfirm && pendingFixes.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-xs font-semibold text-amber-800 mb-2">Confirm fixes before applying:</div>
                      <ul className="text-xs text-amber-700 list-disc list-inside space-y-1">
                        {pendingFixes.map((fix, idx) => (
                          <li key={idx}>{fix}</li>
                        ))}
                      </ul>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowFixConfirm(false);
                            setPendingFixes([]);
                            setPendingFixedContent(null);
                          }}
                          className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={applyAutoFixes}
                          disabled={isApplyingFix}
                          className={cn(
                            'px-3 py-1 text-xs font-semibold rounded-md',
                            'bg-amber-600 text-white hover:bg-amber-700',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                          )}
                        >
                          {isApplyingFix ? 'Applying...' : 'Apply Fixes'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Summary Badges */}
                  {whatIfResult.success && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {whatIfResult.summary.Create > 0 && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                            <Icon icon="mdi:plus-circle" className="w-4 h-4" />
                            {whatIfResult.summary.Create} to Create
                          </span>
                        )}
                        {whatIfResult.summary.Modify > 0 && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                            <Icon icon="mdi:pencil-circle" className="w-4 h-4" />
                            {whatIfResult.summary.Modify} to Modify
                          </span>
                        )}
                        {whatIfResult.summary.Delete > 0 && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                            <Icon icon="mdi:minus-circle" className="w-4 h-4" />
                            {whatIfResult.summary.Delete} to Delete
                          </span>
                        )}
                        {whatIfResult.summary.NoChange > 0 && (
                          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                            <Icon icon="mdi:check-circle-outline" className="w-4 h-4" />
                            {whatIfResult.summary.NoChange} No Change
                          </span>
                        )}
                      </div>
                      {/* Ignored resources toggle */}
                      {whatIfResult.summary.Ignore > 0 && (
                        <button
                          onClick={() => setShowIgnoredResources(!showIgnoredResources)}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                        >
                          <Icon icon={showIgnoredResources ? "mdi:eye" : "mdi:eye-off"} className="w-3.5 h-3.5" />
                          {showIgnoredResources ? 'Hide' : 'Show'} {whatIfResult.summary.Ignore} existing resource{whatIfResult.summary.Ignore > 1 ? 's' : ''} (not in template)
                        </button>
                      )}
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <h5 className="text-sm font-semibold text-emerald-800 mb-2">Preview Report</h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-emerald-800">
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:clock-outline" className="w-4 h-4" />
                            <span>Duration: {whatIfResult.duration_seconds.toFixed(1)}s</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:folder-outline" className="w-4 h-4" />
                            <span>Resource Group: {resourceGroup || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:file-multiple" className="w-4 h-4" />
                            <span>Files Analyzed: {modularFiles.length}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:cloud" className="w-4 h-4" />
                            <span>Subscription: {azureAuthStatus?.subscription_name || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:account" className="w-4 h-4" />
                            <span>Run by: {azureAuthStatus?.user || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Icon icon="mdi:check-decagram" className="w-4 h-4" />
                            <span>Status: Ready to Deploy</span>
                          </div>
                        </div>
                        <div className="mt-3 text-[11px] text-emerald-700">
                          Next steps: Review changes above, then proceed to Deploy when ready.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Timeline of Changes */}
                  {whatIfResult.success && whatIfResult.changes.length > 0 && (
                    <div className="relative">
                      <h5 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                        <Icon icon="mdi:timeline" className="w-4 h-4" />
                        Changes Timeline
                        <span className="text-xs font-normal text-gray-500">
                          (showing {whatIfResult.changes.filter(c => 
                            showIgnoredResources || (c.change_type !== 'Ignore' && c.change_type !== 'NoChange')
                          ).length} of {whatIfResult.changes.length})
                        </span>
                      </h5>
                      <div className="space-y-0.5 max-h-[180px] overflow-y-auto pr-2">
                        {/* Sort: Create, Delete, Modify first, then NoChange, then Ignore */}
                        {whatIfResult.changes
                          .filter(change => showIgnoredResources || (change.change_type !== 'Ignore' && change.change_type !== 'NoChange'))
                          .sort((a, b) => {
                            const order = { Create: 0, Delete: 1, Modify: 2, NoChange: 3, Ignore: 4 };
                            return (order[a.change_type] ?? 5) - (order[b.change_type] ?? 5);
                          })
                          .map((change, idx) => (
                          <div 
                            key={idx} 
                            className={cn(
                              'flex items-center gap-3 p-2.5 rounded-lg border transition-all',
                              change.change_type === 'Create' && 'bg-green-50 border-green-200 hover:bg-green-100',
                              change.change_type === 'Modify' && 'bg-amber-50 border-amber-200 hover:bg-amber-100',
                              change.change_type === 'Delete' && 'bg-red-50 border-red-200 hover:bg-red-100',
                              change.change_type === 'NoChange' && 'bg-gray-50 border-gray-200 hover:bg-gray-100',
                              change.change_type === 'Ignore' && 'bg-slate-50 border-slate-200'
                            )}
                          >
                            {/* Change Type Icon */}
                            <div className={cn(
                              'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                              change.change_type === 'Create' && 'bg-green-200',
                              change.change_type === 'Modify' && 'bg-amber-200',
                              change.change_type === 'Delete' && 'bg-red-200',
                              change.change_type === 'NoChange' && 'bg-gray-200',
                              change.change_type === 'Ignore' && 'bg-slate-200'
                            )}>
                              <Icon 
                                icon={
                                  change.change_type === 'Create' ? 'mdi:plus' :
                                  change.change_type === 'Modify' ? 'mdi:pencil' :
                                  change.change_type === 'Delete' ? 'mdi:minus' :
                                  change.change_type === 'NoChange' ? 'mdi:check' : 'mdi:eye-off'
                                }
                                className={cn(
                                  'w-4 h-4',
                                  change.change_type === 'Create' && 'text-green-700',
                                  change.change_type === 'Modify' && 'text-amber-700',
                                  change.change_type === 'Delete' && 'text-red-700',
                                  change.change_type === 'NoChange' && 'text-gray-600',
                                  change.change_type === 'Ignore' && 'text-slate-500'
                                )}
                              />
                            </div>

                            {/* Resource Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {change.resource_name}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {change.resource_type}
                              </p>
                            </div>

                            {/* Change Badge */}
                            <span className={cn(
                              'text-[10px] font-bold uppercase px-2 py-0.5 rounded',
                              change.change_type === 'Create' && 'bg-green-600 text-white',
                              change.change_type === 'Modify' && 'bg-amber-600 text-white',
                              change.change_type === 'Delete' && 'bg-red-600 text-white',
                              change.change_type === 'NoChange' && 'bg-gray-400 text-white',
                              change.change_type === 'Ignore' && 'bg-slate-400 text-white'
                            )}>
                              {change.change_type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No Changes Message */}
                  {whatIfResult.success && whatIfResult.changes.length === 0 && (
                    <div className="text-center py-6 bg-gray-50 rounded-xl border border-gray-200">
                      <Icon icon="mdi:check-all" className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-600">No changes detected</p>
                      <p className="text-xs text-gray-500">Your infrastructure is already up to date</p>
                    </div>
                  )}
                </div>
              )}

              {/* Deploy Result - Success */}
              {deployResult && deployResult.success && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border-2 border-green-200 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                      <Icon icon="mdi:check-circle" className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-green-800">Deployment succeeded</h4>
                      <p className="text-sm text-green-600">
                        Completed in {deployResult.duration_seconds.toFixed(1)} seconds
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="bg-white rounded-lg p-3 border border-green-100">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Deployment Name</p>
                      <p className="text-sm font-mono text-gray-800">{deployResult.deployment_name}</p>
                    </div>
                    
                    {deployResult.resources.length > 0 && (
                      <div className="bg-white rounded-lg p-3 border border-green-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Resources Created ({deployResult.resources.length})</p>
                        <div className="space-y-1">
                          {deployResult.resources.map((r, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 rounded px-2 py-1">
                              <Icon icon="mdi:check" className="w-4 h-4 text-green-600" />
                              <span className="truncate font-mono text-xs">{r.id.split('/').pop()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {Object.keys(deployResult.outputs).length > 0 && (
                      <div className="bg-white rounded-lg p-3 border border-green-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Outputs</p>
                        <pre className="bg-slate-900 text-green-400 rounded-lg p-3 text-xs overflow-x-auto font-mono">
                          {JSON.stringify(deployResult.outputs, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Deploy Result - Failed */}
              {deployResult && !deployResult.success && (
                <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl border-2 border-red-200 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                      <Icon icon="mdi:alert-circle" className="w-8 h-8 text-red-600" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-red-800">Deployment Failed</h4>
                      <p className="text-sm text-red-600">Please check the error details below</p>
                    </div>
                  </div>
                  
                  {deployResult.error && (
                    <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                      <pre className="text-red-400 text-xs font-mono whitespace-pre-wrap">
                        {deployResult.error}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Warnings */}
              {deployResult?.warnings && deployResult.warnings.length > 0 && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:alert" className="w-5 h-5 text-amber-600" />
                    <p className="text-sm font-semibold text-amber-800">Warnings ({deployResult.warnings.length})</p>
                  </div>
                  <ul className="text-xs text-amber-700 space-y-1">
                    {deployResult.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Icon icon="mdi:chevron-right" className="w-4 h-4 mt-0.5" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
              <div className="text-xs text-gray-500">
                {isDeploying && deployStep === 'preview' && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Icon icon="mdi:eye" className="w-4 h-4" />
                    Analyzing what will change...
                  </span>
                )}
                {isDeploying && deployStep !== 'preview' && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <Icon icon="mdi:lock" className="w-4 h-4" />
                    Please don't close this window during deployment
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeployModal(false)}
                  disabled={isDeploying && deployStep !== 'preview'}
                  className={cn(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    isDeploying && deployStep !== 'preview'
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed' 
                      : 'text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {deployResult?.success ? 'Done' : 'Cancel'}
                </button>
                
                {/* Deploy Button */}
                {azureAuthStatus?.authenticated && !deployResult?.success && (
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying || !resourceGroup}
                    className={cn(
                      'flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg transition-all',
                      'bg-gradient-to-r from-brand-accent to-brand-accentDark text-white',
                      'hover:shadow-lg hover:scale-[1.02]',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none'
                    )}
                  >
                    {isDeploying && deployStep !== 'preview' ? (
                      <>
                        <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
                        Deploying...
                      </>
                    ) : (
                      <>
                        <Icon icon="mdi:rocket-launch" className="w-4 h-4" />
                        Deploy Now
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IaCPreviewModal;

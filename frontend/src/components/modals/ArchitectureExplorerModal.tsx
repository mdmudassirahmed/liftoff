// Architecture Explorer Modal - Interactive LLD View
// Clean, spacious design with interactive user flow

import { useState } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';

interface ArchitectureExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'flow' | 'agents' | 'stack' | 'licenses' | 'diagram';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'flow', label: 'User Flow', icon: 'mdi:transit-connection-variant' },
  { id: 'agents', label: 'AI Agents', icon: 'mdi:robot' },
  { id: 'stack', label: 'Tech Stack', icon: 'mdi:layers-triple' },
  { id: 'diagram', label: 'Architecture Diagram', icon: 'mdi:sitemap-outline' },
  { id: 'licenses', label: 'Licenses', icon: 'mdi:license' },
];

// Display-only labels for the explorer. The real endpoint lives in backend/.env.
const AI_MODEL = 'gpt-4.1';
const FOUNDRY_ENDPOINT = 'your Azure AI Foundry project';

// User Flow Steps for IaC Generation
const IAC_FLOW_STEPS = [
  {
    id: 1,
    title: 'Design Architecture',
    description: 'User drags Azure services onto canvas or describes architecture in natural language',
    icon: 'mdi:drag-variant',
    color: 'bg-blue-500',
    details: [
      'Drag services from palette',
      'Connect with dependencies',
      'Or use "Create from Prompt"',
    ],
    duration: 'User action',
  },
  {
    id: 2,
    title: 'Submit for Generation',
    description: 'User clicks "Generate IaC" button, selecting Bicep, Terraform, or ARM format',
    icon: 'mdi:send',
    color: 'bg-purple-500',
    details: [
      'Choose output format',
      'Diagram JSON serialized',
      'Request sent to backend',
    ],
    duration: '~100ms',
  },
  {
    id: 3,
    title: 'Backend Processing',
    description: 'FastAPI receives request, matches security guardrails to the architecture, and builds the full prompt',
    icon: 'mdi:server',
    color: 'bg-indigo-500',
    details: [
      'Validate diagram structure',
      'Match security guardrails by resource type',
      'Initialize SSE stream',
    ],
    duration: '~200ms',
  },
  {
    id: 4,
    title: 'Security Guardrails Injected',
    description: 'Security constraints from the guardrail catalog are prepended to the generation prompt',
    icon: 'mdi:shield-lock',
    color: 'bg-yellow-600',
    details: [
      '100+ controls mapped to MCSB',
      'Constraints injected per service',
      'Optional landing-zone networking mode',
    ],
    duration: '~50ms',
  },
  {
    id: 5,
    title: 'IaC Generator Agent',
    description: `${AI_MODEL} generates Bicep, Terraform, or ARM with 19 syntax rules + guardrail constraints`,
    icon: 'mdi:code-braces',
    color: 'bg-brand-accent',
    details: [
      'MCP Microsoft Learn lookups',
      'Modular folder structure',
      'Guardrail-compliant output',
    ],
    duration: '~3-8s',
  },
  {
    id: 6,
    title: 'Bicep Compile + Auto-Fix',
    description: 'az bicep build compiles the output; errors are sent back to the agent for correction (up to 2 retries)',
    icon: 'mdi:autorenew',
    color: 'bg-green-600',
    details: [
      'az bicep build compile check',
      'Error lines extracted + fed back',
      '_fix_bicep_syntax() post-proc',
    ],
    duration: '~1-3s',
  },
  {
    id: 7,
    title: 'Stream Response',
    description: 'Backend streams generated code to frontend via SSE',
    icon: 'mdi:broadcast',
    color: 'bg-orange-500',
    details: [
      'Real-time streaming',
      'Token-by-token display',
      'Progress indication',
    ],
    duration: 'Continuous',
  },
  {
    id: 8,
    title: 'Display Result',
    description: 'Frontend renders code with syntax highlighting, ready for deployment',
    icon: 'mdi:check-circle',
    color: 'bg-brand-primary',
    details: [
      'Syntax highlighting',
      'Copy to clipboard',
      'Deploy to Azure option',
    ],
    duration: 'Complete',
  },
];

// Active agents used in current implementation
const ACTIVE_AGENTS = [
  {
    name: 'IaC Generator',
    agentId: 'iac-generator-agent:1',
    model: AI_MODEL,
    icon: 'mdi:code-braces',
    color: 'text-brand-accent',
    bg: 'bg-brand-accent/10',
    description: 'Generate production-ready Bicep, Terraform, and ARM templates from architecture diagrams',
    tools: ['Code Interpreter', 'MCP Microsoft Learn'],
    capabilities: ['bicep_generation', 'terraform_generation', 'arm_template_generation', 'diagram_to_code'],
    isActive: true,
  },
  {
    name: 'Azure Docs',
    agentId: 'azure-docs-agent:2',
    model: AI_MODEL,
    icon: 'mdi:book-open-page-variant',
    color: 'text-azure-blue',
    bg: 'bg-azure-blue/10',
    description: 'Search Microsoft Learn documentation via MCP for best practices and Azure service info',
    tools: ['MCP Microsoft Learn'],
    capabilities: ['documentation_search', 'azure_service_info', 'best_practices_lookup', 'code_samples'],
    isActive: true,
  },
];

// Available agents (configured but not actively used in main flows)
const AVAILABLE_AGENTS = [
  {
    name: 'Orchestrator',
    agentId: 'orchestrator-agent:2',
    model: AI_MODEL,
    icon: 'mdi:account-group',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
    description: 'Central coordinator for multi-agent workflows',
    tools: [],
    capabilities: ['workflow_coordination', 'multi_agent_routing', 'task_decomposition'],
    isActive: false,
  },
  {
    name: 'Security Advisor',
    agentId: 'security-advisor-agent:2',
    model: AI_MODEL,
    icon: 'mdi:shield-check',
    color: 'text-gray-400',
    bg: 'bg-gray-50',
    description: 'Security analysis, compliance checking (Bing grounding not configured)',
    tools: [],
    capabilities: ['vulnerability_analysis', 'compliance_checking', 'risk_assessment'],
    isActive: false,
    note: 'Bing Grounding not configured',
  },
  {
    name: 'Validation',
    agentId: 'validation-agent:1',
    model: AI_MODEL,
    icon: 'mdi:check-circle',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
    description: 'IaC validation, syntax checking, and deployment readiness',
    tools: ['Code Interpreter'],
    capabilities: ['syntax_validation', 'schema_validation', 'naming_validation'],
    isActive: false,
  },
];

// Tech Stack - actual versions from package.json and requirements.txt
const TECH_STACK = {
  frontend: [
    { name: 'React', version: '19.2.0', icon: 'mdi:react' },
    { name: 'TypeScript', version: '5.9.3', icon: 'mdi:language-typescript' },
    { name: 'Vite', version: '7.2.4', icon: 'mdi:lightning-bolt' },
    { name: 'Tailwind CSS', version: '4.1.18', icon: 'mdi:palette' },
    { name: '@xyflow/react', version: '12.10.0', icon: 'mdi:vector-polyline' },
    { name: 'Zustand', version: '5.0.11', icon: 'mdi:database' },
    { name: 'React Router', version: '7.13.0', icon: 'mdi:routes' },
    { name: 'Lucide React', version: '0.563.0', icon: 'mdi:shape' },
  ],
  backend: [
    { name: 'FastAPI', version: '0.109+', icon: 'mdi:api' },
    { name: 'Python', version: '3.11+', icon: 'mdi:language-python' },
    { name: 'Azure AI Projects', version: '1.0.0b11', icon: 'mdi:microsoft-azure' },
    { name: 'Azure Identity', version: '1.15+', icon: 'mdi:shield-key' },
    { name: 'SSE Starlette', version: '1.8+', icon: 'mdi:broadcast' },
    { name: 'Pydantic', version: '2.5+', icon: 'mdi:check-decagram' },
    { name: 'HTTPX', version: '0.26+', icon: 'mdi:web' },
    { name: 'Uvicorn', version: '0.27+', icon: 'mdi:server' },
  ],
  azure: [
    { name: 'Azure AI Foundry', version: 'Preview', icon: 'mdi:microsoft-azure' },
    { name: 'MCP Microsoft Learn', version: '1.0', icon: 'mdi:book-open-variant' },
    { name: 'Code Interpreter', version: 'Built-in', icon: 'mdi:code-braces' },
    { name: AI_MODEL, version: 'OpenAI', icon: 'mdi:robot' },
  ],
};

const LICENSES = [
  { name: 'react', license: 'MIT', author: 'Meta' },
  { name: 'typescript', license: 'Apache-2.0', author: 'Microsoft' },
  { name: 'vite', license: 'MIT', author: 'Evan You' },
  { name: 'tailwindcss', license: 'MIT', author: 'Tailwind Labs' },
  { name: '@xyflow/react', license: 'MIT', author: 'xyflow' },
  { name: 'zustand', license: 'MIT', author: 'Poimandres' },
  { name: 'fastapi', license: 'MIT', author: 'Sebastián Ramírez' },
  { name: 'azure-ai-projects', license: 'MIT', author: 'Microsoft' },
  { name: 'pydantic', license: 'MIT', author: 'Samuel Colvin' },
  { name: 'sse-starlette', license: 'BSD-3', author: 'sysid' },
];

export function ArchitectureExplorerModal({ isOpen, onClose }: ArchitectureExplorerModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('flow');
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const startAnimation = () => {
    setIsAnimating(true);
    setActiveStep(1);
    
    let step = 1;
    const interval = setInterval(() => {
      step++;
      if (step > IAC_FLOW_STEPS.length) {
        setIsAnimating(false);
        setActiveStep(null);
        clearInterval(interval);
      } else {
        setActiveStep(step);
      }
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-5xl max-h-[85vh] m-4 bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-primary to-brand-accent rounded-xl flex items-center justify-center">
              <Icon icon="mdi:sitemap" className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Architecture Explorer</h2>
              <p className="text-xs text-gray-500">Interactive system design visualization</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Icon icon="mdi:close" className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-gray-100 bg-gray-50/50">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-white text-brand-primary shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-white/50"
              )}
            >
              <Icon icon={tab.icon} className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
          {/* User Flow Tab */}
          {activeTab === 'flow' && (
            <div className="space-y-6">
              {/* Header with Play Button */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">IaC Generation Flow</h3>
                  <p className="text-sm text-gray-500">What happens when you generate infrastructure code</p>
                </div>
                <button
                  onClick={startAnimation}
                  disabled={isAnimating}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all",
                    isAnimating
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "bg-brand-primary text-white hover:bg-brand-primary/90 shadow-sm"
                  )}
                >
                  <Icon icon={isAnimating ? "mdi:loading" : "mdi:play"} className={cn("w-4 h-4", isAnimating && "animate-spin")} />
                  {isAnimating ? 'Animating...' : 'Play Flow'}
                </button>
              </div>

              {/* Flow Visualization */}
              <div className="relative">
                {/* Connection Line */}
                <div className="absolute left-8 top-12 bottom-12 w-0.5 bg-gradient-to-b from-blue-200 via-purple-200 to-green-200" />

                {/* Steps */}
                <div className="space-y-4">
                  {IAC_FLOW_STEPS.map((step, index) => (
                    <div
                      key={step.id}
                      className={cn(
                        "relative flex gap-4 p-4 rounded-xl transition-all duration-500",
                        activeStep === step.id
                          ? "bg-white shadow-lg border-2 border-brand-primary scale-[1.02]"
                          : activeStep && activeStep > step.id
                          ? "bg-white/80 border border-gray-200 opacity-60"
                          : "bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm"
                      )}
                      onMouseEnter={() => !isAnimating && setActiveStep(step.id)}
                      onMouseLeave={() => !isAnimating && setActiveStep(null)}
                    >
                      {/* Step Number */}
                      <div className={cn(
                        "relative z-10 w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 transition-all",
                        step.color,
                        activeStep === step.id ? "scale-110 shadow-lg" : ""
                      )}>
                        <Icon icon={step.icon} className="w-7 h-7 text-white" />
                        {activeStep === step.id && (
                          <div className="absolute inset-0 rounded-xl animate-ping opacity-30 bg-current" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-xs font-bold text-gray-400">STEP {step.id}</span>
                          <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {step.duration}
                          </span>
                        </div>
                        <h4 className="font-semibold text-gray-900 mb-1">{step.title}</h4>
                        <p className="text-sm text-gray-500 mb-2">{step.description}</p>
                        
                        {/* Details (shown on hover/active) */}
                        <div className={cn(
                          "flex flex-wrap gap-2 transition-all duration-300",
                          activeStep === step.id ? "opacity-100 max-h-20" : "opacity-0 max-h-0 overflow-hidden"
                        )}>
                          {step.details.map((detail, i) => (
                            <span key={i} className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-md">
                              {detail}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Arrow for next step */}
                      {index < IAC_FLOW_STEPS.length - 1 && (
                        <div className={cn(
                          "absolute -bottom-4 left-8 z-20 transition-all",
                          activeStep === step.id ? "scale-125" : ""
                        )}>
                          <Icon icon="mdi:chevron-down" className="w-5 h-5 text-gray-300" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Agents Tab */}
          {activeTab === 'agents' && (
            <div className="space-y-6">
              {/* Header with Foundry Info */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Azure AI Foundry Agents</h3>
                  <p className="text-sm text-gray-500">Powered by {AI_MODEL} • {FOUNDRY_ENDPOINT}</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary/10 rounded-lg">
                  <Icon icon="mdi:check-circle" className="w-4 h-4 text-brand-primary" />
                  <span className="text-xs font-medium text-brand-primary">{ACTIVE_AGENTS.length} Active</span>
                </div>
              </div>

              {/* Active Agents */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Active Agents (Used in Current Flow)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ACTIVE_AGENTS.map((agent) => (
                    <div
                      key={agent.name}
                      className="group p-5 rounded-xl bg-white border-2 border-brand-primary/30 hover:border-brand-primary hover:shadow-md transition-all"
                    >
                      <div className="flex items-start gap-4">
                        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center relative", agent.bg)}>
                          <Icon icon={agent.icon} className={cn("w-6 h-6", agent.color)} />
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-brand-primary rounded-full border-2 border-white" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-gray-900">{agent.name}</h4>
                            <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 px-2 py-0.5 rounded-full">
                              Active
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mb-1">{agent.model} • {agent.agentId}</p>
                          <p className="text-sm text-gray-600 mb-3">{agent.description}</p>
                          {agent.tools.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {agent.tools.map((tool) => (
                                <span key={tool} className="text-[10px] font-medium text-azure-blue bg-azure-blue/10 px-2 py-0.5 rounded-full">
                                  {tool}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {agent.capabilities.slice(0, 3).map((cap) => (
                              <span key={cap} className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                {cap.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Available Agents */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Available Agents (Configured but Not Active)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {AVAILABLE_AGENTS.map((agent) => (
                    <div
                      key={agent.name}
                      className="group p-4 rounded-xl bg-gray-50 border border-gray-200 opacity-70 hover:opacity-100 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", agent.bg)}>
                          <Icon icon={agent.icon} className={cn("w-5 h-5", agent.color)} />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-700 text-sm">{agent.name}</h4>
                          <p className="text-xs text-gray-400">{agent.model}</p>
                          {'note' in agent && agent.note && (
                            <p className="text-[10px] text-orange-500 mt-1">{agent.note}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Communication Diagram */}
              <div className="p-6 rounded-xl bg-white border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">Current Agent Flow</h4>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-xl bg-purple-100 flex items-center justify-center mb-2">
                      <Icon icon="mdi:server" className="w-7 h-7 text-purple-600" />
                    </div>
                    <span className="text-xs font-medium text-gray-600">FastAPI</span>
                    <span className="block text-[10px] text-gray-400">Backend</span>
                  </div>
                  <Icon icon="mdi:arrow-right" className="w-5 h-5 text-gray-300" />
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-xl bg-brand-accent/10 flex items-center justify-center mb-2 border-2 border-brand-accent">
                      <Icon icon="mdi:code-braces" className="w-7 h-7 text-brand-accent" />
                    </div>
                    <span className="text-xs font-medium text-gray-600">IaC Generator</span>
                    <span className="block text-[10px] text-brand-primary">Active</span>
                  </div>
                  <Icon icon="mdi:plus" className="w-4 h-4 text-gray-300" />
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-xl bg-azure-blue/10 flex items-center justify-center mb-2 border-2 border-azure-blue">
                      <Icon icon="mdi:book-open-page-variant" className="w-7 h-7 text-azure-blue" />
                    </div>
                    <span className="text-xs font-medium text-gray-600">Azure Docs</span>
                    <span className="block text-[10px] text-brand-primary">Active</span>
                  </div>
                  <Icon icon="mdi:arrow-right" className="w-5 h-5 text-gray-300" />
                  <div className="text-center">
                    <div className="w-14 h-14 mx-auto rounded-xl bg-azure-blue/10 flex items-center justify-center mb-2">
                      <Icon icon="mdi:book-open-variant" className="w-7 h-7 text-azure-blue" />
                    </div>
                    <span className="text-xs font-medium text-gray-600">MCP Learn</span>
                    <span className="block text-[10px] text-gray-400">Tool</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tech Stack Tab */}
          {activeTab === 'stack' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Technology Stack</h3>
                <p className="text-sm text-gray-500">Production-ready technologies with actual versions from config</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Frontend */}
                <div className="p-5 rounded-xl bg-white border border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Icon icon="mdi:monitor-dashboard" className="w-4 h-4 text-blue-600" />
                    </div>
                    <h4 className="font-semibold text-gray-900">Frontend</h4>
                  </div>
                  <div className="space-y-2">
                    {TECH_STACK.frontend.map((tech) => (
                      <div key={tech.name} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-blue-50 transition-colors">
                        <div className="flex items-center gap-2">
                          <Icon icon={tech.icon} className="w-4 h-4 text-blue-500" />
                          <span className="text-sm text-gray-700">{tech.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border">{tech.version}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Backend */}
                <div className="p-5 rounded-xl bg-white border border-gray-200">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                      <Icon icon="mdi:server" className="w-4 h-4 text-purple-600" />
                    </div>
                    <h4 className="font-semibold text-gray-900">Backend</h4>
                  </div>
                  <div className="space-y-2">
                    {TECH_STACK.backend.map((tech) => (
                      <div key={tech.name} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-purple-50 transition-colors">
                        <div className="flex items-center gap-2">
                          <Icon icon={tech.icon} className="w-4 h-4 text-purple-500" />
                          <span className="text-sm text-gray-700">{tech.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border">{tech.version}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Azure AI */}
                <div className="p-5 rounded-xl bg-white border border-gray-200 border-azure-blue/30">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-azure-blue/10 flex items-center justify-center">
                      <Icon icon="mdi:microsoft-azure" className="w-4 h-4 text-azure-blue" />
                    </div>
                    <h4 className="font-semibold text-gray-900">Azure AI</h4>
                  </div>
                  <div className="space-y-2">
                    {TECH_STACK.azure.map((tech) => (
                      <div key={tech.name} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-azure-blue/5 transition-colors">
                        <div className="flex items-center gap-2">
                          <Icon icon={tech.icon} className="w-4 h-4 text-azure-blue" />
                          <span className="text-sm text-gray-700">{tech.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border">{tech.version}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Architecture Diagram */}
              <div className="p-6 rounded-xl bg-gradient-to-r from-gray-50 to-white border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">System Architecture</h4>
                <div className="flex items-center justify-between">
                  <div className="flex-1 flex items-center justify-center gap-4">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto rounded-xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center mb-2">
                        <Icon icon="mdi:react" className="w-8 h-8 text-blue-500" />
                      </div>
                      <span className="text-xs font-medium text-gray-600">React SPA</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-0.5 bg-gradient-to-r from-blue-300 to-purple-300" />
                      <span className="text-[10px] text-gray-400 mt-1">REST + SSE</span>
                    </div>
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto rounded-xl bg-purple-50 border-2 border-purple-200 flex items-center justify-center mb-2">
                        <Icon icon="mdi:api" className="w-8 h-8 text-purple-500" />
                      </div>
                      <span className="text-xs font-medium text-gray-600">FastAPI</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-0.5 bg-gradient-to-r from-purple-300 to-teal-300" />
                      <span className="text-[10px] text-gray-400 mt-1">Azure SDK</span>
                    </div>
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto rounded-xl bg-brand-accent/10 border-2 border-brand-accent/30 flex items-center justify-center mb-2">
                        <Icon icon="mdi:microsoft-azure" className="w-8 h-8 text-brand-accent" />
                      </div>
                      <span className="text-xs font-medium text-gray-600">AI Foundry</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Architecture Diagram Tab */}
          {activeTab === 'diagram' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Technical Architecture Diagram</h3>
                <p className="text-sm text-gray-500">Enterprise system design following C4 container-view conventions</p>
              </div>

              {/* SVG Diagram */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 590" className="w-full" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                  <defs>
                    <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                      <polygon points="0 0,8 3,0 6" fill="#9CA3AF" />
                    </marker>
                  </defs>

                  {/* Background */}
                  <rect width="860" height="590" fill="#F9FAFB" rx="10" />

                  {/* Title */}
                  <text x="430" y="26" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">Liftoff — Technical Architecture</text>
                  <text x="430" y="42" textAnchor="middle" fontSize="9.5" fill="#6B7280">AI-Powered Azure Infrastructure-as-Code Platform</text>

                  {/* ── LAYER 1: BROWSER ── */}
                  <rect x="10" y="52" width="840" height="108" rx="7" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5" />
                  <text x="22" y="66" fontSize="8.5" fontWeight="700" fill="#1D4ED8" letterSpacing="1">BROWSER — React 19 · TypeScript 5.9 · Vite 7 · @xyflow/react 12</text>

                  {/* Canvas Designer */}
                  <rect x="18" y="72" width="162" height="78" rx="6" fill="white" stroke="#BFDBFE" strokeWidth="1" />
                  <rect x="18" y="72" width="162" height="19" rx="6" fill="#2563EB" />
                  <rect x="18" y="84" width="162" height="7" fill="#2563EB" />
                  <text x="99" y="84" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Canvas Designer</text>
                  <text x="26" y="101" fontSize="7.5" fill="#374151">• React Flow drag-drop canvas</text>
                  <text x="26" y="112" fontSize="7.5" fill="#374151">• Create from Prompt (NL→diagram)</text>
                  <text x="26" y="123" fontSize="7.5" fill="#374151">• Import Diagram / Service palette</text>
                  <text x="26" y="143" fontSize="7" fill="#9CA3AF">React Flow / xyflow</text>

                  {/* IaC Preview */}
                  <rect x="190" y="72" width="162" height="78" rx="6" fill="white" stroke="#BBF7D0" strokeWidth="1" />
                  <rect x="190" y="72" width="162" height="19" rx="6" fill="#059669" />
                  <rect x="190" y="84" width="162" height="7" fill="#059669" />
                  <text x="271" y="84" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">IaC Preview + Guardrails Panel</text>
                  <text x="198" y="101" fontSize="7.5" fill="#374151">• Bicep / Terraform / ARM tabs</text>
                  <text x="198" y="112" fontSize="7.5" fill="#374151">• Guardrail compliance panel</text>
                  <text x="198" y="123" fontSize="7.5" fill="#374151">• Schema validation (ARM spec)</text>
                  <text x="198" y="143" fontSize="7" fill="#9CA3AF">IaCPreviewModal.tsx</text>

                  {/* Arch Advisor */}
                  <rect x="362" y="72" width="162" height="78" rx="6" fill="white" stroke="#DDD6FE" strokeWidth="1" />
                  <rect x="362" y="72" width="162" height="19" rx="6" fill="#7C3AED" />
                  <rect x="362" y="84" width="162" height="7" fill="#7C3AED" />
                  <text x="443" y="84" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Architecture Advisor Chat</text>
                  <text x="370" y="101" fontSize="7.5" fill="#374151">• AI chat with diagram context</text>
                  <text x="370" y="112" fontSize="7.5" fill="#374151">• Full conversation threading</text>
                  <text x="370" y="123" fontSize="7.5" fill="#374151">• SSE streaming responses</text>
                  <text x="370" y="143" fontSize="7" fill="#9CA3AF">Azure Docs Agent</text>

                  {/* Deploy */}
                  <rect x="534" y="72" width="162" height="78" rx="6" fill="white" stroke="#FED7AA" strokeWidth="1" />
                  <rect x="534" y="72" width="162" height="19" rx="6" fill="#EA580C" />
                  <rect x="534" y="84" width="162" height="7" fill="#EA580C" />
                  <text x="615" y="84" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Deploy to Azure</text>
                  <text x="542" y="101" fontSize="7.5" fill="#374151">• Live subscription dropdown</text>
                  <text x="542" y="112" fontSize="7.5" fill="#374151">• Dynamic RG list (az account)</text>
                  <text x="542" y="123" fontSize="7.5" fill="#374151">• What-If + real-time deploy log</text>
                  <text x="542" y="143" fontSize="7" fill="#9CA3AF">7 resources · 86s · Succeeded</text>

                  {/* Home */}
                  <rect x="706" y="72" width="142" height="78" rx="6" fill="white" stroke="#E5E7EB" strokeWidth="1" />
                  <rect x="706" y="72" width="142" height="19" rx="6" fill="#374151" />
                  <rect x="706" y="84" width="142" height="7" fill="#374151" />
                  <text x="777" y="84" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Home + Explorer</text>
                  <text x="714" y="101" fontSize="7.5" fill="#374151">• Agent Fabric panel</text>
                  <text x="714" y="112" fontSize="7.5" fill="#374151">• Architecture Explorer modal</text>
                  <text x="714" y="123" fontSize="7.5" fill="#374151">• Tech Stack / Flow / Diagram</text>
                  <text x="714" y="143" fontSize="7" fill="#9CA3AF">This tab ↑</text>

                  {/* Browser → Backend arrows */}
                  <line x1="220" y1="160" x2="220" y2="184" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <line x1="450" y1="160" x2="450" y2="184" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <line x1="650" y1="160" x2="650" y2="184" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <text x="220" y="176" textAnchor="middle" fontSize="7" fill="#6B7280">REST/SSE</text>
                  <text x="450" y="176" textAnchor="middle" fontSize="7" fill="#6B7280">REST/SSE</text>
                  <text x="650" y="176" textAnchor="middle" fontSize="7" fill="#6B7280">REST</text>

                  {/* ── LAYER 2: FASTAPI BACKEND ── */}
                  <rect x="10" y="188" width="840" height="138" rx="7" fill="#F0FDF4" stroke="#86EFAC" strokeWidth="1.5" />
                  <text x="22" y="203" fontSize="8.5" fontWeight="700" fill="#15803D" letterSpacing="1">FASTAPI BACKEND — Python 3.11 · Uvicorn · Port 8000</text>

                  {/* Endpoints */}
                  <rect x="18" y="209" width="165" height="107" rx="6" fill="white" stroke="#D1FAE5" strokeWidth="1" />
                  <text x="100" y="224" textAnchor="middle" fontSize="8" fontWeight="600" fill="#374151">API Endpoints</text>
                  <text x="26" y="238" fontSize="7.5" fill="#6B7280">POST /iac/generate (modular)</text>
                  <text x="26" y="249" fontSize="7.5" fill="#6B7280">POST /chat/advisor (SSE)</text>
                  <text x="26" y="260" fontSize="7.5" fill="#6B7280">GET  /deploy/subscriptions</text>
                  <text x="26" y="271" fontSize="7.5" fill="#6B7280">GET  /deploy/resource-groups</text>
                  <text x="26" y="282" fontSize="7.5" fill="#6B7280">POST /deploy/what-if</text>
                  <text x="26" y="293" fontSize="7.5" fill="#6B7280">POST /deploy</text>
                  <text x="26" y="305" fontSize="7.5" fill="#6B7280">GET  /health · /agents</text>

                  {/* Security Guardrails */}
                  <rect x="193" y="209" width="188" height="107" rx="6" fill="white" stroke="#FEF08A" strokeWidth="1.5" />
                  <rect x="193" y="209" width="188" height="19" rx="6" fill="#CA8A04" />
                  <rect x="193" y="221" width="188" height="7" fill="#CA8A04" />
                  <text x="287" y="221" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Guardrails Engine</text>
                  <text x="201" y="238" fontSize="7.5" fill="#374151">• 190 Azure guardrails (JSON)</text>
                  <text x="201" y="249" fontSize="7.5" fill="#374151">• match_guardrails(architecture)</text>
                  <text x="201" y="260" fontSize="7.5" fill="#374151">• Constraints injected into prompt</text>
                  <text x="201" y="271" fontSize="7.5" fill="#374151">• Landing-zone networking mode</text>
                  <text x="201" y="282" fontSize="7.5" fill="#374151">• evaluate_compliance() → report</text>
                  <text x="201" y="293" fontSize="7.5" fill="#374151">• ComplianceReport → frontend</text>
                  <text x="201" y="305" fontSize="7.5" fill="#374151">• GUARDRAILS_ENABLED flag</text>

                  {/* IaC Generation Logic */}
                  <rect x="391" y="209" width="188" height="107" rx="6" fill="white" stroke="#D1FAE5" strokeWidth="1" />
                  <rect x="391" y="209" width="188" height="19" rx="6" fill="#009A44" />
                  <rect x="391" y="221" width="188" height="7" fill="#009A44" />
                  <text x="485" y="221" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">IaC Generation Logic</text>
                  <text x="399" y="238" fontSize="7.5" fill="#374151">• generate_iac_modular() builder</text>
                  <text x="399" y="249" fontSize="7.5" fill="#374151">• _fix_bicep_syntax() post-proc</text>
                  <text x="399" y="260" fontSize="7.5" fill="#6B7280">  19 syntax rules applied</text>
                  <text x="399" y="271" fontSize="7.5" fill="#374151">• _validate_bicep_files() loop</text>
                  <text x="399" y="282" fontSize="7.5" fill="#6B7280">  az bicep build → error extract</text>
                  <text x="399" y="293" fontSize="7.5" fill="#6B7280">  auto-fix retry × 2</text>
                  <text x="399" y="305" fontSize="7.5" fill="#374151">• Modular: main.bicep + modules/</text>

                  {/* Deployment Engine */}
                  <rect x="589" y="209" width="259" height="107" rx="6" fill="white" stroke="#FECACA" strokeWidth="1" />
                  <rect x="589" y="209" width="259" height="19" rx="6" fill="#DC2626" />
                  <rect x="589" y="221" width="259" height="7" fill="#DC2626" />
                  <text x="718" y="221" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Deployment Engine</text>
                  <text x="597" y="238" fontSize="7.5" fill="#374151">• Pre-compile: az bicep build (blocks bad templates)</text>
                  <text x="597" y="249" fontSize="7.5" fill="#374151">• az deployment group create / what-if</text>
                  <text x="597" y="260" fontSize="7.5" fill="#374151">• SSE streaming: real-time deploy logs to browser</text>
                  <text x="597" y="271" fontSize="7.5" fill="#374151">• _safe_join() path-traversal guard</text>
                  <text x="597" y="282" fontSize="7.5" fill="#374151">• shell=False (injection-safe az invocation)</text>
                  <text x="597" y="293" fontSize="7.5" fill="#374151">• Temp dir auto-cleanup (shutil.rmtree)</text>

                  {/* Backend → Foundry arrow */}
                  <line x1="430" y1="326" x2="430" y2="350" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <text x="430" y="342" textAnchor="middle" fontSize="7" fill="#6B7280">Azure AI Projects SDK</text>

                  {/* ── LAYER 3: AI FOUNDRY ── */}
                  <rect x="10" y="354" width="840" height="118" rx="7" fill="#F5F3FF" stroke="#C4B5FD" strokeWidth="1.5" />
                  <text x="22" y="369" fontSize="8.5" fontWeight="700" fill="#6D28D9" letterSpacing="1">AZURE AI FOUNDRY — YOUR PROJECT · {AI_MODEL}</text>

                  {/* IaC Generator Agent - Active */}
                  <rect x="18" y="375" width="228" height="87" rx="6" fill="white" stroke="#009A44" strokeWidth="2" />
                  <rect x="18" y="375" width="228" height="19" rx="6" fill="#009A44" />
                  <rect x="18" y="387" width="228" height="7" fill="#009A44" />
                  <circle cx="235" cy="380" r="5" fill="#22C55E" stroke="white" strokeWidth="1.5" />
                  <text x="125" y="388" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">IaC Generator Agent ●</text>
                  <text x="26" y="404" fontSize="7.5" fill="#374151">Model: gpt-4.1 (Code Interpreter + MCP Learn)</text>
                  <text x="26" y="415" fontSize="7.5" fill="#374151">19 Bicep syntax rules injected via prompt</text>
                  <text x="26" y="426" fontSize="7.5" fill="#374151">Guardrail constraints pre-injected</text>
                  <text x="26" y="437" fontSize="7.5" fill="#374151">Receives error feedback for auto-correction</text>
                  <text x="26" y="450" fontSize="7.5" fill="#22C55E">Status: Active — primary IaC engine</text>
                  <text x="26" y="458" fontSize="7.5" fill="#374151">Outputs: Bicep · Terraform · ARM JSON</text>

                  {/* Azure Docs Agent - Active */}
                  <rect x="256" y="375" width="228" height="87" rx="6" fill="white" stroke="#0078D4" strokeWidth="2" />
                  <rect x="256" y="375" width="228" height="19" rx="6" fill="#0078D4" />
                  <rect x="256" y="387" width="228" height="7" fill="#0078D4" />
                  <circle cx="473" cy="380" r="5" fill="#22C55E" stroke="white" strokeWidth="1.5" />
                  <text x="363" y="388" textAnchor="middle" fontSize="8" fontWeight="600" fill="white">Azure Docs Agent ●</text>
                  <text x="264" y="404" fontSize="7.5" fill="#374151">Model: gpt-4.1 (MCP Microsoft Learn)</text>
                  <text x="264" y="415" fontSize="7.5" fill="#374151">Powers Architecture Advisor chat</text>
                  <text x="264" y="426" fontSize="7.5" fill="#374151">Diagram-aware context passed per message</text>
                  <text x="264" y="437" fontSize="7.5" fill="#374151">Full conversation threading</text>
                  <text x="264" y="450" fontSize="7.5" fill="#22C55E">Status: Active — advisor chat engine</text>
                  <text x="264" y="458" fontSize="7.5" fill="#374151">Real-time Azure best-practice lookups</text>

                  {/* Available agents */}
                  <rect x="494" y="375" width="116" height="87" rx="6" fill="#F9FAFB" stroke="#D1D5DB" strokeWidth="1" strokeDasharray="4,3" />
                  <text x="552" y="395" textAnchor="middle" fontSize="8" fontWeight="500" fill="#9CA3AF">Orchestrator</text>
                  <text x="552" y="408" textAnchor="middle" fontSize="7" fill="#D1D5DB">Multi-agent routing</text>
                  <text x="552" y="419" textAnchor="middle" fontSize="7" fill="#D1D5DB">Task decomposition</text>
                  <text x="552" y="445" textAnchor="middle" fontSize="7" fill="#D1D5DB">● Available</text>

                  <rect x="620" y="375" width="116" height="87" rx="6" fill="#F9FAFB" stroke="#D1D5DB" strokeWidth="1" strokeDasharray="4,3" />
                  <text x="678" y="395" textAnchor="middle" fontSize="8" fontWeight="500" fill="#9CA3AF">Security Advisor</text>
                  <text x="678" y="408" textAnchor="middle" fontSize="7" fill="#D1D5DB">Vulnerability scan</text>
                  <text x="678" y="419" textAnchor="middle" fontSize="7" fill="#D1D5DB">Risk assessment</text>
                  <text x="678" y="445" textAnchor="middle" fontSize="7" fill="#D1D5DB">● Available</text>

                  <rect x="746" y="375" width="102" height="87" rx="6" fill="#F9FAFB" stroke="#D1D5DB" strokeWidth="1" strokeDasharray="4,3" />
                  <text x="797" y="395" textAnchor="middle" fontSize="8" fontWeight="500" fill="#9CA3AF">Validation</text>
                  <text x="797" y="408" textAnchor="middle" fontSize="7" fill="#D1D5DB">IaC syntax check</text>
                  <text x="797" y="419" textAnchor="middle" fontSize="7" fill="#D1D5DB">Code Interpreter</text>
                  <text x="797" y="445" textAnchor="middle" fontSize="7" fill="#D1D5DB">● Available</text>

                  {/* Foundry → Azure arrows */}
                  <line x1="200" y1="472" x2="200" y2="496" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <line x1="450" y1="472" x2="450" y2="496" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <line x1="680" y1="472" x2="680" y2="496" stroke="#9CA3AF" strokeWidth="1" strokeDasharray="3,2" markerEnd="url(#arr)" />
                  <text x="200" y="487" textAnchor="middle" fontSize="7" fill="#6B7280">MCP</text>
                  <text x="450" y="487" textAnchor="middle" fontSize="7" fill="#6B7280">az CLI</text>
                  <text x="680" y="487" textAnchor="middle" fontSize="7" fill="#6B7280">Azure SDK</text>

                  {/* ── LAYER 4: AZURE PLATFORM ── */}
                  <rect x="10" y="500" width="840" height="78" rx="7" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5" />
                  <text x="22" y="515" fontSize="8.5" fontWeight="700" fill="#1E40AF" letterSpacing="1">AZURE PLATFORM</text>

                  <rect x="18" y="520" width="186" height="48" rx="6" fill="white" stroke="#BFDBFE" strokeWidth="1" />
                  <text x="111" y="536" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1E40AF">MCP Microsoft Learn</text>
                  <text x="111" y="548" textAnchor="middle" fontSize="7.5" fill="#6B7280">Live Azure documentation</text>
                  <text x="111" y="560" textAnchor="middle" fontSize="7.5" fill="#6B7280">Best practices at gen time</text>

                  <rect x="214" y="520" width="186" height="48" rx="6" fill="white" stroke="#BFDBFE" strokeWidth="1" />
                  <text x="307" y="536" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1E40AF">Azure Bicep CLI v0.40</text>
                  <text x="307" y="548" textAnchor="middle" fontSize="7.5" fill="#6B7280">az bicep build (compile)</text>
                  <text x="307" y="560" textAnchor="middle" fontSize="7.5" fill="#6B7280">Error extract → auto-fix loop</text>

                  <rect x="410" y="520" width="186" height="48" rx="6" fill="white" stroke="#BFDBFE" strokeWidth="1" />
                  <text x="503" y="536" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1E40AF">Azure Resource Manager</text>
                  <text x="503" y="548" textAnchor="middle" fontSize="7.5" fill="#6B7280">az deployment group create</text>
                  <text x="503" y="560" textAnchor="middle" fontSize="7.5" fill="#6B7280">7 resources · 86s · Succeeded</text>

                  <rect x="606" y="520" width="186" height="48" rx="6" fill="white" stroke="#BFDBFE" strokeWidth="1" />
                  <text x="699" y="536" textAnchor="middle" fontSize="8" fontWeight="600" fill="#1E40AF">Subscriptions + RGs</text>
                  <text x="699" y="548" textAnchor="middle" fontSize="7.5" fill="#6B7280">az account list (live auth)</text>
                  <text x="699" y="560" textAnchor="middle" fontSize="7.5" fill="#6B7280">Dynamic resource group list</text>

                  {/* Roadmap box */}
                  <rect x="802" y="520" width="46" height="48" rx="6" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="1.5" strokeDasharray="4,2" />
                  <text x="825" y="536" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#92400E">Road-</text>
                  <text x="825" y="546" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#92400E">map</text>
                  <text x="825" y="556" textAnchor="middle" fontSize="6" fill="#D97706">ADO/</text>
                  <text x="825" y="564" textAnchor="middle" fontSize="6" fill="#D97706">GH</text>

                  {/* Legend */}
                  <rect x="10" y="582" width="840" height="8" rx="3" fill="#F3F4F6" />
                  <circle cx="28" cy="586" r="3.5" fill="#22C55E" />
                  <text x="37" y="589" fontSize="7" fill="#6B7280">Active agent</text>
                  <circle cx="110" cy="586" r="3.5" fill="#D1D5DB" />
                  <text x="119" y="589" fontSize="7" fill="#6B7280">Available (not wired)</text>
                  <rect x="215" y="583" width="10" height="6" rx="1" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="1" />
                  <text x="230" y="589" fontSize="7" fill="#6B7280">Planned feature</text>
                  <text x="430" y="589" textAnchor="middle" fontSize="7" fill="#9CA3AF">Liftoff · open source · MIT License</text>
                </svg>
              </div>

              {/* Roadmap callout */}
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <Icon icon="mdi:lightbulb-on-outline" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Roadmap: IaC Repository Integration (ADO / GitHub)</p>
                  <p className="text-sm text-amber-700 mt-1">Generated Bicep and Terraform templates can be automatically pushed to Azure DevOps or GitHub repositories, enabling PR-based review workflows, versioned IaC history, and CI/CD pipeline triggers. The agent generates the code; the repo becomes the system of record.</p>
                </div>
              </div>

              {/* DAD note */}
              <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <Icon icon="mdi:image-filter-center-focus" className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">In Pipeline: Diagram Import from DAD (POC)</p>
                  <p className="text-sm text-blue-700 mt-1">A proof-of-concept for importing diagrams from DAD (Digital Architecture Diagrams) is in progress. The core challenge: DAD contains artistic/presentation diagrams, not the realistic component-level architecture diagrams that Liftoff needs to generate accurate IaC. Liftoff's purpose is generating infrastructure code from realistic diagrams, not decorative ones.</p>
                </div>
              </div>
            </div>
          )}

          {/* Licenses Tab */}
          {activeTab === 'licenses' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Open Source Licenses</h3>
                  <p className="text-sm text-gray-500">All dependencies use permissive licenses</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                  <Icon icon="mdi:shield-check" className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-medium text-green-700">Compliant</span>
                </div>
              </div>

              {/* License Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-green-50 border border-green-100 text-center">
                  <div className="text-2xl font-bold text-green-600">8</div>
                  <div className="text-xs text-green-600">MIT License</div>
                </div>
                <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-center">
                  <div className="text-2xl font-bold text-blue-600">1</div>
                  <div className="text-xs text-blue-600">Apache 2.0</div>
                </div>
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-100 text-center">
                  <div className="text-2xl font-bold text-purple-600">1</div>
                  <div className="text-xs text-purple-600">BSD-3-Clause</div>
                </div>
              </div>

              {/* License Table */}
              <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Package</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">License</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Author</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {LICENSES.map((lib) => (
                      <tr key={lib.name} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900">{lib.name}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            lib.license === 'MIT' ? 'text-green-700 bg-green-50' :
                            lib.license === 'Apache-2.0' ? 'text-blue-700 bg-blue-50' :
                            'text-purple-700 bg-purple-50'
                          )}>
                            {lib.license}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-500">{lib.author}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ArchitectureExplorerModal;

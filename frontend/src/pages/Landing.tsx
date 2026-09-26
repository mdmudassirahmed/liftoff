// Index Page - Landing/Home Page

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { ArchitectureAdvisorChat } from '@/components/Chat';
import { ArchitectureExplorerModal } from '@/components/modals/ArchitectureExplorerModal';
import { useCspStore } from '@/store/cspStore';

export function IndexPage() {
  const [showAdvisorChat, setShowAdvisorChat] = useState(false);
  const [showArchExplorer, setShowArchExplorer] = useState(false);
  const activeCsp = useCspStore((s) => s.activeCsp);
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-md border-b border-gray-200 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center">
                <img
                  src="/logo.svg"
                  alt="Liftoff"
                  className="w-9 h-9"
                />
              </div>
              <div>
                <span className="font-bold text-xl text-gray-900">Liftoff</span>
                <p className="text-xs text-gray-500">Design Generate Deploy</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowArchExplorer(true)}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors"
                title="View System Architecture"
              >
                <Icon icon="mdi:sitemap" className="w-4 h-4" />
                Architecture
              </button>
              <button
                onClick={() => setShowAdvisorChat(true)}
                className="flex items-center gap-2 px-4 py-2 text-brand-primary border border-brand-primary rounded-lg font-medium hover:bg-brand-primary/5 transition-colors"
              >
                <Icon icon="mdi:robot-happy" className="w-4 h-4" />
                Ask Advisor
              </button>
              <Link
                to="/workspace"
                className="flex items-center gap-2 px-4 py-2 bg-brand-primary text-white rounded-lg font-medium hover:bg-brand-primaryDark transition-colors"
              >
                <Icon icon="mdi:rocket-launch-outline" className="w-4 h-4" />
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 px-4 bg-gradient-to-br from-white via-gray-50 to-brand-primary/5">
        <div className="max-w-4xl mx-auto h-full flex flex-col items-center justify-center text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary/10 rounded-full text-brand-primary text-sm font-medium mb-6 border border-brand-primary/20">
            <Icon icon="mdi:sparkles" className="w-4 h-4" />
            Enterprise Cloud Architecture Workspace
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
            Design, Generate, and Deploy
            <br />
            <span className="text-brand-primary">Cloud Architecture</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Model Azure solutions visually, generate production-ready Bicep, Terraform, or ARM,
            and deploy with confidence - all from a single workspace.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              to="/workspace"
              className="flex items-center gap-2 px-6 py-3 bg-brand-primary text-white rounded-lg font-medium hover:bg-brand-primaryDark transition-colors shadow-lg shadow-brand-primary/25"
            >
              <Icon icon="mdi:plus" className="w-5 h-5" />
              Start Designing
            </Link>
            <Link
              to="/workspace"
              className="flex items-center gap-2 px-6 py-3 bg-white text-gray-700 rounded-lg font-medium hover:bg-gray-100 transition-colors border border-gray-300"
            >
              <Icon icon="mdi:play-circle-outline" className="w-5 h-5" />
              View Demo
            </Link>
          </div>
          <div className="mt-10 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="p-4 rounded-xl bg-white/80 border border-gray-200 hover:border-brand-primary/50 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-brand-primary/10 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <Icon icon="mdi:drag-variant" className="w-5 h-5 text-brand-primary" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Design</h3>
              <p className="text-sm text-gray-600">
                Visual drag-and-drop architecture modeling.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white/80 border border-gray-200 hover:border-brand-accent/50 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-brand-accent/10 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <Icon icon="mdi:code-braces" className="w-5 h-5 text-brand-accent" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Generate</h3>
              <p className="text-sm text-gray-600">
                IaC output with Bicep, Terraform, or ARM.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white/80 border border-gray-200 hover:border-brand-blue/50 hover:shadow-md transition-all">
              <div className="w-10 h-10 bg-brand-blue/10 rounded-lg flex items-center justify-center mb-3 mx-auto">
                <Icon icon="mdi:rocket-launch" className="w-5 h-5 text-brand-blue" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Deploy</h3>
              <p className="text-sm text-gray-600">
                One-click Azure deployment with live status.
              </p>
            </div>
          </div>
          <div className="mt-8 w-full max-w-5xl">
            <div className="rounded-2xl border border-brand-primary/30 bg-gradient-to-br from-white via-white to-brand-primary/5 p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div className="text-left">
                  <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand-primary mb-2">
                    <Icon icon="mdi:robot" className="w-4 h-4" />
                    Live Agent Fabric
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">AI Agents in Use</h3>
                  <p className="text-sm text-gray-600">
                    Six specialised agents run on the model you configure: OpenAI, Azure OpenAI, a local model, or Azure AI Foundry.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 text-xs font-medium text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-3 py-1 rounded-full">
                  <Icon icon="mdi:cloud-check" className="w-4 h-4" />
                  Bring your own model
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-left">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:account-group" className="w-4 h-4 text-gray-700" />
                    <span className="text-sm font-semibold text-gray-900">Orchestrator</span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-gray-500">Agent</span>
                  </div>
                  <p className="text-xs text-gray-600">Coordinates all agents and routes tasks.</p>
                  <div className="mt-2 text-[11px] text-gray-500">Tools: None</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:code-braces" className="w-4 h-4 text-brand-accent" />
                    <span className="text-sm font-semibold text-gray-900">IaC Generator</span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-brand-accent">Agent</span>
                  </div>
                  <p className="text-xs text-gray-600">Turns diagrams into Bicep/ARM/Terraform.</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[10px] font-medium text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-2 py-0.5 rounded-full">Code Interpreter</span>
                    <span className="text-[10px] font-medium text-azure-blue bg-azure-blue/10 border border-azure-blue/20 px-2 py-0.5 rounded-full">MCP Microsoft Learn</span>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:book-open-page-variant" className="w-4 h-4 text-azure-blue" />
                    <span className="text-sm font-semibold text-gray-900">Azure Docs</span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-azure-blue">Agent</span>
                  </div>
                  <p className="text-xs text-gray-600">Finds best practices from Microsoft Learn.</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[10px] font-medium text-azure-blue bg-azure-blue/10 border border-azure-blue/20 px-2 py-0.5 rounded-full">MCP Microsoft Learn</span>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:shield-check" className="w-4 h-4 text-brand-blue" />
                    <span className="text-sm font-semibold text-gray-900">Security Advisor</span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-brand-blue">Agent</span>
                  </div>
                  <p className="text-xs text-gray-600">Assesses risk and compliance posture.</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[10px] font-medium text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">Optional Web Grounding</span>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:check-circle" className="w-4 h-4 text-brand-primary" />
                    <span className="text-sm font-semibold text-gray-900">Validation</span>
                    <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-brand-primary">Agent</span>
                  </div>
                  <p className="text-xs text-gray-600">Validates IaC syntax and readiness.</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 rounded-full">Code Interpreter</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 w-full max-w-4xl">
            <div className="rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Tech Stack</h3>
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Single-Page App</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Frontend</div>
                  <div className="text-xs text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis">
                    React 19 • TypeScript • Vite • Tailwind CSS • React Flow
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Backend</div>
                  <div className="text-xs text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis">
                    FastAPI • Your choice of AI model • Azure CLI
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="sticky bottom-0 py-6 px-4 bg-gray-900 text-gray-400">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-white">
            Developed by{' '}
            <span className="text-brand-primaryLight">Mudassir Ahmed Mohammad</span>
          </div>
          <p className="text-sm">
            Open source under the MIT License
          </p>
        </div>
      </footer>
      
      {/* Floating Chat Button */}
      {!showAdvisorChat && (
        <button
          onClick={() => setShowAdvisorChat(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-brand-primary text-white rounded-full shadow-lg hover:bg-brand-primaryDark hover:scale-105 transition-all flex items-center justify-center z-40"
          title="Ask Architecture Advisor"
        >
          <Icon icon="mdi:robot-happy" className="w-7 h-7" />
        </button>
      )}
      
      {/* Architecture Advisor Chat Overlay */}
      {showAdvisorChat && (
        <ArchitectureAdvisorChat
          isOverlay={true}
          onClose={() => setShowAdvisorChat(false)}
          csp={activeCsp}
        />
      )}

      {/* Architecture Explorer Modal */}
      <ArchitectureExplorerModal
        isOpen={showArchExplorer}
        onClose={() => setShowArchExplorer(false)}
      />
    </div>
  );
}

export default IndexPage;

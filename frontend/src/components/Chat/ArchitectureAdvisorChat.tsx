/**
 * Architecture Advisor Chat Component
 * 
 * A chat interface for getting enterprise-grade architecture recommendations
 * based on Microsoft's best practices via the Azure Docs Agent (with MCP).
 */
import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[] | null;
  agentName?: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface ArchitectureAdvisorChatProps {
  /** Optional diagram context for architecture-aware responses */
  diagramContext?: { nodes: unknown[]; edges: unknown[] };
  /** Optional class name for styling */
  className?: string;
  /** Title for the chat panel */
  title?: string;
  /** Whether the chat is in a modal/overlay mode */
  isOverlay?: boolean;
  /** Callback when close is clicked (only in overlay mode) */
  onClose?: () => void;
}

// Suggested prompts for users
const SUGGESTED_PROMPTS = [
  {
    icon: 'mdi:shield-check',
    text: 'What are the security best practices for my architecture?',
    category: 'Security',
  },
  {
    icon: 'mdi:scale-balance',
    text: 'How can I improve high availability and disaster recovery?',
    category: 'Reliability',
  },
  {
    icon: 'mdi:currency-usd',
    text: 'What cost optimization strategies should I consider?',
    category: 'Cost',
  },
  {
    icon: 'mdi:rocket-launch',
    text: 'How can I improve performance and scalability?',
    category: 'Performance',
  },
];

export const ArchitectureAdvisorChat: React.FC<ArchitectureAdvisorChatProps> = ({
  diagramContext,
  className,
  title = 'Architecture Advisor',
  isOverlay = false,
  onClose,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Check agent status on mount
  useEffect(() => {
    checkAgentStatus();
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const checkAgentStatus = async () => {
    try {
      const health = await api.health();
      setAgentStatus(health.status === 'healthy' ? 'connected' : 'error');
    } catch {
      setAgentStatus('error');
    }
  };

  const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleSend = async (messageText?: string) => {
    const text = messageText || input.trim();
    if (!text || isLoading) return;

    // Clear input
    setInput('');

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Add placeholder for assistant response
    const assistantId = generateId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(true);

    try {
      // Build conversation history
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Use streaming API
      abortRef.current = api.streamArchitectureAdvisor(
        text,
        diagramContext,
        history,
        // On chunk
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        },
        // On complete
        (sources, agentName) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, isStreaming: false, sources, agentName }
                : m
            )
          );
          setIsLoading(false);
        },
        // On error
        (error) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Error: ${error}`, isStreaming: false }
                : m
            )
          );
          setIsLoading(false);
        }
      );
    } catch (error) {
      // Fallback to non-streaming
      try {
        const response = await api.architectureAdvisor(
          text,
          diagramContext,
          messages.map((m) => ({ role: m.role, content: m.content }))
        );

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: response.response,
                  sources: response.sources,
                  agentName: response.agent_name,
                  isStreaming: false,
                }
              : m
          )
        );
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${e instanceof Error ? e.message : 'Failed to get response'}`,
                  isStreaming: false,
                }
              : m
          )
        );
      }
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    handleSend(prompt);
  };

  return (
    <div
      className={cn(
        'flex flex-col bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden',
        isOverlay ? 'fixed bottom-4 right-4 w-[420px] h-[600px] z-50' : 'w-full h-full',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-brand-primary to-brand-accent border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <Icon icon="mdi:robot-happy" className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-2 h-2 rounded-full',
                  agentStatus === 'connected'
                    ? 'bg-green-400'
                    : agentStatus === 'checking'
                    ? 'bg-yellow-400 animate-pulse'
                    : 'bg-red-400'
                )}
              />
              <span className="text-[10px] text-white/80">
                {agentStatus === 'connected'
                  ? 'Azure Docs Agent (MCP)'
                  : agentStatus === 'checking'
                  ? 'Connecting...'
                  : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
        {isOverlay && onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          >
            <Icon icon="mdi:close" className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-4">
              <Icon icon="mdi:lightbulb-on" className="w-8 h-8 text-brand-primary" />
            </div>
            <h4 className="text-lg font-semibold text-gray-800 mb-2">
              Ask for Architecture Advice
            </h4>
            <p className="text-sm text-gray-500 mb-6 max-w-xs">
              Get enterprise-grade recommendations based on Microsoft's best practices and Azure Well-Architected Framework.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full">
              {SUGGESTED_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestedPrompt(prompt.text)}
                  className="flex items-start gap-2 p-3 bg-white rounded-lg border border-gray-200 hover:border-brand-primary/50 hover:shadow-md transition-all text-left group"
                >
                  <Icon
                    icon={prompt.icon}
                    className="w-4 h-4 text-brand-primary mt-0.5 flex-shrink-0"
                  />
                  <div>
                    <span className="text-[10px] font-medium text-brand-primary uppercase">
                      {prompt.category}
                    </span>
                    <p className="text-xs text-gray-600 line-clamp-2">{prompt.text}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 bg-brand-primary rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon icon="mdi:robot" className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-2.5',
                    message.role === 'user'
                      ? 'bg-brand-primary text-white rounded-br-md'
                      : 'bg-white border border-gray-200 rounded-bl-md shadow-sm'
                  )}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none text-gray-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content || (message.isStreaming ? '...' : '')}
                      </ReactMarkdown>
                      {message.isStreaming && (
                        <span className="inline-flex ml-1">
                          <span className="animate-pulse">▊</span>
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm">{message.content}</p>
                  )}
                  {message.agentName && !message.isStreaming && (
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100">
                      <Icon icon="mdi:check-circle" className="w-3 h-3 text-brand-primary" />
                      <span className="text-[10px] text-gray-400">
                        {message.agentName} via Microsoft Learn MCP
                      </span>
                    </div>
                  )}
                </div>
                {message.role === 'user' && (
                  <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon icon="mdi:account" className="w-4 h-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        {diagramContext && (
          <div className="flex items-center gap-1.5 mb-2 px-2">
            <Icon icon="mdi:diagram-box" className="w-3.5 h-3.5 text-brand-primary" />
            <span className="text-[10px] text-gray-500">
              {diagramContext.nodes?.length || 0} services in context
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about architecture best practices..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 disabled:opacity-50"
            disabled={isLoading}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className={cn(
              'p-2.5 rounded-xl transition-all',
              input.trim() && !isLoading
                ? 'bg-brand-primary text-white hover:bg-brand-primaryDark'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLoading ? (
              <Icon icon="mdi:loading" className="w-5 h-5 animate-spin" />
            ) : (
              <Icon icon="mdi:send" className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchitectureAdvisorChat;

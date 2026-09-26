import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, ExternalLink, X, Minimize2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { agentsService, type AgentType } from '@/services/agentsService';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  mcpEnhanced?: boolean;
  agentName?: string;
  timestamp?: Date;
}

interface ChatPanelProps {
  diagramContext?: string;
  architecture?: Record<string, unknown>;
  onClose?: () => void;
  isMinimized?: boolean;
  onMinimize?: () => void;
  className?: string;
  useFoundryAgents?: boolean;  // Toggle to use Foundry agents
}

import { API_BASE as BACKEND_URL } from '@/lib/apiConfig';

// Architecture-focused suggested questions
const SUGGESTED_QUESTIONS = [
  "What's the best architecture pattern for high availability in Azure?",
  "How do I design a secure hub-spoke network topology?",
  "What are the cost optimization strategies for Azure workloads?",
  "How should I implement disaster recovery for my application?",
  "What are Microsoft's recommendations for microservices on AKS?",
  "How do I secure API endpoints with Azure API Management?",
];

// Get random subset of suggestions
const getRandomSuggestions = (count: number = 3) => {
  const shuffled = [...SUGGESTED_QUESTIONS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  diagramContext,
  architecture,
  onClose,
  isMinimized,
  onMinimize,
  className,
  useFoundryAgents = true,  // Default to using Foundry agents
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions] = useState(() => getRandomSuggestions(3));
  // Always use azure_docs agent for Microsoft Learn integration
  const selectedAgent: AgentType = 'azure_docs';
  const [foundryStatus, setFoundryStatus] = useState<{connected: boolean; checked: boolean}>({
    connected: false,
    checked: false
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check Foundry status on mount
  useEffect(() => {
    if (useFoundryAgents) {
      checkFoundryStatus();
    }
  }, [useFoundryAgents]);

  const checkFoundryStatus = async () => {
    try {
      const health = await agentsService.health();
      // Check both foundry_connected field and agents_discovered > 0
      // This handles both new and old backend versions
      const isConnected = health.foundry_connected || 
        (health.agents_discovered !== undefined && health.agents_discovered > 0);
      console.log(`Foundry health check: connected=${isConnected}, agents=${health.agents_discovered}`);
      setFoundryStatus({
        connected: isConnected,
        checked: true
      });
    } catch (error) {
      console.warn('Could not check Foundry status:', error);
      setFoundryStatus({ connected: false, checked: true });
    }
  };

  /**
   * Clean and normalize markdown content for proper rendering
   * Handles common issues with LLM-generated markdown
   */
  const cleanMarkdown = useCallback((content: string): string => {
    if (!content) return '';
    
    let cleaned = content;
    
    // Fix table formatting issues - ensure proper spacing
    // Fix tables that have | at start/end but missing proper newlines
    cleaned = cleaned.replace(/\|\s*\n\s*\|/g, '|\n|');
    
    // Ensure table rows are on their own lines
    cleaned = cleaned.replace(/(\|[^\n]+\|)(?=\|)/g, '$1\n');
    
    // Fix separator rows (|---|---|) - normalize them
    cleaned = cleaned.replace(/\|[\s-:]+\|/g, (match) => {
      const cols = match.split('|').filter(c => c.trim());
      return '|' + cols.map(() => '---').join('|') + '|';
    });
    
    // Ensure blank line before and after tables
    cleaned = cleaned.replace(/([^\n])\n(\|[^\n]+\|)/g, '$1\n\n$2');
    cleaned = cleaned.replace(/(\|[^\n]+\|)\n([^\n|])/g, '$1\n\n$2');
    
    // Fix code blocks - ensure proper fencing
    cleaned = cleaned.replace(/```(\w+)?\s*\n/g, '\n```$1\n');
    cleaned = cleaned.replace(/\n```\s*$/gm, '\n```\n');
    
    // Clean up excessive newlines
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');
    
    // Fix bullet points that may have issues
    cleaned = cleaned.replace(/^[-*•]\s*/gm, '- ');
    
    // Fix numbered lists
    cleaned = cleaned.replace(/^(\d+)[.)]\s*/gm, '$1. ');
    
    return cleaned.trim();
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    // Log which agent will handle this message
    console.log(`Sending to azure_docs agent with diagram context`);

    try {
      if (useFoundryAgents && foundryStatus.connected) {
        // Use Azure AI Foundry azure-docs agent with Microsoft Learn MCP
        // Always include architecture context if available
        const contextPayload = architecture 
          ? { 
              architecture,
              conversation_history: messages.map(m => ({ role: m.role, content: m.content }))
            } 
          : undefined;
        
        console.log(`Calling agentsService.chat with azure_docs, context: ${contextPayload ? 'yes' : 'no'}`);
        const response = await agentsService.chat(
          currentInput,
          'azure_docs',
          contextPayload
        );
        
        console.log(`Response from: ${response.agent_name}`);
        
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: response.content,
          sources: response.sources,
          agentName: response.agent_name,
          mcpEnhanced: selectedAgent === 'azure_docs',  // Azure docs uses MCP
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Fallback to legacy chat endpoint
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: currentInput,
            conversation_history: messages.map(m => ({
              role: m.role,
              content: m.content
            })),
            context: diagramContext
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: data.response,
          sources: data.sources,
          mcpEnhanced: data.mcp_enhanced,
          timestamp: new Date()
        };
        
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error. ${useFoundryAgents ? 'Please ensure Azure AI Foundry agents are configured correctly.' : `Please ensure the backend is running at ${BACKEND_URL}.`}\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (isMinimized) {
    return null;
  }

  return (
    <div className={cn(
      "flex flex-col bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden",
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3 bg-gradient-to-r from-brand-primary to-brand-accent">
        <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-white">
            Architecture Advisor
          </h2>
        </div>
        {/* Microsoft Learn MCP Badge */}
        <div className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full bg-white/20 text-white font-medium">
          <Sparkles className="w-3 h-3" />
          Microsoft Learn
        </div>
        
        {/* Connection Status */}
        {foundryStatus.checked && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-2 h-2 rounded-full",
              foundryStatus.connected ? "bg-green-400" : "bg-red-400"
            )} />
            <span className="text-[10px] text-white/80">
              {foundryStatus.connected ? "Connected" : "Offline"}
            </span>
          </div>
        )}
        
        {onMinimize && (
          <button
            onClick={onMinimize}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title="Minimize"
          >
            <Minimize2 className="w-4 h-4 text-white" />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px] bg-gray-50">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 py-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-primary/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-brand-primary" />
            </div>
            <p className="font-semibold text-gray-700">Architecture Advisor</p>
            <p className="text-sm mt-1 text-gray-500">Powered by Microsoft Learn</p>
            <p className="text-xs mt-3 max-w-xs mx-auto">
              Ask about Azure architecture patterns, best practices, security, and cost optimization.
              {architecture && (
                <span className="block mt-1 text-brand-primary font-medium">
                  Your diagram context is active
                </span>
              )}
            </p>
            <div className="mt-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Try asking:</p>
              <div className="flex flex-col gap-2">
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(suggestion)}
                    className="text-xs px-4 py-2 bg-white hover:bg-brand-primary/5 hover:text-brand-primary rounded-lg transition-colors text-left border border-gray-200 hover:border-brand-primary/50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "flex gap-3",
              msg.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-brand-primary" />
              </div>
            )}
            
            <div
              className={cn(
                "max-w-[80%] rounded-xl p-3 shadow-sm overflow-hidden",
                msg.role === 'user'
                  ? "bg-brand-primary text-white"
                  : "bg-white text-gray-900 border border-gray-200"
              )}
            >
              {/* Agent Name Badge - show BEFORE content */}
              {msg.role === 'assistant' && msg.agentName && (
                <div className="mb-2 flex items-center gap-1">
                  <span className="text-xs bg-blue-500/20 text-blue-700 px-2 py-0.5 rounded font-medium">
                    {msg.agentName}
                  </span>
                </div>
              )}
              
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap text-xs break-words">{msg.content}</p>
              ) : (
                <div className="chat-message-content prose prose-xs max-w-full overflow-x-auto break-words text-[13px] leading-relaxed
                  prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-headings:text-gray-900
                  prose-h1:text-sm prose-h1:border-b prose-h1:border-gray-200 prose-h1:pb-1
                  prose-h2:text-[13px] prose-h3:text-[13px] prose-h2:font-medium prose-h3:font-medium
                  prose-p:my-1.5 prose-p:leading-relaxed prose-p:text-gray-700 prose-p:text-[13px]
                  prose-ul:my-1.5 prose-ul:pl-3.5 prose-ol:my-1.5 prose-ol:pl-3.5
                  prose-li:my-0.5 prose-li:marker:text-brand-primary prose-li:text-[13px]
                  prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[11px] prose-code:font-mono prose-code:text-pink-600 prose-code:border prose-code:border-gray-200
                  prose-pre:bg-gray-900 prose-pre:p-2.5 prose-pre:rounded-md prose-pre:overflow-x-auto prose-pre:text-[11px] prose-pre:my-2 prose-pre:border prose-pre:border-gray-700
                  prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-a:font-medium
                  prose-strong:font-semibold prose-strong:text-gray-800
                  prose-blockquote:border-l-2 prose-blockquote:border-brand-primary prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-gray-600 prose-blockquote:text-[12px] prose-blockquote:my-2 prose-blockquote:bg-gray-50 prose-blockquote:py-1 prose-blockquote:rounded-r
                  prose-hr:my-3 prose-hr:border-gray-200
                  prose-table:text-[11px] prose-th:bg-gray-100 prose-th:p-1.5 prose-td:p-1.5 prose-td:border prose-td:border-gray-200"
                >
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      // Custom code block renderer for better formatting
                      code: ({ className, children, ...props }) => {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px] font-mono text-pink-600 border border-gray-200" {...props}>
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className={cn("block text-gray-100 text-[11px]", className)} {...props}>
                            {children}
                          </code>
                        );
                      },
                      // Better paragraph handling
                      p: ({ children }) => (
                        <p className="my-1.5 leading-relaxed text-[13px] text-gray-700">{children}</p>
                      ),
                      // Better list handling
                      ul: ({ children }) => (
                        <ul className="my-1.5 space-y-0.5 list-disc pl-3.5 text-[13px]">{children}</ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="my-1.5 space-y-0.5 list-decimal pl-3.5 text-[13px]">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="text-gray-700 leading-relaxed text-[13px]">{children}</li>
                      ),
                      // Better heading rendering
                      h1: ({ children }) => (
                        <h1 className="text-sm font-semibold mt-3 mb-1.5 text-gray-900 border-b border-gray-200 pb-1">{children}</h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-[13px] font-medium mt-2.5 mb-1 text-gray-900">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-[13px] font-medium mt-2 mb-1 text-gray-800">{children}</h3>
                      ),
                      // Better pre/code block rendering
                      pre: ({ children }) => (
                        <pre className="bg-gray-900 rounded-md p-2.5 my-2 overflow-x-auto text-[11px] border border-gray-700">
                          {children}
                        </pre>
                      ),
                      // Better blockquote
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-brand-primary pl-3 my-2 italic text-gray-600 text-[12px] bg-gray-50 py-1 rounded-r">
                          {children}
                        </blockquote>
                      ),
                      // Better links
                      a: ({ href, children }) => (
                        <a 
                          href={href} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-medium text-[13px]"
                        >
                          {children}
                        </a>
                      ),
                      // Horizontal rule
                      hr: () => (
                        <hr className="my-3 border-gray-200" />
                      ),
                      // Strong/bold text
                      strong: ({ children }) => (
                        <strong className="font-semibold text-gray-800">{children}</strong>
                      ),
                      // Emphasis/italic
                      em: ({ children }) => (
                        <em className="italic text-gray-600">{children}</em>
                      ),
                      // Table components - enterprise grade rendering
                      table: ({ children }) => (
                        <div className="my-2 overflow-x-auto rounded-md border border-gray-200">
                          <table className="min-w-full divide-y divide-gray-200 text-[11px]">
                            {children}
                          </table>
                        </div>
                      ),
                      thead: ({ children }) => (
                        <thead className="bg-gray-100">
                          {children}
                        </thead>
                      ),
                      tbody: ({ children }) => (
                        <tbody className="bg-white divide-y divide-gray-200">
                          {children}
                        </tbody>
                      ),
                      tr: ({ children }) => (
                        <tr className="hover:bg-gray-50 transition-colors">
                          {children}
                        </tr>
                      ),
                      th: ({ children }) => (
                        <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-gray-700 uppercase tracking-wider bg-gray-100">
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="px-2.5 py-1.5 text-[11px] text-gray-700">
                          {children}
                        </td>
                      ),
                    }}
                  >
                    {cleanMarkdown(msg.content)}
                  </ReactMarkdown>
                </div>
              )}
              
              {/* MCP Badge */}
              {msg.mcpEnhanced && (
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-xs bg-brand-primary/20 text-brand-primary px-2 py-0.5 rounded flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    MCP Enhanced
                  </span>
                </div>
              )}
              
              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">Sources:</p>
                  <div className="space-y-1">
                    {msg.sources.map((source, i) => (
                      <a
                        key={i}
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {source.length > 50 ? source.substring(0, 50) + '...' : source}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Timestamp */}
              <div className={cn(
                "text-xs mt-1",
                msg.role === 'user' ? "text-green-200" : "text-gray-400"
              )}>
                {formatTime(msg.timestamp)}
              </div>
            </div>
            
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-gray-100 rounded-lg p-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
              <span className="text-sm text-gray-500">Thinking...</span>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Context indicator */}
      {diagramContext && (
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
          <p className="text-xs text-blue-600 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            Diagram context active - I can see your architecture
          </p>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-200">
        {/* Conversation context indicator */}
        {messages.length > 0 && (
          <div className="mb-2 text-xs text-gray-500 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" />
            <span>Conversation active • {messages.length} messages</span>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about Azure architecture..."
            className="flex-1 bg-gray-100 text-gray-900 rounded-lg px-4 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-colors flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

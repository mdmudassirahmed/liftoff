import React, { useState, useCallback } from 'react';
import { ChatPanel } from './ChatPanel';
import { ChatButton } from './ChatButton';

interface ChatContainerProps {
  diagramContext?: string;
  architecture?: Record<string, unknown>;  // Full architecture data for IaC generation
}

/**
 * Container component that manages the chat panel state and positioning.
 * Use this at the app level to add chat functionality.
 */
export const ChatContainer: React.FC<ChatContainerProps> = ({ diagramContext, architecture }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const toggleChat = useCallback(() => {
    if (isMinimized) {
      setIsMinimized(false);
    } else {
      setIsOpen(prev => !prev);
    }
  }, [isMinimized]);

  const handleMinimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
  }, []);

  return (
    <>
      {/* Chat Panel - positioned fixed in bottom right */}
      {isOpen && !isMinimized && (
        <div className="fixed bottom-24 right-6 w-[400px] z-40 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <ChatPanel
            diagramContext={diagramContext}
            architecture={architecture}
            onClose={handleClose}
            onMinimize={handleMinimize}
            isMinimized={isMinimized}
          />
        </div>
      )}

      {/* Floating Chat Button */}
      <ChatButton
        isOpen={isOpen && !isMinimized}
        onClick={toggleChat}
      />
    </>
  );
};

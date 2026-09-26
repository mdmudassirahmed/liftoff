import React from 'react';
import { MessageSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
  hasUnread?: boolean;
  className?: string;
}

export const ChatButton: React.FC<ChatButtonProps> = ({
  isOpen,
  onClick,
  hasUnread,
  className
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center z-50",
        isOpen 
          ? "bg-gray-600 hover:bg-gray-700 rotate-0"
          : "bg-brand-primary hover:bg-brand-primaryDark hover:scale-110",
        className
      )}
      title={isOpen ? "Close chat" : "Open Azure Architect Chat"}
    >
      {isOpen ? (
        <X className="w-6 h-6 text-white" />
      ) : (
        <>
          <MessageSquare className="w-6 h-6 text-white" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-xs text-white font-bold">
              !
            </span>
          )}
        </>
      )}
    </button>
  );
};

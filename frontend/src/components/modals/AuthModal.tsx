// Auth Modal Component

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
  isAuthenticated: boolean;
  authInfo?: {
    user?: string;
    subscriptionName?: string;
    subscriptionId?: string;
    tenantId?: string;
    error?: string;
  };
}

export function AuthModal({
  isOpen,
  onClose,
  onRefresh,
  onSignOut,
  isAuthenticated,
  authInfo,
}: AuthModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  const handleRefreshStatus = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onSignOut();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-azure-blue/10 flex items-center justify-center">
              <Icon icon="mdi:microsoft-azure" className="w-6 h-6 text-azure-blue" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isAuthenticated ? 'Azure Account' : 'Sign in to Azure'}
              </h2>
              <p className="text-sm text-gray-500">
                {isAuthenticated ? 'Manage your connection' : 'Connect to deploy resources'}
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

        {/* Content */}
        <div className="p-6">
          {isAuthenticated ? (
            <div className="space-y-4">
              {/* User Info */}
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="w-12 h-12 rounded-full bg-brand-primary flex items-center justify-center text-white font-semibold text-lg">
                  {authInfo?.user?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{authInfo?.user || 'Azure User'}</p>
                  <p className="text-sm text-gray-500">{authInfo?.subscriptionName || 'Default Subscription'}</p>
                </div>
                <Icon
                  icon="mdi:check-circle"
                  className="w-6 h-6 text-brand-primary ml-auto"
                />
              </div>

              {/* Subscription Details */}
              <div className="grid grid-cols-1 gap-2 text-sm text-gray-600">
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <span>Subscription ID</span>
                  <span className="font-mono text-xs text-gray-500">{authInfo?.subscriptionId || '—'}</span>
                </div>
                <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                  <span>Tenant ID</span>
                  <span className="font-mono text-xs text-gray-500">{authInfo?.tenantId || '—'}</span>
                </div>
              </div>

              {/* Sign Out Button */}
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                disabled={isLoading}
              >
                <Icon icon="mdi:logout" className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info */}
              <div className="bg-brand-accent/10 border border-brand-accent/30 rounded-lg p-4">
                <div className="flex gap-3">
                  <Icon icon="mdi:information" className="w-5 h-5 text-brand-accent flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-700">
                    <p className="font-medium mb-1 text-gray-900">Why sign in?</p>
                    <ul className="list-disc list-inside text-gray-600 space-y-1">
                      <li>Deploy infrastructure to your Azure subscription</li>
                      <li>View existing resources</li>
                      <li>Manage deployments</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* CLI Instructions */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-700 mb-2">
                  This uses your Azure CLI session. Run in a terminal:
                </p>
                <div className="text-xs font-mono bg-white border border-gray-200 rounded px-3 py-2 text-gray-700">
                  az login
                </div>
                {authInfo?.error && (
                  <p className="text-xs text-red-600 mt-2">{authInfo.error}</p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                  {error}
                </div>
              )}

              {/* Refresh Status Button */}
              <button
                onClick={handleRefreshStatus}
                disabled={isLoading}
                className={cn(
                  'w-full flex items-center justify-center gap-3 py-3 rounded-lg',
                  'bg-azure-blue text-white font-medium',
                  'hover:bg-azure-darkBlue transition-colors',
                  'disabled:opacity-70 disabled:cursor-not-allowed'
                )}
              >
                {isLoading ? (
                  <>
                    <Icon icon="mdi:loading" className="w-5 h-5 animate-spin" />
                    Checking Azure CLI...
                  </>
                ) : (
                  <>
                    <Icon icon="mdi:check-network" className="w-5 h-5" />
                    Check Azure CLI Status
                  </>
                )}
              </button>

              {/* Alternative */}
              <div className="text-center">
                <p className="text-xs text-gray-500">
                  Sign in with Azure CLI to enable deployment
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AuthModal;

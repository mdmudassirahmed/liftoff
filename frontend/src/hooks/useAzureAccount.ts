// Shared Azure account context for the canvas.
//
// Reads the signed-in `az` session (same source the deploy flow uses) so the
// canvas can offer real subscription + resource-group dropdowns instead of
// auto-generated placeholder names. Every call degrades silently: on any error,
// or when the user is not logged in, the lists come back empty and callers fall
// back to today's free-text inputs. Results are cached at module scope so the
// (single) Properties panel and any other consumer share one fetch.

import { useEffect, useState } from 'react';
import { api } from '@/services/api';

export interface AzureSubscription {
  subscription_id: string;
  name: string;
  tenant_id?: string;
  is_default?: boolean;
  state?: string;
}

export interface AzureResourceGroup {
  name: string;
  location: string;
  id?: string;
}

interface AzureAccountSnapshot {
  authenticated: boolean;
  subscriptions: AzureSubscription[];
  defaultSubscriptionId?: string;
}

// Module-level caches shared across hook consumers within a session.
let accountCache: AzureAccountSnapshot | null = null;
let accountPromise: Promise<AzureAccountSnapshot> | null = null;
const rgCache = new Map<string, AzureResourceGroup[]>();
const rgPromises = new Map<string, Promise<AzureResourceGroup[]>>();

async function fetchAccount(): Promise<AzureAccountSnapshot> {
  try {
    const status = await api.getDeployStatus();
    if (!status.authenticated) {
      return { authenticated: false, subscriptions: [] };
    }
    const subResponse = await api.listSubscriptions();
    return {
      authenticated: true,
      subscriptions: subResponse?.subscriptions ?? [],
      defaultSubscriptionId: subResponse?.default_subscription_id || status.subscription_id,
    };
  } catch {
    return { authenticated: false, subscriptions: [] };
  }
}

async function fetchResourceGroups(subscriptionId?: string): Promise<AzureResourceGroup[]> {
  const key = subscriptionId || '__default__';
  const cached = rgCache.get(key);
  if (cached) return cached;
  const existing = rgPromises.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await api.listResourceGroups(subscriptionId);
      const groups = res?.resource_groups ?? [];
      rgCache.set(key, groups);
      return groups;
    } catch {
      rgCache.set(key, []);
      return [];
    } finally {
      rgPromises.delete(key);
    }
  })();
  rgPromises.set(key, p);
  return p;
}

export interface UseAzureAccountResult {
  authenticated: boolean;
  subscriptions: AzureSubscription[];
  defaultSubscriptionId?: string;
  /** Resource groups for a subscription (or the az default). Triggers a lazy load. */
  getResourceGroups: (subscriptionId?: string) => AzureResourceGroup[];
}

/**
 * Load the signed-in Azure account (subscriptions) once and expose a lazy
 * per-subscription resource-group lookup. Safe to call from any component.
 */
export function useAzureAccount(): UseAzureAccountResult {
  const [snapshot, setSnapshot] = useState<AzureAccountSnapshot>(
    accountCache ?? { authenticated: false, subscriptions: [] }
  );
  // Bump to re-render when a lazily-loaded RG list arrives.
  const [, setRgVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (accountCache) return; // already used as the initial state
    if (!accountPromise) {
      accountPromise = fetchAccount().then((snap) => {
        accountCache = snap;
        return snap;
      });
    }
    accountPromise.then((snap) => {
      if (!cancelled) setSnapshot(snap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const getResourceGroups = (subscriptionId?: string): AzureResourceGroup[] => {
    const key = subscriptionId || '__default__';
    const cached = rgCache.get(key);
    if (cached) return cached;
    // Kick off a lazy load and re-render when it resolves.
    if (snapshot.authenticated) {
      fetchResourceGroups(subscriptionId).then(() => setRgVersion((v) => v + 1));
    }
    return [];
  };

  return {
    authenticated: snapshot.authenticated,
    subscriptions: snapshot.subscriptions,
    defaultSubscriptionId: snapshot.defaultSubscriptionId,
    getResourceGroups,
  };
}

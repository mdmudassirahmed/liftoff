// Backend connection settings, read once from Vite env (frontend/.env.local).

export const API_BASE: string = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

const API_TOKEN: string = import.meta.env.VITE_API_TOKEN || '';

/**
 * When VITE_API_TOKEN is set (matching API_AUTH_TOKEN on the backend), attach it
 * as a bearer token to every request aimed at the Liftoff API. Patching fetch once
 * covers the REST client, the agents client and the streaming endpoints alike.
 */
export function installApiAuth(): void {
  if (!API_TOKEN || typeof window === 'undefined') return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(API_BASE)) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${API_TOKEN}`);
    return originalFetch(input, { ...init, headers });
  };
}

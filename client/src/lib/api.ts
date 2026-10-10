/**
 * Centralized API client with credentials and token propagation
 */

import { safeGetItem, safeSetItem, safeRemoveItem } from './storage';

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
}

export function getStoredTeamToken(): string | null {
  return safeGetItem('nexus_team_token');
}

export function setStoredTeamToken(token: string): void {
  safeSetItem('nexus_team_token', token);
}

export function removeStoredTeamToken(): void {
  safeRemoveItem('nexus_team_token');
}

export function getStoredAdminToken(): string | null {
  return safeGetItem('nexus_admin_token');
}

export function setStoredAdminToken(token: string): void {
  safeSetItem('nexus_admin_token', token);
}

export function removeStoredAdminToken(): void {
  safeRemoveItem('nexus_admin_token');
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  // Attach stored team token if present
  const teamToken = getStoredTeamToken();
  if (teamToken && !headers.has('x-team-token')) {
    headers.set('x-team-token', teamToken);
  }

  // Attach stored admin token if present
  const adminToken = getStoredAdminToken();
  if (adminToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${adminToken}`);
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const apiBase = (import.meta as any).env?.VITE_API_URL || '';
  const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include' // Always include cookies for same-origin LAN requests
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errJson: any = null;
    try {
      errJson = await response.json();
      if (errJson?.error) errorMessage = errJson.error;
    } catch (e) {
      // Non-JSON response
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        errorMessage = 'Unable to connect to the backend server. Please verify the host server is running.';
      }
    }
    const err: any = new Error(errorMessage);
    err.status = response.status;
    err.is_banned = errJson?.is_banned;
    err.ban_reason = errJson?.ban_reason;
    err.data = errJson;
    throw err;
  }

  return response.json();
}

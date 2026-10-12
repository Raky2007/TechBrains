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

/**
 * Downloads a file (e.g. CSV export) authenticated via cookies and admin token headers
 */
export async function downloadFile(endpoint: string, defaultFilename: string): Promise<void> {
  const headers = new Headers();
  const adminToken = getStoredAdminToken();
  if (adminToken) {
    headers.set('Authorization', `Bearer ${adminToken}`);
    headers.set('x-admin-token', adminToken);
  }
  const teamToken = getStoredTeamToken();
  if (teamToken) {
    headers.set('x-team-token', teamToken);
  }

  const apiBase = (import.meta as any).env?.VITE_API_URL || '';
  const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    let errorMsg = `Download failed with HTTP ${response.status}`;
    try {
      const json = await response.json();
      if (json?.error) errorMsg = json.error;
    } catch {}
    throw new Error(errorMsg);
  }

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;

  const disposition = response.headers.get('Content-Disposition');
  let filename = defaultFilename;
  if (disposition && disposition.includes('filename=')) {
    const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (match && match[1]) {
      filename = match[1].replace(/['"]/g, '');
    }
  }

  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(blobUrl);
}


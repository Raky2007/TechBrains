/**
 * Centralized API client with credentials and token propagation
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
}

export function getStoredTeamToken(): string | null {
  return localStorage.getItem('nexus_team_token');
}

export function setStoredTeamToken(token: string): void {
  localStorage.setItem('nexus_team_token', token);
}

export function removeStoredTeamToken(): void {
  localStorage.removeItem('nexus_team_token');
}

export function getStoredAdminToken(): string | null {
  return localStorage.getItem('nexus_admin_token');
}

export function setStoredAdminToken(token: string): void {
  localStorage.setItem('nexus_admin_token', token);
}

export function removeStoredAdminToken(): void {
  localStorage.removeItem('nexus_admin_token');
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

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include' // Always include cookies for same-origin LAN requests
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errorMessage = errJson.error;
    } catch (e) {
      // Non-JSON response
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

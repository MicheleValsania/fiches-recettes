const DEFAULT_API_BASE = "http://localhost:3001/api";

const rawApiBase =
  typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_BASE : undefined;

const normalizedApiBase =
  typeof rawApiBase === "string" && rawApiBase.trim().length > 0
    ? rawApiBase.trim().replace(/\/+$/, "")
    : DEFAULT_API_BASE;

export const API_BASE = normalizedApiBase;

const API_TOKEN_KEY = "fiches-recettes:api-session";
export const API_AUTH_EXPIRED_EVENT = "fiches-recettes:auth-expired";

export type ApiAccessResult = "ok" | "unauthorized" | "offline";

export function getApiToken(): string {
  try {
    return sessionStorage.getItem(API_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiToken(value: string) {
  try {
    if (value) sessionStorage.setItem(API_TOKEN_KEY, value);
    else sessionStorage.removeItem(API_TOKEN_KEY);
  } catch {
    // If storage is unavailable, authentication lasts only until the next reload.
  }
}

function tokenHeaders(headersInit?: HeadersInit) {
  const headers = new Headers(headersInit);
  const token = getApiToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, { ...init, headers: tokenHeaders(init.headers) });
  if (response.status === 401) {
    setApiToken("");
    window.dispatchEvent(new Event(API_AUTH_EXPIRED_EVENT));
  }
  return response;
}

export async function checkApiAccess(): Promise<ApiAccessResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/status`, { headers: tokenHeaders() });
    if (!response.ok) return response.status === 401 ? "unauthorized" : "offline";
    const body = await response.json();
    return body?.authenticated ? "ok" : "unauthorized";
  } catch {
    return "offline";
  }
}

export async function loginApi(password: string): Promise<ApiAccessResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.status === 401 || response.status === 429) return "unauthorized";
    if (!response.ok) return "offline";
    const body = await response.json();
    setApiToken(typeof body?.token === "string" ? body.token : "");
    return "ok";
  } catch {
    return "offline";
  }
}

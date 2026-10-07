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
export type ApiSession = {
  tenant: { id: string; slug: string; name: string };
  user: { id: string; role: string } | null;
  registrationEnabled: boolean;
};
export type ApiSessionResult =
  | { status: "ok"; session: ApiSession }
  | { status: "unauthorized" | "offline"; session: null };
export type OnboardingProgress = {
  completedSteps: string[];
  tourSeen: boolean;
  persisted: boolean;
};
export type AuthFailureReason =
  | "unauthorized"
  | "offline"
  | "invalid_invite"
  | "invalid_registration"
  | "account_exists"
  | "registration_disabled"
  | "too_many_attempts"
  | "registration_failed";
export type AuthActionResult = { ok: true } | { ok: false; reason: AuthFailureReason };
export type RegistrationPayload = {
  displayName: string;
  email: string;
  password: string;
  organizationName: string;
  inviteCode: string;
};

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

export async function checkApiSession(): Promise<ApiSessionResult> {
  try {
    const response = await fetch(`${API_BASE}/auth/status`, { headers: tokenHeaders() });
    if (!response.ok) {
      return { status: response.status === 401 ? "unauthorized" : "offline", session: null };
    }
    const body = await response.json();
    if (!body?.authenticated || !body?.tenant?.id) return { status: "unauthorized", session: null };
    return {
      status: "ok",
      session: {
        tenant: body.tenant,
        user: body.user?.id ? body.user : null,
        registrationEnabled: Boolean(body.registrationEnabled),
      },
    };
  } catch {
    return { status: "offline", session: null };
  }
}

export async function checkApiAccess(): Promise<ApiAccessResult> {
  return (await checkApiSession()).status;
}

export async function loadOnboardingProgress(): Promise<OnboardingProgress> {
  const response = await apiFetch(`${API_BASE}/onboarding`);
  if (!response.ok) throw new Error("onboarding_load_failed");
  const body = await response.json();
  return {
    completedSteps: Array.isArray(body?.completedSteps) ? body.completedSteps.map(String) : [],
    tourSeen: Boolean(body?.tourSeen),
    persisted: Boolean(body?.persisted),
  };
}

export async function saveOnboardingProgress(progress: Pick<OnboardingProgress, "completedSteps" | "tourSeen">) {
  const response = await apiFetch(`${API_BASE}/onboarding`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(progress),
  });
  if (!response.ok) throw new Error("onboarding_save_failed");
}

async function authenticate(path: string, body: object): Promise<AuthActionResult> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      const knownReasons: AuthFailureReason[] = [
        "unauthorized",
        "invalid_invite",
        "invalid_registration",
        "account_exists",
        "registration_disabled",
        "too_many_attempts",
        "registration_failed",
      ];
      const reason = knownReasons.includes(responseBody?.error) ? responseBody.error : "offline";
      return { ok: false, reason };
    }
    setApiToken(typeof responseBody?.token === "string" ? responseBody.token : "");
    return { ok: true };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export function loginApi(email: string, password: string) {
  return authenticate("/auth/login", { email, password });
}

export function loginLegacyApi(password: string) {
  return authenticate("/auth/login", { password });
}

export function registerApi(payload: RegistrationPayload) {
  return authenticate("/auth/register", payload);
}

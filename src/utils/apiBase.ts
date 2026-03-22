const DEFAULT_API_BASE = "http://localhost:3001/api";

const rawApiBase =
  typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_BASE : undefined;

const normalizedApiBase =
  typeof rawApiBase === "string" && rawApiBase.trim().length > 0
    ? rawApiBase.trim().replace(/\/+$/, "")
    : DEFAULT_API_BASE;

export const API_BASE = normalizedApiBase;

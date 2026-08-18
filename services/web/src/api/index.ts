import type { FiscusApi } from "./client";
import { mockApi } from "./mock";
import { createHttpApi } from "./http";

// VITE_USE_MOCK=false + VITE_API_BASE_URL activates the real HTTP client.
// If VITE_API_BASE_URL is unset, the mock is always used (no banner).
// If the base URL is set but a request fails, the http client falls back to mock
// and triggers the ApiFallbackBanner via fallbackState.ts.
const useMock = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";
const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const api: FiscusApi =
  !useMock && apiBase ? createHttpApi(apiBase) : mockApi;

export type { FiscusApi };

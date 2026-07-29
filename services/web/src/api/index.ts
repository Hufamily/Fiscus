import type { FiscusApi } from "./client";
import { mockApi } from "./mock";

// Flip VITE_USE_MOCK=false and drop in a real client here once services/api is live.
const useMock = (import.meta.env.VITE_USE_MOCK ?? "true") !== "false";

export const api: FiscusApi = useMock ? mockApi : mockApi;
export type { FiscusApi };

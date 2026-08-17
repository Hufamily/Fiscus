import { createContext, useContext, useState, type ReactNode } from "react";
import type { Role } from "../types";

interface SessionCtx { role: Role; setRole: (r: Role) => void; }
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("data_entry");
  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}

// Demo identity per role (mirrors mock volunteers); real app gets this from auth.
export const DEMO_NAMES: Record<Role, string> = {
  data_entry: "Amy",
  reviewer: "Raj",
  treasurer: "Dana",
  leadership: "Pat",
};

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

import { useSession } from "../lib/session";
import { ROLE_LABELS } from "../lib/rbac";
import type { Role } from "../types";

const ROLES: Role[] = ["data_entry", "reviewer", "treasurer", "leadership"];

// Demo affordance: switch role to show query-layer RBAC changing what the UI even offers.
export function RoleSwitcher() {
  const { role, setRole } = useSession();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="hidden sm:inline">Signed in as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-ink"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
    </label>
  );
}

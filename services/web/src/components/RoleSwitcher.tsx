import { useSession } from "../lib/session";
import { ROLE_LABELS } from "../lib/rbac";
import type { Role } from "../types";

const ROLES: Role[] = ["data_entry", "reviewer", "treasurer", "leadership"];

// Demo affordance: switch role to show query-layer RBAC changing what the UI even offers.
// Real RBAC is enforced server-side (issue D1); this switcher exists for the demo only.
export function RoleSwitcher() {
  const { role, setRole } = useSession();
  return (
    <label className="flex items-center gap-2 text-sm text-faint">
      <span className="rounded-full border border-hairline px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-faint">demo</span>
      <span className="hidden whitespace-nowrap lg:inline">Viewing as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-sm font-medium text-ink"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
    </label>
  );
}

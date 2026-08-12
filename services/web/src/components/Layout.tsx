import { NavLink, Outlet } from "react-router-dom";
import { RoleSwitcher } from "./RoleSwitcher";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

const link = "px-3 py-1.5 rounded-full text-sm";
const active = "bg-moss text-white";
const idle = "text-faint hover:text-ink hover:bg-hairline/50";
const cls = ({ isActive }: { isActive: boolean }) => `${link} ${isActive ? active : idle}`;

export function Layout() {
  const { role } = useSession();
  const showUpload = can(role, "upload_documents");
  const showReview = can(role, "review_extractions");
  const showTemplates = can(role, "approve_templates") || can(role, "review_extractions");
  const showLeadership = can(role, "view_aggregate_reports");

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-10">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tracking-tight">Fiscus</span>
              <span className="hidden text-xs text-faint sm:inline">ledger with a memory</span>
            </div>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={cls}>Home</NavLink>
              {showUpload && <NavLink to="/upload" className={cls}>Upload</NavLink>}
              {showReview && <NavLink to="/review" className={cls}>Review</NavLink>}
              {showTemplates && <NavLink to="/templates" className={cls}>Templates</NavLink>}
              <NavLink to="/assistant" className={cls}>Assistant</NavLink>
              <NavLink to="/activity" className={cls}>Activity</NavLink>
              {showLeadership && <NavLink to="/dashboard" className={cls}>Dashboard</NavLink>}
            </nav>
          </div>
          <RoleSwitcher />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-4">
        <p className="text-xs text-faint">Fiscus · agentic bookkeeping for volunteer orgs · CockroachDB × AWS</p>
      </footer>
    </div>
  );
}

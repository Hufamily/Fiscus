import { NavLink, Outlet } from "react-router-dom";
import { RoleSwitcher } from "./RoleSwitcher";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

const link = "px-3 py-2 rounded-md text-sm font-medium";
const active = "bg-brand/10 text-brand-dark";
const idle = "text-slate-600 hover:bg-slate-100";
const cls = ({ isActive }: { isActive: boolean }) => `${link} ${isActive ? active : idle}`;

export function Layout() {
  const { role } = useSession();
  const showUpload = can(role, "upload_documents");
  const showReview = can(role, "review_extractions");
  const showTemplates = can(role, "approve_templates") || can(role, "review_extractions");
  const showLeadership = can(role, "view_aggregate_reports");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-bold text-white">F</div>
              <span className="text-lg font-semibold tracking-tight">Fiscus</span>
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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

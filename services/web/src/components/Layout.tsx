import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { RoleSwitcher } from "./RoleSwitcher";
import { SearchBar } from "./SearchBar";
import { ApiFallbackBanner } from "./ApiFallbackBanner";
import { useSession } from "../lib/session";
import { can } from "../lib/rbac";

const link = "px-3 py-1.5 rounded-full text-sm";
const active = "bg-moss text-white";
const idle = "text-faint hover:text-ink hover:bg-hairline/50";
const cls = ({ isActive }: { isActive: boolean }) => `${link} ${isActive ? active : idle}`;

export function Layout() {
  const { role } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const showUpload = can(role, "upload_documents");
  const showReview = can(role, "review_extractions");
  const showTemplates = can(role, "approve_templates") || can(role, "review_extractions");
  const showLeadership = can(role, "view_aggregate_reports");

  const links = (
    <>
      <NavLink to="/" end className={cls} onClick={() => setMenuOpen(false)}>Home</NavLink>
      {showUpload && <NavLink to="/upload" className={cls} onClick={() => setMenuOpen(false)}>Upload</NavLink>}
      {showReview && <NavLink to="/review" className={cls} onClick={() => setMenuOpen(false)}>Review</NavLink>}
      {showTemplates && <NavLink to="/templates" className={cls} onClick={() => setMenuOpen(false)}>Templates</NavLink>}
      <NavLink to="/assistant" className={cls} onClick={() => setMenuOpen(false)}>Assistant</NavLink>
      <NavLink to="/activity" className={cls} onClick={() => setMenuOpen(false)}>Activity</NavLink>
      {showLeadership && <NavLink to="/dashboard" className={cls} onClick={() => setMenuOpen(false)}>Dashboard</NavLink>}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tracking-tight">Fiscus</span>
              <span className="hidden whitespace-nowrap text-xs text-faint xl:inline">ledger with a memory</span>
            </div>
            <nav className="hidden min-w-0 flex-wrap items-center gap-1 md:flex">{links}</nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SearchBar />
            <div className="hidden sm:block"><RoleSwitcher /></div>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full border border-hairline px-3 py-1.5 text-sm text-faint md:hidden"
              aria-label="Menu"
            >
              {menuOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-hairline px-4 py-3 md:hidden">
            <nav className="flex flex-wrap gap-1.5">{links}</nav>
            <div className="mt-3 sm:hidden"><RoleSwitcher /></div>
          </div>
        )}
      </header>
      <ApiFallbackBanner />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6">
        <p className="text-xs text-faint">Fiscus · agentic bookkeeping for volunteer orgs · CockroachDB × AWS</p>
      </footer>
    </div>
  );
}

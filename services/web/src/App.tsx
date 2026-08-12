import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { SessionProvider } from "./lib/session";
import { ToastProvider } from "./components/Toast";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { UploadPage } from "./pages/UploadPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { AssistantPage } from "./pages/AssistantPage";
import { ActivityPage } from "./pages/ActivityPage";
import { LeadershipDashboard } from "./pages/LeadershipDashboard";
import { NotFoundPage } from "./pages/NotFoundPage";

const TITLES: Record<string, string> = {
  "/": "Home", "/upload": "Upload", "/review": "Review", "/templates": "Templates",
  "/assistant": "Assistant", "/activity": "Activity", "/dashboard": "Dashboard",
};

function TitleSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const base = TITLES[pathname] ?? (pathname.startsWith("/review/") ? "Review" : null);
    document.title = base ? `${base} · Fiscus` : "Fiscus";
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter>
          <TitleSync />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="upload" element={<UploadPage />} />
              <Route path="review" element={<ReviewQueuePage />} />
              <Route path="review/:docId" element={<ReviewDetailPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="dashboard" element={<LeadershipDashboard />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}

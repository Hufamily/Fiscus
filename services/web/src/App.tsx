import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SessionProvider } from "./lib/session";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { UploadPage } from "./pages/UploadPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { AssistantPage } from "./pages/AssistantPage";
import { ActivityPage } from "./pages/ActivityPage";
import { LeadershipDashboard } from "./pages/LeadershipDashboard";

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

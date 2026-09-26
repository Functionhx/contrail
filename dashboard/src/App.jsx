import React, { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { ToastProvider } from "./ui/components/Toast.jsx";

// Contrail 只有一个页面：用量 dashboard。上游的登录、排行榜、额度、宠物、
// 设置等十几个路由在静态公开页面里都不存在，这里不再有路由分支与登录门禁。
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.jsx").then((m) => ({ default: m.DashboardPage })),
);

export default function App() {
  // 订阅 locale：切换语言时整棵树重渲染，文案随之更新。
  const { resolvedLocale } = useLocale();
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <Suspense fallback={null}>
            <main className="contrail-shell">
              <DashboardPage key={resolvedLocale} signedIn publicMode={false} auth={null} />
            </main>
          </Suspense>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

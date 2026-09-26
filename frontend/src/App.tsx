import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { prefetchCommonSchemas } from '@/hooks';
import { prefetchCommonARMSchemas } from '@/lib/dynamicSchemaInheritance';
import './index.css';

// Route-level code splitting: the landing page loads without the canvas bundle.
const IndexPage = lazy(() => import('@/pages/Landing'));
const WorkspacePage = lazy(() => import('@/pages/Workspace'));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-sm text-gray-500">
      Loading Liftoff...
    </div>
  );
}

function App() {
  // Prefetch common Azure resource schemas on app load
  useEffect(() => {
    // Prefetch Bicep schemas (for UI display)
    prefetchCommonSchemas().catch(console.error);

    // Prefetch ARM schemas (for dynamic property inheritance)
    prefetchCommonARMSchemas().catch(console.error);
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;

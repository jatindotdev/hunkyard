import '@fontsource-variable/geist';
import '@/app/globals.css';

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { ScrollbarGutterVariables } from '@/components/ScrollbarGutterVariables';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/Toaster';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

const container = document.getElementById('root');
if (container == null) throw new Error('#root is missing from index.html');

// The provider order matches what RootLayout established: the worker pool sits
// above the theme provider so it outlives navigation and is not torn down when
// the palette changes.
createRoot(container).render(
  // No StrictMode, matching upstream: the viewer fires upstream patch fetches
  // on mount, and double-invoked effects would double every request.
  <>
    <ScrollbarGutterVariables />
    <WorkerPoolContext>
      <ThemeProvider attribute="class">
        <App />
        <Toaster />
        <div id="dark-mode-portal-container" className="dark" data-theme="dark" />
        <div
          id="light-mode-portal-container"
          className="light"
          data-theme="light"
        />
      </ThemeProvider>
    </WorkerPoolContext>
    <PreloadHighlighter />
  </>
);

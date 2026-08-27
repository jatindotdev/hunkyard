import '@fontsource-variable/geist';
import './globals.css';

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { PreloadHighlighter } from './PreloadHighlighter';
import { ScrollbarGutterVariables } from './ScrollbarGutterVariables';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { Toaster } from './Toaster';
import { WorkerPoolContext } from './WorkerPoolContext';

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

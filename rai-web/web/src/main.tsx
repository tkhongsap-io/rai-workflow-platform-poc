// @rai/web entry (W0-02 section 1). W1-00 creates the workspace skeleton only so that build, lint and typecheck run
// over all five workspaces; the shell, sign-in and case screens arrive with W1-07 (Lane B). No UI is claimed here.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';

const root = document.getElementById('root');
if (root === null) throw new Error('root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

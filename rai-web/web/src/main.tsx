// @rai/web entry (W0-02 section 1). W1-07 mounts the application root (shell, sign-in, case list and new-case
// form) and the stylesheet; the served bundle is web/dist, with no API-substitute configuration.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

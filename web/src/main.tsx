import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { API_MODE } from './lib/env';
import './styles/index.css';

/**
 * The mock backend must be running before React makes its first request, so boot is
 * async. In `prism` or `real` mode nothing extra is started.
 */
async function bootstrap() {
  if (API_MODE === 'msw') {
    const { startMockBackend } = await import('./mocks/browser');
    await startMockBackend();
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('No #root element in index.html.');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

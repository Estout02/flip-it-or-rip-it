import { render } from 'preact';
import { App } from './app';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/app.css';

render(<App />, document.getElementById('app')!);

// Offline shell + installability (R9). Production only; the dev server has no service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

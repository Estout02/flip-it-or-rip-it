import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

// Vitest globals are off, so register Testing Library's cleanup explicitly.
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.title = '';
});

// jsdom may lack the modal <dialog> API. Minimal stand-in: open/close + the `close` and
// `cancel` events, which is all the components rely on. Real browsers are covered by e2e.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & { __polyfilled?: boolean };
if (typeof proto.showModal !== 'function') {
  proto.__polyfilled = true;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.show = proto.showModal;
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

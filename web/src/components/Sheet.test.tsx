import { fireEvent, render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

beforeEach(() => {
  history.replaceState(null, '');
});

describe('Sheet', () => {
  it('view="resting" renders sheet sheet--resting and pushes no history entry', () => {
    const pushSpy = vi.spyOn(history, 'pushState');
    const { container } = render(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    expect(container.querySelector('section')!.className).toBe('sheet sheet--resting');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('rerendering to view="expanded" pushes exactly one history entry', () => {
    const pushSpy = vi.spyOn(history, 'pushState');
    const { container, rerender } = render(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    rerender(<Sheet view="expanded" onDismiss={vi.fn()}>content</Sheet>);
    expect(container.querySelector('section')!.className).toBe('sheet sheet--expanded');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(history.state).toEqual({ flipSheet: true });
  });

  it('Escape while expanded calls onDismiss once; while resting it does not', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Sheet view="resting" onDismiss={onDismiss}>content</Sheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(<Sheet view="expanded" onDismiss={onDismiss}>content</Sheet>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while an open <dialog> is in the document', () => {
    const onDismiss = vi.fn();
    render(<Sheet view="expanded" onDismiss={onDismiss}>content</Sheet>);
    const dialog = document.createElement('dialog');
    document.body.appendChild(dialog);
    dialog.setAttribute('open', '');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('a popstate while expanded calls onDismiss and does not call history.back', () => {
    const onDismiss = vi.fn();
    const backSpy = vi.spyOn(history, 'back');
    const { rerender } = render(<Sheet view="resting" onDismiss={onDismiss}>content</Sheet>);
    rerender(<Sheet view="expanded" onDismiss={onDismiss}>content</Sheet>);

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('collapsing back to resting after an expansion calls history.back() exactly once', () => {
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => history.replaceState(null, ''));
    const { rerender } = render(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    rerender(<Sheet view="expanded" onDismiss={vi.fn()}>content</Sheet>);
    rerender(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('.sheet__grabber is aria-hidden and not focusable', () => {
    const { container } = render(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    const grabber = container.querySelector('.sheet__grabber')!;
    expect(grabber.getAttribute('aria-hidden')).toBe('true');
    expect(grabber.tagName).not.toBe('BUTTON');
    expect(grabber.getAttribute('tabindex')).toBeNull();
  });

  it('presentation="pane" renders sheet--pane with no grabber, no history entry and ignores Escape', () => {
    const onDismiss = vi.fn();
    const pushSpy = vi.spyOn(history, 'pushState');
    const { container, rerender } = render(
      <Sheet view="resting" onDismiss={onDismiss} presentation="pane">
        content
      </Sheet>,
    );
    expect(container.querySelector('section')!.className).toBe('sheet sheet--resting sheet--pane');
    expect(container.querySelector('.sheet__grabber')).toBeNull();
    expect(pushSpy).not.toHaveBeenCalled();

    rerender(
      <Sheet view="expanded" onDismiss={onDismiss} presentation="pane">
        content
      </Sheet>,
    );
    expect(pushSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('has neither aria-labelledby nor aria-label in either presentation when omitted', () => {
    const bottom = render(<Sheet view="resting" onDismiss={vi.fn()}>content</Sheet>);
    const bottomSection = bottom.container.querySelector('section')!;
    expect(bottomSection.hasAttribute('aria-labelledby')).toBe(false);
    expect(bottomSection.hasAttribute('aria-label')).toBe(false);

    const pane = render(
      <Sheet view="expanded" onDismiss={vi.fn()} presentation="pane">
        content
      </Sheet>,
    );
    const paneSection = pane.container.querySelector('section')!;
    expect(paneSection.hasAttribute('aria-labelledby')).toBe(false);
    expect(paneSection.hasAttribute('aria-label')).toBe(false);
  });
});

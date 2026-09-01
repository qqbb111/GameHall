import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickSpark, Reveal, SpotlightSurface } from './motion-primitives';

function installMatchMedia(matches: Record<string, boolean> = {}) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('motion primitives', () => {
  beforeEach(() => {
    installMatchMedia();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('Reveal 在内容进入视口后显示并清理观察器', () => {
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback = () => undefined;
    class MockIntersectionObserver {
      root = null;
      rootMargin = '';
      thresholds: number[] = [];
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    const rendered = render(<Reveal><span>牌桌内容</span></Reveal>);
    const host = screen.getByText('牌桌内容').parentElement!;
    expect(host).not.toHaveClass('is-visible');
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(host).toHaveClass('is-visible');
    expect(disconnect).toHaveBeenCalled();
    rendered.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('减少动态效果时 Reveal 立即显示，其他交互进入静态模式', () => {
    installMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    render(
      <>
        <Reveal><span>立即显示</span></Reveal>
        <SpotlightSurface><button type="button">聚光按钮</button></SpotlightSurface>
        <ClickSpark><button type="button">火花按钮</button></ClickSpark>
      </>,
    );
    expect(screen.getByText('立即显示').parentElement).toHaveClass('is-visible');
    expect(screen.getByRole('button', { name: '聚光按钮' }).parentElement).toHaveAttribute('data-motion', 'static');
    expect(screen.getByRole('button', { name: '火花按钮' }).parentElement).toHaveAttribute('data-motion', 'static');
  });

  it('明确忽略减少动态效果时仍启用显现、聚光和火花', () => {
    installMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    let callback: IntersectionObserverCallback = () => undefined;
    class MockIntersectionObserver {
      root = null;
      rootMargin = '';
      thresholds: number[] = [];
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(next: IntersectionObserverCallback) {
        callback = next;
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(
      <>
        <Reveal respectReducedMotion={false}><span>仍然显现</span></Reveal>
        <SpotlightSurface respectReducedMotion={false}><button type="button">持续聚光</button></SpotlightSurface>
        <ClickSpark respectReducedMotion={false}><button type="button">持续火花</button></ClickSpark>
      </>,
    );
    const reveal = screen.getByText('仍然显现').parentElement!;
    expect(reveal).not.toHaveClass('is-visible');
    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(reveal).toHaveClass('is-visible');
    expect(reveal).toHaveAttribute('data-reduced-motion', 'ignore');
    expect(screen.getByRole('button', { name: '持续聚光' }).parentElement).toHaveAttribute('data-motion', 'interactive');
    expect(screen.getByRole('button', { name: '持续火花' }).parentElement).toHaveAttribute('data-motion', 'interactive');
  });

  it('SpotlightSurface 跟随精细指针并在离开时复位', () => {
    render(<SpotlightSurface><button type="button">选择牌桌</button></SpotlightSurface>);
    const surface = screen.getByRole('button', { name: '选择牌桌' }).parentElement!;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => undefined,
    });
    fireEvent.pointerMove(surface, { clientX: 150, clientY: 25 });
    expect(surface).toHaveClass('is-tracking');
    expect(surface.style.getPropertyValue('--spot-x')).toBe('150px');
    fireEvent.pointerLeave(surface);
    expect(surface).not.toHaveClass('is-tracking');
    expect(surface.style.getPropertyValue('--tilt-x')).toBe('0deg');
  });

  it('粗指针设备关闭倾斜和火花交互', () => {
    installMatchMedia({ '(pointer: coarse)': true });
    render(
      <>
        <SpotlightSurface><button type="button">触屏聚光</button></SpotlightSurface>
        <ClickSpark><button type="button">触屏火花</button></ClickSpark>
      </>,
    );
    expect(screen.getByRole('button', { name: '触屏聚光' }).parentElement).toHaveAttribute('data-motion', 'static');
    expect(screen.getByRole('button', { name: '触屏火花' }).parentElement).toHaveAttribute('data-motion', 'static');
  });
});

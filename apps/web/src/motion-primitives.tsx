import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

type MotionStyle = CSSProperties & Record<`--${string}`, string>;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [query]);

  return matches;
}

export function Reveal({
  children,
  className = '',
  delayMs = 0,
  distance = 24,
  respectReducedMotion = true,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  distance?: number;
  respectReducedMotion?: boolean;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const shouldReduceMotion = respectReducedMotion && reducedMotion;
  const [visible, setVisible] = useState(() => shouldReduceMotion || typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    if (shouldReduceMotion || typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldReduceMotion]);

  const style: MotionStyle = {
    '--reveal-delay': `${Math.max(0, delayMs)}ms`,
    '--reveal-distance': `${distance}px`,
  };

  return (
    <div
      ref={elementRef}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
      data-reduced-motion={respectReducedMotion ? 'respect' : 'ignore'}
      style={style}
    >
      {children}
    </div>
  );
}

export function SpotlightSurface({
  children,
  className = '',
  color = 'rgba(240, 206, 139, 0.22)',
  tilt = true,
  respectReducedMotion = true,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  tilt?: boolean;
  respectReducedMotion?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const interactive = !(respectReducedMotion && reducedMotion) && !coarsePointer;

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  function resetSurface() {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      surface.style.setProperty('--spot-x', '50%');
      surface.style.setProperty('--spot-y', '50%');
      surface.style.setProperty('--tilt-x', '0deg');
      surface.style.setProperty('--tilt-y', '0deg');
      surface.style.setProperty('--parallax-x', '0px');
      surface.style.setProperty('--parallax-y', '0px');
      surface.classList.remove('is-tracking');
    });
  }

  function trackPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const normalizedX = rect.width ? x / rect.width - 0.5 : 0;
    const normalizedY = rect.height ? y / rect.height - 0.5 : 0;

    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      surface.style.setProperty('--spot-x', `${x}px`);
      surface.style.setProperty('--spot-y', `${y}px`);
      surface.style.setProperty('--tilt-x', tilt ? `${normalizedY * -4.5}deg` : '0deg');
      surface.style.setProperty('--tilt-y', tilt ? `${normalizedX * 5.5}deg` : '0deg');
      surface.style.setProperty('--parallax-x', `${normalizedX * 9}px`);
      surface.style.setProperty('--parallax-y', `${normalizedY * 7}px`);
      surface.classList.add('is-tracking');
    });
  }

  const style: MotionStyle = { '--spotlight-color': color };

  return (
    <div
      ref={surfaceRef}
      className={`spotlight-surface ${className}`.trim()}
      data-motion={interactive ? 'interactive' : 'static'}
      data-reduced-motion={respectReducedMotion ? 'respect' : 'ignore'}
      onPointerMove={trackPointer}
      onPointerLeave={resetSurface}
      style={style}
    >
      {children}
    </div>
  );
}

type Spark = {
  angle: number;
  bornAt: number;
  x: number;
  y: number;
};

export function ClickSpark({
  children,
  className = '',
  respectReducedMotion = true,
}: {
  children: ReactNode;
  className?: string;
  respectReducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const magnetFrameRef = useRef<number | null>(null);
  const sparksRef = useRef<Spark[]>([]);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const disabled = (respectReducedMotion && reducedMotion) || coarsePointer;

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (magnetFrameRef.current !== null) cancelAnimationFrame(magnetFrameRef.current);
    sparksRef.current = [];
  }, []);

  function magnet(event: ReactPointerEvent<HTMLSpanElement>) {
    if (disabled) return;
    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    const x = rect.width ? (event.clientX - rect.left) / rect.width - 0.5 : 0;
    const y = rect.height ? (event.clientY - rect.top) / rect.height - 0.5 : 0;
    if (magnetFrameRef.current !== null) cancelAnimationFrame(magnetFrameRef.current);
    magnetFrameRef.current = requestAnimationFrame(() => {
      host.style.setProperty('--magnet-x', `${x * 6}px`);
      host.style.setProperty('--magnet-y', `${y * 4}px`);
    });
  }

  function resetMagnet(event: ReactPointerEvent<HTMLSpanElement>) {
    const host = event.currentTarget;
    if (magnetFrameRef.current !== null) cancelAnimationFrame(magnetFrameRef.current);
    magnetFrameRef.current = requestAnimationFrame(() => {
      host.style.setProperty('--magnet-x', '0px');
      host.style.setProperty('--magnet-y', '0px');
    });
  }

  function draw(now: number) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const duration = 440;
    const live = sparksRef.current.filter((spark) => now - spark.bornAt < duration);
    sparksRef.current = live;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    context.save();
    context.scale(dpr, dpr);
    context.lineCap = 'round';

    for (const spark of live) {
      const progress = Math.min(1, (now - spark.bornAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const inner = 7 + eased * 9;
      const outer = inner + (1 - progress) * 11;
      const cosine = Math.cos(spark.angle);
      const sine = Math.sin(spark.angle);
      context.beginPath();
      context.moveTo(spark.x + cosine * inner, spark.y + sine * inner);
      context.lineTo(spark.x + cosine * outer, spark.y + sine * outer);
      context.strokeStyle = `rgba(240, 206, 139, ${1 - progress})`;
      context.lineWidth = 1.5;
      context.stroke();
    }
    context.restore();

    if (live.length) frameRef.current = requestAnimationFrame(draw);
    else frameRef.current = null;
  }

  function spark(event: ReactPointerEvent<HTMLSpanElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const host = event.currentTarget;
    if (!canvas) return;
    const rect = host.getBoundingClientRect();
    const padding = 26;
    const width = rect.width + padding * 2;
    const height = rect.height + padding * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${-padding}px`;
    canvas.style.top = `${-padding}px`;

    const now = performance.now();
    const originX = event.clientX - rect.left + padding;
    const originY = event.clientY - rect.top + padding;
    sparksRef.current.push(...Array.from({ length: 9 }, (_, index) => ({
      angle: (Math.PI * 2 * index) / 9,
      bornAt: now,
      x: originX,
      y: originY,
    })));
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  }

  return (
    <span
      className={`click-spark ${className}`.trim()}
      data-motion={disabled ? 'static' : 'interactive'}
      data-reduced-motion={respectReducedMotion ? 'respect' : 'ignore'}
      onPointerDown={spark}
      onPointerMove={magnet}
      onPointerLeave={resetMagnet}
    >
      {children}
      <canvas ref={canvasRef} aria-hidden="true" />
    </span>
  );
}

import { useEffect, useRef, useState } from "react";

/** Adds html.js-reveal once, then flips `.rv` elements to `.vis` as they enter view. */
export function useRevealObserver() {
  useEffect(() => {
    document.documentElement.classList.add("js-reveal");
    const els = Array.from(document.querySelectorAll<HTMLElement>(".rv"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("vis");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/** Counts up to `value` once the element scrolls into view. Always lands on the true value. */
export function useCountUp(value: number, durationMs = 1400) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries[0]?.isIntersecting) return;
        done = true;
        const start = performance.now();
        function tick(now: number) {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3);
          setDisplay(Math.round(value * eased));
          if (t < 1) requestAnimationFrame(tick);
          else setDisplay(value);
        }
        requestAnimationFrame(tick);
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, durationMs]);
  return { ref, display };
}

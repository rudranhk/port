import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { gsap } from "gsap";

/**
 * ImageRevealMask
 * -----------------------------------------------------------------------
 * Cursor-driven image mask reveal (Awwwards-style "brush" hover effect).
 *
 * Image1 (`baseSrc`) sits underneath and is always fully visible.
 * Image2 (`revealSrc`) sits on top, clipped to a soft, feathered,
 * rounded-rectangle "brush" via CSS `mask-image` + `mask-position`.
 * The brush shape itself is pre-rendered ONCE as an SVG data-URI
 * (a blurred rounded rect) — at runtime we only ever move it with
 * `mask-position`, never regenerate it, so there's no per-frame SVG/DOM
 * work, only compositor-friendly property updates.
 *
 * Usage:
 *   <ImageRevealMask
 *     baseSrc="/images/photo-1.jpg"
 *     revealSrc="/images/photo-2.jpg"
 *     baseAlt="Rudra"
 *     revealAlt="AI engineer concept"
 *     className="w-full aspect-[4/5] max-w-[640px]"
 *   />
 *
 * Drop your two images anywhere Vite/CRA/Next can serve them (e.g.
 * `public/images/...`) and point `baseSrc` / `revealSrc` at them.
 */
export default function ImageRevealMask({
  baseSrc,
  revealSrc,
  baseAlt = "",
  revealAlt = "",
  brushSize = 320, // px — diameter of the square mask "brush"
  radius = 24, // px — rounded-rect corner radius
  feather = 18, // px — blur amount for the soft edge
  className = "",
}) {
  const containerRef = useRef(null);
  const maskLayerRef = useRef(null); // the <img> that gets the mask applied
  const pos = useRef({ x: 0, y: 0 }); // GSAP-tweened brush center (local coords)
  const quickX = useRef(null);
  const quickY = useRef(null);
  const tickerFn = useRef(null);
  const idleTl = useRef(null);
  const hasInteracted = useRef(false);

  const [loaded, setLoaded] = useState(false);

  // --- Preload both images before ever painting, so there's never a
  //     frame where only one of the two is visible. ------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      [baseSrc, revealSrc].map(
        (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = resolve; // don't block forever on a bad URL
            img.src = src;
          })
      )
    ).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [baseSrc, revealSrc]);

  // --- Pre-bake the brush shape once: a blurred rounded-rect, encoded
  //     as an SVG data-URI. Only `mask-position` moves at runtime. ----
  const maskDataUri = useMemo(() => {
    const pad = feather * 2;
    const inner = brushSize - pad * 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${brushSize}' height='${brushSize}'>
      <filter id='f'><feGaussianBlur stdDeviation='${feather}'/></filter>
      <rect x='${pad}' y='${pad}' width='${inner}' height='${inner}' rx='${radius}' ry='${radius}' fill='#fff' filter='url(#f)'/>
    </svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }, [brushSize, radius, feather]);

  // --- Apply the current tweened position to the mask layer's style.
  //     This is the only thing that runs every animation frame. ------
  const render = useCallback(() => {
    const el = maskLayerRef.current;
    if (!el) return;
    const half = brushSize / 2;
    const value = `${pos.current.x - half}px ${pos.current.y - half}px`;
    el.style.maskPosition = value;
    el.style.webkitMaskPosition = value;
  }, [brushSize]);

  useEffect(() => {
    const container = containerRef.current;
    const maskLayer = maskLayerRef.current;
    if (!container || !maskLayer) return;

    // Start centered so the brush is never at (0,0) before first move.
    const rect = () => container.getBoundingClientRect();
    const r0 = rect();
    pos.current.x = r0.width / 2;
    pos.current.y = r0.height / 2;

    // gsap.quickTo gives cheap, reusable, inertia-smoothed interpolation
    // (lerp) toward whatever target we feed it — this is the "slight
    // inertia instead of snapping" requirement.
    quickX.current = gsap.quickTo(pos.current, "x", { duration: 0.5, ease: "power3" });
    quickY.current = gsap.quickTo(pos.current, "y", { duration: 0.5, ease: "power3" });

    // GSAP's ticker runs on requestAnimationFrame internally.
    tickerFn.current = render;
    gsap.ticker.add(tickerFn.current);
    render();

    function startIdleFloat() {
      const b = rect();
      idleTl.current = gsap.to(pos.current, {
        x: b.width / 2 + 24,
        y: b.height / 2 - 18,
        duration: 2.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    }

    function stopIdleFloat() {
      idleTl.current?.kill();
      idleTl.current = null;
    }

    function moveTo(clientX, clientY) {
      const b = rect();
      quickX.current(clientX - b.left);
      quickY.current(clientY - b.top);
    }

    function onPointerMove(e) {
      if (!hasInteracted.current) {
        hasInteracted.current = true;
        stopIdleFloat();
      }
      moveTo(e.clientX, e.clientY);
    }

    function onPointerEnter() {
      gsap.to(maskLayer, { scale: 1.06, duration: 0.6, ease: "power3.out" });
    }

    function onPointerLeave() {
      gsap.to(maskLayer, { scale: 1, duration: 0.6, ease: "power3.out" });
    }

    // Pointer Events unify mouse/touch/pen — for touch, "move" only
    // fires while the finger is actually dragging across the screen,
    // which already matches the "follow the finger while dragging" spec.
    container.addEventListener("pointermove", onPointerMove, { passive: true });
    container.addEventListener("pointerenter", onPointerEnter);
    container.addEventListener("pointerleave", onPointerLeave);

    // No pointer support at all (rare) → keep the gentle idle float.
    const supportsPointer = window.matchMedia("(pointer: fine), (pointer: coarse)").matches;
    if (!supportsPointer) startIdleFloat();

    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerenter", onPointerEnter);
      container.removeEventListener("pointerleave", onPointerLeave);
      if (tickerFn.current) gsap.ticker.remove(tickerFn.current);
      stopIdleFloat();
      quickX.current = null;
      quickY.current = null;
      gsap.killTweensOf(maskLayer);
      gsap.killTweensOf(pos.current);
    };
  }, [brushSize, render]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-[24px] bg-neutral-900 select-none touch-none ${className}`}
    >
      {/* Reserve the box before images arrive → no layout shift. */}
      <img
        src={baseSrc}
        alt={baseAlt}
        draggable={false}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      <img
        ref={maskLayerRef}
        src={revealSrc}
        alt={revealAlt}
        draggable={false}
        style={{
          maskImage: maskDataUri,
          WebkitMaskImage: maskDataUri,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskSize: `${brushSize}px ${brushSize}px`,
          WebkitMaskSize: `${brushSize}px ${brushSize}px`,
          willChange: "mask-position, transform",
        }}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />

      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-neutral-800" aria-hidden="true" />
      )}
    </div>
  );
}

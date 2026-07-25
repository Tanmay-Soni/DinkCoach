/**
 * Looping player for the composite "average dink" avatar.
 *
 *   <CompositeAvatarPlayer composite={asset} />
 *
 * Renders the volumetric mannequin frame-by-frame at the asset's fps, honoring
 * the live view's mirroring so left/right match the session. Recurring faults
 * highlight persistently (all at once). Respects prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react';
import { drawBodyFrame, drawGhostWireframe } from './avatarBodyRenderer.js';

export default function CompositeAvatarPlayer({
  composite,
  mirror = true,
  showFaults = true,
  ghostSequences = null,
  playing = true,
  speed = 1,
  className,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const cursorRef = useRef(0);
  const lastRef = useRef(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setDims({ width: rect.width, height: rect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !composite || !composite.frames || !composite.frames.length || !dims.width) {
      return undefined;
    }
    const ctx = canvas.getContext('2d');
    const { frames } = composite;
    const fps = composite.fps || 30;
    const highlightJoints = showFaults ? composite.highlightJoints || [] : [];

    function render(now) {
      const dt = now - (lastRef.current || now);
      lastRef.current = now;
      if (playing) {
        cursorRef.current = (cursorRef.current + (dt / 1000) * fps * speed) % frames.length;
      }
      const index = Math.floor(cursorRef.current);
      const frame = frames[index];

      ctx.clearRect(0, 0, dims.width, dims.height);

      if (ghostSequences) {
        for (const sequence of ghostSequences) {
          const ghostFrame = sequence[index];
          if (ghostFrame) {
            drawGhostWireframe(ctx, ghostFrame.kp, {
              width: dims.width,
              height: dims.height,
              mirror,
              alpha: 0.1,
            });
          }
        }
      }

      const pulse = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.abs(Math.sin(now / 520));
      drawBodyFrame(ctx, frame.keypoints, {
        width: dims.width,
        height: dims.height,
        mirror,
        highlightJoints,
        pulse,
      });

      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [composite, dims, playing, speed, mirror, showFaults, ghostSequences, reduceMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

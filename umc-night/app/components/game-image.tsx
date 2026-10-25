"use client";
import { useEffect, useReducer } from "react";
import { imageReadyEvent, preparedImage } from "../../lib/client-images";

export function GameImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const ready = (event: Event) => { if ((event as CustomEvent).detail === src) refresh(); };
    window.addEventListener(imageReadyEvent, ready);
    return () => window.removeEventListener(imageReadyEvent, ready);
  }, [src]);
  return <img key={src} src={preparedImage(src)?.src ?? src} alt={alt} className={className} decoding="sync" fetchPriority="high" />;
}

import React, { useState, useEffect } from 'react';
import type { DocImage } from '../../../shared/types';

interface DocImageEmbedProps {
  query: string;
  prefetchedImages?: DocImage[];
  onImagesLoaded?: (query: string, images: DocImage[]) => void;
}

export function DocImageEmbed({ query, prefetchedImages, onImagesLoaded }: DocImageEmbedProps) {
  const [images, setImages] = useState<DocImage[]>(prefetchedImages ?? []);
  const [isLoading, setIsLoading] = useState(!prefetchedImages || prefetchedImages.length === 0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (prefetchedImages && prefetchedImages.length > 0) {
      setImages(prefetchedImages);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    (window as any).electronAPI.docs
      .fetchImages(query)
      .then((result: DocImage[]) => {
        if (cancelled) return;
        setImages(result);
        setIsLoading(false);
        if (result.length > 0) onImagesLoaded?.(query, result);
      })
      .catch(() => {
        if (cancelled) return;
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, prefetchedImages]);

  if (isLoading) {
    return (
      <div
        className="my-3 rounded-xl border border-white/[0.12] overflow-hidden"
        style={{ maxWidth: '380px' }}
      >
        <div className="animate-pulse">
          <div className="bg-white/[0.05] h-44 w-full" />
          <div className="p-2.5 space-y-1.5 bg-white/[0.03]">
            <div className="h-3 bg-white/[0.08] rounded w-3/4" />
            <div className="h-2.5 bg-white/[0.05] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  // Silent failure - don't clutter the UI
  if (hasError || images.length === 0) return null;

  return (
    <>
      {images.map((img, i) => (
        <div
          key={i}
          className="my-3 rounded-xl border border-white/[0.12] hover:border-blue-400/40 overflow-hidden transition-all cursor-pointer group"
          style={{ maxWidth: '380px' }}
          onClick={() => window.open(img.pageUrl, '_blank')}
          title="View on docs.unrealengine.com"
        >
          <img
            src={img.imageUrl}
            alt={img.altText || query}
            className="w-full h-auto"
            style={{
              maxHeight: '240px',
              objectFit: 'contain',
              background: 'rgba(255,255,255,0.03)',
            }}
            onError={(e) => {
              const container = (e.currentTarget as HTMLElement).closest(
                '.rounded-xl'
              ) as HTMLElement | null;
              if (container) container.style.display = 'none';
            }}
          />
          <div className="p-2.5 bg-white/[0.04] flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/70 font-medium line-clamp-1">
                {img.pageTitle}
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                docs.unrealengine.com
              </p>
            </div>
            <svg
              className="w-3.5 h-3.5 text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0 ml-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        </div>
      ))}
    </>
  );
}

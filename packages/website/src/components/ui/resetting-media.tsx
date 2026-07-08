'use client';

import * as React from 'react';

interface ResettingGifProps extends React.HTMLAttributes<HTMLElement> {
  resetKey: React.Key;
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  unoptimized?: boolean;
}

const VIDEO_EXTENSIONS = /\.(webm|mp4|ogg)(\?.*)?$/i;

export const ResettingGif = React.forwardRef<HTMLImageElement | HTMLVideoElement, ResettingGifProps>(
  ({ resetKey, src, alt, fill, sizes, priority, unoptimized, className, style, ...props }, ref) => {
    const [mediaUrl, setMediaUrl] = React.useState<string | null>(null);
    const [isVisible, setIsVisible] = React.useState(false);
    const mediaRef = React.useRef<HTMLImageElement | HTMLVideoElement>(null);
    const isVideo = VIDEO_EXTENSIONS.test(src);

    React.useImperativeHandle(ref, () => mediaRef.current as HTMLImageElement | HTMLVideoElement);

    React.useEffect(() => {
      // Hide and clear immediately
      setIsVisible(false);
      setMediaUrl(null);

      // Create new URL with multiple cache busters to ensure uniqueness
      const newSrc = `${src}${src.includes('?') ? '&' : '?'}reset=${resetKey}&t=${Date.now()}&r=${Math.random()}`;

      // First timer: Set the new URL but keep hidden
      const loadTimer = setTimeout(() => {
        setMediaUrl(newSrc);

        // Second timer: Make visible after URL is set
        const showTimer = setTimeout(() => {
          setIsVisible(true);
        }, 50);

        return () => clearTimeout(showTimer);
      }, 100);

      return () => clearTimeout(loadTimer);
    }, [resetKey, src]);

    // Handle fill prop styling similar to Next.js Image component
    const imgStyle: React.CSSProperties = fill
      ? {
          position: 'absolute',
          height: '100%',
          width: '100%',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          objectFit: 'contain',
          ...style,
        }
      : style || {};

    // Don't render anything until we have a URL
    if (!mediaUrl || !isVisible) {
      return <div style={imgStyle} className={className} aria-hidden="true" />;
    }

    if (isVideo) {
      return (
        <video
          key={`${resetKey}-${mediaUrl}`}
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={mediaUrl}
          className={className}
          style={imgStyle}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-label={alt}
          {...(props as React.VideoHTMLAttributes<HTMLVideoElement>)}
        />
      );
    }

    return (
      <img
        key={`${resetKey}-${mediaUrl}`} // Double key for absolute remount
        ref={mediaRef as React.RefObject<HTMLImageElement>}
        src={mediaUrl}
        alt={alt}
        className={className}
        style={imgStyle}
        loading="eager" // Always eager to start loading immediately
        onLoad={() => {
          // Force the gif to start from beginning by triggering reflow
          if (mediaRef.current instanceof HTMLImageElement) {
            mediaRef.current.style.display = 'none';
            mediaRef.current.offsetHeight; // Trigger reflow
            mediaRef.current.style.display = '';
          }
        }}
        {...(props as React.ImgHTMLAttributes<HTMLImageElement>)}
      />
    );
  }
);

ResettingGif.displayName = 'ResettingGif';

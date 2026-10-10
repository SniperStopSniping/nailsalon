import type { ImgHTMLAttributes } from 'react';

export default function Image({ alt, src, className, fill, priority, style, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) {
  return <img {...props} fetchPriority={priority ? 'high' : undefined} alt={alt} src={src} className={className} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style} />;
}

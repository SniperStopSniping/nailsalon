import type { ImgHTMLAttributes } from 'react';

export default function Image({ alt, src, className, fill, priority: _priority, style, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) {
  // Next's priority prop preloads the image; it does not supply fetchPriority.
  // Forward the explicit HTML hint so the fixture cannot hide a missing hint.
  return <img {...props} alt={alt} src={src} className={className} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style} />;
}

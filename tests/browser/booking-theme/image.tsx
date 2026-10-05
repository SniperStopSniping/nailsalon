import type { ImgHTMLAttributes } from 'react';

export default function Image({ alt, src, className, fill, style, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) {
  return <img {...props} alt={alt} src={src} className={className} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style} />;
}

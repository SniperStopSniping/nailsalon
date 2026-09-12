import type { ImgHTMLAttributes } from 'react';

export default function Image({ alt, src, className }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img alt={alt} src={src} className={className} />;
}

export default function Image(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element -- Vite-only replacement for next/image.
  return <img alt="" {...props} />;
}

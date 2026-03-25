import '@/styles/global.css';

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="bg-background text-foreground antialiased"
        suppressHydrationWarning
      >
        {props.children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";

// Hardcoded pre-paint init: reads stored theme and stamps color-scheme +
// .dark class on <html> BEFORE the body renders, so Brave's "Force Dark
// Mode" filter sees we already handle both palettes and skips applying
// its own. Must be inline + sync — async would lose the race with paint.
const themeInitScript = `
  try {
    var t = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isDark = t === 'dark' || ((t === 'system' || !t) && prefersDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
`;

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inside Assistant",
  description: "AI-powered company assistant with persistent memory",
  applicationName: "Inside Assistant",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Inside Assistant" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#08090C" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Top progress bar on every nav — orange to match brand */}
        <NextTopLoader
          color="#F97316"
          height={2}
          showSpinner={false}
          speed={250}
          shadow="0 0 8px #F97316,0 0 4px #F97316"
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

import Script from 'next/script';

export const metadata: Metadata = {
  metadataBase: new URL('https://sulcus.ca'),
  title: {
    default: 'SULCUS — Thermodynamic Memory for AI Agents',
    template: '%s | SULCUS',
  },
  description: "SULCUS provides thermodynamic context management for LLMs, reducing token burn by 90% via intelligent memory paging.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon-192.png",
  },
  openGraph: {
    type: 'website',
    siteName: 'SULCUS',
    images: [{ url: '/og-image.png' }],
  },
  twitter: {
    card: 'summary_large_image',
  },
};

import { Providers } from "@/components/providers";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Google tag (gtag.js) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-RNE1KGGTGM"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-RNE1KGGTGM');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const SITE = "https://gsc.ajmalaksar.com";
const GITHUB = "https://github.com/ajmalaksar/gsc-mcp";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "gsc-mcp — Google Search Console as an SEO copilot for AI",
    template: "%s · gsc-mcp",
  },
  description:
    "An open-source MCP server that turns Google Search Console into an SEO copilot for Claude and any MCP client. Query analytics, diagnose indexing, audit pages, and surface opportunities — locally and privately.",
  keywords: [
    "Google Search Console",
    "MCP",
    "Model Context Protocol",
    "SEO",
    "Claude",
    "search analytics",
    "indexing",
  ],
  authors: [{ name: "Ajmal Aksar" }],
  openGraph: {
    type: "website",
    url: SITE,
    title: "gsc-mcp — Google Search Console as an SEO copilot for AI",
    description:
      "Turn Google Search Console into an SEO copilot for Claude and any MCP client. Local-first and private.",
    siteName: "gsc-mcp",
  },
  twitter: {
    card: "summary_large_image",
    title: "gsc-mcp — Google Search Console as an SEO copilot for AI",
    description:
      "Turn Google Search Console into an SEO copilot for Claude and any MCP client. Local-first and private.",
  },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE },
};

function Header() {
  return (
    <header className="site-header">
      <div className="container nav">
        <Link href="/" className="brand">
          <span className="dot" /> gsc-mcp
        </Link>
        <nav className="nav-links">
          <a href="#features">Features</a>
          <a href="#privacy">Privacy</a>
          <Link href="/privacy">Legal</Link>
          <a className="btn btn-primary" href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container foot">
        <span className="copy">© {2026} Ajmal Aksar · MIT licensed</span>
        <div className="links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

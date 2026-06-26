const GITHUB = "https://github.com/ajmalaksar25/gsc-mcp";

type Feature = { icon: string; title: string; body: string; status: "live" | "soon" };

const FEATURES: Feature[] = [
  {
    icon: "📊",
    title: "Search analytics, in plain language",
    body: "Clicks, impressions, CTR and position by any dimension and date range — plus top queries and pages.",
    status: "live",
  },
  {
    icon: "🎯",
    title: "Opportunity finder",
    body: "Striking-distance keywords (positions 5–20) and high-impression / low-CTR pages, ranked with a reason for each.",
    status: "live",
  },
  {
    icon: "🔎",
    title: "URL inspection",
    body: "Index status, coverage, canonical, last crawl and rich-result state for any URL — to diagnose why a page is or isn't indexed.",
    status: "live",
  },
  {
    icon: "🗂️",
    title: "Multi-site, one place",
    body: "Register friendly aliases, switch the active property in conversation, and get a portfolio view across every site you own.",
    status: "live",
  },
  {
    icon: "🧭",
    title: "Coverage report, reconstructed",
    body: "The 'Page indexing' buckets Google won't export in bulk — rebuilt URL-by-URL within quota: crawled-not-indexed, discovered, redirects, blocked.",
    status: "soon",
  },
  {
    icon: "🛠️",
    title: "On-page audits with fixes",
    body: "Fetch a live page and get concrete edits — titles, meta, canonical, Open Graph previews, structured data, alt text — not just a red X.",
    status: "soon",
  },
  {
    icon: "⚡",
    title: "Page speed & Core Web Vitals",
    body: "LCP, INP and CLS from real-user field data via PageSpeed Insights and CrUX, folded into your site's health.",
    status: "soon",
  },
  {
    icon: "📈",
    title: "SEO / E-E-A-T / GEO scores",
    body: "A prioritized 'fix these first' list and a generated report — including readiness to be cited by AI answer engines.",
    status: "soon",
  },
  {
    icon: "🖥️",
    title: "Local dashboard",
    body: "A private dashboard to see coverage, scores and audits at a glance — reading the same data your AI client does.",
    status: "soon",
  },
];

type Milestone = { phase: string; title: string; body: string; status: "shipped" | "building" | "planned" };

const ROADMAP: Milestone[] = [
  {
    phase: "Phase 1",
    title: "Core Search Console",
    body: "Search analytics, opportunity finder, URL inspection, sitemaps and multi-site — over MCP and the CLI.",
    status: "shipped",
  },
  {
    phase: "Phase 2",
    title: "Coverage reconstruction",
    body: "Rebuild the 'Page indexing' report Google won't export in bulk — cached, URL-by-URL, within quota.",
    status: "building",
  },
  {
    phase: "Phase 3",
    title: "On-page audits + page speed",
    body: "Fetch a live page for concrete fixes (titles, meta, Open Graph, structured data) plus Core Web Vitals from PageSpeed and CrUX.",
    status: "planned",
  },
  {
    phase: "Phase 4",
    title: "Scores & site report",
    body: "SEO, E-E-A-T and GEO scores with a prioritized, shareable report — your single source of truth.",
    status: "planned",
  },
  {
    phase: "Phase 5",
    title: "Local dashboard",
    body: "A private dashboard to see coverage, scores and audits at a glance — reading the same data your AI client does.",
    status: "planned",
  },
  {
    phase: "Phase 6",
    title: "One-click onboarding",
    body: "Hosted 'sign in with Google' and a one-click install, so anyone can connect their sites in seconds.",
    status: "planned",
  },
];

const STATUS_LABEL: Record<Milestone["status"], string> = {
  shipped: "Shipped",
  building: "In progress",
  planned: "Planned",
};

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>
            Google Search Console as an <span className="grad">SEO copilot</span> for AI.
          </h1>
          <p className="lead">
            gsc-mcp connects Search Console to Claude and any MCP client, so you can ask plain-language
            questions, diagnose indexing, and act on real opportunities — all running locally on your machine.
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href={GITHUB} target="_blank" rel="noopener noreferrer">
              View on GitHub →
            </a>
            <a className="btn" href="#features">
              What it does
            </a>
          </div>
          <pre className="code">
            <span className="c"># add it to Claude Code, then just ask</span>
            {"\n"}
            <span className="g">claude mcp add</span> gsc -- npx -y @ajmalaksar/gsc-mcp serve
            {"\n\n"}
            <span className="c"># &quot;which of my pages are losing clicks this month?&quot;</span>
          </pre>
        </div>
      </section>

      <section id="features">
        <div className="container">
          <div className="section-head">
            <span className="kicker">Capabilities</span>
            <h2>From raw Search Console data to decisions you can act on.</h2>
            <p>
              Search Console tells you <em>what</em> is happening. gsc-mcp is being built to also tell you{" "}
              <em>what to change</em> — and help your AI assistant do it with you.
            </p>
          </div>
          <div className="grid">
            {FEATURES.map((f) => (
              <div className="card" key={f.title}>
                <div className="ico">{f.icon}</div>
                <h3>
                  {f.title}
                  <span className={`badge ${f.status}`}>{f.status === "live" ? "Available" : "Roadmap"}</span>
                </h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roadmap" style={{ borderTop: "1px solid var(--border-soft)" }}>
        <div className="container">
          <div className="section-head">
            <span className="kicker">Roadmap</span>
            <h2>What&apos;s shipped, and what&apos;s coming.</h2>
            <p>Built in public, one phase at a time — Phase 1 is live today.</p>
          </div>
          <ol className="timeline">
            {ROADMAP.map((m) => (
              <li className={`tl-item ${m.status}`} key={m.phase}>
                <span className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-head">
                    <span className="tl-phase">{m.phase}</span>
                    <span className={`badge ${m.status === "planned" ? "soon" : "live"}`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                  </div>
                  <h3>{m.title}</h3>
                  <p>{m.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="local-first" style={{ borderTop: "1px solid var(--border-soft)" }}>
        <div className="container split">
          <div className="section-head">
            <span className="kicker">Local-first &amp; private</span>
            <h2>Your data never leaves your machine.</h2>
            <p>
              gsc-mcp runs as a local server. You sign in with your own Google account; the token is stored only
              on your device. We never receive, store, or see your Search Console data.
            </p>
          </div>
          <div className="panel-quote">
            <ul>
              <li>Read-only access — the <code>webmasters.readonly</code> scope, nothing more.</li>
              <li>OAuth tokens stored locally at <code>~/.gsc-mcp</code>, never transmitted to us.</li>
              <li>No hosted backend, no data warehouse — each user runs their own.</li>
              <li>Open source and MIT licensed — read every line.</li>
            </ul>
          </div>
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--border-soft)", textAlign: "center" }}>
        <div className="container">
          <h2 style={{ letterSpacing: "-0.02em" }}>Built in public.</h2>
          <p style={{ color: "var(--muted)", maxWidth: "52ch", margin: "12px auto 28px" }}>
            Phase 1 is live; coverage reconstruction, on-page audits, scoring and the dashboard are landing next.
            Follow along or contribute.
          </p>
          <a className="btn btn-primary" href={GITHUB} target="_blank" rel="noopener noreferrer">
            Star the repo →
          </a>
        </div>
      </section>
    </>
  );
}

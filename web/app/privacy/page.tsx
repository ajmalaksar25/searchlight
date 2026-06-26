import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How gsc-mcp handles your data: local-first, read-only, and never transmitted to us.",
  alternates: { canonical: "https://gsc.ajmalaksar.com/privacy" },
};

export default function Privacy() {
  return (
    <article className="prose container">
      <h1>Privacy Policy</h1>
      <p className="updated">Last updated: June 27, 2026</p>

      <p>
        This Privacy Policy describes how the <strong>gsc-mcp</strong> software (the &quot;Software&quot;) and the
        website at <code>gsc.ajmalaksar.com</code> (the &quot;Site&quot;) handle information. gsc-mcp is an
        open-source project maintained by Ajmal Aksar (&quot;we&quot;, &quot;us&quot;).
      </p>

      <div className="callout">
        <strong>The short version:</strong> gsc-mcp runs locally on your own device. You sign in with your own
        Google account, and your access tokens and Search Console data stay on your machine. We do not receive,
        store, transmit, or have any access to your Search Console data.
      </div>

      <h2>1. How the Software works</h2>
      <p>
        gsc-mcp is a local Model Context Protocol (MCP) server that you install and run on your own computer. It
        communicates directly between your machine and Google&apos;s APIs. There is no gsc-mcp server, backend, or
        database operated by us that your data passes through.
      </p>

      <h2>2. Google account data we access</h2>
      <p>
        When you choose to connect Google Search Console, Google asks you to grant the read-only scope{" "}
        <code>https://www.googleapis.com/auth/webmasters.readonly</code>. With your authorization, the Software
        reads your Search Console data (such as search analytics, sitemaps, URL inspection results, and the list of
        properties you own) <strong>solely to display and analyze it for you</strong> inside your own AI client or
        terminal. This processing happens locally on your device.
      </p>
      <p>
        We request read-only access only. The Software does not modify your site or your Search Console settings
        under this scope.
      </p>

      <h2>3. Authentication tokens</h2>
      <p>
        After you sign in, Google issues OAuth tokens. These tokens are stored only on your own device (by default
        under <code>~/.gsc-mcp/</code>, with restricted file permissions) and are used to refresh access
        automatically. They are never sent to us or to any third party other than Google.
      </p>

      <h2>4. Limited Use disclosure</h2>
      <p>
        gsc-mcp&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Specifically, Google user data is used only to provide and
        improve the user-facing features described above; it is processed locally on your device; it is not
        transferred to us; and it is never sold, used for advertising, or used to train generalized AI/ML models.
      </p>

      <h2>5. The website</h2>
      <p>
        The Site is an informational page about the project. It does not ask you to log in and never has access to
        your Google account or Search Console data. The Site may collect anonymous, aggregated traffic statistics
        (such as page views) to understand general usage; this does not identify you personally.
      </p>

      <h2>6. Data sharing</h2>
      <p>
        We do not sell, rent, or share your personal information or Google user data. Because your data does not
        reach us in the first place, there is nothing for us to share.
      </p>

      <h2>7. Security</h2>
      <p>
        Your tokens and data reside on your own device under your control. We recommend keeping your operating
        system and the Software up to date. You can revoke gsc-mcp&apos;s access at any time at{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>{" "}
        and remove the local token with <code>gsc-mcp logout</code>.
      </p>

      <h2>8. Children</h2>
      <p>The Software and Site are not directed to children under 16, and we do not knowingly collect their data.</p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy as the project evolves. Material changes will be reflected here with an updated
        date.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about this policy? Email{" "}
        <a href="mailto:ajmalaksar25@gmail.com">ajmalaksar25@gmail.com</a>.
      </p>
    </article>
  );
}

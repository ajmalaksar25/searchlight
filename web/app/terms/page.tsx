import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing use of the gsc-mcp software and website.",
  alternates: { canonical: "https://gsc.ajmalaksar.com/terms" },
};

export default function Terms() {
  return (
    <article className="prose container">
      <h1>Terms of Service</h1>
      <p className="updated">Last updated: June 27, 2026</p>

      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the <strong>gsc-mcp</strong> software (the
        &quot;Software&quot;) and the website at <code>gsc.ajmalaksar.com</code> (the &quot;Site&quot;), maintained
        by Ajmal Aksar (&quot;we&quot;, &quot;us&quot;). By installing or using the Software or Site, you agree to
        these Terms.
      </p>

      <h2>1. The service</h2>
      <p>
        gsc-mcp is open-source software that runs locally on your device and connects your Google Search Console
        account to AI clients via the Model Context Protocol. The Site provides information about the project.
      </p>

      <h2>2. License</h2>
      <p>
        The Software is released under the MIT License. Your use, modification, and distribution of the source code
        are governed by that license, which is included with the Software. These Terms cover your use of the
        project and Site more generally.
      </p>

      <h2>3. Your Google account and third-party services</h2>
      <p>
        You are responsible for your own Google Cloud and Google Search Console accounts and for complying with
        Google&apos;s applicable terms and policies. gsc-mcp is an independent open-source project and is{" "}
        <strong>not affiliated with, endorsed by, or sponsored by Google</strong>. &quot;Google&quot;, &quot;Google
        Search Console&quot;, and related marks belong to Google LLC.
      </p>

      <h2>4. Acceptable use</h2>
      <p>
        You agree to use the Software only with accounts and properties you are authorized to access, and not to
        use it to violate any law or any third party&apos;s rights, or to exceed or abuse API rate limits.
      </p>

      <h2>5. No warranty</h2>
      <p>
        The Software and Site are provided <strong>&quot;as is&quot;</strong>, without warranty of any kind, express
        or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not
        warrant that the Software will be uninterrupted, error-free, or that any SEO outcome will result from its
        use.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, we will not be liable for any indirect, incidental, special,
        consequential, or exemplary damages, or any loss of data, profits, or rankings, arising from your use of
        the Software or Site.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these Terms as the project evolves. Continued use after changes constitutes acceptance of the
        revised Terms.
      </p>

      <h2>8. Governing law</h2>
      <p>
        These Terms are governed by the laws of India, without regard to its conflict-of-laws principles.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these Terms? Email <a href="mailto:ajmalaksar25@gmail.com">ajmalaksar25@gmail.com</a>.
      </p>
    </article>
  );
}

import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Privacy Policy - Budgero',
  description:
    'How Budgero collects, uses, and shares personal data — and the rights you have under GDPR, UK GDPR, and CCPA. Plain English, with the legal terms preserved where they matter.',
  alternates: { canonical: 'https://budgero.app/privacy' },
  openGraph: {
    title: 'Privacy Policy - Budgero',
    description:
      'How Budgero collects, uses, and shares personal data, and the rights you have under GDPR and CCPA.',
    url: 'https://budgero.app/privacy',
  },
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 dark:from-black dark:via-gray-900/50 dark:to-gray-800">
      <div className="container mx-auto px-4 pt-24 md:pt-28 pb-16 max-w-4xl">
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl p-8 shadow-2xl border border-white/50 dark:border-gray-700/50">
          <h1 className="text-4xl font-black text-gray-900 dark:text-white mb-2">Privacy Policy</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-1">
            <strong>Last updated:</strong> 29 April 2026
          </p>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            <strong>Effective:</strong> 29 April 2026
          </p>

          <div className="prose prose-lg dark:prose-invert max-w-none prose-table:text-sm prose-th:text-left prose-th:bg-gray-100 dark:prose-th:bg-gray-900/40 prose-td:align-top prose-headings:scroll-mt-24">
            <p>
              This Privacy Policy explains what personal data Budgero collects, how it&apos;s used
              and shared, and the rights you have under applicable privacy laws — primarily the
              EU/UK General Data Protection Regulation (GDPR / UK GDPR) and the California
              Consumer Privacy Act / California Privacy Rights Act (CCPA / CPRA).
            </p>
            <p>
              It&apos;s written in plain English. Where a section matters legally — like lawful
              bases or your rights — the legal terms are preserved so you can compare it against
              the regulations. If anything is unclear, email{' '}
              <a href="mailto:privacy@budgero.app">
                <strong>privacy@budgero.app</strong>
              </a>
              .
            </p>
            <hr />

            <h2>1. Who we are</h2>
            <p>
              Budgero is the &ldquo;data controller&rdquo; for the personal data processed through
              the service for the purposes of GDPR.
            </p>
            <p>
              <strong>Privacy contact:</strong>{' '}
              <a href="mailto:privacy@budgero.app">privacy@budgero.app</a>
              <br />
              <strong>General contact:</strong>{' '}
              <a href="mailto:hello@budgero.app">hello@budgero.app</a>
            </p>
            <p>
              At Budgero&apos;s current scale (small user base, no special-category data, no
              large-scale monitoring), GDPR Art. 27&apos;s exemption from the EU-representative
              requirement applies — processing is occasional, not large-scale, and not high-risk.
              If the project grows past that threshold, an EU representative will be appointed and
              this policy updated. The same applies to a UK representative under UK GDPR Art. 27.
            </p>

            <hr />

            <h2>2. The short version</h2>
            <ul>
              <li>
                <strong>Your financial data is end-to-end encrypted.</strong> Transactions,
                budgets, balances, categories, and notes are encrypted on your device with a key
                derived from your password. Nobody — not Budgero, not its providers, not an
                attacker, not a government — can read them. This is the part of Budgero called
                zero-knowledge.
              </li>
              <li>
                <strong>The rest is normal SaaS data.</strong> Running the service still requires
                an email and password (handled by an auth provider), billing details (handled by a
                payments provider), product analytics (handled by an EU analytics provider), and
                email logs (handled by an email provider). For shared workspaces, the display name
                you give a workspace and the email addresses of people you invite are also stored
                in plaintext so that collaboration can work — see §3.2 for the precise carve-out.
                The full list is in §6 below.
              </li>
              <li>
                <strong>Personal data is never sold.</strong> Budgero doesn&apos;t share data with
                advertisers in any way that GDPR or the CCPA defines as a &ldquo;sale&rdquo; or
                &ldquo;share.&rdquo; The only third-party advertising tag — Google Ads — only
                loads after you accept it via the cookie banner.
              </li>
              <li>
                <strong>You have full rights</strong> under GDPR / UK GDPR / CCPA, including the
                right to access, correct, delete, and export your data, and to complain to your
                local data-protection authority. See §10.
              </li>
              <li>
                <strong>Cookies and trackers</strong> require your consent. The &ldquo;Manage
                cookies&rdquo; link in the footer of every page lets you change your choice at any
                time.
              </li>
            </ul>

            <hr />

            <h2>3. What personal data is collected</h2>

            <h3>3.1 Account data</h3>
            <ul>
              <li>Email address</li>
              <li>
                Password — never stored in plain text; hashed and salted by the authentication
                provider (Clerk)
              </li>
              <li>Account preferences and settings</li>
              <li>A unique account identifier (Clerk user ID)</li>
            </ul>

            <h3>3.2 Encrypted vault data (zero-knowledge — unreadable by Budgero)</h3>
            <ul>
              <li>Transactions, budgets, balances, categories, notes, spending data</li>
              <li>Encrypted on your device with AES-256 using a key derived from your password</li>
              <li>Only the resulting ciphertext is stored on the server</li>
            </ul>
            <p>
              <strong>What zero-knowledge does <em>not</em> cover.</strong> To make shared
              workspaces and real-time sync work, Budgero stores a small amount of collaboration
              metadata on the server in plaintext: the display name you give to a workspace, the
              email addresses of people you&apos;ve invited to it, membership roles, and sync
              version numbers. Push-notification payloads themselves are encrypted; only the
              account and workspace identifiers needed to route them are stored in plaintext.
              This metadata never includes any of the financial content listed above — your
              transactions, balances, and categories remain unreadable by Budgero.
            </p>

            <h3>3.3 Billing and subscription data</h3>
            <ul>
              <li>Plan, price, currency, subscription status, renewal date, country (for tax)</li>
              <li>Order ID, last four digits of payment method (where provided to us)</li>
              <li>
                Full payment-instrument data (card number, etc.) is collected and held by the
                payments provider (LemonSqueezy), <strong>not</strong> by Budgero
              </li>
            </ul>

            <h3>3.4 Service-email metadata</h3>
            <ul>
              <li>
                Send/open/bounce events for transactional emails (welcome, trial-ended, inactivity,
                password reset, billing receipts)
              </li>
            </ul>

            <h3>3.5 Product analytics (pseudonymous)</h3>
            <ul>
              <li>Page URLs, screen size, browser, operating system, referrer</li>
              <li>
                IP address — used at request time for coarse geolocation and abuse-prevention,
                then discarded server-side. It is not retained alongside the analytics events.
              </li>
              <li>
                Event names — for example <code>Checkout Started</code>, <code>Purchase</code>,{' '}
                <code>Subscription Canceled</code>, <code>Trial Started</code>
              </li>
              <li>
                Event properties for commercial events only — plan, amount, currency, the
                cancellation reason you provide
              </li>
              <li>
                A pseudonymous user identifier (your Clerk user ID), so events from the same
                account can be correlated across sessions
              </li>
              <li>
                <strong>No</strong> session recording, autocapture, heatmaps, or surveys
              </li>
            </ul>

            <h3>3.6 Marketing analytics — consent-gated</h3>
            <ul>
              <li>
                If — and only if — you accept the &ldquo;Marketing&rdquo; category in the cookie
                banner: a Google Ads click identifier (<code>gclid</code>), a conversion event,
                and the aggregate identifiers Google&apos;s tag (<code>gtag</code>) collects (IP,
                browser, page URL)
              </li>
              <li>If you decline or ignore the banner, none of this is collected</li>
            </ul>

            <h3>3.7 Server / security logs</h3>
            <ul>
              <li>
                Request logs from the hosting provider — IP address, timestamp, request path,
                response status, user agent — used for service operation, security, and
                abuse-prevention
              </li>
            </ul>

            <p>
              <strong>Not collected:</strong> financial-account credentials (Budgero doesn&apos;t
              connect to banks), location data beyond IP-based country, contacts, photos,
              microphone, or any of the special categories of personal data listed in GDPR Art. 9.
            </p>

            <hr />

            <h2>4. Why it&apos;s used, and on what lawful basis</h2>
            <p>
              For users in the EU/UK, Budgero identifies a lawful basis for each processing
              purpose under GDPR Art. 6:
            </p>

            <table>
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th>Categories of data</th>
                  <th>Lawful basis (GDPR Art. 6)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    Provide the Budgero service (account creation, login, sync, vault storage)
                  </td>
                  <td>Account data, encrypted vault data</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>Take payment and manage your subscription</td>
                  <td>Billing &amp; subscription data</td>
                  <td>Performance of a contract — Art. 6(1)(b)</td>
                </tr>
                <tr>
                  <td>
                    Send service emails (welcome, trial-ended, inactivity, security, billing
                    receipts)
                  </td>
                  <td>Email + send/open/bounce metadata</td>
                  <td>
                    Performance of a contract — Art. 6(1)(b); legitimate interest in keeping you
                    informed about your account — Art. 6(1)(f)
                  </td>
                </tr>
                <tr>
                  <td>Comply with tax, accounting, and other statutory obligations</td>
                  <td>Billing &amp; subscription data</td>
                  <td>Legal obligation — Art. 6(1)(c)</td>
                </tr>
                <tr>
                  <td>Detect, investigate, and prevent abuse, fraud, and security incidents</td>
                  <td>Server logs, IP, account data</td>
                  <td>
                    Legitimate interest in protecting the service and its users — Art. 6(1)(f)
                  </td>
                </tr>
                <tr>
                  <td>
                    Product analytics — understanding what features get used and where users drop
                    off
                  </td>
                  <td>Pseudonymous analytics events (§3.5)</td>
                  <td>
                    Legitimate interest in improving the product — Art. 6(1)(f). You can object at
                    any time (see §10).
                  </td>
                </tr>
                <tr>
                  <td>
                    Marketing analytics — measuring the effectiveness of paid acquisition campaigns
                  </td>
                  <td>Google Ads click ID, conversion event, gtag aggregate data</td>
                  <td>
                    Consent — Art. 6(1)(a). Collected only after you accept the
                    &ldquo;Marketing&rdquo; category in the cookie banner. You can withdraw consent
                    at any time via &ldquo;Manage cookies.&rdquo;
                  </td>
                </tr>
              </tbody>
            </table>

            <p>
              Where Budgero relies on legitimate interest, the balance between that interest and
              your rights has been considered. If you&apos;d like to talk through the reasoning
              for any specific case, email <a href="mailto:privacy@budgero.app">privacy@budgero.app</a>.
            </p>

            <hr />

            <h2>5. How long it&apos;s kept</h2>

            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Account data (email, account ID, preferences)</td>
                  <td>
                    For the life of your account, plus up to 30 days after deletion to allow for
                    recovery and to flush backups
                  </td>
                </tr>
                <tr>
                  <td>Encrypted vault data</td>
                  <td>
                    For the life of your account; deleted within 30 days of account deletion
                    (Budgero cannot read it at any point)
                  </td>
                </tr>
                <tr>
                  <td>Billing records (orders, invoices)</td>
                  <td>
                    Retained as required by applicable tax and accounting law (typically 5–10
                    years); after that, deleted
                  </td>
                </tr>
                <tr>
                  <td>Service-email send/open/bounce metadata</td>
                  <td>
                    Up to 90 days in the email provider, then deleted
                  </td>
                </tr>
                <tr>
                  <td>Product-analytics events (pseudonymous)</td>
                  <td>
                    Up to 6 months in the analytics provider
                  </td>
                </tr>
                <tr>
                  <td>Product-analytics person profiles</td>
                  <td>
                    Up to 12 months of inactivity, then deleted
                  </td>
                </tr>
                <tr>
                  <td>Marketing-analytics data (Google Ads)</td>
                  <td>
                    Per Google Ads&apos; default retention; you can request earlier deletion via
                    the rights described in §10
                  </td>
                </tr>
                <tr>
                  <td>Server / security logs</td>
                  <td>
                    Up to 30 days for routine operations; up to 1 year for entries flagged as
                    security-relevant
                  </td>
                </tr>
              </tbody>
            </table>

            <p>
              When you delete your account, the data above is deleted or anonymized on the
              schedules listed, except where Budgero is legally required to retain it (e.g. tax
              records).
            </p>

            <hr />

            <h2>6. Who it&apos;s shared with (Sub-processors)</h2>
            <p>
              Personal data is <strong>never sold or rented</strong>. Limited personal data is
              shared with the service providers listed below, who act on Budgero&apos;s
              instructions under written contracts (Data Processing Agreements where the provider
              offers them). Each provider&apos;s standard contractual terms are reviewed before
              they are added.
            </p>

            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Role</th>
                  <th>Personal data shared</th>
                  <th>Region</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Clerk</strong>
                  </td>
                  <td>Authentication and account management</td>
                  <td>Email, password (hashed), account ID</td>
                  <td>EU residency configured</td>
                </tr>
                <tr>
                  <td>
                    <strong>PostHog Cloud EU</strong>
                  </td>
                  <td>Product analytics</td>
                  <td>Pseudonymous events (§3.5), IP, account ID</td>
                  <td>EU</td>
                </tr>
                <tr>
                  <td>
                    <strong>LemonSqueezy</strong>
                  </td>
                  <td>Payments and subscription billing</td>
                  <td>Email, billing address, plan, payment-instrument data</td>
                  <td>US (with SCCs)</td>
                </tr>
                <tr>
                  <td>
                    <strong>Resend</strong>
                  </td>
                  <td>Transactional email delivery</td>
                  <td>Email address, message content of service emails</td>
                  <td>EU / US (with SCCs)</td>
                </tr>
                <tr>
                  <td>
                    <strong>Google Ads (gtag)</strong> <em>(consent-gated)</em>
                  </td>
                  <td>Marketing-analytics conversion tracking</td>
                  <td>Click ID, conversion event, IP, browser</td>
                  <td>US (with SCCs)</td>
                </tr>
                <tr>
                  <td>
                    <strong>Hosting provider</strong>
                  </td>
                  <td>Application hosting and server logs</td>
                  <td>All data above transits or is logged here at the network level</td>
                  <td>EU</td>
                </tr>
              </tbody>
            </table>

            <p>
              Budgero may also disclose personal data to:
            </p>
            <ul>
              <li>
                <strong>Professional advisers</strong> (lawyers, accountants) under duties of
                confidentiality, when required;
              </li>
              <li>
                <strong>Law-enforcement or regulators</strong> where compelled by valid legal
                process — in which case, where lawful, you&apos;ll be notified.
              </li>
            </ul>

            <hr />

            <h2>7. International transfers</h2>
            <p>
              Some of the providers in §6 process personal data outside the European Economic
              Area — primarily in the United States.
            </p>
            <p>
              For provider transfers outside the EEA (e.g. LemonSqueezy, Resend US region, Google
              Ads), Budgero relies on the provider&apos;s European Commission{' '}
              <strong>Standard Contractual Clauses (SCCs, 2021 version)</strong> and equivalent
              UK addenda where applicable. Vault data remains end-to-end encrypted across all
              providers and is unreadable by anyone other than you.
            </p>

            <hr />

            <h2>8. Cookies and tracking</h2>
            <p>
              No non-essential cookies or third-party scripts (including Google Ads) load until
              you accept them via the consent banner. The categories are:
            </p>
            <ul>
              <li>
                <strong>Strictly necessary</strong> — required to log you in and keep the site
                working. Always on; cannot be disabled.
              </li>
              <li>
                <strong>Analytics</strong> — pseudonymous product-usage analytics (PostHog Cloud
                EU). Treated as legitimate interest in the EU/UK; you can opt out via &ldquo;Manage
                cookies&rdquo; or via Settings → Security &amp; Privacy in the app.
              </li>
              <li>
                <strong>Marketing</strong> — Google Ads conversion tag. Off by default. Loaded
                only after you click Accept on the relevant banner category.
              </li>
            </ul>
            <p>
              You can change your choice at any time via the <strong>Manage cookies</strong> link
              in the footer of every page on{' '}
              <a href="https://budgero.app">https://budgero.app</a>.
            </p>

            <hr />

            <h2>9. How data is secured</h2>
            <ul>
              <li>
                <strong>End-to-end encryption</strong> for vault data — AES-256 with a key derived
                from your password on your device. The key is never seen by Budgero, and plaintext
                vault data is never seen by Budgero.
              </li>
              <li>
                <strong>TLS 1.2+</strong> for all data in transit.
              </li>
              <li>
                <strong>Encryption at rest</strong> at the database and storage layers.
              </li>
              <li>
                <strong>Single-operator access controls.</strong> Only the operator has
                administrative access; that access is used solely to run the service.
              </li>
              <li>
                <strong>Vendor due diligence</strong> when choosing each provider in §6.
              </li>
              <li>
                <strong>Breach response</strong> — if a personal-data breach occurs that&apos;s
                likely to result in risk to your rights, the relevant supervisory authority will
                be notified within 72 hours of becoming aware (GDPR Art. 33), and affected users
                notified without undue delay where the risk is high (Art. 34).
              </li>
            </ul>
            <p>
              Important caveat: zero-knowledge means{' '}
              <strong>your vault cannot be recovered if you forget your password.</strong> Store
              it somewhere safe — a password manager is the standard answer.
            </p>

            <hr />

            <h2>10. Your rights</h2>
            <p>Wherever you live, you can:</p>
            <ul>
              <li>
                <strong>Access</strong> the personal data Budgero holds about you — request a copy
              </li>
              <li>
                <strong>Correct</strong> inaccurate personal data (rectification)
              </li>
              <li>
                <strong>Delete</strong> your account and associated personal data (&ldquo;right to
                erasure&rdquo;) — subject to legal-retention exceptions
              </li>
              <li>
                <strong>Export</strong> your data in a portable, machine-readable format (data
                portability)
              </li>
              <li>
                <strong>Restrict</strong> processing while a dispute is resolved
              </li>
              <li>
                <strong>Object</strong> to processing based on legitimate interest, including
                analytics
              </li>
              <li>
                <strong>Withdraw consent</strong> at any time for anything processed on the basis
                of consent (e.g. marketing analytics) — withdrawal does not affect the lawfulness
                of processing before the withdrawal
              </li>
              <li>
                <strong>Not be subject to automated decisions</strong> that produce legal or
                similarly significant effects — Budgero does not perform such automated
                decision-making
              </li>
            </ul>
            <p>
              To exercise any of these, email{' '}
              <a href="mailto:privacy@budgero.app">
                <strong>privacy@budgero.app</strong>
              </a>
              . Requests will be answered as fast as possible, and within{' '}
              <strong>30 days</strong> as required by GDPR (extendable by up to 60 days for
              complex requests, with notice).
            </p>
            <p>
              You can also <strong>lodge a complaint with a supervisory authority</strong>:
            </p>
            <ul>
              <li>
                EU/EEA residents: with the data-protection authority of your habitual residence,
                place of work, or place of the alleged infringement. A list is published by the
                EDPB at{' '}
                <a href="https://edpb.europa.eu" target="_blank" rel="noopener noreferrer">
                  https://edpb.europa.eu
                </a>
                .
              </li>
              <li>
                UK residents: the Information Commissioner&apos;s Office at{' '}
                <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">
                  https://ico.org.uk
                </a>
                .
              </li>
            </ul>

            <hr />

            <h2>11. California residents (CCPA / CPRA notice)</h2>
            <p>
              If you&apos;re a California resident, this section gives you additional disclosures
              required by the California Consumer Privacy Act, as amended.
            </p>
            <p>
              <strong>Categories of personal information collected,</strong> mapped to the CCPA
              categories: identifiers (email, account ID, IP), commercial information (subscription
              plan), internet/network activity (analytics events, server logs), inferences (none).
              These are collected for the business purposes described in §4.
            </p>
            <p>
              <strong>Sources:</strong> directly from you, from your device, and from service
              providers.
            </p>
            <p>
              <strong>Disclosure for a business purpose:</strong> only to the service providers in
              §6.
            </p>
            <p>
              <strong>Sale or sharing of personal information:</strong>{' '}
              <strong>Personal information is not sold or shared</strong> as those terms are
              defined in the CCPA. Budgero does not engage in cross-context behavioural
              advertising. The Google Ads conversion tag described in §3.6 fires only on consent
              and only sends conversion signals — not user identifiers — for measurement of
              campaigns Budgero runs.
            </p>
            <p>
              Because nothing is sold or shared, no &ldquo;Do Not Sell or Share My Personal
              Information&rdquo; link is provided. You can still exercise the rights to know,
              correct, delete, and limit the use of sensitive PI by contacting{' '}
              <a href="mailto:privacy@budgero.app">privacy@budgero.app</a>.
            </p>
            <p>
              Sensitive personal information is not used or disclosed for purposes other than those
              identified in CPRA §7027(m).
            </p>
            <p>You will not be discriminated against for exercising your rights.</p>

            <hr />

            <h2>12. Children&apos;s privacy</h2>
            <p>
              Budgero is not directed to and may not be used by individuals under the age of 16,
              or under the local digital-consent age where it is higher. Personal data is not
              knowingly collected from children. If you believe a child has provided personal data,
              email <a href="mailto:privacy@budgero.app">privacy@budgero.app</a> and it will be
              deleted.
            </p>

            <hr />

            <h2>13. Changes to this policy</h2>
            <p>
              This policy may be updated as the service or the law changes. The &ldquo;Last
              updated&rdquo; date at the top of this page will reflect the latest revision. For
              material changes affecting how personal data is used, you&apos;ll be notified by
              email before the change takes effect.
            </p>

            <hr />

            <h2>14. Contact</h2>
            <ul>
              <li>
                Privacy questions and rights requests:{' '}
                <a href="mailto:privacy@budgero.app">
                  <strong>privacy@budgero.app</strong>
                </a>
              </li>
              <li>
                General support:{' '}
                <a href="mailto:hello@budgero.app">
                  <strong>hello@budgero.app</strong>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

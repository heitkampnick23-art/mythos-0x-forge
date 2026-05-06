import { LegalLayout } from './LegalLayout';

export function Privacy({ onBack }: { onBack: () => void }) {
  return (
    <LegalLayout title="Privacy Policy" effective="May 6, 2026" onBack={onBack}>
      <Section title="What we collect">
        <ul>
          <li>
            <strong>Account info:</strong> email address (when you sign in), Stripe customer ID
            (when you subscribe).
          </li>
          <li>
            <strong>Uploaded media:</strong> images and short videos you submit for analysis. Held
            ephemerally in object storage; auto-purged within 30 days.
          </li>
          <li>
            <strong>Analysis records:</strong> verdict, confidence score, model tag, timestamp.
            Retained for service operation, history display, and abuse review.
          </li>
          <li>
            <strong>Operational logs:</strong> request paths, status codes, IP-derived per-day
            hashes (not raw IPs) for rate limiting. Rotated daily.
          </li>
        </ul>
      </Section>

      <Section title="What we don't collect">
        <ul>
          <li>We do not use cookies for advertising or cross-site tracking.</li>
          <li>We do not sell or rent your data.</li>
          <li>We do not train detection models on your uploads.</li>
          <li>We do not store the contents of your magic-link emails.</li>
        </ul>
      </Section>

      <Section title="Third-party processors">
        <p>
          To deliver the Service we share limited data with:
        </p>
        <ul>
          <li>
            <strong>Sightengine</strong> — receives uploaded media for AI-detection scoring.
          </li>
          <li>
            <strong>Anthropic</strong> — receives detection scores (no media) for narration
            generation.
          </li>
          <li>
            <strong>Stripe</strong> — receives email and payment details for subscription billing.
          </li>
          <li>
            <strong>Resend</strong> — receives email addresses to deliver magic-link sign-in
            messages.
          </li>
          <li>
            <strong>Cloudflare</strong> — hosts the Service (Pages, Workers, R2, D1) and provides
            DDoS protection.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          We set one HttpOnly cookie (<code>mfs</code>) when you sign in. It contains an opaque
          session token. No tracking cookies, no advertising pixels.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You may request export or deletion of your data at any time by emailing{' '}
          <a className="text-ember-gold hover:text-ember-fire" href="mailto:privacy@mythos0x.com">
            privacy@mythos0x.com
          </a>
          . We honor verified requests within 30 days. EU/UK users have additional rights under
          GDPR (access, rectification, erasure, portability, objection); California residents
          under CCPA. We do not sell personal information.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Authentication uses HttpOnly, Secure, SameSite cookies over HTTPS only. Database access
          is account-scoped and least-privilege. API keys for external Providers are stored as
          encrypted Worker secrets, never exposed to the browser. Despite these measures, no
          Internet service is fully secure; if you discover a vulnerability please disclose
          responsibly to{' '}
          <a className="text-ember-gold hover:text-ember-fire" href="mailto:security@mythos0x.com">
            security@mythos0x.com
          </a>
          .
        </p>
      </Section>

      <Section title="Children">
        <p>
          The Service is not directed at children under 13 (or the local equivalent). We do not
          knowingly collect data from children. If you believe a child has used the Service,
          contact us and we will delete the account.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We will notify active subscribers by email of any material changes to this Policy.
          Effective date at the top of this page.
        </p>
      </Section>
    </LegalLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight text-ember-gold">
        {title}
      </h2>
      <div className="legal-content text-[14px] leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

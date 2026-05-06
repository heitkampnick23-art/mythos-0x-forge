import { LegalLayout } from './LegalLayout';

export function AUP({ onBack }: { onBack: () => void }) {
  return (
    <LegalLayout title="Acceptable Use Policy" effective="May 6, 2026" onBack={onBack}>
      <Section title="The short version">
        <p>
          Mythos 0X Forge exists to help people verify the authenticity of media. Don't use it to
          do harm. Specifically: don't target individuals, don't pretend our verdicts are proof,
          don't try to break the Service, and don't violate the law.
        </p>
      </Section>

      <Section title="Prohibited uses">
        <ul>
          <li>
            <strong>Targeted harassment, doxxing, or stalking</strong> of any individual,
            including using the Service to "verify" non-public images of a specific person without
            their consent.
          </li>
          <li>
            <strong>Misrepresentation of verdicts</strong> as definitive evidence in legal,
            journalistic, or institutional contexts. Verdicts are probabilistic estimates, not
            proof.
          </li>
          <li>
            <strong>Authentication of CSAM, NCII, or other illegal content.</strong> Do not upload
            it; we will report and cooperate with law enforcement.
          </li>
          <li>
            <strong>Building competing detection products</strong> by systematically
            reverse-engineering Service output.
          </li>
          <li>
            <strong>Automated scraping or load-testing</strong> beyond your tier's daily limit.
            Public API access (Max tier) has separate rate limits.
          </li>
          <li>
            <strong>Circumventing tier limits</strong> via account-cycling, IP-rotation, or shared
            credentials.
          </li>
          <li>
            <strong>Reselling verdicts</strong> without our written permission.
          </li>
          <li>
            <strong>Probing, scanning, or testing for vulnerabilities</strong> outside a
            coordinated disclosure to{' '}
            <a className="text-ember-gold hover:text-ember-fire" href="mailto:security@mythos0x.com">
              security@mythos0x.com
            </a>
            .
          </li>
        </ul>
      </Section>

      <Section title="Reporting abuse">
        <p>
          To report misuse of the Service, illegal content, or a verdict being misrepresented in
          public, email{' '}
          <a className="text-ember-gold hover:text-ember-fire" href="mailto:abuse@mythos0x.com">
            abuse@mythos0x.com
          </a>{' '}
          with as much context as you can share.
        </p>
      </Section>

      <Section title="Enforcement">
        <p>
          Violations may result in immediate suspension of your account, refund denial, and—for
          serious offenses—reports to law enforcement. We act on credible reports without prior
          notice.
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

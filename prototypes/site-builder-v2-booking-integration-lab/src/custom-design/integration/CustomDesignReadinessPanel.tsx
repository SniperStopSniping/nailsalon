import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { CustomDesignReadinessIssue } from './ui-types';

type CustomDesignReadinessPanelProps = {
  issues: readonly CustomDesignReadinessIssue[];
  showReady?: boolean;
};

export function CustomDesignReadinessPanel({
  issues,
  showReady = false,
}: CustomDesignReadinessPanelProps) {
  if (issues.length === 0) {
    return showReady ? (
      <section
        aria-label="Custom Design readiness"
        className="custom-design-owner-readiness custom-design-owner-readiness--ready"
      >
        <CheckCircle2 aria-hidden="true" size={18} />
        <div>
          <strong>Ready for customer Preview</strong>
          <p>Every saved link area has a usable label and destination.</p>
        </div>
      </section>
    ) : null;
  }

  return (
    <section
      aria-label="Custom Design readiness"
      className="custom-design-owner-readiness"
      role="status"
    >
      <AlertTriangle aria-hidden="true" size={18} />
      <div>
        <strong>Check this design</strong>
        <ul>
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${issue.imageItemId ?? ''}:${issue.areaId ?? ''}:${index}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { QuickBookPresentationProfile } from './presentation-view';
import { buildQuickBookFacts } from './QuickBookPrimitives';

export type PrimaryFact = ReturnType<typeof buildQuickBookFacts>[number];

/** Inputs have already passed the existing privacy/visibility adapter. */
export function selectPrimaryFacts(profile: QuickBookPresentationProfile, limit: 3 | 4) {
  const all = buildQuickBookFacts(profile);
  const order = ['location', 'hours', 'reviews', 'clients'];
  const primary = order.flatMap(id => all.filter(fact => fact.id === id)).slice(0, limit);
  const secondary = all.filter(fact => !primary.some(item => item.id === fact.id));
  const privacyNotes = primary.filter(fact => fact.id === 'location' && /after booking/iu.test(fact.detail ?? ''));
  return {
    primary: primary.map((fact) => {
      if (fact.id === 'reviews' && profile.reviews) {
        return { ...fact, value: profile.reviews.ratingText, detail: profile.reviews.reviewCountText };
      }
      return privacyNotes.includes(fact) ? { ...fact, detail: null } : fact;
    }),
    secondary,
    privacyNotes: privacyNotes.map(fact => fact.detail!),
  };
}

/** Never use an incomplete last row. Long content gets an intentional list. */
export function factArrangement(facts: PrimaryFact[], width: number): 'one' | 'two' | 'three' | 'four' | 'list' {
  if (facts.length <= 1) {
    return 'one';
  }
  const columns = facts.length === 3 ? 3 : 2;
  const cellWidth = (width - (columns - 1) * 14) / columns;
  const textWidth = cellWidth - (columns === 3 ? 0 : 24);
  const tooLong = facts.some((fact) => {
    const copy = `${fact.value} ${fact.detail ?? ''}`;
    const longestWord = Math.max(...copy.split(/\s+/u).map(word => word.length));
    return longestWord * 6.6 > textWidth || copy.length > (columns === 3 ? 50 : 90);
  });
  if (tooLong) {
    return 'list';
  }
  return facts.length === 2 ? 'two' : facts.length === 3 ? 'three' : 'four';
}

export function BalancedFacts({ facts, hours }: { facts: PrimaryFact[]; hours: QuickBookPresentationProfile['hours'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 320));
    observer.observe(element);
    return () => observer.disconnect();
  }, [facts.length]);
  if (!facts.length) {
    return null;
  }
  return (
    <div aria-label="Business information" className="qbp-facts" data-arrangement={factArrangement(facts, width)} data-primary-count={facts.length} ref={ref}>
      {facts.map((fact) => {
        const body = (
          <>
            {fact.icon}
            <span className="qbp-fact-copy">
              <span className="qbp-fact-label">{fact.label}</span>
              <span className="qbp-fact-value">{fact.value}</span>
              {fact.detail ? <span className="qbp-fact-detail">{fact.detail}</span> : null}
            </span>
          </>
        );
        if (fact.id === 'hours' && hours?.weekly.length) {
          return (
            <details className="qbp-fact" data-fact={fact.id} data-qb-fact={fact.id} key={fact.id}>
              <summary>
                {body}
                <ChevronDown aria-hidden="true" size={12} />
              </summary>
              <dl className="qbp-week">
                {hours.weekly.map(row => (
                  <div key={row.day}>
                    <dt>{row.day}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          );
        }
        return fact.href ? <a className="qbp-fact" data-fact={fact.id} data-qb-fact={fact.id} href={fact.href} key={fact.id} rel="noopener noreferrer" target="_blank">{body}</a> : <div className="qbp-fact" data-fact={fact.id} data-qb-fact={fact.id} key={fact.id}>{body}</div>;
      })}
    </div>
  );
}

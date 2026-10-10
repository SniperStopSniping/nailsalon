# Readability and page-speed checks

## Colour roles

Keep Luster's blush/plum owner theme and Isla's cream/gold customer theme separate. Secondary text is real content, not a disabled state. Use the shared muted ink tokens without lowering their opacity. Use `--owner-control` for input edges; pale card dividers remain decorative. Isla uses `--isla-gold-ink` for gold text/focus and keeps the lighter `--isla-gold` for decoration.

The colour-pair unit checks enforce 4.5:1 for normal text and 3:1 for tested control/focus colours. Rendered axe checks include blended backgrounds, real component styles and mobile WebKit. They retry during entrance transitions, do not suppress violations, and do not certify every WCAG requirement or every possible user-selected colour/photo.

## Regression coverage

- `src/styles/readability.test.ts`: owner, entry, onboarding, Isla and legacy theme tokens; local font loading.
- `tests/browser/assert-readable.ts`: rendered text checks used by owner tabs, entry, forms, assistant, SMS balances/top-ups, booking access and public booking palettes.
- `tests/browser/booking-theme/isla.spec.ts`: approved imagery, service selection, location/hours, expanded menu, extra selection, keyboard focus and responsive layout.
- The standalone onboarding lab checks 12 real screens at 320, 390, 430 and 1280px, including its own ESM-compatible axe helper.
- These checks run inside the existing protected CI suites. Fixtures use synthetic data, not real messages, credit grants, payments or salon publication.

## Performance changes

Isla's existing logo, hero and gallery photographs use responsive Next Image delivery. The main photo is prioritized; gallery images stay lazy. Fixed intrinsic dimensions and the approved CSS preserve the crop and layout. The onboarding section library loads its existing bundled Inter/Newsreader fonts instead of a blocking Google Fonts CSS import.

## Repeatable mobile lab audit

Run public routes sequentially on a quiet machine, using the same Lighthouse version and device/throttling settings before and after. Compare the actual canonical production commit, not a development server or Vercel protection screen.

```sh
npx --yes lighthouse@13.5.0 https://www.lustergel.app/isla-nail-studio/book/service \
  --chrome-flags='--headless=new' \
  --only-categories=performance,accessibility,best-practices \
  --output=json --output=html --output-path=/tmp/isla-mobile --quiet
```

Also check `/`, `/onboarding-v1`, `/owner-sign-in` and `/isla-nail-studio/find-booking`. Scores are lab measurements, not real-user Core Web Vitals or proof of authenticated/payment/provider acceptance. Keep private owner sessions out of public reports.

Baseline on 2026-10-10, production commit `7617d81f36b4185e7c963cb23aa54dda13624884`:

| Route | Performance | Accessibility | Best practices |
| --- | ---: | ---: | ---: |
| Isla service | 62 | 96 | 100 |
| Homepage | 96 | 100 | 100 |
| Onboarding | 56 | 100 | 100 |
| Owner sign-in | 78 | 100 | 100 |
| Find booking | 92 | 100 | 100 |

The Isla baseline reported 21 text contrast failures, LCP 6.7s and about 618 KiB of avoidable image transfer. The PageSpeed Insights API returned a quota error, so these measurements use Lighthouse directly. Rerun against the released code; do not interpret this baseline as the new result.

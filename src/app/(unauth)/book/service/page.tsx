import {
  type BookServicePageProps,
  renderBookServicePage,
} from './BookServicePageServer';

export const dynamic = 'force-dynamic';

/** Public LIVE route entrypoint; the canonical implementation lives server-side. */
export default async function BookServicePage(props: BookServicePageProps) {
  return renderBookServicePage(props);
}

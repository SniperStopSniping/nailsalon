import {
  type BookServicePageProps,
  renderBookServicePage,
} from './BookServicePageServer';

export const dynamic = 'force-dynamic';

/** Public LIVE route entrypoint; the canonical implementation lives server-side. */
export default async function BookServicePage(props: {
  searchParams: Promise<BookServicePageProps['searchParams']>;
  params: Promise<NonNullable<BookServicePageProps['params']>>;
}) {
  return renderBookServicePage({
    searchParams: await props.searchParams,
    params: await props.params,
  });
}

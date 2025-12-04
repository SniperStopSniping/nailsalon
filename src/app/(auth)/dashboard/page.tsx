'use client';

import { MessageState } from '@/features/dashboard/MessageState';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { SponsorLogos } from '@/features/sponsors/SponsorLogos';

const DashboardIndexPage = () => {
  return (
    <>
      <TitleBar
        title="Dashboard"
        description="Welcome to your dashboard"
      />

      <MessageState
        icon={(
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M0 0h24v24H0z" stroke="none" />
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3M12 12l8-4.5M12 12v9M12 12L4 7.5" />
          </svg>
        )}
        title="Welcome to the Dashboard"
        description={(
          <>
            This is the main dashboard area. You can customize this page in
            {' '}
            <code className="bg-secondary text-secondary-foreground">
              src/app/(auth)/dashboard/page.tsx
            </code>
          </>
        )}
        button={(
          <>
            <div className="mt-2 text-sm font-light text-muted-foreground">
              Need more features? Check out
              {' '}
              <a
                className="text-blue-500 hover:text-blue-600"
                href="https://nextjs-boilerplate.com/pro-saas-starter-kit"
              >
                Next.js Boilerplate SaaS
              </a>
            </div>

            <div className="mt-7">
              <SponsorLogos />
            </div>
          </>
        )}
      />
    </>
  );
};

export default DashboardIndexPage;

/// <reference types="vite/client" />
import '@/styles/global.css';

import { ClerkProvider } from '@clerk/clerk-react';
import { enUS } from '@clerk/localizations';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AdminSalonSelector } from '@/components/admin/dashboard/AdminSalonSelector';
import { FoundingSalonOffer } from '@/components/owner-entry/FoundingSalonOffer';
import { OwnerSignInScreen } from '@/components/owner-entry/OwnerSignInScreen';

const query = new URLSearchParams(location.search);
const exampleSalons = [
  { id: 'isla', name: query.has('long') ? 'Isla Nail Studio and Beautifully Considered Nail Art & Beauty' : 'Isla Nail Studio', slug: 'isla', role: 'owner', status: 'active', publicUrl: '/?destination=public', bookingUrl: '/?destination=booking' },
  { id: 'test', name: 'Nail salon test', slug: 'test', role: 'owner', status: 'active', publicUrl: '/?destination=public', bookingUrl: '/?destination=booking' },
  { id: 'studio', name: 'The Nail Studio', slug: 'studio', role: 'owner', status: 'active', publicUrl: '/?destination=public', bookingUrl: '/?destination=booking' },
];
function EntryReview() {
  const [removed, setRemoved] = useState<string[]>([]);
  const [claimed, setClaimed] = useState(false);
  const [destination, setDestination] = useState('');
  if (destination) {
    return <p role="status">{destination}</p>;
  }
  if (query.get('screen') === 'offer') {
    return <FoundingSalonOffer onClaim={() => setClaimed(true)} pending={claimed} message={claimed ? 'Visual review only: no live plan or text credits were changed.' : null} />;
  }
  if (query.get('screen') === 'sign-in') {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
    return publishableKey
      ? (
          <ClerkProvider publishableKey={publishableKey} localization={{ ...enUS, signIn: { ...enUS.signIn, start: { ...enUS.signIn?.start, subtitle: 'Sign in to continue', actionText: 'New to Luster?', actionLink: 'Create your free salon' } } }}>
            <OwnerSignInScreen dashboardUrl="/?destination=dashboard" createSalonUrl="/?destination=onboarding" />
          </ClerkProvider>
        )
      : <p>Provide a Clerk development publishable key to review the real authentication component.</p>;
  }
  return (
    <AdminSalonSelector
      salons={exampleSalons.filter(salon => !removed.includes(salon.id))}
      hiddenSalons={[...exampleSalons.filter(salon => removed.includes(salon.id)), { id: 'archived-one', slug: 'archived-one', name: 'Earlier studio', role: 'owner', status: 'draft' }]}
      onSelect={salon => setDestination(`Opened ${salon.name}`)}
      onVisibilityChange={async (salon, hidden) => {
        if (query.has('error')) {
          throw new Error('Could not update the salon list. Try again.');
        }
        setRemoved(current => hidden ? [...current, salon.id] : current.filter(id => id !== salon.id));
      }}
      footerAction={<button type="button" onClick={() => setDestination('Logged out')}>Log out</button>}
    />
  );
}
createRoot(document.getElementById('root')!).render(<EntryReview />);

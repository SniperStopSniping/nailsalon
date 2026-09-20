import { createContext, useContext } from 'react';

const salon = {
  salonId: 'salon_browser_fixture',
  salonSlug: 'isla-browser',
  salonName: 'Isla Browser Fixture',
  themeKey: 'isla',
  status: 'active' as const,
  isAccessible: true,
};

const SalonContext = createContext(salon);

export function SalonProvider({ children }: { children: React.ReactNode }) {
  return <SalonContext.Provider value={salon}>{children}</SalonContext.Provider>;
}

export function useSalon() {
  return useContext(SalonContext);
}

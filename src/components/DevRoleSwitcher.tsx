/**
 * DEV ONLY - Role Switcher Dropdown
 *
 * Allows instant switching between Super Admin, Admin, Staff, and Client
 * dashboards without logging out or re-authenticating.
 *
 * This component only renders in dev mode (NEXT_PUBLIC_DEV_MODE=true).
 */

'use client';

import { useEffect, useState } from 'react';

import { type DevRole, useDevRole } from '@/hooks/useDevRole';

// =============================================================================
// ROLE CONFIG
// =============================================================================

type RoleConfig = {
  label: string;
  route: string;
  color: string;
};

const ROLE_CONFIG: Record<DevRole, RoleConfig> = {
  super_admin: {
    label: 'Super Admin',
    route: '/en/super-admin',
    color: '#8B5CF6', // purple
  },
  admin: {
    label: 'Admin',
    route: '/en/admin',
    color: '#3B82F6', // blue
  },
  staff: {
    label: 'Staff',
    route: '/en/staff',
    color: '#10B981', // green
  },
  client: {
    label: 'Client',
    route: '/en',
    color: '#F59E0B', // amber
  },
};

// =============================================================================
// COMPONENT
// =============================================================================

export default function DevRoleSwitcher() {
  const { isDevMode, switchRole, getCurrentDevRole } = useDevRole();
  const [currentRole, setCurrentRole] = useState<DevRole | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch current role on mount
  useEffect(() => {
    if (isDevMode) {
      getCurrentDevRole().then(setCurrentRole);
    }
  }, [isDevMode, getCurrentDevRole]);

  // Don't render if not in dev mode
  if (!isDevMode) {
    return null;
  }

  const handleSelect = async (role: DevRole | null) => {
    setIsLoading(true);
    setIsOpen(false);

    const success = await switchRole(role);

    if (success) {
      if (role === null) {
        // Clear - reload current page
        window.location.reload();
      } else {
        // Navigate to target route
        window.location.href = ROLE_CONFIG[role].route;
      }
    } else {
      setIsLoading(false);
    }
  };

  const currentConfig = currentRole ? ROLE_CONFIG[currentRole] : null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '12px',
        right: '12px',
        zIndex: 99999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          fontSize: '11px',
          fontWeight: 600,
          color: '#fff',
          backgroundColor: currentConfig?.color ?? '#6B7280',
          border: '2px solid rgba(255,255,255,0.3)',
          borderRadius: '6px',
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: isLoading ? 0.7 : 1,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          transition: 'all 0.15s ease',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: currentRole ? '#fff' : '#9CA3AF',
          }}
        />
        <span>
          DEV:
          {currentConfig?.label ?? 'None'}
        </span>
        <span style={{ fontSize: '8px', opacity: 0.8 }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            minWidth: '140px',
            backgroundColor: '#1F2937',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            overflow: 'hidden',
          }}
        >
          {(Object.entries(ROLE_CONFIG) as [DevRole, RoleConfig][]).map(
            ([role, config]) => (
              <button
                key={role}
                type="button"
                onClick={() => handleSelect(role)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: currentRole === role ? config.color : '#D1D5DB',
                  backgroundColor:
                    currentRole === role ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.1s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor
                    = currentRole === role ? 'rgba(255,255,255,0.1)' : 'transparent';
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: config.color,
                  }}
                />
                {config.label}
                {currentRole === role && (
                  <span style={{ marginLeft: 'auto', fontSize: '10px' }}>✓</span>
                )}
              </button>
            ),
          )}

          {/* Divider */}
          <div
            style={{
              height: '1px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              margin: '4px 0',
            }}
          />

          {/* Clear Option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '10px 12px',
              fontSize: '12px',
              fontWeight: 500,
              color: '#9CA3AF',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background-color 0.1s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#6B7280',
              }}
            />
            Clear (Real Auth)
          </button>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
          }}
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

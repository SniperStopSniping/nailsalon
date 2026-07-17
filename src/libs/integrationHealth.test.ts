/* eslint-disable import/first */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: {} }));

import { resolveGoogleReadiness } from './integrationHealth';

describe('resolveGoogleReadiness', () => {
  it('reports setup_incomplete when OAuth is connected but no blocking calendar is saved', () => {
    expect(resolveGoogleReadiness('active', [])).toBe('setup_incomplete');
    expect(resolveGoogleReadiness('active', null)).toBe('setup_incomplete');
    expect(resolveGoogleReadiness('active', undefined)).toBe('setup_incomplete');
  });

  it('reports ready once at least one blocking calendar is saved', () => {
    expect(resolveGoogleReadiness('active', ['calendar_a@group.calendar.google.com'])).toBe('ready');
    expect(resolveGoogleReadiness('active', ['a', 'b'])).toBe('ready');
  });

  it('reports reconnect_required when authorization was revoked, regardless of selection', () => {
    expect(resolveGoogleReadiness('reconnect_required', ['a'])).toBe('reconnect_required');
    expect(resolveGoogleReadiness('reconnect_required', [])).toBe('reconnect_required');
  });

  it('reports attention_required when the connection is degraded but configured', () => {
    expect(resolveGoogleReadiness('degraded', ['a'])).toBe('attention_required');
  });

  it('treats a degraded connection with no selection as setup_incomplete first', () => {
    // The owner cannot fix "attention required" without a selection to repair;
    // guide them to finish setup.
    expect(resolveGoogleReadiness('degraded', [])).toBe('setup_incomplete');
  });

  it('keeps an existing salon with a valid selection fully ready', () => {
    // Existing pilot salons were seeded with ['primary'] at connect time and
    // must not be disrupted by the readiness rollout.
    expect(resolveGoogleReadiness('active', ['primary'])).toBe('ready');
  });
});

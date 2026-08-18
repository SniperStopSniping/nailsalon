import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EFFECTIVE_CONFIRMATION_MODE,
  resolveEffectivePublicConfirmationMode,
} from './confirmationMode';

describe('resolveEffectivePublicConfirmationMode', () => {
  it('resolves a legacy NULL service (no parent) to the default (instant)', () => {
    expect(resolveEffectivePublicConfirmationMode({ ownConfirmationMode: null }))
      .toBe('instant');
    expect(DEFAULT_EFFECTIVE_CONFIRMATION_MODE).toBe('instant');
  });

  it('uses its own value when set', () => {
    expect(resolveEffectivePublicConfirmationMode({ ownConfirmationMode: 'consultation' }))
      .toBe('consultation');
    expect(resolveEffectivePublicConfirmationMode({ ownConfirmationMode: 'request_approval' }))
      .toBe('request_approval');
  });

  it('a child with no own value inherits its parent\'s value', () => {
    expect(resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: null,
      parentConfirmationMode: 'consultation',
    })).toBe('consultation');
  });

  it('a child\'s own value always wins over its parent\'s', () => {
    expect(resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: 'instant',
      parentConfirmationMode: 'consultation',
    })).toBe('instant');
  });

  it('a child with neither its own nor a parent value falls back to the default', () => {
    expect(resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: null,
      parentConfirmationMode: null,
    })).toBe('instant');
  });

  it('treats undefined the same as null for both own and parent', () => {
    expect(resolveEffectivePublicConfirmationMode({ ownConfirmationMode: undefined }))
      .toBe('instant');
    expect(resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: undefined,
      parentConfirmationMode: undefined,
    })).toBe('instant');
  });

  it('fails closed to "no opinion" on an unrecognized stored string, cascading to parent/default rather than trusting it', () => {
    expect(resolveEffectivePublicConfirmationMode({ ownConfirmationMode: 'garbage' }))
      .toBe('instant');
    expect(resolveEffectivePublicConfirmationMode({
      ownConfirmationMode: 'garbage',
      parentConfirmationMode: 'consultation',
    })).toBe('consultation');
  });

  it('is a pure function: repeated calls with the same input give the same output', () => {
    const input = { ownConfirmationMode: 'request_approval' as const };

    expect(resolveEffectivePublicConfirmationMode(input)).toBe(resolveEffectivePublicConfirmationMode(input));
  });
});

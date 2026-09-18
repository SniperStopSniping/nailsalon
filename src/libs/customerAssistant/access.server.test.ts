import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { CUSTOMER_ASSISTANT_MODEL, CUSTOMER_ASSISTANT_REASONING_EFFORT, getCustomerAssistantConfig, isCustomerAssistantEnabledForSalon } = await import('./access.server');

afterEach(() => vi.unstubAllEnvs());

describe('customer assistant access boundary', () => {
  it('requires its own enabled flag, customer API key, and a strong signing secret', () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'customer-key');
    vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'a'.repeat(32));
    vi.stubEnv('OPENAI_API_KEY_OWNER', 'owner-key-must-not-be-used');

    expect(getCustomerAssistantConfig()).toEqual({ apiKey: 'customer-key', signingSecret: 'a'.repeat(32) });

    vi.stubEnv('OPENAI_API_KEY_CUSTOMER', '');

    expect(getCustomerAssistantConfig()).toBeNull();

    vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'customer-key');
    vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'short');

    expect(getCustomerAssistantConfig()).toBeNull();
  });

  it('admits only the exact Isla pilot slug while configured', () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY_CUSTOMER', 'customer-key');
    vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 'a'.repeat(32));

    expect(isCustomerAssistantEnabledForSalon('isla-nail-studio')).toBe(true);
    expect(isCustomerAssistantEnabledForSalon('Isla-Nail-Studio')).toBe(false);
    expect(isCustomerAssistantEnabledForSalon('isla-nail-studio ')).toBe(false);
    expect(isCustomerAssistantEnabledForSalon('another-salon')).toBe(false);
  });

  it('pins Luna low and has no environment model override', () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_MODEL', 'something-else');

    expect(CUSTOMER_ASSISTANT_MODEL).toBe('gpt-5.6-luna');
    expect(CUSTOMER_ASSISTANT_REASONING_EFFORT).toBe('low');
  });
});

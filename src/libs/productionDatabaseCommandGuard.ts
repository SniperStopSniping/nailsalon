export const PRODUCTION_CONFIRMATION_ENV = 'LUSTER_PRODUCTION_CONFIRM';

export type ProductionDatabaseCommandGuardErrorCode
  = 'PRODUCTION_CONFIRMATION_REQUIRED';

const ERROR_MESSAGES: Record<
  ProductionDatabaseCommandGuardErrorCode,
  string
> = {
  PRODUCTION_CONFIRMATION_REQUIRED:
    `Production database command rejected: ${PRODUCTION_CONFIRMATION_ENV} must exactly match today's local date (YYYY-MM-DD).`,
};

export class ProductionDatabaseCommandGuardError extends Error {
  readonly code: ProductionDatabaseCommandGuardErrorCode;

  constructor(code: ProductionDatabaseCommandGuardErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProductionDatabaseCommandGuardError';
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function currentLocalDate(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Requires fresh, explicit intent before a Production database command runs.
 * The supplied value is deliberately excluded from every error surface.
 */
export function requireProductionDatabaseCommandConfirmation(
  environment: Environment = process.env,
): void {
  if (environment[PRODUCTION_CONFIRMATION_ENV] !== currentLocalDate()) {
    throw new ProductionDatabaseCommandGuardError(
      'PRODUCTION_CONFIRMATION_REQUIRED',
    );
  }
}

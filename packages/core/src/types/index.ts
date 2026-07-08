/**
 * Shared TypeScript types for the budget application
 *
 * This file contains only shared utility types and error classes.
 * Service-specific types are defined in their respective service directories.
 */

export class BudgetError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export class ValidationError extends BudgetError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class DatabaseNewerThanAppError extends BudgetError {
  constructor(
    public readonly databaseVersion: number,
    public readonly maxSupportedVersion: number
  ) {
    super(
      `Database schema version ${databaseVersion} is newer than this app supports (${maxSupportedVersion}). Update the app before opening this space.`,
      'DB_NEWER_THAN_APP'
    );
    this.name = 'DatabaseNewerThanAppError';
  }
}

export class NotFoundError extends BudgetError {
  /** `new NotFoundError('Transaction', 42)` → "Transaction with id 42 not found". */
  constructor(resource: string, id: number | string);
  /** Single-argument form: the string is used verbatim as the error message. */
  constructor(message: string);
  constructor(resourceOrMessage: string, id?: number | string) {
    super(
      id === undefined ? resourceOrMessage : `${resourceOrMessage} with id ${id} not found`,
      'NOT_FOUND'
    );
    this.name = 'NotFoundError';
  }
}

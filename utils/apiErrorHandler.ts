/**
 * Utility for consistent API error handling across the application.
 *
 * Extracts meaningful error messages from various error formats and
 * provides type-safe error handling patterns.
 *
 * @example
 * ```typescript
 * import { getApiErrorMessage, isApiError } from '~/utils/apiErrorHandler';
 *
 * try {
 *   const data = await query('/some-endpoint');
 * } catch (error) {
 *   const message = getApiErrorMessage(error);
 *   showError(message);
 * }
 * ```
 */

interface ApiError {
    statusCode?: number;
    statusMessage?: string;
    data?: {
        message?: string;
        error?: string;
        details?: string;
    };
}

/**
 * Type guard to check if an error is an API error with additional data
 */
export const isApiError = (error: unknown): error is ApiError => {
    return (
        typeof error === 'object' && error !== null && ('statusCode' in error || 'data' in error)
    );
};

/**
 * Extract a user-friendly error message from various error types
 */
export const getApiErrorMessage = (
    error: unknown,
    defaultMessage = 'An unexpected error occurred'
): string => {
    // Handle API errors with data
    if (isApiError(error)) {
        if (error.data?.message) return error.data.message;
        if (error.data?.error) return error.data.error;
        if (error.data?.details) return error.data.details;
        if (error.statusMessage) return error.statusMessage;
    }

    // Handle standard Error objects
    if (error instanceof Error) {
        return error.message;
    }

    // Handle string errors
    if (typeof error === 'string') {
        return error;
    }

    // Default message
    return defaultMessage;
};

/**
 * Get HTTP status code from error if available
 */
export const getApiErrorStatus = (error: unknown): number | undefined => {
    if (isApiError(error)) {
        return error.statusCode;
    }
    return undefined;
};

/**
 * Check if error is a specific HTTP status
 */
export const isHttpStatus = (error: unknown, status: number): boolean => {
    return getApiErrorStatus(error) === status;
};

/**
 * Common error status checkers
 */
export const isNotFoundError = (error: unknown): boolean => isHttpStatus(error, 404);
export const isUnauthorizedError = (error: unknown): boolean => isHttpStatus(error, 401);
export const isForbiddenError = (error: unknown): boolean => isHttpStatus(error, 403);
export const isServerError = (error: unknown): boolean => {
    const status = getApiErrorStatus(error);
    return status !== undefined && status >= 500;
};

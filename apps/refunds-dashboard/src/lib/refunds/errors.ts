export type RefundErrorCode = "forbidden" | "validation" | "not_found" | "conflict" | "audit_failed";

const HTTP_STATUS: Record<RefundErrorCode, number> = {
  forbidden: 403,
  validation: 400,
  not_found: 404,
  conflict: 409,
  audit_failed: 500,
};

// Branded with a registered symbol rather than relying on `instanceof`: the
// bundler can load this module more than once (e.g. once per server layer).
const BRAND = Symbol.for("@acme/refunds-dashboard/RefundServiceError");

export class RefundServiceError extends Error {
  override name = "RefundServiceError";
  readonly code: RefundErrorCode;
  readonly [BRAND] = true;

  constructor(code: RefundErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isRefundServiceError(error: unknown): error is RefundServiceError {
  return typeof error === "object" && error !== null && BRAND in error;
}

import type { Config } from "../config.js";

/**
 * OTP delivery stub. No real email/SMS integration exists or is needed at
 * this stage. Always logs a structured line; only includes the raw code in
 * the log when the developer opted in with `OTP_DEV_EXPOSE=true`
 * (`config.otpDevExpose`) — never just because NODE_ENV isn't 'production'.
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

// logs the otp in plaintext when not production. our staging has NODE_ENV unset btw — am
// YA: staging gets NODE_ENV=production from ops/.env.docker. fine
// (BUG-031: compose never loaded ops/.env.docker; now gated on otpDevExpose)
export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose">,
  recipient: { merchantUserId: string; email: string },
  code: string,
): void {
  if (!config.otpDevExpose) {
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp code generated");
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
}

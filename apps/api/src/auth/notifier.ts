import type { Config } from "../config.js";

/**
 * OTP delivery stub. No real email/SMS integration exists yet (ENH-001).
 * Always logs a structured line; includes the raw code only when
 * `config.otpDevExpose` is on — the same switch that puts `devOtpCode` in
 * the login reply, which is off unless explicitly enabled and refused in
 * production (BUG-031).
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

// logs the otp in plaintext when not production. our staging has NODE_ENV unset btw — am
// YA: staging gets NODE_ENV=production from ops/.env.docker. fine
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

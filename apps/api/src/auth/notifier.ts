import type { Config } from "../config.js";
import { sendMail, type MailConfig, type SendMail } from "../lib/mail.js";

/**
 * OTP delivery. When `config.smtpHost` is set the code is emailed to the
 * user (ENH-001); a failed or slow send is logged, never thrown, so the
 * login still answers and the user can press "resend". Always logs a
 * structured line; includes the raw code only when `config.otpDevExpose` is
 * on — the same switch that puts `devOtpCode` in the login reply, which is
 * off unless explicitly enabled and refused in production (BUG-031).
 */
/** Subset of the Fastify logger, so tests can pass a stub. */
export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

/** The email body shared by the merchant and admin notifiers. */
export function otpMailText(code: string, ttlMinutes: number): string {
  return [
    `Your FilsPay login code is: ${code}`,
    "",
    `It is valid for ${ttlMinutes} minutes.`,
    "",
    "If this wasn't you, ignore this email and change your password.",
  ].join("\n");
}

// logs the otp in plaintext when not production. our staging has NODE_ENV unset btw — am
// YA: staging gets NODE_ENV=production from ops/.env.docker. fine
export async function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose" | "otpTtlMinutes"> & MailConfig,
  recipient: { merchantUserId: string; email: string },
  code: string,
  send: SendMail = sendMail,
): Promise<void> {
  if (!config.otpDevExpose) {
    logger.info({ merchantUserId: recipient.merchantUserId, channel: "otp" }, "otp code generated");
  } else {
    logger.info(
      { merchantUserId: recipient.merchantUserId, channel: "otp", code },
      "otp code generated (dev)",
    );
  }
  if (config.smtpHost === "" || recipient.email === "") return;
  try {
    await send(config, {
      to: recipient.email,
      subject: "Your FilsPay login code",
      text: otpMailText(code, config.otpTtlMinutes),
    });
  } catch (err) {
    logger.error(
      { merchantUserId: recipient.merchantUserId, channel: "otp", err: (err as Error).message },
      "otp email not sent",
    );
  }
}

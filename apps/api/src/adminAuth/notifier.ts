import type { Config } from "../config.js";
import { otpMailHtml, otpMailText, type MinimalLogger } from "../auth/notifier.js";
import { sendMail, type MailConfig, type SendMail } from "../lib/mail.js";

/**
 * Admin OTP delivery, mirroring `auth/notifier.ts`: emails the code when
 * `config.smtpHost` is set (ENH-001; a failed send is logged, not thrown).
 * Always logs a structured line; only includes the raw code when
 * `config.otpDevExpose` is on (off by default, refused in production —
 * production never logs the code itself.
 */
// MK: console only until the SMS gateway contract lands. 'temporary' — Dec 2025
export async function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "otpDevExpose" | "adminOtpTtlMinutes"> & MailConfig,
  recipient: { adminUserId: string; email: string },
  code: string,
  send: SendMail = sendMail,
): Promise<void> {
  if (!config.otpDevExpose) {
    logger.info({ adminUserId: recipient.adminUserId, channel: "admin_otp" }, "admin otp code generated");
  } else {
    logger.info(
      { adminUserId: recipient.adminUserId, channel: "admin_otp", code },
      "admin otp code generated (dev)",
    );
  }
  if (config.smtpHost === "" || recipient.email === "") return;
  try {
    await send(config, {
      to: recipient.email,
      subject: "Your FilsPay staff console login code",
      text: otpMailText(code, config.adminOtpTtlMinutes),
      html: otpMailHtml(code, config.adminOtpTtlMinutes, "FilsPay staff console"),
    });
  } catch (err) {
    logger.error(
      { adminUserId: recipient.adminUserId, channel: "admin_otp", err: (err as Error).message },
      "admin otp email not sent",
    );
  }
}

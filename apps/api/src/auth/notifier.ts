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

/** Colours and font of the code email, in one place so they can follow the
 *  dashboards' theme. Inline styles only: mail clients drop <style> blocks. */
export const MAIL_THEME = {
  accent: "#b3243b",
  text: "#1d1b1a",
  muted: "#6f6863",
  background: "#f6f5f3",
  card: "#ffffff",
  font: "Arial, Helvetica, sans-serif",
};

/** The plain-text email body shared by the merchant and admin notifiers. */
export function otpMailText(code: string, ttlMinutes: number): string {
  return [
    `Your FilsPay login code is: ${code}`,
    "",
    `It is valid for ${ttlMinutes} minutes.`,
    "",
    "If this wasn't you, ignore this email and change your password.",
  ].join("\n");
}

/** The same message as simple HTML: no images, scripts or links, so nothing
 *  is loaded from outside and nothing can track the reader. `code` is digits
 *  only (randomDigits). */
export function otpMailHtml(code: string, ttlMinutes: number, product = "FilsPay"): string {
  const t = MAIL_THEME;
  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:${t.background};font-family:${t.font};color:${t.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:${t.card};border-radius:8px;border-top:4px solid ${t.accent}">
<tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:bold;color:${t.accent}">${product}</td></tr>
<tr><td style="padding:0 24px;font-size:15px">Your login code is:</td></tr>
<tr><td style="padding:16px 24px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace">${code}</td></tr>
<tr><td style="padding:0 24px 16px;font-size:14px;color:${t.muted}">It is valid for ${ttlMinutes} minutes. Never share it with anyone, including FilsPay staff.</td></tr>
<tr><td style="padding:12px 24px 24px;font-size:13px;color:${t.muted};border-top:1px solid ${t.background}">If this wasn't you, ignore this email and change your password.</td></tr>
</table></td></tr></table>
</body></html>`;
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
      html: otpMailHtml(code, config.otpTtlMinutes),
    });
  } catch (err) {
    logger.error(
      { merchantUserId: recipient.merchantUserId, channel: "otp", err: (err as Error).message },
      "otp email not sent",
    );
  }
}

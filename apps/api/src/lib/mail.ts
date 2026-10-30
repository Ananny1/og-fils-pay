import type { Transporter } from "nodemailer";
import type { Config } from "../config.js";

/**
 * Outgoing email over SMTP (ENH-001; the VirtuThinko portal's pattern):
 * Mailpit locally (http://localhost:8025), Gmail or any SMTP server hosted.
 * Only used when `config.smtpHost` is set. nodemailer is loaded on first
 * send, so a process that never sends mail never loads it.
 */
export type MailConfig = Pick<
  Config,
  "nodeEnv" | "smtpHost" | "smtpPort" | "smtpSecure" | "smtpUser" | "smtpPassword" | "mailFrom"
>;

export type OutgoingMail = { to: string; subject: string; text: string };

/** Signature the notifiers depend on, so tests can pass a fake. */
export type SendMail = (config: MailConfig, mail: OutgoingMail) => Promise<void>;

/** Upper bound for one send. A slow or dead mail server must not hold a
 *  login request open; the user can press "resend". */
const SEND_TIMEOUT_MS = 10_000;

let transporter: Promise<Transporter> | undefined;

function getTransporter(config: MailConfig): Promise<Transporter> {
  transporter ??= import("nodemailer").then(({ default: nodemailer }) =>
    nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      // Never send a code over a plain connection in production.
      requireTLS: config.nodeEnv === "production",
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    }),
  );
  return transporter;
}

export const sendMail: SendMail = async (config, mail) => {
  const transport = await getTransporter(config);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`mail send timed out after ${SEND_TIMEOUT_MS} ms`)), SEND_TIMEOUT_MS);
  });
  try {
    await Promise.race([transport.sendMail({ from: config.mailFrom, ...mail }), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

import nodemailer from "nodemailer";

export type Mailer = (msg: { to: string; subject: string; text: string }) => Promise<void>;

// Sends through Gmail with an app password (Google account › Security › App passwords).
export function gmailMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  for (const name of ["GMAIL_USER", "GMAIL_APP_PASSWORD"]) {
    if (!env[name]) throw new Error(`${name} is not set (see .env.example)`);
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  return async (msg) => {
    await transport.sendMail({ from: `Greenfields <${env.GMAIL_USER}>`, ...msg });
  };
}

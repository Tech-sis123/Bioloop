import { config } from '../config.js';

// Sends email through Resend when RESEND_API_KEY is set. Without it, emails are
// skipped and admins can create reset links from the dashboard instead.
export async function sendMail({ to, subject, text }) {
  if (!config.resendApiKey) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  return { sent: true };
}

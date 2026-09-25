const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD in .env');
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: SMTP_SECURE === 'true', // true for port 465, false for 587/25 (STARTTLS)
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined
  });
  return transporter;
}

async function sendContactEmail({ firstName, lastName, email, message }) {
  const to = process.env.CONTACT_TO_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;
  if (!to) throw new Error('CONTACT_TO_EMAIL is not set in .env');

  const t = getTransporter();
  await t.sendMail({
    from,
    to,
    replyTo: email,
    subject: `[PENOKS Contact Form] Message from ${firstName} ${lastName}`,
    text: `From: ${firstName} ${lastName} <${email}>\n\n${message || '(no message provided)'}`,
    html: `<p><strong>From:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)} &lt;${escapeHtml(email)}&gt;</p>
           <p>${escapeHtml(message || '(no message provided)').replace(/\n/g, '<br>')}</p>`
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendContactEmail };

//! Email delivery via SMTP (Hermes / Azure ACS / any SMTP relay).
//!
//! Configuration via environment variables:
//!   SULCUS_SMTP_HOST       — SMTP server hostname (default: hermes.technocraftonline.com)
//!   SULCUS_SMTP_PORT       — SMTP port (default: 587)
//!   SULCUS_SMTP_USERNAME   — SMTP auth username
//!   SULCUS_SMTP_PASSWORD   — SMTP auth password
//!   SULCUS_SMTP_FROM       — sender address (default: noreply@sulcus.ca)
//!   SULCUS_SMTP_FROM_NAME  — sender display name (default: Sulcus)

use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use once_cell::sync::Lazy;
use std::env;

/// SMTP configuration — loaded once from env.
struct SmtpConfig {
    host: String,
    port: u16,
    username: String,
    password: String,
    from_address: String,
    from_name: String,
}

static SMTP_CONFIG: Lazy<Option<SmtpConfig>> = Lazy::new(|| {
    let username = env::var("SULCUS_SMTP_USERNAME").ok()?;
    let password = env::var("SULCUS_SMTP_PASSWORD").ok()?;

    Some(SmtpConfig {
        host: env::var("SULCUS_SMTP_HOST")
            .unwrap_or_else(|_| "hermes.technocraftonline.com".to_string()),
        port: env::var("SULCUS_SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587),
        username,
        password,
        from_address: env::var("SULCUS_SMTP_FROM")
            .unwrap_or_else(|_| "noreply@sulcus.ca".to_string()),
        from_name: env::var("SULCUS_SMTP_FROM_NAME")
            .unwrap_or_else(|_| "Sulcus".to_string()),
    })
});

/// Check whether SMTP is configured (credentials present).
pub fn is_configured() -> bool {
    SMTP_CONFIG.is_some()
}

/// Send an email. Returns Ok(()) on success or an error message.
pub async fn send_email(to: &str, subject: &str, html_body: &str) -> Result<(), String> {
    let config = SMTP_CONFIG
        .as_ref()
        .ok_or_else(|| "SMTP not configured — set SULCUS_SMTP_USERNAME and SULCUS_SMTP_PASSWORD".to_string())?;

    let from: Mailbox = format!("{} <{}>", config.from_name, config.from_address)
        .parse()
        .map_err(|e| format!("invalid from address: {e}"))?;

    let to_mailbox: Mailbox = to
        .parse()
        .map_err(|e| format!("invalid recipient address: {e}"))?;

    let email = Message::builder()
        .from(from)
        .to(to_mailbox)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html_body.to_string())
        .map_err(|e| format!("failed to build email: {e}"))?;

    let creds = Credentials::new(config.username.clone(), config.password.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
        .map_err(|e| format!("SMTP relay error: {e}"))?
        .port(config.port)
        .credentials(creds)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| format!("SMTP send failed: {e}"))?;

    tracing::info!(to = to, subject = subject, "email sent successfully");
    Ok(())
}

// ── Shared email styles ────────────────────────────────────────────
//
// All Sulcus emails use consistent branding:
//   - Dark theme (#050a0f background)
//   - Teal diamond icon (CSS-based, no emoji)
//   - Gold (#D4AF37) and teal (#00F0FF) accents
//   - "Memory that thinks." tagline
//   - contact@dforge.ca footer

/// CSS styles shared across all email templates.
const EMAIL_STYLES: &str = r#"
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #050a0f; color: #e5e5e5; padding: 40px 20px; margin: 0; }
    .container { max-width: 560px; margin: 0 auto; background: #0a1520; padding: 40px; border: 1px solid #D4AF37; border-radius: 2px; }
    .logo { text-align: center; margin-bottom: 24px; }
    .diamond { display: inline-block; width: 28px; height: 28px; background: #00F0FF; transform: rotate(45deg); box-shadow: 0 0 20px rgba(0, 240, 255, 0.4); }
    .brand { text-align: center; margin-bottom: 32px; }
    .brand-name { color: #fafafa; font-size: 22px; font-weight: 700; letter-spacing: 6px; text-transform: uppercase; margin: 12px 0 4px; }
    .brand-tagline { color: #D4AF37; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; }
    h1 { color: #fafafa; font-size: 20px; margin: 0 0 16px; font-weight: 600; }
    p { line-height: 1.7; color: #a3a3a3; font-size: 14px; }
    a { color: #00F0FF; }
    .btn { display: inline-block; background: linear-gradient(135deg, #D4AF37, #B8860B); color: #050a0f; padding: 14px 36px; border-radius: 2px; text-decoration: none; font-weight: 700; margin: 24px 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; }
    .code-block { background: #111820; padding: 14px 18px; border: 1px solid #D4AF37; border-radius: 2px; font-family: 'SF Mono', Monaco, monospace; font-size: 13px; word-break: break-all; color: #00F0FF; margin: 16px 0; }
    .feature { background: #111820; padding: 16px; border-left: 3px solid #00F0FF; margin: 16px 0; }
    .feature strong { color: #00F0FF; }
    .divider { height: 1px; background: linear-gradient(to right, transparent, #D4AF37, transparent); margin: 32px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1a2530; font-size: 11px; color: #555; text-align: center; }
    .footer a { color: #D4AF37; text-decoration: none; }
"#;

/// Shared email header with diamond logo and brand text.
const EMAIL_HEADER: &str = r#"
    <div class="logo"><div class="diamond"></div></div>
    <div class="brand">
      <div class="brand-name">Sulcus</div>
      <div class="brand-tagline">Memory that thinks.</div>
    </div>
"#;

/// Shared email footer.
const EMAIL_FOOTER: &str = r#"
    <div class="footer">
      <p><a href="https://sulcus.ca">sulcus.ca</a></p>
      <p>Digital Forge Studios &middot; <a href="mailto:contact@dforge.ca">contact@dforge.ca</a></p>
    </div>
"#;

// ── Invite email template ──────────────────────────────────────────

/// Send a service invitation email with the given token.
pub async fn send_invite_email(
    to: &str,
    invitation_token: &str,
    tenant_name: &str,
) -> Result<(), String> {
    let join_url = format!(
        "https://sulcus.ca/register?invite={}",
        invitation_token
    );

    let subject = format!("You've been invited to Sulcus by {}", tenant_name);

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>{styles}</style>
</head>
<body>
  <div class="container">
    {header}
    <h1>You're invited to Sulcus</h1>
    <p><strong>{tenant}</strong> has invited you to join their Sulcus workspace — persistent, reactive memory for AI agents.</p>
    <p><a href="{url}" class="btn">Accept Invitation &rarr;</a></p>
    <p>Or use this invitation token manually:</p>
    <div class="code-block">{token}</div>
    <p style="font-size:12px; color:#555;">This invitation expires in 24 hours.</p>
    {footer}
  </div>
</body>
</html>"#,
        styles = EMAIL_STYLES,
        header = EMAIL_HEADER,
        footer = EMAIL_FOOTER,
        tenant = tenant_name,
        url = join_url,
        token = invitation_token,
    );

    send_email(to, &subject, &html).await
}

/// Send a welcome email after joining.
pub async fn send_welcome_email(to: &str, tenant_id: &str, api_key: &str) -> Result<(), String> {
    let subject = "Welcome to Sulcus — your API key is ready";

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>{styles}</style>
</head>
<body>
  <div class="container">
    {header}
    <h1>Welcome to Sulcus</h1>
    <p>You're in. Your workspace <strong>{tenant}</strong> is ready.</p>
    <p>Here's your API key — save it somewhere safe, you won't see it again:</p>
    <div class="code-block">{key}</div>
    <p>Get started:</p>
    <ul style="color:#a3a3a3; line-height:2.2; font-size:14px;">
      <li><a href="https://sulcus.ca/docs">Documentation</a></li>
      <li><a href="https://sulcus.ca/docs/claude-code-setup">Claude Code Setup</a></li>
      <li><a href="https://sulcus.ca/dashboard">Dashboard</a></li>
    </ul>
    {footer}
  </div>
</body>
</html>"#,
        styles = EMAIL_STYLES,
        header = EMAIL_HEADER,
        footer = EMAIL_FOOTER,
        tenant = tenant_id,
        key = api_key,
    );

    send_email(to, subject, &html).await
}

/// Send a platform invite — inviting someone to create their own fresh Sulcus account.
pub async fn send_platform_invite_email(
    to: &str,
    invitation_token: &str,
    from_tenant: &str,
) -> Result<(), String> {
    let signup_url = format!("https://sulcus.ca/register?invite={}", invitation_token);

    let subject = "You've been invited to try Sulcus";

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>{styles}</style>
</head>
<body>
  <div class="container">
    {header}
    <h1>You've been invited to try Sulcus</h1>
    <p>You've been invited by <strong>{from}</strong> to try Sulcus — a reactive memory engine for AI agents.</p>

    <div class="feature">
      <strong>What Sulcus does:</strong><br>
      <span style="color:#a3a3a3;">Persistent, intelligent memory for AI agents. Memories heat up when used, cool down over time, and get recalled exactly when needed.</span>
    </div>

    <p><a href="{url}" class="btn">Create Your Free Account &rarr;</a></p>

    <p style="font-size:12px; color:#555;">Or paste this link in your browser:</p>
    <p style="font-size:11px; color:#555; word-break:break-all;">{url}</p>

    <div class="divider"></div>

    <p style="font-size:12px; color:#555;">This invitation expires in 24 hours. Your account is completely independent — your data is your own.</p>
    {footer}
  </div>
</body>
</html>"#,
        styles = EMAIL_STYLES,
        header = EMAIL_HEADER,
        footer = EMAIL_FOOTER,
        from = from_tenant,
        url = signup_url,
    );

    send_email(to, &subject, &html).await
}

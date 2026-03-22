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

// ── Invite email template ──────────────────────────────────────────

/// Send a service invitation email with the given token.
pub async fn send_invite_email(
    to: &str,
    invitation_token: &str,
    tenant_name: &str,
) -> Result<(), String> {
    let join_url = format!(
        "https://sulcus.ca/join?token={}",
        invitation_token
    );

    let subject = format!("You've been invited to Sulcus by {}", tenant_name);

    let html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px; }}
    .container {{ max-width: 560px; margin: 0 auto; background: #171717; border-radius: 12px; padding: 40px; border: 1px solid #262626; }}
    h1 {{ color: #fafafa; font-size: 24px; margin: 0 0 16px; }}
    p {{ line-height: 1.6; color: #a3a3a3; }}
    .btn {{ display: inline-block; background: #3b82f6; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0; }}
    .btn:hover {{ background: #2563eb; }}
    .token {{ background: #262626; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 14px; word-break: break-all; color: #d4d4d4; }}
    .footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #262626; font-size: 12px; color: #737373; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>🧠 You're invited to Sulcus</h1>
    <p><strong>{tenant}</strong> has invited you to join their Sulcus workspace — thermodynamic memory for AI agents.</p>
    <p><a href="{url}" class="btn">Accept Invitation</a></p>
    <p>Or use this invitation token manually:</p>
    <div class="token">{token}</div>
    <p>This invitation expires in 24 hours.</p>
    <div class="footer">
      <p>Sulcus — Memory that thinks. <a href="https://sulcus.ca" style="color:#3b82f6;">sulcus.ca</a></p>
      <p>Digital Forge Studios · contact@dforge.ca</p>
    </div>
  </div>
</body>
</html>"#,
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
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 40px 20px; }}
    .container {{ max-width: 560px; margin: 0 auto; background: #171717; border-radius: 12px; padding: 40px; border: 1px solid #262626; }}
    h1 {{ color: #fafafa; font-size: 24px; margin: 0 0 16px; }}
    p {{ line-height: 1.6; color: #a3a3a3; }}
    .key {{ background: #262626; padding: 12px 16px; border-radius: 6px; font-family: monospace; font-size: 14px; word-break: break-all; color: #d4d4d4; }}
    .footer {{ margin-top: 32px; padding-top: 16px; border-top: 1px solid #262626; font-size: 12px; color: #737373; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>🧠 Welcome to Sulcus</h1>
    <p>You're in. Your workspace <strong>{tenant}</strong> is ready.</p>
    <p>Here's your API key — save it somewhere safe, you won't see it again:</p>
    <div class="key">{key}</div>
    <p>Get started:</p>
    <ul style="color:#a3a3a3; line-height:2;">
      <li><a href="https://sulcus.ca/docs" style="color:#3b82f6;">Documentation</a></li>
      <li><a href="https://sulcus.ca/docs/claude-code-setup" style="color:#3b82f6;">Claude Code Setup</a></li>
      <li><a href="https://sulcus.ca/dashboard" style="color:#3b82f6;">Dashboard</a></li>
    </ul>
    <div class="footer">
      <p>Sulcus — Memory that thinks. <a href="https://sulcus.ca" style="color:#3b82f6;">sulcus.ca</a></p>
      <p>Digital Forge Studios · contact@dforge.ca</p>
    </div>
  </div>
</body>
</html>"#,
        tenant = tenant_id,
        key = api_key,
    );

    send_email(to, subject, &html).await
}

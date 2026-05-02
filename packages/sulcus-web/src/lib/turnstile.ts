const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || "";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  if (!TURNSTILE_SECRET) {
    // If no secret configured, skip verification (dev mode)
    console.warn("[turnstile] No TURNSTILE_SECRET_KEY configured — skipping verification");
    return true;
  }

  if (!token) return false;

  try {
    const body: Record<string, string> = {
      secret: TURNSTILE_SECRET,
      response: token,
    };
    if (remoteIp) body.remoteip = remoteIp;

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] Verification failed:", e);
    return false;
  }
}

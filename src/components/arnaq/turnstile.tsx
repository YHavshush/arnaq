"use client";

import Script from "next/script";
import { useEffect } from "react";
import { captchaEnabled } from "@/lib/auth/captcha";

declare global {
  interface Window {
    turnstile?: { reset: (widget?: string | HTMLElement) => void };
  }
}

/**
 * The Turnstile box. It puts its token in the form it sits in (field `cf-turnstile-response`). A token works once, so
 * `resetOn` (the form's last answer) gets a fresh one after every submit. Renders nothing when CAPTCHA is off.
 */
export function Turnstile({ resetOn }: { resetOn?: unknown }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (resetOn !== undefined && resetOn !== null) window.turnstile?.reset();
  }, [resetOn]);
  if (!captchaEnabled() || !siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" />
    </>
  );
}

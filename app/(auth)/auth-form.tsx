"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, Loader2, Lock, Mail, UserRound } from "lucide-react";
import { signIn, signUp, type AuthFormState } from "./actions";
import styles from "./auth.module.css";

const MODES = {
  "sign-in": {
    action: signIn,
    kicker: "Welcome back",
    title: "Sign in to your",
    accent: "city",
    subtitle: "Your agents have been busy. Let’s see what they made.",
    submit: "Enter the city",
    pending: "Unlocking HQ…",
    switchText: "New to Creator City?",
    switchLink: { href: "/sign-up", label: "Claim your plot" },
  },
  "sign-up": {
    action: signUp,
    kicker: "Free to start",
    title: "Build your",
    accent: "creator city",
    subtitle: "Create an account and your headquarters goes up right away.",
    submit: "Create my city",
    pending: "Pouring the foundation…",
    switchText: "Already have a city?",
    switchLink: { href: "/sign-in", label: "Sign in" },
  },
} as const;

const STRENGTH = [
  { label: "Too short", tone: "weak" },
  { label: "Weak", tone: "weak" },
  { label: "Fair", tone: "fair" },
  { label: "Good", tone: "good" },
  { label: "Strong", tone: "strong" },
] as const;

/** 0 until the 8-character minimum is met, then one point per extra trait, capped at 4. */
function passwordScore(value: string) {
  if (value.length < 8) return 0;
  let score = 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) score++;
  return Math.min(score, 4);
}

export function AuthForm({ mode }: { mode: keyof typeof MODES }) {
  const copy = MODES[mode];
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(copy.action, {});
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const ids = useId();
  const score = passwordScore(password);
  const strength = STRENGTH[score];
  // A short password still lights one red bar so typing gets immediate feedback.
  const filledBars = password ? Math.max(score, 1) : 0;
  const isSignUp = mode === "sign-up";

  return (
    <div className={styles.card}>
      <span className={styles.kicker}>{copy.kicker}</span>
      <h1 className={styles.title}>
        {copy.title} <span className={styles.titleAccent}>{copy.accent}</span>
      </h1>
      <p className={styles.subtitle}>{copy.subtitle}</p>

      <a href="/auth/google" className={styles.google} aria-disabled={pending || undefined}>
        <GoogleIcon />
        Continue with Google
      </a>

      <div className={styles.divider}><span>or use email</span></div>

      <form action={formAction} className={styles.form} noValidate>
        {isSignUp && (
          <div className={styles.field}>
            <label htmlFor={`${ids}-name`}>Name</label>
            <div className={styles.inputWrap}>
              <UserRound className={styles.inputIcon} size={17} aria-hidden="true" />
              <input id={`${ids}-name`} name="name" type="text" autoComplete="name" required
                defaultValue={state.fields?.name} placeholder="Ada Lovelace" />
            </div>
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor={`${ids}-email`}>Email</label>
          <div className={styles.inputWrap}>
            <Mail className={styles.inputIcon} size={17} aria-hidden="true" />
            <input id={`${ids}-email`} name="email" type="email" autoComplete="email" required
              defaultValue={state.fields?.email} placeholder="you@studio.com" />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor={`${ids}-password`}>Password</label>
          <div className={styles.inputWrap}>
            <Lock className={styles.inputIcon} size={17} aria-hidden="true" />
            <input id={`${ids}-password`} name="password" type={showPassword ? "text" : "password"} required
              minLength={isSignUp ? 8 : undefined}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder={isSignUp ? "At least 8 characters" : "Your password"}
              aria-describedby={isSignUp ? `${ids}-strength` : undefined} />
            <button type="button" className={styles.reveal} onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {isSignUp && (
            <div id={`${ids}-strength`} className={styles.strength} data-tone={password ? strength.tone : undefined}>
              <div className={styles.strengthBars} aria-hidden="true">
                {[1, 2, 3, 4].map(n => <span key={n} data-on={filledBars >= n || undefined} />)}
              </div>
              <span aria-live="polite">{password ? strength.label : "Use 8+ characters with a mix of letters, numbers and symbols."}</span>
            </div>
          )}
        </div>

        {state.error && (
          <p role="alert" className={styles.error}>
            <CircleAlert size={17} aria-hidden="true" />
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending} className={styles.submit}>
          {pending ? (
            <><Loader2 className={styles.spin} size={18} aria-hidden="true" />{copy.pending}</>
          ) : (
            <>{copy.submit}<ArrowRight className={styles.submitArrow} size={18} aria-hidden="true" /></>
          )}
        </button>
      </form>

      <p className={styles.switch}>
        {copy.switchText}{" "}
        <Link href={copy.switchLink.href}>{copy.switchLink.label}</Link>
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

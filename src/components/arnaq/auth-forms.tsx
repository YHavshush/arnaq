"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  changePassword,
  confirmLink,
  forgotPassword,
  signIn,
  signUp,
  updatePassword,
  type ErrorKey,
  type FormState,
} from "@/app/(auth)/actions";
import { useI18n } from "@/i18n/client";
import { MIN_PASSWORD } from "@/lib/auth/validate";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";
import { Turnstile } from "./turnstile";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function useAuthAction(action: Action) {
  const [state, run, pending] = useActionState(action, null);
  const { t } = useI18n();
  const e = t.auth.errors;
  const message = (key: ErrorKey) => (key === "short" ? e.short(MIN_PASSWORD) : e[key]);
  return { state, run, pending, error: state?.error ? message(state.error) : null, t };
}

/** The card every sign-in page sits in. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass fade-in grid gap-5 p-6">
      <h1 className="font-display text-[28px] leading-tight font-medium tracking-tight text-balance">
        {title}
      </h1>
      {children}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div role="status" className="grid gap-2">
      <h2 className="font-display text-2xl font-medium">{title}</h2>
      <p className="text-ink-muted text-[15px]">{body}</p>
    </div>
  );
}

const linkClass = "text-accent font-semibold";

export function LoginForm({ next, confirmed }: { next: string; confirmed?: boolean }) {
  const { state, run, pending, error, t } = useAuthAction(signIn);
  const m = t.auth;
  return (
    <AuthCard title={m.login.title}>
      {confirmed ? (
        <p role="status" className="text-ink-muted text-[15px]">
          {m.login.confirmed}
        </p>
      ) : null}
      <form action={run} className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label={m.fields.email}>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            defaultValue={state?.email ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label={m.fields.password}>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </Field>
        <Turnstile resetOn={state} />
        <ErrorLine message={error} />
        <div>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? m.login.busy : m.login.submit}
          </PrimaryButton>
        </div>
      </form>
      <div className="text-ink-muted grid gap-1 text-sm">
        <Link href="/forgot-password" className={linkClass}>
          {m.login.forgot}
        </Link>
        <p>
          {m.login.noAccount}{" "}
          <Link href="/register" className={linkClass}>
            {m.login.createOne}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}

export function RegisterForm() {
  const { state, run, pending, error, t } = useAuthAction(signUp);
  const m = t.auth;
  if (state?.sent)
    return (
      <AuthCard title={m.register.checkTitle}>
        <Notice title={m.register.checkTitle} body={m.register.checkBody(state.sent.email)} />
        <Link href="/login" className={`${linkClass} text-sm`}>
          {m.forgot.back}
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title={m.register.title}>
      <form action={run} className="grid gap-4">
        <Field label={m.fields.email}>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            defaultValue={state?.email ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label={m.fields.password} hint={m.fields.passwordHint(MIN_PASSWORD)}>
          <input
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Field label={m.fields.confirmPassword}>
          <input
            name="repeat"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Turnstile resetOn={state} />
        <ErrorLine message={error} />
        <div>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? m.register.busy : m.register.submit}
          </PrimaryButton>
        </div>
      </form>
      <p className="text-ink-muted text-sm">
        {m.register.haveAccount}{" "}
        <Link href="/login" className={linkClass}>
          {m.register.signIn}
        </Link>
      </p>
    </AuthCard>
  );
}

export function ForgotForm() {
  const { state, run, pending, error, t } = useAuthAction(forgotPassword);
  const m = t.auth;
  if (state?.sent)
    return (
      <AuthCard title={m.forgot.sentTitle}>
        <Notice title={m.forgot.sentTitle} body={m.forgot.sentBody(state.sent.email)} />
        <Link href="/login" className={`${linkClass} text-sm`}>
          {m.forgot.back}
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title={m.forgot.title}>
      <p className="text-ink-muted text-[15px]">{m.forgot.intro}</p>
      <form action={run} className="grid gap-4">
        <Field label={m.fields.email}>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            defaultValue={state?.email ?? ""}
            className={inputClass}
          />
        </Field>
        <Turnstile resetOn={state} />
        <ErrorLine message={error} />
        <div>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? m.forgot.busy : m.forgot.submit}
          </PrimaryButton>
        </div>
      </form>
      <Link href="/login" className={`${linkClass} text-sm`}>
        {m.forgot.back}
      </Link>
    </AuthCard>
  );
}

export function ResetForm({ email }: { email: string | null }) {
  const { run, pending, error, t } = useAuthAction(updatePassword);
  const m = t.auth;
  return (
    <AuthCard title={m.reset.title}>
      {email ? <p className="text-ink-muted text-[15px]">{m.reset.forAccount(email)}</p> : null}
      <form action={run} className="grid gap-4">
        <Field label={m.fields.newPassword} hint={m.fields.passwordHint(MIN_PASSWORD)}>
          <input
            name="password"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label={m.fields.confirmPassword}>
          <input
            name="repeat"
            type="password"
            required
            minLength={MIN_PASSWORD}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <ErrorLine message={error} />
        <div>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? m.reset.busy : m.reset.submit}
          </PrimaryButton>
        </div>
      </form>
    </AuthCard>
  );
}

/** Shown by /auth/confirm: nothing happens until this button is pressed. */
export function ConfirmForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const { run, pending, error, t } = useAuthAction(confirmLink);
  const m = t.auth;
  return (
    <AuthCard title={m.confirm.title}>
      <p className="text-ink-muted text-[15px]">
        {type === "recovery" ? m.confirm.bodyRecovery : m.confirm.bodyEmail}
      </p>
      <form action={run} className="grid gap-4">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <ErrorLine message={error} />
        <div>
          <PrimaryButton type="submit" disabled={pending}>
            {pending ? m.confirm.busy : m.confirm.submit}
          </PrimaryButton>
        </div>
      </form>
    </AuthCard>
  );
}

export function InvalidLink() {
  const { t } = useI18n();
  const m = t.auth;
  return (
    <AuthCard title={m.confirm.invalidTitle}>
      <p className="text-ink-muted text-[15px]">{m.confirm.invalidBody}</p>
      <Link href="/login" className={`${linkClass} text-sm`}>
        {m.confirm.backToSignIn}
      </Link>
    </AuthCard>
  );
}

/** Change the password from Settings: needs the current one. */
export function ChangePasswordForm() {
  const { state, run, pending, error, t } = useAuthAction(changePassword);
  const m = t.auth;
  return (
    <form action={run} className="grid gap-4">
      <p className="text-ink-muted max-w-[52ch] text-[14px]">{m.change.hint}</p>
      <Field label={m.fields.currentPassword}>
        <input
          name="current"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>
      <Field label={m.fields.newPassword} hint={m.fields.passwordHint(MIN_PASSWORD)}>
        <input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      <Field label={m.fields.confirmPassword}>
        <input
          name="repeat"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      <Turnstile resetOn={state} />
      <ErrorLine message={error} />
      <div aria-live="polite" className="text-ink-muted text-[14px]">
        {state?.done ? m.change.done : null}
      </div>
      <div>
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? m.change.busy : m.change.submit}
        </PrimaryButton>
      </div>
    </form>
  );
}

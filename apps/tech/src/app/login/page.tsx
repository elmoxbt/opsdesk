"use client";

import { api, type AuthUser, errorMessage, loginSchema } from "@opsdesk/shared";
import { Button } from "@opsdesk/ui/button";
import { Field } from "@opsdesk/ui/field";
import { Input } from "@opsdesk/ui/input";
import { Logo } from "@opsdesk/ui/logo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return setErrors({ email: f.email?.[0], password: f.password?.[0] });
    }
    setBusy(true);
    setErrors({});
    try {
      const { user } = await api<{ user: AuthUser }>("/auth/login", { method: "POST", body: parsed.data });
      qc.setQueryData(["me"], user);
      router.replace("/");
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-5 py-10">
      <Logo className="text-lg" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your jobs, ready even without signal.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email}>
          <Input
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            className="h-12 text-base"
          />
        </Field>
        <Field label="Password" error={errors.password}>
          <Input name="password" type="password" autoComplete="current-password" className="h-12 text-base" />
        </Field>
        {errors.form && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <Button type="submit" size="lg" className="h-12 w-full text-base" loading={busy}>
          Sign in
        </Button>
      </form>
    </main>
  );
}

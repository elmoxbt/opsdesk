"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type AuthUser, type LoginInput, loginSchema } from "@opsdesk/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@opsdesk/ui/button";
import { Field } from "@opsdesk/ui/field";
import { Input } from "@opsdesk/ui/input";
import { api, errorMessage } from "@/lib/api/client";
import { qk } from "@/lib/api/hooks";
import { handleFormError } from "@/lib/forms";
import { safeNext } from "@/lib/redirect";

export interface DemoLogins {
  password: string;
  accounts: Array<{ role: string; email: string; hint: string }>;
}

export function LoginForm({ demo }: { demo?: DemoLogins }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const signIn = async (values: LoginInput) => {
    const { user } = await api<{ user: AuthUser }>("/auth/login", { method: "POST", body: values });
    qc.setQueryData(qk.me, user);
    toast.success(`Welcome back, ${user.name.split(" ")[0]}`);
    router.replace(safeNext(params.get("next")));
  };
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signIn(values);
    } catch (e) {
      handleFormError(e, form.setError, ["email", "password"]);
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back. Pick up where your team left off.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here? Ask your manager for an invitation.
      </p>
      {demo && (
        <section aria-labelledby="demo-logins" className="mt-8 border-t pt-6">
          <h2 id="demo-logins" className="text-sm font-medium">
            Try the demo
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Sample data, reset regularly. Pick a role:</p>
          <div className="mt-3 grid gap-2">
            {demo.accounts.map((a) => (
              <Button
                key={a.email}
                type="button"
                variant="outline"
                className="h-auto justify-start py-2.5 text-left"
                loading={demoBusy === a.email}
                disabled={demoBusy !== null}
                onClick={async () => {
                  setDemoBusy(a.email);
                  try {
                    await signIn({ email: a.email, password: demo.password });
                  } catch (e) {
                    toast.error(errorMessage(e));
                    setDemoBusy(null);
                  }
                }}
              >
                <span>
                  <span className="block font-medium">Sign in as {a.role}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{a.hint}</span>
                </span>
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

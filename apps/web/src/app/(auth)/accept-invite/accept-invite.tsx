"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { acceptInvitationSchema, type AuthUser, type Role } from "@opsdesk/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { NotFoundIllustration } from "@opsdesk/ui/illustrations";
import { Button } from "@opsdesk/ui/button";
import { Field } from "@opsdesk/ui/field";
import { Input } from "@opsdesk/ui/input";
import { Skeleton } from "@opsdesk/ui/skeleton";
import { EmptyState } from "@opsdesk/ui/states";
import { api } from "@/lib/api/client";
import { qk } from "@/lib/api/hooks";
import { handleFormError } from "@/lib/forms";

type Values = z.input<typeof acceptInvitationSchema>;

export function AcceptInvite() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () =>
      api<{ email: string; role: Role; organizationName: string }>("/invitations/lookup", {
        query: { token },
      }),
    enabled: token.length > 0,
    retry: false,
  });
  const form = useForm<Values>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { token, name: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { user } = await api<{ user: AuthUser }>("/invitations/accept", { method: "POST", body: values });
      qc.setQueryData(qk.me, user);
      toast.success(`Welcome to ${user.organization.name}`);
      router.replace("/dashboard");
    } catch (e) {
      handleFormError(e, form.setError, ["name", "password"]);
    }
  });

  if (!token || invite.isError) {
    return (
      <EmptyState
        illustration={NotFoundIllustration}
        title="This invite link isn't valid"
        description="It may have expired or already been used. Ask your manager to send a new one."
        action={
          <Button asChild variant="outline">
            <Link href="/login">Go to sign in</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div>
      {invite.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Join {invite.data.organizationName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You&apos;ve been invited as a {invite.data.role.toLowerCase()} ({invite.data.email}).
          </p>
        </>
      )}
      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <Field label="Your name" error={errors.name?.message}>
          <Input autoComplete="name" autoFocus {...form.register("name")} />
        </Field>
        <Field label="Choose a password" error={errors.password?.message} hint="At least 10 characters">
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting} disabled={invite.isPending}>
          Join team
        </Button>
      </form>
    </div>
  );
}

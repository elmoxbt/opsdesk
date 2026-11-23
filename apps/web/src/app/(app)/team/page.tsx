"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateInvitationInput,
  createInvitationSchema,
  INVITABLE_ROLES,
  type UserDto,
} from "@opsdesk/shared";
import { MailPlus, MoreHorizontal, UserMinus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { TeamIllustration } from "@opsdesk/ui/illustrations";
import { Avatar } from "@opsdesk/ui/avatar";
import { Button } from "@opsdesk/ui/button";
import { Card, CardHeader, CardTitle } from "@opsdesk/ui/card";
import { ConfirmDialog } from "@opsdesk/ui/confirm-dialog";
import { Dialog } from "@opsdesk/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@opsdesk/ui/dropdown-menu";
import { Field } from "@opsdesk/ui/field";
import { Input, NativeSelect } from "@opsdesk/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@opsdesk/ui/states";
import { AnimatedItem, TableSkeleton, useFirstLoad } from "@opsdesk/ui/table";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import {
  useChangeRole,
  useDeactivateUser,
  useInvitations,
  useInvite,
  useRevokeInvitation,
  useUsers,
} from "@/lib/api/hooks";
import { formatDateTime, relativeTime } from "@/lib/format";
import { handleFormError } from "@/lib/forms";
import { PageTitle } from "@opsdesk/ui/page-title";

const ROLE_LABEL = { OWNER: "Owner", DISPATCHER: "Dispatcher", TECHNICIAN: "Technician" } as const;

export default function TeamPage() {
  const me = useSession();
  const users = useUsers();
  const invitations = useInvitations();
  const revoke = useRevokeInvitation();
  const changeRole = useChangeRole();
  const deactivate = useDeactivateUser();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<UserDto | null>(null);
  const animate = useFirstLoad(users.isSuccess);
  const isOwner = me.role === "OWNER";

  return (
    <div className="space-y-6">
      <PageTitle>Team</PageTitle>
      <PageHeader
        title="Team"
        description="People who can sign in to your workspace."
        actions={
          <Button onClick={() => setInviting(true)}>
            <MailPlus aria-hidden /> Invite
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        {users.isPending ? (
          <TableSkeleton rows={3} cols={3} />
        ) : users.isError ? (
          <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        ) : (
          <ul className="divide-y">
            {users.data.items.map((u, i) => (
              <AnimatedItem
                key={u.id}
                index={i}
                animate={animate}
                className="flex items-center gap-3 px-5 py-3"
              >
                <Avatar name={u.name} src={u.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {u.name}{" "}
                    {u.id === me.id && (
                      <span className="text-xs font-normal text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                </div>
                <div className="hidden text-right text-xs text-muted-foreground sm:block">
                  {u.isActive
                    ? u.lastLoginAt
                      ? `Active ${relativeTime(u.lastLoginAt)}`
                      : "Never signed in"
                    : "Deactivated"}
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                  {ROLE_LABEL[u.role]}
                </span>
                {isOwner && u.role !== "OWNER" && u.isActive ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${u.name}`}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>Change role</DropdownMenuLabel>
                      {(["DISPATCHER", "TECHNICIAN"] as const).map((r) => (
                        <DropdownMenuItem
                          key={r}
                          disabled={u.role === r}
                          onSelect={() =>
                            changeRole.mutate(
                              { id: u.id, role: r },
                              {
                                onSuccess: () =>
                                  toast.success(`${u.name} is now a ${ROLE_LABEL[r].toLowerCase()}`),
                                onError: (e) => toast.error(errorMessage(e)),
                              },
                            )
                          }
                        >
                          {ROLE_LABEL[r]}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setRemoving(u)}>
                        <UserMinus aria-hidden /> Deactivate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="size-10" aria-hidden />
                )}
              </AnimatedItem>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        {invitations.isPending ? (
          <TableSkeleton rows={2} cols={3} />
        ) : invitations.isError ? (
          <ErrorState message={errorMessage(invitations.error)} onRetry={() => void invitations.refetch()} />
        ) : invitations.data.length === 0 ? (
          <EmptyState
            illustration={TeamIllustration}
            title="No pending invitations"
            description="Invite dispatchers and technicians. They'll get an email link that's valid for 72 hours."
            action={
              <Button variant="outline" onClick={() => setInviting(true)}>
                <MailPlus aria-hidden /> Invite someone
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABEL[inv.role]} · expires {formatDateTime(inv.expiresAt, me.organization.timezone)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    revoke.mutate(inv.id, {
                      onSuccess: () => toast.success("Invitation revoked"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <X aria-hidden /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Deactivate ${removing?.name ?? "user"}?`}
        description="They'll be signed out everywhere immediately. Their past jobs and activity are kept."
        confirmLabel="Deactivate"
        destructive
        loading={deactivate.isPending}
        onConfirm={() =>
          removing &&
          deactivate.mutate(removing.id, {
            onSuccess: () => {
              toast.success(`${removing.name} deactivated`);
              setRemoving(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const invite = useInvite();
  const roles = INVITABLE_ROLES[me.role];
  const form = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: "", role: "TECHNICIAN" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await invite.mutateAsync(data);
      toast.success(`Invitation sent to ${data.email}`);
      form.reset();
      onOpenChange(false);
    } catch (e) {
      handleFormError(e, form.setError, ["email", "role"]);
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a teammate"
      description="They'll get an email with a link to set their password."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={isSubmitting}>
            Send invite
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field label="Email" required error={errors.email?.message}>
          <Input type="email" autoFocus {...form.register("email")} />
        </Field>
        <Field label="Role" error={errors.role?.message}>
          <NativeSelect {...form.register("role")}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </form>
    </Dialog>
  );
}

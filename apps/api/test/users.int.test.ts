import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, inviteAndAccept, createOrg, type TestContext } from "./utils";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

describe("users", () => {
  it("GET /api/users lists the org's users with pagination (owner + dispatcher only)", async () => {
    const owner = await createOrg(ctx.app);
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");

    const res = await owner.agent.get("/api/users").query({ page: 1, pageSize: 2 }).expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(res.body.items).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    await dispatcher.agent.get("/api/users").expect(200);
    await tech.agent.get("/api/users").expect(403);
  });

  it("PATCH /api/users/:id/role: owner can change roles; change applies immediately and is audited", async () => {
    const owner = await createOrg(ctx.app);
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    await tech.agent.get("/api/users").expect(403);

    await owner.agent.patch(`/api/users/${tech.user.id}/role`).send({ role: "DISPATCHER" }).expect(200);
    // Same access token, new permissions: role is re-read from the DB on each request.
    await tech.agent.get("/api/users").expect(200);

    const audit = await ctx.db.auditLog.findFirst({
      where: { entityId: tech.user.id, action: "user.role_changed" },
    });
    expect(audit).toMatchObject({
      actorId: owner.user.id,
      before: { role: "TECHNICIAN" },
      after: { role: "DISPATCHER" },
    });
  });

  it("only the owner may change roles, and nobody can promote to or demote the OWNER", async () => {
    const owner = await createOrg(ctx.app);
    const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");

    await dispatcher.agent.patch(`/api/users/${tech.user.id}/role`).send({ role: "DISPATCHER" }).expect(403);
    await owner.agent.patch(`/api/users/${tech.user.id}/role`).send({ role: "OWNER" }).expect(400);
    await owner.agent.patch(`/api/users/${owner.user.id}/role`).send({ role: "TECHNICIAN" }).expect(403);
    await owner.agent.patch(`/api/users/not-a-uuid/role`).send({ role: "TECHNICIAN" }).expect(400);
  });

  it("POST /api/users/:id/deactivate ends the user's sessions immediately", async () => {
    const owner = await createOrg(ctx.app);
    const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    await tech.agent.get("/api/auth/me").expect(200);

    const res = await owner.agent.post(`/api/users/${tech.user.id}/deactivate`).expect(200);
    expect(res.body.isActive).toBe(false);
    await tech.agent.get("/api/auth/me").expect(401);
    await tech.agent.post("/api/auth/refresh").expect(401);
  });
});

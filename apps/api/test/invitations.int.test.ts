import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, inviteAndAccept, PASSWORD, createOrg, type TestContext, unique } from "./utils";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const http = () => request(ctx.app.getHttpServer());

describe("invitations", () => {
  it("owner invites a dispatcher → email sent → accept creates the user in the same org and signs them in", async () => {
    const owner = await createOrg(ctx.app);
    const email = `${unique("disp")}@test.dev`;
    const created = await owner.agent
      .post("/api/invitations")
      .send({ email, role: "DISPATCHER" })
      .expect(201);
    expect(created.body).not.toHaveProperty("tokenHash");

    const token = ctx.mail.lastTokenFor(email);
    const lookup = await http().get("/api/invitations/lookup").query({ token }).expect(200);
    expect(lookup.body).toEqual({
      email,
      role: "DISPATCHER",
      organizationName: owner.user.organization.name,
    });

    const agent = request.agent(ctx.app.getHttpServer());
    const accepted = await agent
      .post("/api/invitations/accept")
      .send({ token, name: "Dee", password: PASSWORD })
      .expect(201);
    expect(accepted.body.user).toMatchObject({
      email,
      role: "DISPATCHER",
      organization: { id: owner.user.organization.id },
    });
    await agent.get("/api/auth/me").expect(200);
  });

  it("an invitation can only be used once", async () => {
    const owner = await createOrg(ctx.app);
    const email = `${unique("t")}@test.dev`;
    await owner.agent.post("/api/invitations").send({ email, role: "TECHNICIAN" }).expect(201);
    const token = ctx.mail.lastTokenFor(email);
    await http().post("/api/invitations/accept").send({ token, name: "T", password: PASSWORD }).expect(201);
    await http().post("/api/invitations/accept").send({ token, name: "T", password: PASSWORD }).expect(404);
  });

  it("expired invitations are rejected", async () => {
    const owner = await createOrg(ctx.app);
    const email = `${unique("t")}@test.dev`;
    const { body } = await owner.agent
      .post("/api/invitations")
      .send({ email, role: "TECHNICIAN" })
      .expect(201);
    await ctx.db.invitation.update({
      where: { id: body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http()
      .post("/api/invitations/accept")
      .send({ token: ctx.mail.lastTokenFor(email), name: "T", password: PASSWORD })
      .expect(404);
  });

  it("re-inviting invalidates the previous link", async () => {
    const owner = await createOrg(ctx.app);
    const email = `${unique("t")}@test.dev`;
    await owner.agent.post("/api/invitations").send({ email, role: "TECHNICIAN" }).expect(201);
    const oldToken = ctx.mail.lastTokenFor(email);
    await owner.agent.post("/api/invitations").send({ email, role: "TECHNICIAN" }).expect(201);
    await http().get("/api/invitations/lookup").query({ token: oldToken }).expect(404);
  });

  it("rejects inviting an email that already has an account", async () => {
    const owner = await createOrg(ctx.app);
    await owner.agent
      .post("/api/invitations")
      .send({ email: owner.user.email, role: "TECHNICIAN" })
      .expect(409);
  });

  it("lists and revokes pending invitations", async () => {
    const owner = await createOrg(ctx.app);
    const email = `${unique("t")}@test.dev`;
    const { body } = await owner.agent
      .post("/api/invitations")
      .send({ email, role: "TECHNICIAN" })
      .expect(201);
    const list = await owner.agent.get("/api/invitations").expect(200);
    expect(list.body.map((i: { id: string }) => i.id)).toEqual([body.id]);
    await owner.agent.delete(`/api/invitations/${body.id}`).expect(204);
    expect((await owner.agent.get("/api/invitations").expect(200)).body).toEqual([]);
    await http()
      .get("/api/invitations/lookup")
      .query({ token: ctx.mail.lastTokenFor(email) })
      .expect(404);
  });

  describe("RBAC", () => {
    it("dispatcher can invite technicians but not dispatchers", async () => {
      const owner = await createOrg(ctx.app);
      const dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
      await dispatcher.agent
        .post("/api/invitations")
        .send({ email: `${unique("t")}@test.dev`, role: "TECHNICIAN" })
        .expect(201);
      await dispatcher.agent
        .post("/api/invitations")
        .send({ email: `${unique("d")}@test.dev`, role: "DISPATCHER" })
        .expect(403);
    });

    it("technicians cannot invite or list invitations", async () => {
      const owner = await createOrg(ctx.app);
      const tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
      await tech.agent
        .post("/api/invitations")
        .send({ email: `${unique("t")}@test.dev`, role: "TECHNICIAN" })
        .expect(403);
      await tech.agent.get("/api/invitations").expect(403);
    });

    it("nobody can invite an OWNER", async () => {
      const owner = await createOrg(ctx.app);
      const res = await owner.agent
        .post("/api/invitations")
        .send({ email: `${unique("o")}@test.dev`, role: "OWNER" })
        .expect(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("unauthenticated callers get 401", async () => {
      await http().post("/api/invitations").send({ email: "a@b.co", role: "TECHNICIAN" }).expect(401);
    });
  });
});

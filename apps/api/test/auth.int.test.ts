import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieNames, createTestApp, PASSWORD, createOrg, type TestContext, unique } from "./utils";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const http = () => request(ctx.app.getHttpServer());

describe("single-business deployment", () => {
  it("has no public signup: the owner comes from bootstrap, everyone else is invited", async () => {
    await http()
      .post("/api/auth/signup")
      .send({
        organizationName: "X",
        organizationSlug: unique("x"),
        name: "X",
        email: "x@test.dev",
        password: PASSWORD,
      })
      .expect(404);
  });

  it("GET /api/config exposes branding + features publicly, without owner details", async () => {
    const res = await http().get("/api/config").expect(200);
    expect(res.body).toMatchObject({
      appName: expect.any(String),
      branding: { primaryColor: expect.stringMatching(/^#/) },
    });
    expect(Object.keys(res.body.features).sort()).toEqual([
      "analytics",
      "bookingPortal",
      "inventory",
      "payments",
      "publicApi",
      "technicianApp",
    ]);
    expect(res.body.branding.primaryForeground).toMatch(/^#/);
    expect(res.body).not.toHaveProperty("owner");
  });
});

describe("login response", () => {
  it("sets httpOnly cookies and never returns secrets", async () => {
    const { user } = await createOrg(ctx.app);
    const res = await http()
      .post("/api/auth/login")
      .send({ email: user.email.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect(res.body.user).toMatchObject({ role: "OWNER", email: user.email });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|token/i);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.every((c) => c.includes("HttpOnly"))).toBe(true);
    expect(cookieNames(res)).toEqual(expect.arrayContaining(["opsdesk_at", "opsdesk_rt"]));
  });

  it("returns 400 with field details on invalid input", async () => {
    const res = await http().post("/api/auth/login").send({ email: "bad" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details).toHaveProperty("email");
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    const { user } = await createOrg(ctx.app);
    const res = await http()
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect(res.body.user.id).toBe(user.id);
  });

  it("gives the same 401 for wrong password and unknown email", async () => {
    const { user } = await createOrg(ctx.app);
    const a = await http()
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password" })
      .expect(401);
    const b = await http()
      .post("/api/auth/login")
      .send({ email: "nobody@test.dev", password: "wrong-password" })
      .expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user via cookie", async () => {
    const { agent, user } = await createOrg(ctx.app);
    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body.id).toBe(user.id);
  });

  it("is 401 without a session, with the standard error shape", async () => {
    const res = await http().get("/api/auth/me").expect(401);
    expect(res.body).toEqual({
      error: { code: "UNAUTHENTICATED", message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it("rejects a tampered token", async () => {
    await http().get("/api/auth/me").set("Authorization", "Bearer not.a.jwt").expect(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh token, and reusing the old one revokes the whole family", async () => {
    const { agent } = await createOrg(ctx.app);
    const getRt = (res: request.Response) =>
      (res.headers["set-cookie"] as unknown as string[])
        .find((c) => c.startsWith("opsdesk_rt="))!
        .split(";")[0]!;

    const first = await agent.post("/api/auth/refresh").expect(200);
    const rt1 = getRt(first);
    const second = await agent.post("/api/auth/refresh").expect(200);
    const rt2 = getRt(second);
    expect(rt2).not.toBe(rt1);

    // Attacker replays the stolen, already-rotated rt1...
    await http().post("/api/auth/refresh").set("Cookie", rt1).expect(401);
    // ...which also kills the legitimate user's current token (family revoked).
    await http().post("/api/auth/refresh").set("Cookie", rt2).expect(401);
  });

  it("is 401 with no cookie", async () => {
    await http().post("/api/auth/refresh").expect(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the refresh token and clears cookies", async () => {
    const { agent } = await createOrg(ctx.app);
    const res = await agent.post("/api/auth/logout").expect(204);
    expect(cookieNames(res)).toEqual(expect.arrayContaining(["opsdesk_at", "opsdesk_rt"]));
    await agent.post("/api/auth/refresh").expect(401);
  });
});

describe("GET /api/health", () => {
  it("is public and reports the DB", async () => {
    await http().get("/api/health").expect(200, { status: "ok", db: "up" });
  });
});

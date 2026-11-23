import type { AddressInfo } from "node:net";
import { type JobChangedEvent, REALTIME_EVENTS } from "@opsdesk/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  accessTokenFor,
  createCustomer,
  createJob,
  createService,
  createTestApp,
  inviteAndAccept,
  type SignedIn,
  createOrg,
  type TestContext,
} from "./utils";

let ctx: TestContext;
let url: string;
let owner: SignedIn;
let dispatcher: SignedIn;
let tech: SignedIn;
let tech2: SignedIn;
let otherOrg: SignedIn;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.app.listen(0);
  url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  owner = await createOrg(ctx.app);
  dispatcher = await inviteAndAccept(ctx, owner.agent, "DISPATCHER");
  tech = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  tech2 = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
  otherOrg = await createOrg(ctx.app);
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});
afterAll(() => ctx.close());

function connect(token?: string): Promise<Socket> {
  const socket = io(url, {
    transports: ["websocket"],
    auth: token ? { token } : {},
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (e) => reject(e));
  });
}
const connectAs = async (who: SignedIn) => connect(await accessTokenFor(ctx.app, who.user.email));

/** Collects job.changed events; `settle` waits so "received nothing" assertions are meaningful. */
function collect(socket: Socket): JobChangedEvent[] {
  const got: JobChangedEvent[] = [];
  socket.on(REALTIME_EVENTS.jobChanged, (e: JobChangedEvent) => got.push(e));
  return got;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("realtime gateway", () => {
  it("rejects handshakes without a valid token", async () => {
    await expect(connect()).rejects.toThrow("UNAUTHENTICATED");
    await expect(connect("not-a-jwt")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("rejects browser handshakes from a foreign origin, even with a valid token", async () => {
    const token = await accessTokenFor(ctx.app, owner.user.email);
    const socket = io(url, {
      transports: ["websocket"],
      auth: { token },
      extraHeaders: { Origin: "https://evil.example" },
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await expect(
      new Promise((resolve, reject) => {
        socket.once("connect", () => resolve(undefined));
        socket.once("connect_error", reject);
      }),
    ).rejects.toThrow("FORBIDDEN_ORIGIN");
  });

  it("pushes job changes to managers and the assigned technician only, never across tenants", async () => {
    const [mgr, mine, other, foreign] = await Promise.all([
      connectAs(dispatcher),
      connectAs(tech),
      connectAs(tech2),
      connectAs(otherOrg),
    ]);
    const [toMgr, toMine, toOther, toForeign] = [
      collect(mgr),
      collect(mine),
      collect(other),
      collect(foreign),
    ];

    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = await createJob(owner.agent, {
      customerId: c.id,
      serviceTypeId: s.id,
      technicianId: tech.user.id,
      scheduledStart: "2032-01-01T09:00:00Z",
    });
    await owner.agent.post(`/api/jobs/${job.id}/transitions`).send({ to: "EN_ROUTE" }).expect(200);
    await settle();

    expect(toMgr.map((e) => e.kind)).toEqual(["created", "status_changed"]);
    expect(toMgr[1]).toMatchObject({
      job: { id: job.id, status: "EN_ROUTE" },
      actor: { id: owner.user.id, name: "Owner" },
    });
    expect(toMine.map((e) => e.kind)).toEqual(["created", "status_changed"]);
    expect(toOther).toEqual([]);
    expect(toForeign).toEqual([]);
  });

  it("a reassignment notifies both the new and the previous technician", async () => {
    const [prev, next] = await Promise.all([connectAs(tech), connectAs(tech2)]);
    const [toPrev, toNext] = [collect(prev), collect(next)];
    const c = await createCustomer(owner.agent);
    const s = await createService(owner.agent);
    const job = await createJob(owner.agent, {
      customerId: c.id,
      serviceTypeId: s.id,
      technicianId: tech.user.id,
      scheduledStart: "2032-02-01T09:00:00Z",
    });
    await owner.agent
      .post(`/api/jobs/${job.id}/schedule`)
      .send({ technicianId: tech2.user.id, scheduledStart: "2032-02-01T11:00:00Z", version: job.version })
      .expect(200);
    await settle();
    expect(toPrev.map((e) => e.kind)).toEqual(["created", "rescheduled"]);
    expect(toNext.map((e) => e.kind)).toEqual(["rescheduled"]);
    expect(toNext[0]?.job.technician?.id).toBe(tech2.user.id);
  });

  it("deactivating a user disconnects their live sockets", async () => {
    const victim = await inviteAndAccept(ctx, owner.agent, "TECHNICIAN");
    const socket = await connectAs(victim);
    const closed = new Promise<string>((r) => socket.once("disconnect", (reason) => r(reason)));
    await owner.agent.post(`/api/users/${victim.user.id}/deactivate`).expect(200);
    expect(await closed).toBe("io server disconnect");
    await expect(connect(await accessTokenFor(ctx.app, victim.user.email).catch(() => "x"))).rejects.toThrow(
      "UNAUTHENTICATED",
    );
  });
});

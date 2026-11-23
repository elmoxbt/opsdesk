import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { ServerOptions } from "socket.io";

/**
 * Socket.IO with the same CORS allow-list as HTTP (credentials on, so the
 * httpOnly access cookie is sent on the handshake). Multi-instance fan-out
 * would swap in @socket.io/redis-adapter here; one instance needs nothing.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
  }
}

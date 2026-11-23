import type { RequestUser } from "../auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: RequestUser;
    }
  }
}

export {};

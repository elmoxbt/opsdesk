import { Inject, Injectable } from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { ENV, type Env } from "../config/env";

@Injectable()
export class PasswordService {
  /** Precomputed so login does equal work whether or not the email exists. */
  private dummyHash: Promise<string>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.dummyHash = hash("timing-equaliser", env.BCRYPT_ROUNDS);
  }

  hash(password: string): Promise<string> {
    return hash(password, this.env.BCRYPT_ROUNDS);
  }

  async verify(password: string, passwordHash: string | null | undefined): Promise<boolean> {
    if (!passwordHash) {
      await compare(password, await this.dummyHash);
      return false;
    }
    return compare(password, passwordHash);
  }
}

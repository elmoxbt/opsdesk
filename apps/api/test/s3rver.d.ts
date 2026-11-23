// Minimal types for s3rver (a local S3-compatible server used only in tests).
declare module "s3rver" {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory: string;
    configureBuckets?: Array<{ name: string }>;
  }
  export default class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<{ address: string; port: number }>;
    close(): Promise<void>;
  }
}

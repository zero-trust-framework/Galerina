declare module "node:crypto" {
  interface HashResult {
    update(data: string, encoding: string): HashResult;
    update(data: Uint8Array): HashResult;
    digest(format: "hex" | "base64" | "binary"): string;
  }
  export function createHash(algorithm: string): HashResult;

  interface GenerateKeyPairOptions {
    publicKeyEncoding?: { type: string; format: string };
    privateKeyEncoding?: { type: string; format: string };
  }
  interface GenerateKeyPairResult {
    publicKey: string;
    privateKey: string;
  }
  export function generateKeyPairSync(
    type: string,
    options: GenerateKeyPairOptions,
  ): GenerateKeyPairResult;

  interface KeyObjectSpec {
    key: string;
    dsaEncoding?: string;
  }
  export function sign(
    algorithm: string | null,
    data: BufferSource,
    keyObject: KeyObjectSpec,
  ): Buffer;
  export function verify(
    algorithm: string | null,
    data: BufferSource,
    keyObject: KeyObjectSpec,
    signature: BufferSource,
  ): boolean;

  export function timingSafeEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean;

  interface PublicKeyObject {
    export(options: { type: string; format: "der" }): Buffer;
    export(options: { type: string; format: "pem" }): string;
  }
  export function createPublicKey(
    key: string | Buffer | { key: Uint8Array | Buffer; format: string; type: string },
  ): PublicKeyObject;
}

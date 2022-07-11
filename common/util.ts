import { SocksClientChainOptions, SocksClientOptions } from "./constants.ts";

export class SocksClientError extends Error {
  constructor(
    message: string,
    public options: SocksClientOptions | SocksClientChainOptions,
  ) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
export function shuffleArray(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

export type RequireOnlyOne<T, Keys extends keyof T = keyof T> =
  & Pick<T, Exclude<keyof T, Keys>>
  & {
    [K in Keys]?:
      & Required<Pick<T, K>>
      & Partial<Record<Exclude<Keys, K>, undefined>>;
  }[Keys];

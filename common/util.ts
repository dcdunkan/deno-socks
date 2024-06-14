import { SocksClientChainOptions, SocksClientOptions } from "./constants.ts";

export class SocksClientError extends Error {
  constructor(
    message: string,
    public options: SocksClientOptions | SocksClientChainOptions,
  ) {
    super(message);
  }
}

export function shuffleArray(array: unknown[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

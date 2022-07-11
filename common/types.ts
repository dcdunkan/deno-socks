// Copied from Node declarations
interface OnReadOpts {
  buffer: Uint8Array | (() => Uint8Array);
  callback(bytesWritten: number, buf: Uint8Array): boolean;
}

interface ConnectOpts {
  onread?: OnReadOpts | undefined;
}

interface LookupOptions {
  family?: number | undefined;
  hints?: number | undefined;
  all?: boolean | undefined;
  verbatim?: boolean | undefined;
}

interface LookupOneOptions extends LookupOptions {
  all?: false | undefined;
}

interface IpcSocketConnectOpts extends ConnectOpts {
  path: string;
}

interface ErrnoException extends Error {
  errno?: number | undefined;
  code?: string | undefined;
  path?: string | undefined;
  syscall?: string | undefined;
}

type LookupFunction = (
  hostname: string,
  options: LookupOneOptions,
  callback: (
    err: ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) => void;

interface TcpSocketConnectOpts extends ConnectOpts {
  port: number;
  host?: string | undefined;
  localAddress?: string | undefined;
  localPort?: number | undefined;
  hints?: number | undefined;
  family?: number | undefined;
  lookup?: LookupFunction | undefined;
}

export type SocketConnectOpts = TcpSocketConnectOpts | IpcSocketConnectOpts;

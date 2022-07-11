import { Buffer } from "https://deno.land/std@0.147.0/node/buffer.ts";
import { Duplex } from "https://deno.land/std@0.147.0/node/stream.ts";
import { Socket } from "https://deno.land/std@0.147.0/node/net.ts";
import { SocketConnectOpts } from "./types.ts";
import { RequireOnlyOne } from "./util.ts";

export const DEFAULT_TIMEOUT = 30000;
export const SOCKS5_CUSTOM_AUTH_START = 0x80;
export const SOCKS5_CUSTOM_AUTH_END = 0xfe;
export const SOCKS5_NO_ACCEPTABLE_AUTH = 0xff;

export const SOCKS_INCOMING_PACKET_SIZES = {
  Socks5InitialHandshakeResponse: 2,
  Socks5UserPassAuthenticationResponse: 2,
  Socks5ResponseHeader: 5,
  Socks5ResponseIPv4: 10,
  Socks5ResponseIPv6: 22,
  Socks5ResponseHostname: (hostNameLength: number) => hostNameLength + 7,
  Socks4Response: 8,
};

// deno-fmt-ignore
export const ERRORS = {
  InvalidSocksCommand: 'An invalid SOCKS command was provided. Valid options are connect, bind, and associate.',
  InvalidSocksCommandForOperation: 'An invalid SOCKS command was provided. Only a subset of commands are supported for this operation.',
  InvalidSocksCommandChain: 'An invalid SOCKS command was provided. Chaining currently only supports the connect command.',
  InvalidSocksClientOptionsDestination: 'An invalid destination host was provided.',
  InvalidSocksClientOptionsExistingSocket: 'An invalid existing socket was provided. This should be an instance of stream.Duplex.',
  InvalidSocksClientOptionsProxy: 'Invalid SOCKS proxy details were provided.',
  InvalidSocksClientOptionsTimeout: 'An invalid timeout value was provided. Please enter a value above 0 (in ms).',
  InvalidSocksClientOptionsProxiesLength: 'At least two socks proxies must be provided for chaining.',
  InvalidSocksClientOptionsCustomAuthRange: 'Custom auth must be a value between 0x80 and 0xFE.',
  InvalidSocksClientOptionsCustomAuthOptions: 'When a custom_auth_method is provided, custom_auth_request_handler, custom_auth_response_size, and custom_auth_response_handler must also be provided and valid.',
  NegotiationError: 'Negotiation error',
  SocketClosed: 'Socket closed',
  ProxyConnectionTimedOut: 'Proxy connection timed out',
  InternalError: 'SocksClient internal error (this should not happen)',
  InvalidSocks4HandshakeResponse: 'Received invalid Socks4 handshake response',
  Socks4ProxyRejectedConnection: 'Socks4 Proxy rejected connection',
  InvalidSocks4IncomingConnectionResponse: 'Socks4 invalid incoming connection response',
  Socks4ProxyRejectedIncomingBoundConnection: 'Socks4 Proxy rejected incoming bound connection',
  InvalidSocks5InitialHandshakeResponse: 'Received invalid Socks5 initial handshake response',
  InvalidSocks5IntiailHandshakeSocksVersion: 'Received invalid Socks5 initial handshake (invalid socks version)',
  InvalidSocks5InitialHandshakeNoAcceptedAuthType: 'Received invalid Socks5 initial handshake (no accepted authentication type)',
  InvalidSocks5InitialHandshakeUnknownAuthType: 'Received invalid Socks5 initial handshake (unknown authentication type)',
  Socks5AuthenticationFailed: 'Socks5 Authentication failed',
  InvalidSocks5FinalHandshake: 'Received invalid Socks5 final handshake response',
  InvalidSocks5FinalHandshakeRejected: 'Socks5 proxy rejected connection',
  InvalidSocks5IncomingConnectionResponse: 'Received invalid Socks5 incoming connection response',
  Socks5ProxyRejectedIncomingBoundConnection: 'Socks5 Proxy rejected incoming bound connection',
};

export type SocksProxyType = 4 | 5;
export type SocksCommandOption = "connect" | "bind" | "associate";
export type SocksClientBoundEvent = SocksClientEstablishedEvent;
export type SocksProxy = RequireOnlyOne<
  {
    ipaddress?: string;
    host?: string;
    port: number;
    type: SocksProxyType;
    userId?: string;
    password?: string;
    custom_auth_method?: number;
    custom_auth_request_handler?: () => Promise<Buffer>;
    custom_auth_response_size?: number;
    custom_auth_response_handler?: (data?: Buffer) => Promise<boolean>;
  },
  "host" | "ipaddress"
>;

export enum SocksCommand {
  connect = 0x01,
  bind = 0x02,
  associate = 0x03,
}

export enum Socks4Response {
  Granted = 0x5a,
  Failed = 0x5b,
  Rejected = 0x5c,
  RejectedIdent = 0x5d,
}

export enum Socks5Auth {
  NoAuth = 0x00,
  GSSApi = 0x01,
  UserPass = 0x02,
}

export enum Socks5Response {
  Granted = 0x00,
  Failure = 0x01,
  NotAllowed = 0x02,
  NetworkUnreachable = 0x03,
  HostUnreachable = 0x04,
  ConnectionRefused = 0x05,
  TTLExpired = 0x06,
  CommandNotSupported = 0x07,
  AddressNotSupported = 0x08,
}

export enum Socks5HostType {
  IPv4 = 0x01,
  Hostname = 0x03,
  IPv6 = 0x04,
}

export enum SocksClientState {
  Created = 0,
  Connecting = 1,
  Connected = 2,
  SentInitialHandshake = 3,
  ReceivedInitialHandshakeResponse = 4,
  SentAuthentication = 5,
  ReceivedAuthenticationResponse = 6,
  SentFinalHandshake = 7,
  ReceivedFinalResponse = 8,
  BoundWaitingForConnection = 9,
  Established = 10,
  Disconnected = 11,
  Error = 99,
}

export interface SocksRemoteHost {
  host: string;
  port: number;
}

export interface SocksClientOptions {
  command: SocksCommandOption;
  destination: SocksRemoteHost;
  proxy: SocksProxy;
  timeout?: number;
  existing_socket?: Duplex;
  set_tcp_nodelay?: boolean;
  socket_options?: SocketConnectOpts;
}

export interface SocksClientChainOptions {
  command: "connect";
  destination: SocksRemoteHost;
  proxies: SocksProxy[];
  timeout?: number;
  randomizeChain?: false;
}

export interface SocksClientEstablishedEvent {
  socket: Socket;
  remoteHost?: SocksRemoteHost;
}

export interface SocksUDPFrameDetails {
  frameNumber?: number;
  remoteHost: SocksRemoteHost;
  data: Buffer;
}

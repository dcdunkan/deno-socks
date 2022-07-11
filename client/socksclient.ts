// deno-lint-ignore-file no-explicit-any ban-types no-async-promise-executor
import { EventEmitter } from "https://deno.land/std@0.147.0/node/events.ts";
import {
  isIPv4,
  isIPv6,
  Socket,
} from "https://deno.land/std@0.147.0/node/net.ts";
import {
  fromLong,
  toBuffer,
  toLong,
  toString,
} from "https://deno.land/x/dip@v2.0.0/mod.ts";
import { SmartBuffer } from "https://deno.land/x/smart_buffer@v3.0.0/mod.ts";
import { Duplex } from "https://deno.land/std@0.147.0/node/stream.ts";
import { Buffer } from "https://deno.land/std@0.147.0/node/buffer.ts";
import {
  setImmediate,
  setTimeout,
} from "https://deno.land/std@0.147.0/node/timers.ts";
import {
  DEFAULT_TIMEOUT,
  ERRORS,
  Socks4Response,
  SOCKS5_NO_ACCEPTABLE_AUTH,
  Socks5Auth,
  Socks5HostType,
  Socks5Response,
  SOCKS_INCOMING_PACKET_SIZES,
  SocksClientBoundEvent,
  SocksClientChainOptions,
  SocksClientEstablishedEvent,
  SocksClientOptions,
  SocksClientState,
  SocksCommand,
  SocksRemoteHost,
  SocksUDPFrameDetails,
} from "../common/constants.ts";
import { SocketConnectOpts } from "../common/types.ts";
import { ReceiveBuffer } from "../common/receive_buffer.ts";
import { shuffleArray, SocksClientError } from "../common/util.ts";
import {
  validateSocksClientChainOptions,
  validateSocksClientOptions,
} from "../common/helpers.ts";

export declare interface SocksClient {
  on(event: "error", listener: (err: SocksClientError) => void): this;
  on(event: "bound", listener: (info: SocksClientBoundEvent) => void): this;
  on(
    event: "established",
    listener: (info: SocksClientEstablishedEvent) => void,
  ): this;

  once(event: string, listener: (...args: any[]) => void): this;
  once(event: "error", listener: (err: SocksClientError) => void): this;
  once(event: "bound", listener: (info: SocksClientBoundEvent) => void): this;
  once(
    event: "established",
    listener: (info: SocksClientEstablishedEvent) => void,
  ): this;

  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: "error", err: SocksClientError): boolean;
  emit(event: "bound", info: SocksClientBoundEvent): boolean;
  emit(event: "established", info: SocksClientEstablishedEvent): boolean;
}

export class SocksClient extends EventEmitter implements SocksClient {
  private options: SocksClientOptions;
  private socket!: Duplex;
  private state!: SocksClientState;
  private receiveBuffer!: ReceiveBuffer;
  private nextRequiredPacketBufferSize!: number;
  private socks5ChosenAuthType!: number;

  private onDataReceived!: (data: Buffer) => void;
  private onClose!: (hadError: boolean) => void;
  private onError!: (err: Error) => void;
  private onConnect!: () => void;

  constructor(options: SocksClientOptions) {
    super();
    this.options = {
      ...options,
    };

    validateSocksClientOptions(options);

    this.setState(SocksClientState.Created);
  }

  static createConnection(
    options: SocksClientOptions,
    callback?: Function,
  ): Promise<SocksClientEstablishedEvent> {
    return new Promise<SocksClientEstablishedEvent>((resolve, reject) => {
      // Validate SocksClientOptions
      try {
        validateSocksClientOptions(options, ["connect"]);
      } catch (err) {
        if (typeof callback === "function") {
          callback(err);
          return resolve(err as any); // Resolves pending promise (prevents memory leaks).
        } else {
          return reject(err);
        }
      }

      const client = new SocksClient(options);
      client.connect(options.existing_socket);
      client.once("established", (info: SocksClientEstablishedEvent) => {
        client.removeAllListeners();
        if (typeof callback === "function") {
          callback(null, info);
          resolve(info); // Resolves pending promise (prevents memory leaks).
        } else {
          resolve(info);
        }
      });

      // Error occurred, failed to establish connection.
      client.once("error", (err: Error) => {
        client.removeAllListeners();
        if (typeof callback === "function") {
          callback(err);
          resolve(err as any); // Resolves pending promise (prevents memory leaks).
        } else {
          reject(err);
        }
      });
    });
  }

  static createConnectionChain(
    options: SocksClientChainOptions,
    callback?: Function,
  ): Promise<SocksClientEstablishedEvent> {
    return new Promise<SocksClientEstablishedEvent>(async (resolve, reject) => {
      // Validate SocksClientChainOptions
      try {
        validateSocksClientChainOptions(options);
      } catch (err) {
        if (typeof callback === "function") {
          callback(err);
          return resolve(err as any); // Resolves pending promise (prevents memory leaks).
        } else {
          return reject(err);
        }
      }

      let sock!: Socket;

      // Shuffle proxies
      if (options.randomizeChain) {
        shuffleArray(options.proxies);
      }

      try {
        // tslint:disable-next-line:no-increment-decrement
        for (let i = 0; i < options.proxies.length; i++) {
          const nextProxy = options.proxies[i];

          // If we've reached the last proxy in the chain, the destination is the actual destination, otherwise it's the next proxy.
          const nextDestination = i === options.proxies.length - 1
            ? options.destination
            : {
              host: options.proxies[i + 1].host! ||
                options.proxies[i + 1].ipaddress!,
              port: options.proxies[i + 1].port,
            };

          // Creates the next connection in the chain.
          const result = await SocksClient.createConnection({
            command: "connect",
            proxy: nextProxy,
            destination: nextDestination,
            // Initial connection ignores this as sock is undefined. Subsequent connections re-use the first proxy socket to form a chain.
          });

          // If sock is undefined, assign it here.
          if (!sock) {
            sock = result.socket;
          }
        }

        if (typeof callback === "function") {
          callback(null, { socket: sock });
          resolve({ socket: sock }); // Resolves pending promise (prevents memory leaks).
        } else {
          resolve({ socket: sock });
        }
      } catch (err) {
        if (typeof callback === "function") {
          callback(err);
          resolve(err as any); // Resolves pending promise (prevents memory leaks).
        } else {
          reject(err);
        }
      }
    });
  }

  static createUDPFrame(options: SocksUDPFrameDetails): Buffer {
    const buff = new SmartBuffer();
    buff.writeUInt16BE(0);
    buff.writeUInt8(options.frameNumber || 0);
    if (isIPv4(options.remoteHost.host)) {
      buff.writeUInt8(Socks5HostType.IPv4);
      buff.writeUInt32BE(toLong(options.remoteHost.host));
    } else if (isIPv6(options.remoteHost.host)) {
      buff.writeUInt8(Socks5HostType.IPv6);
      buff.writeBuffer(toBuffer(options.remoteHost.host));
    } else {
      buff.writeUInt8(Socks5HostType.Hostname);
      buff.writeUInt8(Buffer.byteLength(options.remoteHost.host));
      buff.writeString(options.remoteHost.host);
    }
    buff.writeUInt16BE(options.remoteHost.port);
    buff.writeBuffer(options.data);
    return buff.toBuffer();
  }

  static parseUDPFrame(data: Buffer): SocksUDPFrameDetails {
    const buff = SmartBuffer.fromBuffer(data);
    buff.readOffset = 2;
    const frameNumber = buff.readUInt8();
    const hostType: Socks5HostType = buff.readUInt8();
    let remoteHost;
    if (hostType === Socks5HostType.IPv4) {
      remoteHost = fromLong(buff.readUInt32BE());
    } else if (hostType === Socks5HostType.IPv6) {
      remoteHost = toString(buff.readBuffer(16));
    } else {
      remoteHost = buff.readString(buff.readUInt8());
    }
    const remotePort = buff.readUInt16BE();
    return {
      frameNumber,
      remoteHost: {
        host: remoteHost,
        port: remotePort,
      },
      data: buff.readBuffer(),
    };
  }

  private setState(newState: SocksClientState) {
    if (this.state !== SocksClientState.Error) {
      this.state = newState;
    }
  }

  public connect(existingSocket?: Duplex) {
    this.onDataReceived = (data: Buffer) => this.onDataReceivedHandler(data);
    this.onClose = () => this.onCloseHandler();
    this.onError = (err: Error) => this.onErrorHandler(err);
    this.onConnect = () => this.onConnectHandler();

    // Start timeout timer (defaults to 30 seconds)
    const timer = setTimeout(
      () => this.onEstablishedTimeout(),
      this.options.timeout || DEFAULT_TIMEOUT,
    );

    // check whether unref is available as it differs from browser to NodeJS (#33)
    if (timer.unref && typeof timer.unref === "function") {
      timer.unref();
    }

    // If an existing socket is provided, use it to negotiate SOCKS handshake. Otherwise create a new Socket.
    if (existingSocket) {
      this.socket = existingSocket;
    } else {
      // @ts-ignore Idk, it was in the original implementation
      this.socket = new Socket();
    }

    // Attach Socket error handlers.
    this.socket.once("close", this.onClose);
    this.socket.once("error", this.onError);
    this.socket.once("connect", this.onConnect);
    this.socket.on("data", this.onDataReceived);

    this.setState(SocksClientState.Connecting);
    this.receiveBuffer = new ReceiveBuffer();

    if (existingSocket) {
      this.socket.emit("connect");
    } else {
      (this.socket as Socket).connect(this.getSocketOptions());

      if (
        this.options.set_tcp_nodelay !== undefined &&
        this.options.set_tcp_nodelay !== null
      ) {
        (this.socket as Socket).setNoDelay(!!this.options.set_tcp_nodelay);
      }
    }

    // Listen for established event so we can re-emit any excess data received during handshakes.
    this.prependOnceListener("established", (info) => {
      setImmediate(() => {
        if (this.receiveBuffer.length > 0) {
          const excessData = this.receiveBuffer.get(this.receiveBuffer.length);

          info.socket.emit("data", excessData);
        }
        info.socket.resume();
      });
    });
  }

  private getSocketOptions(): SocketConnectOpts {
    return {
      ...this.options.socket_options,
      host: this.options.proxy.host || this.options.proxy.ipaddress,
      port: this.options.proxy.port,
    };
  }

  private onEstablishedTimeout() {
    if (
      this.state !== SocksClientState.Established &&
      this.state !== SocksClientState.BoundWaitingForConnection
    ) {
      this.closeSocket(ERRORS.ProxyConnectionTimedOut);
    }
  }

  private onConnectHandler() {
    this.setState(SocksClientState.Connected);
    if (this.options.proxy.type === 4) {
      this.sendSocks4InitialHandshake();
    } else {
      this.sendSocks5InitialHandshake();
    }

    this.setState(SocksClientState.SentInitialHandshake);
  }

  private onDataReceivedHandler(data: Buffer) {
    this.receiveBuffer.append(data);
    this.processData();
  }

  private processData() {
    // If we have enough data to process the next step in the SOCKS handshake, proceed.
    while (
      this.state !== SocksClientState.Established &&
      this.state !== SocksClientState.Error &&
      this.receiveBuffer.length >= this.nextRequiredPacketBufferSize
    ) {
      // Sent initial handshake, waiting for response.
      if (this.state === SocksClientState.SentInitialHandshake) {
        if (this.options.proxy.type === 4) {
          // Socks v4 only has one handshake response.
          this.handleSocks4FinalHandshakeResponse();
        } else {
          // Socks v5 has two handshakes, handle initial one here.
          this.handleInitialSocks5HandshakeResponse();
        }
        // Sent auth request for Socks v5, waiting for response.
      } else if (this.state === SocksClientState.SentAuthentication) {
        this.handleInitialSocks5AuthenticationHandshakeResponse();
        // Sent final Socks v5 handshake, waiting for final response.
      } else if (this.state === SocksClientState.SentFinalHandshake) {
        this.handleSocks5FinalHandshakeResponse();
        // Socks BIND established. Waiting for remote connection via proxy.
      } else if (this.state === SocksClientState.BoundWaitingForConnection) {
        if (this.options.proxy.type === 4) {
          this.handleSocks4IncomingConnectionResponse();
        } else {
          this.handleSocks5IncomingConnectionResponse();
        }
      } else {
        this.closeSocket(ERRORS.InternalError);
        break;
      }
    }
  }

  private onCloseHandler() {
    this.closeSocket(ERRORS.SocketClosed);
  }

  private onErrorHandler(err: Error) {
    this.closeSocket(err.message);
  }

  private removeInternalSocketHandlers() {
    this.socket.pause();
    this.socket.removeListener("data", this.onDataReceived);
    this.socket.removeListener("close", this.onClose);
    this.socket.removeListener("error", this.onError);
    this.socket.removeListener("connect", this.onConnect);
  }

  private closeSocket(err: string) {
    // Make sure only one 'error' event is fired for the lifetime of this SocksClient instance.
    if (this.state !== SocksClientState.Error) {
      // Set internal state to Error.
      this.setState(SocksClientState.Error);

      // Destroy Socket
      this.socket.destroy();

      // Remove internal listeners
      this.removeInternalSocketHandlers();

      // Fire 'error' event.
      this.emit("error", new SocksClientError(err, this.options));
    }
  }

  private sendSocks4InitialHandshake() {
    const userId = this.options.proxy.userId || "";

    const buff = new SmartBuffer();
    buff.writeUInt8(0x04);
    buff.writeUInt8(SocksCommand[this.options.command]);
    buff.writeUInt16BE(this.options.destination.port);

    // Socks 4 (IPv4)
    if (isIPv4(this.options.destination.host)) {
      buff.writeBuffer(toBuffer(this.options.destination.host));
      buff.writeStringNT(userId);
      // Socks 4a (hostname)
    } else {
      buff.writeUInt8(0x00);
      buff.writeUInt8(0x00);
      buff.writeUInt8(0x00);
      buff.writeUInt8(0x01);
      buff.writeStringNT(userId);
      buff.writeStringNT(this.options.destination.host);
    }

    this.nextRequiredPacketBufferSize =
      SOCKS_INCOMING_PACKET_SIZES.Socks4Response;
    this.socket.write(buff.toBuffer());
  }

  private handleSocks4FinalHandshakeResponse() {
    const data = this.receiveBuffer.get(8);

    if (data[1] !== Socks4Response.Granted) {
      this.closeSocket(
        `${ERRORS.Socks4ProxyRejectedConnection} - (${
          Socks4Response[data[1]]
        })`,
      );
    } else {
      // Bind response
      if (SocksCommand[this.options.command] === SocksCommand.bind) {
        const buff = SmartBuffer.fromBuffer(data);
        buff.readOffset = 2;

        const remoteHost: SocksRemoteHost = {
          port: buff.readUInt16BE(),
          host: fromLong(buff.readUInt32BE()),
        };

        // If host is 0.0.0.0, set to proxy host.
        if (remoteHost.host === "0.0.0.0") {
          remoteHost.host = this.options.proxy.ipaddress!;
        }
        this.setState(SocksClientState.BoundWaitingForConnection);
        this.emit("bound", { remoteHost, socket: this.socket });

        // Connect response
      } else {
        this.setState(SocksClientState.Established);
        this.removeInternalSocketHandlers();
        this.emit("established", { socket: this.socket });
      }
    }
  }

  private handleSocks4IncomingConnectionResponse() {
    const data = this.receiveBuffer.get(8);

    if (data[1] !== Socks4Response.Granted) {
      this.closeSocket(
        `${ERRORS.Socks4ProxyRejectedIncomingBoundConnection} - (${
          Socks4Response[data[1]]
        })`,
      );
    } else {
      const buff = SmartBuffer.fromBuffer(data);
      buff.readOffset = 2;

      const remoteHost: SocksRemoteHost = {
        port: buff.readUInt16BE(),
        host: fromLong(buff.readUInt32BE()),
      };

      this.setState(SocksClientState.Established);
      this.removeInternalSocketHandlers();
      this.emit("established", { remoteHost, socket: this.socket });
    }
  }

  private sendSocks5InitialHandshake() {
    const buff = new SmartBuffer();

    // By default we always support no auth.
    const supportedAuthMethods = [Socks5Auth.NoAuth];

    // We should only tell the proxy we support user/pass auth if auth info is actually provided.
    // Note: As of Tor v0.3.5.7+, if user/pass auth is an option from the client, by default it will always take priority.
    if (this.options.proxy.userId || this.options.proxy.password) {
      supportedAuthMethods.push(Socks5Auth.UserPass);
    }

    // Custom auth method?
    if (this.options.proxy.custom_auth_method !== undefined) {
      supportedAuthMethods.push(this.options.proxy.custom_auth_method);
    }

    // Build handshake packet
    buff.writeUInt8(0x05);
    buff.writeUInt8(supportedAuthMethods.length);
    for (const authMethod of supportedAuthMethods) {
      buff.writeUInt8(authMethod);
    }

    this.nextRequiredPacketBufferSize =
      SOCKS_INCOMING_PACKET_SIZES.Socks5InitialHandshakeResponse;
    this.socket.write(buff.toBuffer());
    this.setState(SocksClientState.SentInitialHandshake);
  }

  private handleInitialSocks5HandshakeResponse() {
    const data = this.receiveBuffer.get(2);

    if (data[0] !== 0x05) {
      this.closeSocket(ERRORS.InvalidSocks5IntiailHandshakeSocksVersion);
    } else if (data[1] === SOCKS5_NO_ACCEPTABLE_AUTH) {
      this.closeSocket(ERRORS.InvalidSocks5InitialHandshakeNoAcceptedAuthType);
    } else {
      // If selected Socks v5 auth method is no auth, send final handshake request.
      if (data[1] === Socks5Auth.NoAuth) {
        this.socks5ChosenAuthType = Socks5Auth.NoAuth;
        this.sendSocks5CommandRequest();
        // If selected Socks v5 auth method is user/password, send auth handshake.
      } else if (data[1] === Socks5Auth.UserPass) {
        this.socks5ChosenAuthType = Socks5Auth.UserPass;
        this.sendSocks5UserPassAuthentication();
        // If selected Socks v5 auth method is the custom_auth_method, send custom handshake.
      } else if (data[1] === this.options.proxy.custom_auth_method) {
        this.socks5ChosenAuthType = this.options.proxy.custom_auth_method;
        this.sendSocks5CustomAuthentication();
      } else {
        this.closeSocket(ERRORS.InvalidSocks5InitialHandshakeUnknownAuthType);
      }
    }
  }

  private sendSocks5UserPassAuthentication() {
    const userId = this.options.proxy.userId || "";
    const password = this.options.proxy.password || "";

    const buff = new SmartBuffer();
    buff.writeUInt8(0x01);
    buff.writeUInt8(Buffer.byteLength(userId));
    buff.writeString(userId);
    buff.writeUInt8(Buffer.byteLength(password));
    buff.writeString(password);

    this.nextRequiredPacketBufferSize =
      SOCKS_INCOMING_PACKET_SIZES.Socks5UserPassAuthenticationResponse;
    this.socket.write(buff.toBuffer());
    this.setState(SocksClientState.SentAuthentication);
  }

  private async sendSocks5CustomAuthentication() {
    this.nextRequiredPacketBufferSize = this.options.proxy
      .custom_auth_response_size!;
    if (this.options.proxy.custom_auth_response_handler) {
      this.socket.write(
        await this.options.proxy.custom_auth_response_handler(),
      );
    }
    this.setState(SocksClientState.SentAuthentication);
  }

  private async handleSocks5CustomAuthHandshakeResponse(data: Buffer) {
    // deno-lint-ignore no-extra-non-null-assertion
    return await this.options.proxy.custom_auth_response_handler!?.(data);
  }

  private handleSocks5AuthenticationNoAuthHandshakeResponse(
    data: Buffer,
  ): boolean {
    return data[1] === 0x00;
  }

  private handleSocks5AuthenticationUserPassHandshakeResponse(
    data: Buffer,
  ): boolean {
    return data[1] === 0x00;
  }

  private async handleInitialSocks5AuthenticationHandshakeResponse() {
    this.setState(SocksClientState.ReceivedAuthenticationResponse);

    let authResult = false;

    if (this.socks5ChosenAuthType === Socks5Auth.NoAuth) {
      authResult = this.handleSocks5AuthenticationNoAuthHandshakeResponse(
        this.receiveBuffer.get(2),
      );
    } else if (this.socks5ChosenAuthType === Socks5Auth.UserPass) {
      authResult = this
        .handleSocks5AuthenticationUserPassHandshakeResponse(
          this.receiveBuffer.get(2),
        );
    } else if (
      this.socks5ChosenAuthType === this.options.proxy.custom_auth_method
    ) {
      authResult = await this.handleSocks5CustomAuthHandshakeResponse(
        this.receiveBuffer.get(this.options.proxy.custom_auth_response_size!),
      );
    }

    if (!authResult) {
      this.closeSocket(ERRORS.Socks5AuthenticationFailed);
    } else {
      this.sendSocks5CommandRequest();
    }
  }

  private sendSocks5CommandRequest() {
    const buff = new SmartBuffer();

    buff.writeUInt8(0x05);
    buff.writeUInt8(SocksCommand[this.options.command]);
    buff.writeUInt8(0x00);

    // ipv4, ipv6, domain?
    if (isIPv4(this.options.destination.host)) {
      buff.writeUInt8(Socks5HostType.IPv4);
      buff.writeBuffer(toBuffer(this.options.destination.host));
    } else if (isIPv6(this.options.destination.host)) {
      buff.writeUInt8(Socks5HostType.IPv6);
      buff.writeBuffer(toBuffer(this.options.destination.host));
    } else {
      buff.writeUInt8(Socks5HostType.Hostname);
      buff.writeUInt8(this.options.destination.host.length);
      buff.writeString(this.options.destination.host);
    }
    buff.writeUInt16BE(this.options.destination.port);

    this.nextRequiredPacketBufferSize =
      SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseHeader;
    this.socket.write(buff.toBuffer());
    this.setState(SocksClientState.SentFinalHandshake);
  }

  private handleSocks5FinalHandshakeResponse() {
    // Peek at available data (we need at least 5 bytes to get the hostname length)
    const header = this.receiveBuffer.peek(5);

    if (header[0] !== 0x05 || header[1] !== Socks5Response.Granted) {
      this.closeSocket(
        `${ERRORS.InvalidSocks5FinalHandshakeRejected} - ${
          Socks5Response[header[1]]
        }`,
      );
    } else {
      // Read address type
      const addressType = header[3];

      let remoteHost!: SocksRemoteHost;
      let buff: SmartBuffer;

      // IPv4
      if (addressType === Socks5HostType.IPv4) {
        // Check if data is available.
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseIPv4;
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(4),
        );

        remoteHost = {
          host: fromLong(buff.readUInt32BE()),
          port: buff.readUInt16BE(),
        };

        // If given host is 0.0.0.0, assume remote proxy ip instead.
        if (remoteHost.host === "0.0.0.0") {
          remoteHost.host = this.options.proxy.ipaddress!;
        }

        // Hostname
      } else if (addressType === Socks5HostType.Hostname) {
        const hostLength = header[4];
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseHostname(
          hostLength,
        ); // header + host length + host + port

        // Check if data is available.
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(5), // Slice at 5 to skip host length
        );

        remoteHost = {
          host: buff.readString(hostLength),
          port: buff.readUInt16BE(),
        };
        // IPv6
      } else if (addressType === Socks5HostType.IPv6) {
        // Check if data is available.
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseIPv6;
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(4),
        );

        remoteHost = {
          host: toString(buff.readBuffer(16)),
          port: buff.readUInt16BE(),
        };
      }

      // We have everything we need
      this.setState(SocksClientState.ReceivedFinalResponse);

      // If using CONNECT, the client is now in the established state.
      if (SocksCommand[this.options.command] === SocksCommand.connect) {
        this.setState(SocksClientState.Established);
        this.removeInternalSocketHandlers();
        this.emit("established", { remoteHost, socket: this.socket });
      } else if (SocksCommand[this.options.command] === SocksCommand.bind) {
        /* If using BIND, the Socks client is now in BoundWaitingForConnection state.
           This means that the remote proxy server is waiting for a remote connection to the bound port. */
        this.setState(SocksClientState.BoundWaitingForConnection);
        this.nextRequiredPacketBufferSize =
          SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseHeader;
        this.emit("bound", { remoteHost, socket: this.socket });
        /*
          If using Associate, the Socks client is now Established. And the proxy server is now accepting UDP packets at the
          given bound port. This initial Socks TCP connection must remain open for the UDP relay to continue to work.
        */
      } else if (
        SocksCommand[this.options.command] === SocksCommand.associate
      ) {
        this.setState(SocksClientState.Established);
        this.removeInternalSocketHandlers();
        this.emit("established", {
          remoteHost,
          socket: this.socket,
        });
      }
    }
  }

  private handleSocks5IncomingConnectionResponse() {
    // Peek at available data (we need at least 5 bytes to get the hostname length)
    const header = this.receiveBuffer.peek(5);

    if (header[0] !== 0x05 || header[1] !== Socks5Response.Granted) {
      this.closeSocket(
        `${ERRORS.Socks5ProxyRejectedIncomingBoundConnection} - ${
          Socks5Response[header[1]]
        }`,
      );
    } else {
      // Read address type
      const addressType = header[3];

      let remoteHost!: SocksRemoteHost;
      let buff: SmartBuffer;

      // IPv4
      if (addressType === Socks5HostType.IPv4) {
        // Check if data is available.
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseIPv4;
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(4),
        );

        remoteHost = {
          host: fromLong(buff.readUInt32BE()),
          port: buff.readUInt16BE(),
        };

        // If given host is 0.0.0.0, assume remote proxy ip instead.
        if (remoteHost.host === "0.0.0.0") {
          remoteHost.host = this.options.proxy.ipaddress!;
        }

        // Hostname
      } else if (addressType === Socks5HostType.Hostname) {
        const hostLength = header[4];
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseHostname(
          hostLength,
        ); // header + host length + port

        // Check if data is available.
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(5), // Slice at 5 to skip host length
        );

        remoteHost = {
          host: buff.readString(hostLength),
          port: buff.readUInt16BE(),
        };
        // IPv6
      } else if (addressType === Socks5HostType.IPv6) {
        // Check if data is available.
        const dataNeeded = SOCKS_INCOMING_PACKET_SIZES.Socks5ResponseIPv6;
        if (this.receiveBuffer.length < dataNeeded) {
          this.nextRequiredPacketBufferSize = dataNeeded;
          return;
        }

        buff = SmartBuffer.fromBuffer(
          this.receiveBuffer.get(dataNeeded).slice(4),
        );

        remoteHost = {
          host: toString(buff.readBuffer(16)),
          port: buff.readUInt16BE(),
        };
      }

      this.setState(SocksClientState.Established);
      this.removeInternalSocketHandlers();
      this.emit("established", { remoteHost, socket: this.socket });
    }
  }

  get socksClientOptions(): SocksClientOptions {
    return {
      ...this.options,
    };
  }
}

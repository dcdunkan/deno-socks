// deno-lint-ignore-file no-explicit-any require-await
import { SocksClient } from "./socksclient.ts";
import { SocksProxy, SocksRemoteHost } from "../common/constants.ts";
import { shuffleArray, SocksClientError } from "../common/util.ts";
import {
  int32ToIpv4,
  ipToBuffer,
  ipv4ToInt32,
  validateSocksClientChainOptions,
  validateSocksClientOptions,
} from "../common/helpers.ts";
import { Socket } from "node:net";
import { Buffer } from "node:buffer";
import assert from "node:assert";
import { Address4, Address6 } from "npm:ip-address@9.0.5";

Deno.test("Creating and parsing Socks UDP frames", async (t) => {
  const packetData = Buffer.from([10, 12, 14, 16, 18, 20]);
  // deno-fmt-ignore
  const validIPv4Frame = Buffer.from([
    0x0,    0x0,    0x0,    0x1,    0x1,    0x2,    0x3,
    0x4,    0x0,    0x50,   0xa,    0xc,    0xe,    0x10,
    0x12,   0x14,
  ]);
  // deno-fmt-ignore
  const validIPv6Frame = Buffer.from([
    0x0,    0x0,    0x4,    0x4,    0x20,    0x1,    0xd,
    0xb8,   0x85,   0xa3,   0x12,   0x34,    0x8a,   0x2e,
    0x3,    0x70,   0x73,   0x34,   0x18,    0x40,   0x0,
    0x50,   0xa,    0xc,    0xe,    0x10,    0x12,   0x14,
  ]);
  // deno-fmt-ignore
  const validHostnameFrame = Buffer.from([
    0x0,    0x0,    0x0,    0x3,    0xe,    0x77,   0x77,
    0x77,   0x2e,   0x67,   0x6f,   0x6f,   0x67,   0x6c,
    0x65,   0x2e,   0x63,   0x6f,   0x6d,   0x0,    0x50,
    0xa,    0xc,    0xe,    0x10,   0x12,   0x14,
  ]);

  const ipv4HostInfo = {
    host: "1.2.3.4",
    port: 80,
  };

  const ipv6HostInfo = {
    host: "2001:0db8:85a3:1234:8a2e:0370:7334:1840",
    port: 80,
  };

  const hostHostInfo = {
    host: "www.google.com",
    port: 80,
  };

  const ipv4UDPFrame = SocksClient.createUDPFrame({
    remoteHost: ipv4HostInfo,
    data: packetData,
  });
  const ipv6UDPFrame = SocksClient.createUDPFrame({
    remoteHost: ipv6HostInfo,
    data: packetData,
    frameNumber: 4,
  });
  const hostnameUDPFrame = SocksClient.createUDPFrame({
    remoteHost: hostHostInfo,
    data: packetData,
  });

  await t.step("should generate valid UDP frames", () => {
    assert.deepStrictEqual(ipv4UDPFrame, validIPv4Frame);
    assert.deepStrictEqual(ipv6UDPFrame, validIPv6Frame);
    assert.deepStrictEqual(hostnameUDPFrame, validHostnameFrame);
  });

  await t.step("should parse generated UDP frames back to input values", () => {
    const parsedIPv4UDPFrame = SocksClient.parseUDPFrame(ipv4UDPFrame);
    const parsedIPv6UDPFrame = SocksClient.parseUDPFrame(ipv6UDPFrame);
    const parsedHostnameUDPFrame = SocksClient.parseUDPFrame(hostnameUDPFrame);

    // IPv4
    assert.deepStrictEqual(parsedIPv4UDPFrame.remoteHost, ipv4HostInfo);
    assert.deepStrictEqual(parsedIPv4UDPFrame.frameNumber, 0);
    assert.deepStrictEqual(parsedIPv4UDPFrame.data, packetData);

    // IPv6
    assert.deepStrictEqual(parsedIPv6UDPFrame.remoteHost, ipv6HostInfo);
    assert.deepStrictEqual(parsedIPv6UDPFrame.frameNumber, 4);
    assert.deepStrictEqual(parsedIPv6UDPFrame.data, packetData);

    // Hostname
    assert.deepStrictEqual(parsedHostnameUDPFrame.remoteHost, hostHostInfo);
    assert.deepStrictEqual(parsedHostnameUDPFrame.frameNumber, 0);
    assert.deepStrictEqual(parsedHostnameUDPFrame.data, packetData);
  });
});

Deno.test("Validating SocksProxyOptions", async (t) => {
  const socksRemoteHostValid: SocksRemoteHost = {
    host: "1.2.3.4",
    port: 1080,
  };

  const socksRemoteHostInvalidHost: SocksRemoteHost = {
    host: undefined!,
    port: 1080,
  };

  const socksremoteHostInvalidPort: SocksRemoteHost = {
    host: "1.2.3.4",
    port: undefined!,
  };

  const socksCommandValid = "connect";
  const socksCommandInvalid: any = "other";

  const socksProxyValid: SocksProxy = {
    ipaddress: "1.2.3.4",
    port: 1080,
    type: 5,
  };

  const socksProxyInvalidIPAddress: SocksProxy = {
    ipaddress: undefined!,
    port: 1080,
    type: 5,
  };

  const socksProxyValidHost: SocksProxy = {
    host: "openinternetproxyfree.com",
    port: 1080,
    type: 5,
  };

  const socksProxyValidHostInvalidIPAddress: SocksProxy = {
    host: "openinternetproxyfree.com",
    ipaddress: undefined,
    port: 1080,
    type: 5,
  };

  const socksProxyInvalidHost: SocksProxy = {
    host: undefined!,
    port: 1080,
    type: 5,
  };

  const socksProxyInvalidCustomAuthMethod: SocksProxy = {
    host: "openinternetproxyfree.com",
    port: 1080,
    type: 5,
    custom_auth_method: 0x10,
  };

  const socksProxyCustomAuthMissingOptions: SocksProxy = {
    host: "openinternetproxyfree.com",
    port: 1080,
    type: 5,
    custom_auth_method: 0x80,
  };

  const socksProxyCustomAuthValidOptions: SocksProxy = {
    host: "openinternetproxyfree.com",
    port: 1080,
    type: 5,
    custom_auth_method: 0x80,
    custom_auth_request_handler: async () => Buffer.from([1, 2, 3]),
    custom_auth_response_size: 2,
    custom_auth_response_handler: async (data) => data![1] === 0x01,
  };

  const invalidProxyType: any = 9;

  const socksProxyInvalidPortBounds: SocksProxy = {
    ipaddress: "1111:2222:3333:4444:5555:6666",
    port: 90000,
    type: 4,
  };

  const socksProxyInvalidPort: SocksProxy = {
    ipaddress: "1.2.3.4",
    port: undefined!,
    type: 4,
  };

  const socksProxyInvalidType: SocksProxy = {
    ipaddress: "1.2.3.4",
    port: 1080,
    type: invalidProxyType,
  };

  // @ts-ignore kek
  const socketValid = new Socket();
  const socketInvalid: any = "something that is not a socket";
  const socksProxiesValid: SocksProxy[] = [socksProxyValid, socksProxyValid];
  const socksProxiesInvalidLength: SocksProxy[] = [socksProxyValid];
  const socksProxiesInvalid: any = "not an array of proxies";
  const socksProxiesInvalidMixed: SocksProxy[] = [
    socksProxyValid,
    socksProxyInvalidIPAddress,
  ];

  await t.step(
    "should not throw an exception when passing valid options",
    () => {
      validateSocksClientOptions({
        proxy: socksProxyValid,
        command: socksCommandValid,
        destination: socksRemoteHostValid,
        timeout: 10000,
        existing_socket: socketValid,
      });
    },
  );

  await t.step(
    "should not throw an exception when passing valid options with proxy host property",
    () => {
      validateSocksClientOptions({
        proxy: socksProxyValidHost,
        command: socksCommandValid,
        destination: socksRemoteHostValid,
        timeout: 10000,
        existing_socket: socketValid,
      });
    },
  );

  await t.step(
    "should not throw an exception when passing valid options with proxy host property and invalid ipaddress property",
    () => {
      validateSocksClientOptions({
        proxy: socksProxyValidHostInvalidIPAddress,
        command: socksCommandValid,
        destination: socksRemoteHostValid,
        timeout: 10000,
        existing_socket: socketValid,
      });
    },
  );

  await t.step(
    "should throw an exception when given an invalid proxy ip address",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidIPAddress,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid proxy host property",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidHost,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid proxy port (out of bounds)",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidPortBounds,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid proxy port",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidPort,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid proxy type",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidType,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      }, SocksClientError);
    },
  );

  await t.step("should throw an exception when given a invalid command", () => {
    assert.throws(() => {
      validateSocksClientOptions({
        proxy: socksProxyValid,
        command: socksCommandInvalid,
        destination: socksRemoteHostValid,
      });
    }, SocksClientError);
  });

  await t.step(
    "should throw an exception when given a invalid command (not accepted)",
    () => {
      assert.throws(() => {
        validateSocksClientOptions(
          {
            proxy: socksProxyValid,
            command: "bind",
            destination: socksRemoteHostValid,
          },
          ["connect"],
        );
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given a invalid destination host",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyValid,
          command: socksCommandValid,
          destination: socksRemoteHostInvalidHost,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given a invalid destination port",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyValid,
          command: socksCommandValid,
          destination: socksremoteHostInvalidPort,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid timeout",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyValid,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          timeout: -1,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given an invalid existing_socket",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyValid,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          existing_socket: socketInvalid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given a custom_auth_method with an invalid value",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyInvalidCustomAuthMethod,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      });
    },
  );

  await t.step(
    "should throw an exception when custom_auth_method is present but not all the custom auth options are set",
    () => {
      assert.throws(() => {
        validateSocksClientOptions({
          proxy: socksProxyCustomAuthMissingOptions,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      });
    },
  );

  await t.step(
    "should not throw an exception when all custom auth methods are set",
    () => {
      assert.doesNotThrow(() => {
        validateSocksClientOptions({
          proxy: socksProxyCustomAuthValidOptions,
          command: socksCommandValid,
          destination: socksRemoteHostValid,
        });
      });
    },
  );

  await t.step(
    "should not throw an exception when given valid options (chaining)",
    () => {
      validateSocksClientChainOptions({
        command: socksCommandValid,
        destination: socksRemoteHostValid,
        timeout: 10000,
        proxies: socksProxiesValid,
      });
    },
  );

  await t.step(
    "should throw an exception when given invalid socks proxies (length)",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          timeout: 10000,
          proxies: socksProxiesInvalidLength,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given invalid socks proxies (invalid socks proxy mixed in)",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          timeout: 10000,
          proxies: socksProxiesInvalidMixed,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given invalid socks proxies (invalid)",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          timeout: 10000,
          proxies: socksProxiesInvalid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given invalid socks command (non connect)",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandInvalid,
          destination: socksRemoteHostValid,
          timeout: 10000,
          proxies: socksProxiesValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given invalid timeout value",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandValid,
          destination: socksRemoteHostValid,
          timeout: -1000,
          proxies: socksProxiesValid,
        });
      }, SocksClientError);
    },
  );

  await t.step(
    "should throw an exception when given invalid socks destination",
    () => {
      assert.throws(() => {
        validateSocksClientChainOptions({
          command: socksCommandValid,
          destination: socksRemoteHostInvalidHost,
          timeout: 10000,
          proxies: socksProxiesValid,
        });
      }, SocksClientError);
    },
  );
});

Deno.test("SocksClient", async (t) => {
  await t.step("createConnection", async (t) => {
    await t.step(
      "should call the callback with an error when options validation fails and callback is provided",
      () => {
        SocksClient.createConnection(
          {
            destination: {
              host: "1.2.3.4",
              port: 1234,
            },
            proxy: {
              host: "1.2.3.4",
              port: 1080,
              type: 4,
            },
            command: "fake" as any,
          },
          (err: Error | null) => {
            assert(err instanceof SocksClientError);
          },
        );
      },
    );

    await t.step(
      "should reject promise when options validation fails and callback is not provided",
      async () => {
        assert.rejects(
          async () => {
            await SocksClient.createConnection({
              destination: {
                host: "1.2.3.4",
                port: 1234,
              },
              proxy: {
                host: "1.2.3.4",
                port: 1080,
                type: 4,
              },
              command: "fake" as any,
            });
          },
          (err: Error) => {
            assert(err instanceof SocksClientError);
            return true;
          },
        );
      },
    );
  });

  await t.step("createConnectionChain", async (t) => {
    await t.step(
      "should call the callback with an error when options validation fails and callback is provided",
      () => {
        SocksClient.createConnectionChain(
          {
            destination: {
              host: "1.2.3.4",
              port: 1234,
            },
            proxies: [
              {
                host: "1.2.3.4",
                port: 1080,
                type: 4,
              },
              {
                host: "2.3.4.5",
                port: 1080,
                type: 4,
              },
            ],
            command: "fake" as any,
          },
          (err: Error | null) => {
            assert(err instanceof SocksClientError);
          },
        );
      },
    );

    await t.step(
      "should reject promise when options validation fails and callback is not provided",
      async () => {
        assert.rejects(
          async () => {
            await SocksClient.createConnectionChain({
              destination: {
                host: "1.2.3.4",
                port: 1234,
              },
              proxies: [
                {
                  host: "1.2.3.4",
                  port: 1080,
                  type: 4,
                },
                {
                  host: "2.3.4.5",
                  port: 1080,
                  type: 4,
                },
              ],
              command: "fake" as any,
            });
          },
          (err: Error) => {
            assert(err instanceof SocksClientError);
            return true;
          },
        );
      },
    );
  });
});

Deno.test("utils", async (t) => {
  await t.step("should shuffle an array", () => {
    const arr = [1, 2, 3, 4, 5, 6];
    const arrCopy = [...arr];

    shuffleArray(arrCopy);

    assert.notDeepStrictEqual(arr, arrCopy);
    assert.deepStrictEqual(arr, arrCopy.sort());
  });

  await t.step("should convert between int32 and ipv4 string", () => {
    const ipAddr = "1.2.3.4";
    const ipLong = ipv4ToInt32(ipAddr);
    assert.equal(int32ToIpv4(ipLong), ipAddr);
  });
  await t.step("converts a valid IPv4 address to a Buffer correctly", () => {
    const ip = "192.168.1.1";
    const expectedBuffer = Buffer.from(new Address4(ip).toArray());
    assert.deepEqual(expectedBuffer, ipToBuffer(ip));
  });
  await t.step("converts a valid IPv6 address to a Buffer correctly", () => {
    const ip = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const expectedBuffer = Buffer.from(new Address6(ip).toByteArray());
    assert.deepEqual(expectedBuffer, ipToBuffer(ip));
  });
});

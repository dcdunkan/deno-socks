// deno-lint-ignore-file no-explicit-any
import { ReceiveBuffer } from "./receive_buffer.ts";
import { Buffer } from "node:buffer";
import {
  assert as assert_,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert";

Deno.test("Creating ReceiveBuffers", async (t) => {
  await t.step("should default to 4096 internal buffer size", () => {
    const buff: any = new ReceiveBuffer();
    assertStrictEquals(buff.buffer.length, 4096);
    assertStrictEquals(buff.originalSize, 4096);
  });

  await t.step(
    "should create an internal buffer with the specificed size",
    () => {
      const size = 1024;
      const buff: any = new ReceiveBuffer(size);
      assertStrictEquals(buff.buffer.length, size);
      assertStrictEquals(buff.originalSize, size);
    },
  );

  await t.step("should have an internal offset of zero after creation", () => {
    const buff = new ReceiveBuffer();
    assertStrictEquals(buff.length, 0);
  });
});

Deno.test("Using ReceiveBuffers", async (t) => {
  await t.step(
    "should throw an error if attempting to call peek on an empty instance",
    () => {
      const buff = new ReceiveBuffer();
      assertThrows(() => buff.peek(10));
    },
  );

  await t.step(
    "should throw an error if attempting to call get on an empty instance",
    () => {
      const buff = new ReceiveBuffer();
      assertThrows(() => buff.get(10));
    },
  );

  await t.step("should append the correct data to the internal buffer", () => {
    const buff: any = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);
    assertEquals(buff.buffer.slice(0, data.length), data);
  });

  await t.step("should peek internal buffer data and not remove it", () => {
    const buff: any = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);

    assertEquals(buff.peek(data.length), data);
    assertEquals(buff.buffer.slice(0, data.length), data);
  });

  await t.step("should get internal buffer data and remove it properly", () => {
    const buff = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);

    assertStrictEquals(buff.length, data.length);
    const readData = buff.get(data.length);
    assertEquals(readData, data);
    assertStrictEquals(buff.length, 0);
  });

  await t.step(
    "should grow in size if the buffer is full and we are trying to write more data",
    () => {
      const buff: any = new ReceiveBuffer(10);
      const longData = Buffer.from("heeeeeeeeellllllllllooooooooooo");
      assert_(buff.buffer.length < longData.length);
      buff.append(longData);
      assert_(buff.buffer.length >= longData.length);

      const readData = buff.get(longData.length);
      assertEquals(readData, longData);
    },
  );

  await t.step(
    "should throw an error if attemping to append something that is not a Buffer",
    () => {
      const buff = new ReceiveBuffer();
      const notABuffer: any = "kjsfkjhdsfkjsdhfd";

      assertThrows(() => buff.append(notABuffer));
    },
  );
});

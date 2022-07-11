// deno-lint-ignore-file no-explicit-any
import { ReceiveBuffer } from "./receive_buffer.ts";
import { Buffer } from "https://deno.land/std@0.147.0/node/buffer.ts";
import assert from "https://deno.land/std@0.147.0/node/assert.ts";
import { assert as assert_ } from "https://deno.land/std@0.147.0/testing/asserts.ts";

Deno.test("Creating ReceiveBuffers", async (t) => {
  await t.step("should default to 4096 internal buffer size", () => {
    const buff: any = new ReceiveBuffer();
    assert.strictEqual(buff.buffer.length, 4096);
    assert.strictEqual(buff.originalSize, 4096);
  });

  await t.step(
    "should create an internal buffer with the specificed size",
    () => {
      const size = 1024;
      const buff: any = new ReceiveBuffer(size);
      assert.strictEqual(buff.buffer.length, size);
      assert.strictEqual(buff.originalSize, size);
    },
  );

  await t.step("should have an internal offset of zero after creation", () => {
    const buff = new ReceiveBuffer();
    assert.strictEqual(buff.length, 0);
  });
});

Deno.test("Using ReceiveBuffers", async (t) => {
  await t.step(
    "should throw an error if attempting to call peek on an empty instance",
    () => {
      const buff = new ReceiveBuffer();
      assert.throws(() => buff.peek(10));
    },
  );

  await t.step(
    "should throw an error if attempting to call get on an empty instance",
    () => {
      const buff = new ReceiveBuffer();
      assert.throws(() => buff.get(10));
    },
  );

  await t.step("should append the correct data to the internal buffer", () => {
    const buff: any = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);
    assert.deepStrictEqual(buff.buffer.slice(0, data.length), data);
  });

  await t.step("should peek internal buffer data and not remove it", () => {
    const buff: any = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);

    assert.deepStrictEqual(buff.peek(data.length), data);
    assert.deepStrictEqual(buff.buffer.slice(0, data.length), data);
  });

  await t.step("should get internal buffer data and remove it properly", () => {
    const buff = new ReceiveBuffer();
    const data = Buffer.from("hello");
    buff.append(data);

    assert.strictEqual(buff.length, data.length);
    const readData = buff.get(data.length);
    assert.deepStrictEqual(readData, data);
    assert.strictEqual(buff.length, 0);
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
      assert.deepStrictEqual(readData, longData);
    },
  );

  await t.step(
    "should throw an error if attemping to append something that is not a Buffer",
    () => {
      const buff = new ReceiveBuffer();
      const notABuffer: any = "kjsfkjhdsfkjsdhfd";

      assert.throws(() => buff.append(notABuffer));
    },
  );
});

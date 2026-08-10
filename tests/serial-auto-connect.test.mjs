import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const url = new URL(
  "../src/controllers/connections/serial-auto-connect.ts",
  import.meta.url,
);
const compiled = ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: url.pathname,
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);
const serial = loaded.exports;

const port = (usbVendorId, usbProductId) => ({
  getInfo: () => ({ usbVendorId, usbProductId }),
});

test("automatically chooses only a remembered authorized port", () => {
  const only = port(0x1234, 0x5678);
  assert.equal(serial.chooseAuthorizedSerialPort([only], null), null);
  assert.equal(
    serial.chooseAuthorizedSerialPort([only], {
      version: 2,
      usbVendorId: 0x1234,
      usbProductId: 0x5678,
      baudRate: 115200,
    }),
    only,
  );
});

test("uses remembered identity when several authorized ports exist", () => {
  const unrelated = port(1, 2);
  const byrobot = port(3, 4);
  assert.equal(
    serial.chooseAuthorizedSerialPort(
      [unrelated, byrobot],
      { version: 2, usbVendorId: 3, usbProductId: 4, baudRate: 57600 },
    ),
    byrobot,
  );
});

test("remembers the successful baud rate and safely migrates v1 identities", () => {
  const remembered = serial.identityFromPort(port(3, 4), 57600);
  assert.deepEqual(remembered, {
    version: 2,
    usbVendorId: 3,
    usbProductId: 4,
    baudRate: 57600,
  });
  assert.deepEqual(
    serial.parseRememberedSerialIdentity({
      version: 1,
      usbVendorId: 3,
      usbProductId: 4,
    }),
    {
      version: 2,
      usbVendorId: 3,
      usbProductId: 4,
      baudRate: undefined,
    },
  );
  assert.equal(
    serial.parseRememberedSerialIdentity({
      version: 2,
      usbVendorId: 3,
      usbProductId: 4,
      baudRate: 38400,
    }),
    null,
  );
});

test("does not guess among several unknown serial ports", () => {
  assert.equal(
    serial.chooseAuthorizedSerialPort([port(1, 2), port(3, 4)], null),
    null,
  );
  assert.equal(serial.parseRememberedSerialIdentity({ version: 9 }), null);
});

import { LuaFactory } from "wasmoon";

export function createLuaTestFactory() {
  // Wasmoon's WASI environ_get copies bytes as Latin-1 and asserts for a
  // non-ASCII Node entry path inherited as "_". Firmware tests use only their
  // explicitly mounted files; give the virtual process a stable ASCII name.
  return new LuaFactory(undefined, { _: "/test/air780-lua" });
}

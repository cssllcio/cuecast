import { describe, expect, it } from "vitest";
import { ping } from "./sanity.js";

describe("toolchain sanity", () => {
  it("resolves TypeScript + Vitest end to end", () => {
    expect(ping()).toBe("pong");
  });
});

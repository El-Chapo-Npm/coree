import { describe, it, expect, vi } from "vitest";
import { createInMemoryCache } from "../shared/cache";

describe("createInMemoryCache", () => {
  it("stores and retrieves values", () => {
    const cache = createInMemoryCache();
    cache.set("foo", "bar");
    expect(cache.get("foo")).toBe("bar");
  });

  it("invalidates and clears entries", () => {
    const cache = createInMemoryCache();
    cache.set("foo", "bar");
    cache.invalidate("foo");
    expect(cache.get("foo")).toBeUndefined();
  });

  it("should clear all keys", () => {
    const cache = createInMemoryCache();
    cache.set("foo", "bar");
    cache.set("baz", "qux");
    cache.clear();
    expect(cache.get("foo")).toBeUndefined();
    expect(cache.get("baz")).toBeUndefined();
  });

  it("should expire keys based on TTL", () => {
    const cache = createInMemoryCache();
    cache.set("foo", "bar", 100);
    expect(cache.get("foo")).toBe("bar");

    // Mock Date.now to simulate time passing
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => originalDateNow() + 200);

    expect(cache.get("foo")).toBeUndefined();

    // Restore Date.now
    Date.now = originalDateNow;
  });

  it("should use default TTL", () => {
    const cache = createInMemoryCache(100);
    cache.set("foo", "bar");
    expect(cache.get("foo")).toBe("bar");

    const originalDateNow = Date.now;
    Date.now = vi.fn(() => originalDateNow() + 200);

    expect(cache.get("foo")).toBeUndefined();

    Date.now = originalDateNow;
  });

  it("validates TTL value", () => {
    const cache = createInMemoryCache();
    expect(() => cache.set("foo", "bar", -10)).toThrow();
    expect(() => cache.set("foo", "bar", 1.5)).toThrow();
    // @ts-expect-error
    expect(() => cache.set("foo", "bar", "100")).toThrow();
  });
});

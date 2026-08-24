import { describe, expect, it } from "vitest";
import {
  CODE_DIGITS,
  generateCode,
  generateToken,
  isCodeShaped,
  isEmailShaped,
  normalizeCode,
  normalizeEmail,
  subjectFor,
  timingSafeEqual,
} from "../src/code.js";

describe("generateCode", () => {
  it("always produces the advertised number of digits", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateCode()).toMatch(new RegExp(`^\\d{${CODE_DIGITS}}$`));
    }
  });

  it("keeps leading zeros rather than shortening the code", () => {
    // Padding is what makes "007123" six characters instead of "7123", which the shape check --
    // and the user staring at a six-box input -- both depend on.
    const padded = Array.from({ length: 2000 }, generateCode).filter((code) => code.startsWith("0"));
    expect(padded.length).toBeGreaterThan(0);
    for (const code of padded) expect(code).toHaveLength(CODE_DIGITS);
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 1000 }, generateCode));
    // Birthday collisions in 10^6 are expected at this sample size; a generator stuck on a handful
    // of values is what this rules out.
    expect(codes.size).toBeGreaterThan(900);
  });
});

describe("generateToken", () => {
  it("is 256 bits of hex", () => {
    expect(generateToken()).toMatch(/^[\da-f]{64}$/);
  });

  it("is unique across a large sample", () => {
    expect(new Set(Array.from({ length: 1000 }, generateToken)).size).toBe(1000);
  });
});

describe("normalizeCode", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["  123456  ", "123456"],
    ["12 34-56", "123456"],
  ])("reads %o as %o", (input, expected) => {
    expect(normalizeCode(input)).toBe(expected);
  });
});

describe("isCodeShaped", () => {
  it("accepts exactly the right number of digits", () => {
    expect(isCodeShaped("123456")).toBe(true);
  });

  it.each(["12345", "1234567", "12345a", "", "  "])("rejects %o", (input) => {
    expect(isCodeShaped(input)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("folds case so one person does not become two accounts", () => {
    // The claim this produces becomes the Workshop account id and the entry matched against
    // access.admins, so the folding here is what keeps an admin an admin after they capitalise.
    expect(normalizeEmail("Ada@Example.COM")).toBe("ada@example.com");
  });

  it("trims surrounding whitespace from a pasted address", () => {
    expect(normalizeEmail("  ada@example.com \n")).toBe("ada@example.com");
  });
});

describe("isEmailShaped", () => {
  it.each(["ada@example.com", "ada.lovelace+os@mail.example.co.uk"])("accepts %o", (input) => {
    expect(isEmailShaped(input)).toBe(true);
  });

  it.each(["ada", "ada@", "@example.com", "ada@example", "ada @example.com", ""])(
    "rejects %o", (input) => {
      expect(isEmailShaped(input)).toBe(false);
    });
});

describe("timingSafeEqual", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc123", "abc12")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("subjectFor", () => {
  it("is stable for one address and different across addresses", async () => {
    const [first, second, other] = await Promise.all([
      subjectFor("ada@example.com"),
      subjectFor("ada@example.com"),
      subjectFor("grace@example.com"),
    ]);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it("does not leak the address it was derived from", async () => {
    expect(await subjectFor("ada@example.com")).not.toContain("ada");
  });
});

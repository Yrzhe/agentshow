// The acceptance test for the reason this Worker exists.
//
// A sign-in code that arrives next to anything fetchable is a code that gets spent by a link
// scanner before its recipient types it. Every other suite here checks that the flow works; this
// one checks the property that made the flow necessary, and it is the one to look at first if
// somebody ever reports "already used" again.

import { describe, expect, it } from "vitest";
import { assertNoLinks, renderCodeMessage, type CodeMessage } from "../src/email.js";

const render = () => renderCodeMessage({ brand: "Example OS", code: "123456", ttlMinutes: 10 });

describe("the sign-in email", () => {
  it("carries the code in every part a client might display", () => {
    const message = render();
    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
    // In the subject too: on a phone the code is then readable from the notification without
    // opening anything, which is the closest this gets to the one-tap the link used to provide.
    expect(message.subject).toContain("123456");
  });

  it("contains nothing a scanner, a preview fetcher, or a linkifier could follow", () => {
    const message = render();
    for (const part of [message.subject, message.text, message.html]) {
      expect(part).not.toMatch(/https?:\/\//i);
      expect(part).not.toMatch(/<a[\s>]/i);
      expect(part).not.toMatch(/href/i);
      expect(part).not.toMatch(/\bwww\./i);
      expect(part).not.toMatch(/\bmailto:/i);
    }
  });

  it("says the code is single-use and time-limited", () => {
    const message = render();
    expect(message.text).toContain("once");
    expect(message.text).toContain("10 minutes");
  });

  it("reads correctly when the expiry is a single minute", () => {
    const message = renderCodeMessage({ brand: "Example OS", code: "000001", ttlMinutes: 1 });
    expect(message.text).toContain("1 minute");
    expect(message.text).not.toContain("1 minutes");
  });

  it("escapes a brand name rather than letting it reach the markup", () => {
    const message = renderCodeMessage({
      brand: "<script>alert(1)</script>",
      code: "123456",
      ttlMinutes: 10,
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });
});

describe("assertNoLinks", () => {
  const base: CodeMessage = { subject: "Your code", text: "123456", html: "<p>123456</p>" };

  it("accepts a message with no links", () => {
    expect(() => assertNoLinks(base)).not.toThrow();
  });

  // Each of these is a plausible future edit. The point of the guard is that none of them can ship
  // quietly: a template that grows a "having trouble? click here" reintroduces the original bug.
  it.each([
    ["an anchor tag", { html: '<p>123456</p><a href="https://example.com">Sign in</a>' }],
    ["a bare URL in the text", { text: "123456 - or visit https://example.com/login" }],
    ["a scheme-less hostname", { text: "123456 - or visit www.example.com" }],
    ["a tracking image", { html: '<p>123456</p><img src="https://example.com/pixel.gif">' }],
    ["a mailto", { text: "123456. Reply to mailto:help@example.com" }],
    ["a link in the subject", { subject: "Sign in at https://example.com" }],
  ])("refuses %s", (_label, overrides) => {
    expect(() => assertNoLinks({ ...base, ...overrides })).toThrow(/fetchable/);
  });
});

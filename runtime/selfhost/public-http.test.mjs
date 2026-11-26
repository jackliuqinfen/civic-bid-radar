import assert from "node:assert/strict";
import test from "node:test";
import { approvedPublicUrl, isPublicAddress } from "./public-http.mjs";

test("public source requests require an explicitly approved HTTPS host", () => {
  const hosts = "example.com, publication.example.org";
  assert.equal(approvedPublicUrl("https://example.com/tender", hosts).hostname, "example.com");
  for (const value of ["http://example.com/", "https://example.com:9443/", "https://other.example.org/",
    "https://example.com./", "https://127.0.0.1/"]) {
    assert.throws(() => approvedPublicUrl(value, hosts));
  }
  assert.throws(() => approvedPublicUrl("https://example.com/", ""));
});

test("connection addresses exclude private and reserved destinations", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "100.64.0.2", "169.254.1.1", "192.0.2.1", "224.0.0.1",
    "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "3fff::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700::1111"), true);
});

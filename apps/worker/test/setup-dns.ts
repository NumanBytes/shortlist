// Tests never touch the network, DNS included: every fetch now checks that its host resolves
// to a public address (src/discovery/public-url.ts), so resolve every name to a documentation
// address (TEST-NET-3, public as far as the check is concerned). A test that needs a private
// answer mocks lookup itself.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '203.0.113.10', family: 4 }]),
}));

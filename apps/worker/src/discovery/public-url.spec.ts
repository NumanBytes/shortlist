import { assertPublicUrl, isPrivateAddress, looksPublic } from './public-url.js';

describe('public-url', () => {
  it('knows private, loopback, link-local and unique-local addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.1.1',
      '192.168.1.5',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('screens links without DNS: internal names, private literals and non-http schemes are out', () => {
    expect(looksPublic('https://careers.example.com/jobs/1')).toBe(true);
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/health',
      'http://api.internal/x',
      'http://postgres:5432/',
      'http://[::1]/',
      'file:///etc/passwd',
    ])
      expect(looksPublic(url)).toBe(false);
  });

  it('refuses before any request for a private literal', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/non-public/);
  });
});

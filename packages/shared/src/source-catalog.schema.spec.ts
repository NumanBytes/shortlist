import { AddCatalogEntrySchema, FollowPlacesSchema, Regions, regionMatches } from './source-catalog.schema.js';

describe('Regions', () => {
  it('lowercases, trims and drops duplicates', () => {
    expect(Regions.parse([' Lahore', 'lahore', 'Pakistan '])).toEqual(['lahore', 'pakistan']);
  });

  it('refuses blanks and too many places', () => {
    expect(Regions.safeParse(['']).success).toBe(false);
    expect(Regions.safeParse(Array.from({ length: 11 }, (_, i) => `p${i}`)).success).toBe(false);
  });
});

describe('regionMatches', () => {
  it('matches a place the user typed, word by word', () => {
    expect(regionMatches(['lahore', 'pakistan'], ['lahore'])).toBe(true);
    expect(regionMatches(['lahore'], ['Lahore, Pakistan'])).toBe(true);
    expect(regionMatches(['new york'], ['new york', 'boston'])).toBe(true);
  });

  it("doesn't match on part of a word or another place", () => {
    expect(regionMatches(['pakistan'], ['pk'])).toBe(false);
    expect(regionMatches(['new york'], ['york'])).toBe(false);
    expect(regionMatches(['remote'], ['lahore'])).toBe(false);
  });
});

describe('catalog request schemas', () => {
  it('adds an entry from a name, a link and its places, and nothing else', () => {
    expect(
      AddCatalogEntrySchema.parse({ name: 'Acme', link: 'https://acme.com/careers', regions: ['Berlin'] }),
    ).toEqual({ name: 'Acme', link: 'https://acme.com/careers', regions: ['berlin'] });
    expect(
      AddCatalogEntrySchema.safeParse({ name: 'Acme', link: 'https://acme.com', regions: [], isListed: false }).success,
    ).toBe(false);
  });

  it('needs at least one place to follow', () => {
    expect(FollowPlacesSchema.safeParse({ regions: [] }).success).toBe(false);
    expect(FollowPlacesSchema.parse({ regions: ['Lahore'] })).toEqual({ regions: ['lahore'] });
  });
});

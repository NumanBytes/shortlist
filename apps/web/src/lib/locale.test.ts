import { paperSizeFor } from './locale';

describe('paperSizeFor', () => {
  it('picks Letter for the US and Canada, A4 elsewhere, from the first tag with a region', () => {
    expect(paperSizeFor(['en-US'])).toBe('LETTER');
    expect(paperSizeFor(['fr-CA', 'en'])).toBe('LETTER');
    expect(paperSizeFor(['en-PK'])).toBe('A4');
    expect(paperSizeFor(['en', 'de-DE'])).toBe('A4');
    expect(paperSizeFor(['en'])).toBe('A4');
    expect(paperSizeFor(['not a tag', 'en-US'])).toBe('LETTER');
  });
});

const { validateAndDeduplicate, validateClaim } = require('../prisma/import-claims.js');

const validClaim = {
  sourceKey: 'source:claim-1',
  text: 'Une affirmation éditoriale suffisamment longue.',
  truthLabel: 'TRUE',
  category: 'science',
  sourceUrl: 'https://example.com/source-1',
};

describe('editorial claims import validation', () => {
  it('normalizes valid claims and removes exact duplicate records', () => {
    const result = validateAndDeduplicate([
      validClaim,
      { ...validClaim, text: '  Une affirmation   éditoriale suffisamment longue.  ' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceKey: 'source:claim-1',
      text: 'Une affirmation éditoriale suffisamment longue.',
      truthLabel: 'TRUE',
    });
  });

  it('rejects conflicting labels for duplicate claim text', () => {
    expect(() => validateAndDeduplicate([
      validClaim,
      { ...validClaim, sourceKey: 'source:claim-2', truthLabel: 'FALSE' },
    ])).toThrow('Conflicting truthLabel');
  });

  it('rejects non-HTTPS source URLs', () => {
    expect(() => validateClaim({ ...validClaim, sourceUrl: 'http://example.com' }, 0))
      .toThrow('must use HTTPS');
  });

  it('rejects missing editorial labels', () => {
    expect(() => validateClaim({ ...validClaim, truthLabel: 'UNKNOWN' }, 0))
      .toThrow('truthLabel must be TRUE or FALSE');
  });
});

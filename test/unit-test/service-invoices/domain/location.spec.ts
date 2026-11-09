import {
  locationOf,
  normalizeLocation,
} from '../../../../src/modules/service-invoices/domain/location';

describe('locationOf', () => {
  it('joins city and state', () => {
    expect(locationOf({ city: ' São Paulo ', state: 'SP' })).toBe(
      'São Paulo, SP',
    );
  });

  it.each([
    { city: 'São Paulo', state: null },
    { city: null, state: 'SP' },
    { city: '', state: 'SP' },
    { city: null, state: null },
  ])('is null without both parts (%j)', client => {
    expect(locationOf(client)).toBeNull();
  });
});

describe('normalizeLocation', () => {
  it('trims, and takes blank for nothing', () => {
    expect(normalizeLocation(' Campinas, SP ')).toBe('Campinas, SP');
    expect(normalizeLocation('   ')).toBeNull();
  });
});

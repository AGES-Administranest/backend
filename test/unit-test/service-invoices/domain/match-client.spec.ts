import { matchTaker } from '../../../../src/modules/service-invoices/domain/match-client';

describe('matchTaker', () => {
  const lookups = (
    byTaxId: string | null,
    byName: string[] = [],
  ): {
    byTaxId: jest.Mock;
    byName: jest.Mock;
  } => ({
    byTaxId: jest.fn().mockResolvedValue(byTaxId),
    byName: jest.fn().mockResolvedValue(byName),
  });

  const taker = {
    name: 'CLINICA VETERINARIA EXEMPLO LTDA',
    taxId: '12345678000195',
  };

  it('links by the tax id first', async () => {
    const found = lookups('linked', ['suggested']);

    await expect(matchTaker(taker, found)).resolves.toEqual({
      clientMatch: 'linked',
    });
    expect(found.byName).not.toHaveBeenCalled();
  });

  it('falls back to the name when no client holds the tax id', async () => {
    await expect(
      matchTaker(taker, lookups(null, ['suggested'])),
    ).resolves.toEqual({
      clientSuggestions: ['suggested'],
    });
  });

  it('suggests by the name when the note has no tax id', async () => {
    const found = lookups('linked', ['suggested']);

    await expect(matchTaker({ name: taker.name }, found)).resolves.toEqual({
      clientSuggestions: ['suggested'],
    });
    expect(found.byTaxId).not.toHaveBeenCalled();
  });

  it('answers nothing when nothing matches or nothing was read', async () => {
    await expect(matchTaker(taker, lookups(null))).resolves.toEqual({});
    await expect(matchTaker({}, lookups('linked'))).resolves.toEqual({});
  });
});

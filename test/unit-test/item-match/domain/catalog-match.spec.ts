import {
  CatalogItem,
  prepareCatalog,
  rankCandidates,
} from '../../../../src/modules/item-match/domain/catalog-match';

const CATALOG: CatalogItem[] = [
  { id: 'propofol-1', name: 'Propofol 10mg/mL - frasco ampola 20mL' },
  { id: 'propofol-2', name: 'Propofol 2% ampola 20mL' },
  { id: 'cetamina-100', name: 'Cetamina 100mg/mL frasco 10mL' },
  { id: 'cetamina-50', name: 'Cetamina 50mg/mL frasco 10mL' },
  { id: 'seringa-insulina', name: 'Seringa 1ml (insulina)' },
  { id: 'seringa-3', name: 'Seringa 3ml' },
  { id: 'agulha-25x7', name: 'Agulha 25x7 cx c/100' },
  { id: 'equipo', name: 'Equipo macrogotas' },
  { id: 'metadona', name: 'Metadona 10mg/ml amp 1ml', unit: 'AMPOULE' },
];

const catalog = prepareCatalog(CATALOG);
const rank = (description: string) => rankCandidates(catalog, description);
const ids = (description: string) => rank(description).map(c => c.id);

describe('rankCandidates', () => {
  // US10 §4.2: every text measure put the wrong propofol first.
  it('lets the measures pick what text alone gets wrong', () => {
    expect(ids('PROPOFOL 1% 20ML AMP')).toEqual(['propofol-1']);
    expect(ids('CETAMINA 10% FR 10ML')).toEqual(['cetamina-100']);
  });

  it('scores a line that states every word and measure of the name at 1', () => {
    expect(rank('CETAMINA 100MG/ML FR 10ML')[0]).toEqual({
      id: 'cetamina-100',
      score: 1,
    });
  });

  it('reads supplier truncations as the word', () => {
    expect(rank('SER 3ML S/AG LS SR')[0]).toMatchObject({ id: 'seringa-3' });
    expect(rank('CETAMIN 10% 10ML')[0]).toMatchObject({ id: 'cetamina-100' });
  });

  it('weighs a rare word over a common one', () => {
    const [insulin] = rank('SERINGA 1ML S/ AGULHA TUBERCULINA');
    expect(insulin.id).toBe('seringa-insulina');
    expect(insulin.score).toBeLessThan(0.5);
  });

  it('does not take "com agulha" for the needle', () => {
    expect(ids('Seringa 5 mL com agulha 25x7')).not.toContain('agulha-25x7');
  });

  it('holds back an item when the line names a variant it lacks', () => {
    expect(rank('EQUIPO MACROGOTAS FOTOSSENSIVEL')[0].score).toBeLessThan(0.85);
  });

  it('uses the unit as the dosage form', () => {
    expect(ids('METADONA 10MG COMPRIMIDO')).toEqual([]);
  });

  it('does not read a "frasco" unit as an injectable', () => {
    const inhalants = prepareCatalog([
      { id: 'sevoflurano', name: 'Sevoflurano 250 ml', unit: 'VIAL' },
    ]);

    expect(
      rankCandidates(inhalants, 'SEVOFLURANO LIQ P/ INAL FR 250ML')[0],
    ).toMatchObject({ id: 'sevoflurano' });
  });

  it('holds back a plain syringe for a blood gas one', () => {
    expect(
      rank('SERINGA P/ GASOMETRIA 3ML HEPARINIZADA')[0].score,
    ).toBeLessThan(0.85);
  });

  it('finds nothing for a brand the name does not carry', () => {
    expect(ids('DIPRIVAN 1% 200MG/20ML AMP')).toEqual([]);
  });
});

import { compareAttributes } from '../../../../src/modules/item-match/domain/attribute-comparison';
import { extractAttributes } from '../../../../src/modules/item-match/domain/attributes';
import { normalize } from '../../../../src/modules/item-match/domain/normalize';

const attributesOf = (text: string) => extractAttributes(normalize(text));

describe('compareAttributes', () => {
  const compare = (line: string, item: string) =>
    compareAttributes(attributesOf(line), attributesOf(item));

  it.each([
    ['PROPOFOL 2% 20ML', 'Propofol 1% amp 20ml'],
    ['PROPOFOL 1% FA 50ML', 'Propofol 1% amp 20ml'],
    ['CATETER IV 24G', 'Cateter 22G'],
    ['AGULHA 25X8', 'Agulha 25x7'],
    ['LUVA PROC TAM P', 'Luva procedimento M'],
    ['LIDOCAINA 2% C/V 20ML', 'Lidocaina 2% s/ vaso 20ml'],
    ['TRAMADOL 50MG CAPSULA', 'Tramadol 50mg/ml amp 2ml'],
    ['ZOLETIL 100 5ML', 'Zoletil 50'],
    ['Tubo endotraqueal c/ cuff nº 4,5', 'Tubo endotraqueal 4,0 c/ cuff'],
    ['GAZE 7,5X7,5 PCT C/ 500', 'Gaze esteril 7,5x7,5 pct c/10'],
    ['ESPARADRAPO 5CMX4,5M', 'Esparadrapo 10cm'],
  ])('vetoes %s against %s', (line, item) => {
    expect(compare(line, item).veto).toBe(true);
  });

  it('confirms what both state and counts what the line leaves out', () => {
    expect(compare('PROPOFOL 1% AMP', 'Propofol 1% amp 20ml')).toEqual({
      veto: false,
      confirmed: 1,
      unconfirmed: 1,
    });
  });

  it('takes a bare number as the measure the item states', () => {
    expect(compare('CATETER 22 AZUL', 'Cateter 22G')).toMatchObject({
      veto: false,
      confirmed: 1,
    });
  });
});

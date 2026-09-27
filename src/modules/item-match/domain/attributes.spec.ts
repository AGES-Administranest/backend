import { compareAttributes, extractAttributes } from './attributes';
import { normalize } from './normalize';

const attributesOf = (text: string) => extractAttributes(normalize(text));

describe('extractAttributes', () => {
  it.each([
    ['PROPOFOL 1% 20ML', 10],
    ['Propofol 10 mg/mL', 10],
    ['DIPRIVAN 200MG/20ML AMP', 10],
    ['DIPIRONA 1G/2ML AMP', 500],
    ['FENTANILA 0,05MG/ML', 0.05],
    ['Fentanil 50 mcg/mL', 0.05],
    ['Adrenalina 1:1000 ampola', 1],
    ['TRAMADOL 100MG INJ AMP 2ML', 50],
  ])('concentration in mg/mL: %s', (text, expected) => {
    expect(attributesOf(text).concentrations[0]).toBeCloseTo(expected);
  });

  it.each([
    ['PROPOFOL 1% 20ML', [20]],
    ['MIDAZOLAM 15MG/3ML', [3]],
    ['Clorexidina 0,5% 1L', [1000]],
    ['SERINGA 10 CC', [10]],
    ['ISOFLURANO 1ML/ML FR 100ML', [100]],
  ])('volume in mL: %s', (text, expected) => {
    expect(attributesOf(text).volumes).toEqual(expected);
  });

  it('tells a gauge from grams', () => {
    expect(attributesOf('CATETER 22G').gauges).toEqual([22]);
    expect(attributesOf('CEFAZOLINA 1G FA').masses).toEqual([1000]);
  });

  it('reads needle sizes in either notation', () => {
    expect(attributesOf('AGULHA 25X7').dimensions).toEqual([[7, 25]]);
    expect(attributesOf('AGULHA 0,70X25MM').dimensions[0][0]).toBeCloseTo(7);
  });

  it('keeps the package count apart from bare numbers', () => {
    const attributes = attributesOf('Tubo endotraqueal nº 4,0 cx c/ 10');
    expect(attributes.counts).toEqual([10]);
    expect(attributes.bareNumbers).toEqual([4]);
  });

  it('reads sizes, forms and with/without flags', () => {
    expect(attributesOf('LUVA PROCED LATEX TAM M').sizes).toEqual(['m']);
    expect(attributesOf('TRAMADOL 50MG CAPSULA').forms).toEqual(['oral']);
    expect(attributesOf('LIDOCAINA 2% S/V').flags.get('vaso')).toBe(false);
    expect(attributesOf('TUBO C/ CUFF').flags.get('cuff')).toBe(true);
    expect(attributesOf('GAZE NAO ESTERIL').flags.get('esteril')).toBe(false);
    expect(attributesOf('GAZE ESTERIL').flags.get('esteril')).toBe(true);
  });
});

describe('compareAttributes', () => {
  const compare = (doc: string, item: string) =>
    compareAttributes(attributesOf(doc), attributesOf(item));

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
  ])('vetoes %s against %s', (doc, item) => {
    expect(compare(doc, item).veto).toBe(true);
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

import { extractAttributes } from './attributes';
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
    expect(attributes.packageCounts).toEqual([10]);
    expect(attributes.bareNumbers).toEqual([4]);
  });

  it('reads sizes, forms and with/without flags', () => {
    expect(attributesOf('LUVA PROCED LATEX TAM M').sizes).toEqual(['m']);
    expect(attributesOf('TRAMADOL 50MG CAPSULA').dosageForms).toEqual(['oral']);
    expect(attributesOf('LIDOCAINA 2% S/V').flags.get('vasoconstrictor')).toBe(
      false,
    );
    expect(attributesOf('TUBO C/ CUFF').flags.get('cuff')).toBe(true);
    expect(attributesOf('GAZE NAO ESTERIL').flags.get('sterile')).toBe(false);
    expect(attributesOf('GAZE ESTERIL').flags.get('sterile')).toBe(true);
  });
});

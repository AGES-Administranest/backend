import { normalize } from './normalize';

describe('normalize', () => {
  it.each([
    ['Bupivacaína 0,5%', 'bupivacaina 0.5%'],
    ['PROPOFOL 1% 20 ML AMP.', 'propofol 1% 20ml amp'],
    ['LIDOCAINA 2% S/VASO', 'lidocaina 2% sem vaso'],
    ['SERINGA DESC 1ML C/AG', 'seringa desc 1ml com agulha'],
    ['AG HIPO 25X7 CX100', 'agulha hipo 25x7 caixa 100'],
    ['Agulha 25 x 7 mm', 'agulha 25x7'],
    ['ESPARADRAPO 10CMX4,5M', 'esparadrapo 10x4.5'],
    ['AGULHA 0,70X25MM 22G', 'agulha 0.70x25 22g'],
    ['CETAMINA 10% FA 10ML', 'cetamina 10% frasco ampola 10ml'],
    ['Clorexidina 0,5% 1 litro', 'clorexidina 0.5% 1l'],
    ['SERINGA 10 CC', 'seringa 10cc'],
  ])('%s → %s', (text, expected) => {
    expect(normalize(text)).toBe(expected);
  });

  it('drops the lot and expiry a DANFE appends to the description', () => {
    expect(normalize('DIPIRONA 500MG/ML Lote: D25H071 Val: 31/07/2027')).toBe(
      'dipirona 500mg/ml',
    );
  });

  it.each([
    ['SORO FISIOLOGICO 0,9% 500ML', 'nacl 0.9% 500ml'],
    ['SORO FISIOL 0,9% 250ML BOLSA', 'nacl 0.9% 250ml bolsa'],
    ['Cloreto de Sódio 0,9% 500 mL', 'nacl 0.9% 500ml'],
    ['SF 0,9% 250ML', 'nacl 0.9% 250ml'],
    ['RINGER LACTATO 500ML SF', 'ringer lactato 500ml sf'],
    ['SONDA ENDOTRAQ C/BALAO 4,0', 'tubo endotraqueal com cuff 4.0'],
    ['EQUIPO MACRO C/INJ LAT', 'equipo macrogotas com inj lat'],
    ['EPINEFRINA 1MG/ML', 'adrenalina 1mg/ml'],
  ])('spells synonyms one way: %s', (text, expected) => {
    expect(normalize(text)).toBe(expected);
  });
});

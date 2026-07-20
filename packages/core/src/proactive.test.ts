import { describe, it, expect } from 'vitest';
import { isoWeek, isDrop } from './proactive';

// Zdroj pravdy pre formát isoWeek je history-snapshot/index.mjs (dedupe kľúč
// `proactive:<site>:<metric>:<wk>`). Tento test stráži, že sa NEROZÍDU — inak
// by denný psi alert a týždenný history alert nededupovali a klient by dostal
// dva e-maily za ten istý pokles.
describe('isoWeek', () => {
  it('ISO 8601 týždne (kontrola voči známym hodnotám)', () => {
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    // 2026-01-01 je štvrtok → W01
    expect(isoWeek(new Date('2026-07-20T00:00:00Z'))).toBe('2026-W30');
    // 4. jan 2026 (nedeľa) patrí ešte do W01
    expect(isoWeek(new Date('2026-01-04T23:59:59Z'))).toBe('2026-W01');
    // 5. jan 2026 (pondelok) už W02
    expect(isoWeek(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
  });

  it('1. januára patriaci do posledného týždňa predošlého roka', () => {
    // 2021-01-01 je piatok → ISO W53 roku 2020
    expect(isoWeek(new Date('2021-01-01T00:00:00Z'))).toBe('2020-W53');
  });
});

describe('isDrop', () => {
  it('pokles aspoň o prah → true (len zhoršenie)', () => {
    expect(isDrop(90, 80, 10)).toBe(true); // -10
    expect(isDrop(90, 79, 10)).toBe(true); // -11
  });

  it('menší pokles než prah → false', () => {
    expect(isDrop(90, 81, 10)).toBe(false); // -9
  });

  it('zlepšenie → false (nikdy nealertuj na zlepšenie)', () => {
    expect(isDrop(80, 95, 10)).toBe(false);
    expect(isDrop(80, 80, 10)).toBe(false);
  });
});

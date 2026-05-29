type TestCallback = () => void | Promise<void>;
type TestRegistration = (name: string, callback: TestCallback) => void;

interface TestMatchers {
  toBe(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toHaveLength(expected: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
}

declare const describe: TestRegistration;
declare const it: TestRegistration;
declare function expect(actual: unknown): TestMatchers;

export type ProductCache<T> = {
  get(): Promise<T | null>;
  set(value: T): Promise<void>;
  clear(): Promise<void>;
};

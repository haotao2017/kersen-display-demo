declare module 'bcryptjs' {
  export function hashSync(value: string, salt: number | string): string;
  export function compareSync(value: string, hash: string): boolean;
}

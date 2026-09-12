declare module 'diff' {
  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
  }

  export function diffLines(
    oldStr: string,
    newStr: string,
    options?: { ignoreWhitespace?: boolean },
  ): Change[];
}

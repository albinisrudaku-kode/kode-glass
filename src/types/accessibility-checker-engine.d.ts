declare module 'accessibility-checker-engine/ace-node.js' {
  export class Checker {
    check(root: Document | Element, policies?: string[]): Promise<unknown>;
  }
}

declare const __DEV__: boolean;

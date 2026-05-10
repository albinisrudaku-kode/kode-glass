const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

export const logger = {
  warn(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.warn(`[Kode Glass] ${message}`, ...args);
    }
  },
  error(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.error(`[Kode Glass] ${message}`, ...args);
    }
  },
  info(message: string, ...args: unknown[]): void {
    if (isDev) {
      console.info(`[Kode Glass] ${message}`, ...args);
    }
  },
};

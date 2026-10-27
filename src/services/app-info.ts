import pkg from '../../package.json';

/** The app version, from package.json (the release workflow checks it matches the Tauri and Cargo versions). */
export const APP_VERSION: string = pkg.version;

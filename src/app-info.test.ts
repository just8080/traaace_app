import { describe, expect, it } from 'vitest';
import tauriConfig from '../src-tauri/tauri.conf.json';
import cargoToml from '../src-tauri/Cargo.toml?raw';
import { APP_VERSION } from './services/app-info';

describe('app version', () => {
  it('is the same in package.json, tauri.conf.json and Cargo.toml', () => {
    const cargo = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(tauriConfig.version).toBe(APP_VERSION);
    expect(cargo).toBe(APP_VERSION);
  });
});

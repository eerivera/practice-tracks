import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { type Config } from '../../common/types.js';
import { BUILT_IN_DEFAULTS, mergeConfig } from '../../common/config/defaults.js';

function loadYaml(filePath: string): Partial<Config> {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as Partial<Config>;
}

// User-saved overrides sit alongside the committed template. The template
// (default_mix.yaml) is never written by the app; user_mix.yaml is gitignored.
const USER_CONFIG_PATH = path.resolve('config/user_mix.yaml');
const DEFAULT_CONFIG_PATH = path.resolve('config/default_mix.yaml');

export function loadBaseConfig(): Config {
  let config = structuredClone(BUILT_IN_DEFAULTS);
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    config = mergeConfig(config, loadYaml(DEFAULT_CONFIG_PATH));
  }
  if (fs.existsSync(USER_CONFIG_PATH)) {
    config = mergeConfig(config, loadYaml(USER_CONFIG_PATH));
  }
  return config;
}

export function saveBaseConfig(config: Config): void {
  fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(config), 'utf8');
}

export function resetBaseConfig(): Config {
  if (fs.existsSync(USER_CONFIG_PATH)) fs.unlinkSync(USER_CONFIG_PATH);
  return loadBaseConfig();
}

export function loadConfig(songDir: string): Config {
  const config = loadBaseConfig();

  const songConfigPath = path.join(songDir, 'mix.yaml');
  if (fs.existsSync(songConfigPath)) {
    return mergeConfig(config, loadYaml(songConfigPath));
  }

  return config;
}

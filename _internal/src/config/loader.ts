import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { type Config } from '../../common/types.js';
import { BUILT_IN_DEFAULTS, mergeConfig } from '../../common/config/defaults.js';

export { mergeConfig } from '../../common/config/defaults.js';

function loadYaml(filePath: string): Partial<Config> {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as Partial<Config>;
}

export function loadConfig(songDir: string): Config {
  let config = structuredClone(BUILT_IN_DEFAULTS);

  const projectConfigPath = path.resolve('config/default_mix.yaml');
  if (fs.existsSync(projectConfigPath)) {
    config = mergeConfig(config, loadYaml(projectConfigPath));
  }

  const songConfigPath = path.join(songDir, 'mix.yaml');
  if (fs.existsSync(songConfigPath)) {
    config = mergeConfig(config, loadYaml(songConfigPath));
  }

  return config;
}

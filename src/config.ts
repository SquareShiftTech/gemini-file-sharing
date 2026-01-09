import fs from 'fs';
import path from 'path';
import os from 'os';

export interface GcsDeployerConfig {
  projectId?: string;
  bucketName?: string;
  subfolder?: string;
}


let CONFIG_DIR = path.join(os.homedir(), '.gcs-deployer');
let CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class ConfigManager {
  // For testing
  static setConfigPath(dir: string) {
    CONFIG_DIR = dir;
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
  }

  static load(): GcsDeployerConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return {};
  }

  static save(config: GcsDeployerConfig) {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      const existing = this.load();
      const newConfig = { ...existing, ...config };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  static getBucket(): string | undefined {
    return this.load().bucketName;
  }

  static getProject(): string | undefined {
    return this.load().projectId;
  }

  static getSubfolder(): string | undefined {
    return this.load().subfolder;
  }
}

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

// Parse arguments
const args = process.argv.slice(2);
const getArg = (name) => {
    const index = args.findIndex(arg => arg.startsWith(`--${name}=`));
    return index !== -1 ? args[index].split('=')[1] : null;
};

const platform = getArg('platform');
const arch = getArg('arch');

if (!platform || !arch) {
    console.error('Usage: node scripts/package.js --platform=<platform> --arch=<arch>');
    process.exit(1);
}

const name = 'gcs-deployer';
const releaseDir = 'release';
const tempDir = 'temp_package';

// Ensure clean state
if (fs.existsSync(releaseDir)) {
    // Keep release dir, don't delete to allow parallel runs or cumulative builds
} else {
    fs.mkdirSync(releaseDir);
}

if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir);

// 1. Prepare Content
console.log(`Packaging for ${platform} (${arch})...`);

// Copy bundle
fs.copyFileSync('dist/gcs-deploy-bundled.cjs', path.join(tempDir, 'gcs-deploy-bundled.cjs'));

// Create gemini-extension.json
const extensionConfig = {
    name: name,
    version: packageJson.version,
    description: packageJson.description,
    mcpServers: {
        [name]: {
            command: "node",
            args: ["--no-warnings", "gcs-deploy-bundled.cjs"],
            env: {}
        }
    }
};
fs.writeFileSync(path.join(tempDir, 'gemini-extension.json'), JSON.stringify(extensionConfig, null, 2));

// 2. Archive
const archiveBaseName = `${platform}.${arch}.${name}`;
const archiveName = platform === 'win32' ? `${archiveBaseName}.zip` : `${archiveBaseName}.tar.gz`;
const outputPath = path.join(releaseDir, archiveName);

try {
    if (platform === 'win32') {
        // Create Zip
        execSync(`zip -r ../${outputPath} *`, { cwd: tempDir, stdio: 'inherit' });
    } else {
        // Create Tarball
        execSync(`tar -czf ../${outputPath} *`, { cwd: tempDir, stdio: 'inherit' });
    }
    console.log(`Created ${outputPath}`);
} catch (error) {
    console.error('Failed to create archive:', error);
    process.exit(1);
} finally {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
}

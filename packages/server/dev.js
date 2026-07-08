#!/usr/bin/env node

const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isWindows = os.platform() === 'win32';
const pathDelimiter = path.delimiter;
const wantsSelfHost =
  typeof process.env.SELF_HOSTABLE === 'string' &&
  process.env.SELF_HOSTABLE.toLowerCase() === 'true';
const configFile = (() => {
  if (isWindows) {
    return wantsSelfHost ? '.air.windows.selfhost.toml' : '.air.windows.toml';
  }
  return wantsSelfHost ? '.air.unix.selfhost.toml' : '.air.unix.toml';
})();

const modeLabel = wantsSelfHost ? 'self-host' : 'SaaS';
console.log(`🚀 Starting Air (${modeLabel}) with ${isWindows ? 'Windows' : 'Unix'} configuration`);
console.log(`📁 Config file: ${configFile}`);

// Ensure offline signing is enabled in dev by provisioning a local ES256 key
try {
  if (!process.env.OFFLINE_ECDSA_PRIV_PEM) {
    const keyPath = path.join(__dirname, 'offline.dev.pem');
    if (!fs.existsSync(keyPath)) {
      console.log('🔐 Generating dev ECDSA P-256 private key for offline signing...');
      const { privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // P-256
      });
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.writeFileSync(keyPath, pem, { mode: 0o600 });
      console.log('✅ Wrote dev key to', keyPath);
    }
    const pem = fs.readFileSync(keyPath, 'utf8');
    process.env.OFFLINE_ECDSA_PRIV_PEM = pem;
    console.log('🔓 Dev offline signing enabled via OFFLINE_ECDSA_PRIV_PEM');
  } else {
    console.log('🔓 OFFLINE_ECDSA_PRIV_PEM already set; using provided key');
  }
} catch (e) {
  console.warn('⚠️ Failed to provision dev offline signer (will remain disabled):', e?.message);
}

// Enable dev entitlement issuance without subscription in development
if (!process.env.OFFLINE_ENTITLEMENT_DEV) {
  process.env.OFFLINE_ENTITLEMENT_DEV = 'true';
  console.log('🧪 OFFLINE_ENTITLEMENT_DEV enabled for development');
}

// Prefer an explicit override first, then try common Go bin locations
const airBinary = process.env.AIR_BIN || 'air';
const goBinFallback =
  process.env.GOBIN ||
  (process.env.GOPATH ? path.join(process.env.GOPATH, 'bin') : path.join(os.homedir(), 'go', 'bin'));
const airEnv = {
  ...process.env,
  PATH: `${goBinFallback}${pathDelimiter}${process.env.PATH || ''}`,
};

// Spawn air with platform-specific config file
const airProcess = spawn(airBinary, ['-c', configFile], {
  stdio: 'inherit',
  env: airEnv,
});

airProcess.on('error', (error) => {
  const installHint = isWindows
    ? 'Install Air via `go install github.com/air-verse/air@latest` and ensure it is on your PATH.'
    : 'Install Air with `go install github.com/air-verse/air@latest` (GOBIN/GOPATH/bin must be on PATH).';
  console.error('❌ Failed to start Air:', error.message);
  if (error?.code === 'ENOENT') {
    console.error(`💡 ${installHint}`);
  }
  process.exit(1);
});

airProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`❌ Air exited with code ${code}`);
    process.exit(code);
  }
});

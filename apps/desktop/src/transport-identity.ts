import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const identityKey = 'lan-transport-identity';
export type TransportMaterial = { key: string; cert: string; fingerprint: string };
export type TransportMetadata = { cert: string; fingerprint: string };

export function certificateCoversHost(cert: string, host: string): boolean {
  try {
    const certificate = new X509Certificate(cert);
    return net.isIP(host) ? certificate.checkIP(host) !== undefined : certificate.checkHost(host) !== undefined;
  } catch {
    return false;
  }
}

export function createTransportIdentityStore(store: { get(key: string): Promise<unknown | null>; set(key: string, value: unknown): Promise<void> }) {
  return {
    async loadOrCreate(host: string, additionalHosts: string[] = []): Promise<TransportMaterial & { publicMetadata: TransportMetadata }> {
      const saved = await store.get(identityKey);
      const material = isMaterial(saved) && isTransportMaterialValid(saved)
        ? saved
        : await generateTransportMaterial([host, ...additionalHosts]);
      if (material !== saved) await store.set(identityKey, material);
      return { ...material, publicMetadata: { cert: material.cert, fingerprint: material.fingerprint } };
    },
  };
}

export function createProtectedFileStore(file: string) {
  const read = async () => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  };
  return {
    async get(key: string) {
      const values = await read();
      return values[key] ?? null;
    },
    async set(key: string, value: unknown) {
      const values = await read();
      values[key] = value;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
      await fs.rename(temporary, file);
    },
  };
}

async function generateTransportMaterial(hosts: string[]): Promise<TransportMaterial> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prismata-tls-'));
  const keyFile = path.join(directory, 'key.pem');
  const certFile = path.join(directory, 'cert.pem');
  try {
    const subjectAlternativeName = [...new Set(hosts)].map((host) => net.isIP(host) ? `IP:${host}` : `DNS:${host}`).join(',');
    await execFileAsync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-subj', '/CN=Prismata LAN', '-addext', `subjectAltName=${subjectAlternativeName}`, '-keyout', keyFile, '-out', certFile], { maxBuffer: 1024 * 1024 });
    const [key, cert, der] = await Promise.all([fs.readFile(keyFile, 'utf8'), fs.readFile(certFile, 'utf8'), execFileAsync('openssl', ['x509', '-in', certFile, '-outform', 'der'], { encoding: 'buffer' }).then((result) => result.stdout as Buffer)]);
    return { key, cert, fingerprint: createHash('sha256').update(der).digest('hex') };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function isMaterial(value: unknown): value is TransportMaterial {
  return !!value && typeof value === 'object' && typeof (value as TransportMaterial).key === 'string' && typeof (value as TransportMaterial).cert === 'string' && /^[a-f0-9]{64}$/i.test((value as TransportMaterial).fingerprint);
}

export function isTransportMaterialValid(material: TransportMaterial, now = Date.now()): boolean {
  try {
    const certificate = new X509Certificate(material.cert);
    if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) return false;
    const fingerprint = createHash('sha256').update(certificate.raw).digest('hex');
    if (fingerprint.toLowerCase() !== material.fingerprint.toLowerCase()) return false;
    const certificateKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
    const privateKey = createPublicKey(createPrivateKey(material.key)).export({ type: 'spki', format: 'der' });
    return Buffer.from(certificateKey).equals(Buffer.from(privateKey));
  } catch {
    return false;
  }
}

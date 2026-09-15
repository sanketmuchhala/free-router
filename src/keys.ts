import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// The router's own API keys. Clients use one of these; provider keys never leave the router.
// Only a hash of each key is stored, so the file cannot be used to recover a key.

export interface KeyRecord {
  id: string;
  name: string;
  /** SHA-256 of the key, hex. */
  hash: string;
  /** The first characters, to recognize a key in a list. */
  prefix: string;
  createdAt: string;
}

const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

export class KeyStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, 'keys.json');
  }

  list(): KeyRecord[] {
    if (!existsSync(this.file)) return [];
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private save(records: KeyRecord[]) {
    writeFileSync(this.file, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
  }

  /** Make a key. The key itself is returned once and never stored. */
  create(name = 'default'): { key: string; record: KeyRecord } {
    const key = `fr_${randomBytes(24).toString('base64url')}`;
    const record: KeyRecord = { id: randomBytes(4).toString('hex'), name: name.slice(0, 60), hash: hashOf(key), prefix: key.slice(0, 7), createdAt: new Date().toISOString() };
    this.save([...this.list(), record]);
    return { key, record };
  }

  revoke(idOrPrefix: string): KeyRecord | undefined {
    const records = this.list();
    const match = records.find(r => r.id === idOrPrefix || r.prefix === idOrPrefix || r.name === idOrPrefix);
    if (match) this.save(records.filter(r => r !== match));
    return match;
  }

  verify(key: string | undefined): KeyRecord | undefined {
    if (!key) return undefined;
    const hash = Buffer.from(hashOf(key), 'hex');
    return this.list().find(r => {
      const stored = Buffer.from(r.hash, 'hex');
      return stored.length === hash.length && timingSafeEqual(stored, hash);
    });
  }
}

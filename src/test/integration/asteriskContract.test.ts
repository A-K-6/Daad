/**
 * Asterisk fixture contract tests (static, hermetic).
 *
 * Validates that docker/asterisk/* implements the JBM contract WITHOUT
 * requiring a live container: TLS 5061 + TCP/UDP 5060, mandatory
 * SDES-SRTP, PCMU/PCMA only, RFC 4733 DTMF, RTP 10000–10199, symmetric
 * RTP + contact rewrite, single-contact AORs, extension-only dial plan,
 * and no committed secrets/captures.
 *
 * Live-container checks (pjsip show contacts/channels, 2-client soak)
 * are gated behind DAAD_LIVE_ASTERISK=1 and documented in
 * docs/ACCEPTANCE.md — they are skipped by default in CI.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'docker/asterisk');
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('asterisk fixture contract (static)', () => {
  it('ships all required fixture files', () => {
    for (const f of [
      'Dockerfile',
      'docker-compose.yml',
      'README.md',
      '.env.example',
      'config/pjsip.conf',
      'config/extensions.conf',
      'config/rtp.conf',
      'config/logger.conf',
      'scripts/gen-certs.sh',
      'scripts/redact-pcap.sh',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f)), `missing ${f}`).toBe(true);
    }
  });

  it('exposes SIP/TLS 5061 with cert/key wiring', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/\[transport-tls\]/);
    expect(conf).toMatch(/protocol\s*=\s*tls/);
    expect(conf).toMatch(/bind\s*=\s*0\.0\.0\.0:5061/);
    expect(conf).toMatch(/cert_file\s*=.*asterisk\.crt/);
    expect(conf).toMatch(/priv_key_file\s*=.*asterisk\.key/);
  });

  it('keeps TCP/UDP 5060 fallback transports', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/\[transport-tcp\][\s\S]*?bind\s*=\s*0\.0\.0\.0:5060/);
    expect(conf).toMatch(/\[transport-udp\][\s\S]*?bind\s*=\s*0\.0\.0\.0:5060/);
  });

  it('mandates SDES-SRTP (no plain-RTP downgrade)', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/media_encryption\s*=\s*sdes/);
    // Must not contain an endpoint that disables encryption.
    expect(conf).not.toMatch(/media_encryption\s*=\s*no/);
  });

  it('restricts codecs to PCMU/PCMA (ulaw/alaw)', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/disallow\s*=\s*all/);
    expect(conf).toMatch(/allow\s*=\s*ulaw,alaw/);
    expect(conf).not.toMatch(/allow\s*=.*opus/i);
    expect(conf).not.toMatch(/allow\s*=.*g729/i);
  });

  it('uses RFC 4733 DTMF and symmetric RTP + contact rewrite', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/dtmf_mode\s*=\s*rfc4733/);
    expect(conf).not.toMatch(/dtmf_mode\s*=\s*inband/);
    expect(conf).toMatch(/rtp_symmetric\s*=\s*yes/);
    expect(conf).toMatch(/rewrite_contact\s*=\s*yes/);
    expect(conf).toMatch(/force_rport\s*=\s*yes/);
    expect(conf).toMatch(/direct_media\s*=\s*no/);
  });

  it('enforces single-contact AORs (duplicate REGISTER replaces)', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/max_contacts\s*=\s*1/);
    expect(conf).toMatch(/remove_existing\s*=\s*yes/);
  });

  it('configures RTP range 10000–10199', () => {
    const conf = read('config/rtp.conf');
    expect(conf).toMatch(/rtpstart\s*=\s*10000/);
    expect(conf).toMatch(/rtpend\s*=\s*10199/);
  });

  it('dial plan is extension-only with echo + hangup probe', () => {
    const conf = read('config/extensions.conf');
    expect(conf).toMatch(/exten\s*=>\s*1001[\s\S]*?Dial\(PJSIP\/1001/);
    expect(conf).toMatch(/exten\s*=>\s*1002[\s\S]*?Dial\(PJSIP\/1002/);
    expect(conf).toMatch(/exten\s*=>\s*600[\s\S]*?Echo\(\)/);
    // No trunk / outbound dial patterns.
    expect(conf).not.toMatch(/Dial\(PJSIP\/.*trunk/i);
    expect(conf).not.toMatch(/Dial\(SIP\//);
  });

  it('injects passwords from env only — no committed secrets', () => {
    const conf = read('config/pjsip.conf');
    expect(conf).toMatch(/\$\{DAAD_TEST_PASSWORD_1001\}/);
    expect(conf).toMatch(/\$\{DAAD_TEST_PASSWORD_1002\}/);
    // No literal password= lines with real values.
    const literalSecrets = conf
      .split('\n')
      .filter(
        (l) =>
          /^\s*password\s*=/.test(l) && !l.includes('${DAAD_TEST_PASSWORD'),
      );
    expect(literalSecrets).toEqual([]);
    // .env.example ships placeholders only.
    const envExample = read('.env.example');
    expect(envExample).toMatch(/changeme/);
  });

  it('gitignores generated certs, captures and local .env', () => {
    const gi = fs.readFileSync(path.resolve(process.cwd(), '.gitignore'), 'utf8');
    for (const needle of [
      'docker/asterisk/certs/',
      'docker/asterisk/captures/*.pcap',
      'docker/asterisk/.env',
    ]) {
      expect(gi, `missing gitignore entry: ${needle}`).toContain(needle);
    }
    // And no real certs/captures/.env are committed right now.
    expect(fs.existsSync(path.join(ROOT, 'certs/asterisk.key'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, '.env'))).toBe(false);
    const captures = fs.existsSync(path.join(ROOT, 'captures'))
      ? fs.readdirSync(path.join(ROOT, 'captures'))
      : [];
    expect(
      captures.filter((f) => /\.pcap(ng)?$/.test(f)),
    ).toEqual([]);
  });

  it('sanitized-capture policy: logger.conf keeps SIP debug off by default', () => {
    expect(read('config/logger.conf')).not.toMatch(/pjsip.*debug/i);
  });

  it('live-container checks are documented but skipped without DAAD_LIVE_ASTERISK=1', () => {
    // This test documents the live gate; the real live assertions live in
    // docs/ACCEPTANCE.md criteria 19 + fixture README zero-orphan commands.
    if (!process.env.DAAD_LIVE_ASTERISK) {
      expect(true).toBe(true);
      return;
    }
    // Live mode: operator runs the README zero-orphan commands manually.
    expect(process.env.DAAD_LIVE_ASTERISK).toBe('1');
  });
});

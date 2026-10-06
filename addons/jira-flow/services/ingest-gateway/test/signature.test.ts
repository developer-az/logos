import { randomBytes } from 'node:crypto';
import { sign, verifySignature } from '../src/jira/signature';

describe('verifySignature', () => {
  const body = Buffer.from('{"hello":"world"}');
  const secret = randomBytes(32).toString('hex');

  it('accepts a correct signature', () => {
    expect(verifySignature(body, sign(body, secret), secret)).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['wrong scheme', 'sha1=abc'],
    ['wrong digest', sign(body, randomBytes(32).toString('hex'))],
    ['truncated digest', sign(body, secret).slice(0, 20)],
  ])('rejects %s', (_name, header) => {
    expect(verifySignature(body, header, secret)).toBe(false);
  });

  it('rejects a body modified after signing', () => {
    expect(verifySignature(Buffer.from('{"hello":"world!"}'), sign(body, secret), secret)).toBe(false);
  });
});

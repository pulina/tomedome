import packageJson from '../../../package.json';

export const TOMEDOME_USER_AGENT = `TomeDome/${packageJson.version}`;

export function withUserAgent(headers: Record<string, string>): Record<string, string> {
  return { ...headers, 'user-agent': TOMEDOME_USER_AGENT };
}

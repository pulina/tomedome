import styles from './AboutPage.module.css';

const VERSION = '0.1.0';

const FONT_CREDITS = [
  { name: 'Cinzel', author: 'Vernon Adams', license: 'SIL OFL 1.1' },
  { name: 'Inter', author: 'Rasmus Andersson', license: 'SIL OFL 1.1' },
  { name: 'JetBrains Mono', author: 'JetBrains s.r.o.', license: 'SIL OFL 1.1' },
];

const OSS_DEPS = [
  { name: '@fastify/cors', license: 'MIT' },
  { name: '@likecoin/epub-ts', license: 'BSD-2-Clause' },
  { name: 'better-sqlite3', license: 'MIT' },
  { name: 'cheerio', license: 'MIT' },
  { name: 'Electron', license: 'MIT' },
  { name: 'fastify', license: 'MIT' },
  { name: 'franc-min', license: 'MIT' },
  { name: 'jszip', license: 'MIT (dual MIT/GPL-3.0; this app uses MIT)' },
  { name: 'linkedom', license: 'ISC' },
  { name: 'pino', license: 'MIT' },
  { name: 'pino-pretty', license: 'MIT' },
  { name: 'react', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'react-router-dom', license: 'MIT' },
  { name: 'react-virtuoso', license: 'MIT' },
  { name: 'safe-regex2', license: 'MIT' },
];

export function AboutPage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.appName}>TomeDome</div>
          <div className={styles.versionBadge}>v{VERSION}</div>
          <div className={styles.tagline}>AI Reading Companion for long book series</div>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Author</div>
          <div className={styles.row}>
            <span className={styles.label}>Name</span>
            <span className={styles.value}>Szymon Kuliński</span>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Source Code</div>
          <div className={styles.row}>
            <span className={styles.label}>GitHub</span>
            <a
              className={styles.valueMuted}
              href="https://github.com/pulina/tomedome"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/pulina/tomedome
            </a>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>License</div>
          <div className={styles.licenseBlock}>
            <div className={styles.licenseName}>MIT License</div>
            <div className={styles.licenseText}>
              Copyright © 2025 Szymon Kuliński
              {'\n\n'}
              Permission is hereby granted, free of charge, to any person obtaining a copy of this
              software and associated documentation files (the &quot;Software&quot;), to deal in the
              Software without restriction, including without limitation the rights to use, copy,
              modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
              and to permit persons to whom the Software is furnished to do so, subject to the
              following conditions:
              {'\n\n'}
              The above copyright notice and this permission notice shall be included in all copies
              or substantial portions of the Software.
              {'\n\n'}
              THE SOFTWARE IS PROVIDED &quot;AS IS&quot;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
              IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
              HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
              CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
              THE USE OR OTHER DEALINGS IN THE SOFTWARE.
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Font Credits</div>
          <div className={styles.creditTable}>
            {FONT_CREDITS.map(({ name, author, license }) => (
              <div key={name} className={styles.creditRow}>
                <span className={styles.creditName}>{name}</span>
                <span className={styles.creditAuthor}>{author}</span>
                <span className={styles.creditLicense}>{license}</span>
              </div>
            ))}
          </div>
          <div className={styles.helper}>
            Full license texts are distributed in <code>licenses/fonts/</code> inside the
            application bundle.
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitle}>Open Source Dependencies</div>
          <div className={styles.creditTable}>
            {OSS_DEPS.map(({ name, license }) => (
              <div key={name} className={styles.creditRow}>
                <span className={styles.creditName}>{name}</span>
                <span className={styles.creditLicense}>{license}</span>
              </div>
            ))}
          </div>
          <div className={styles.helper}>
            Font npm packages (<code>@fontsource/*</code>) match the fonts listed above (OFL-1.1).
            Electron ships with Chromium and other components; their notices ship with the Electron
            runtime, not in this table.
          </div>
        </section>
      </div>
    </div>
  );
}

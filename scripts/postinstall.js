const { execSync } = require('child_process')

execSync('electron-rebuild -f -w better-sqlite3', { stdio: 'inherit' })

if (process.platform === 'darwin') {
  execSync(
    "find node_modules/better-sqlite3 -name '*.node' -exec codesign --sign - --force {} \\;",
    { stdio: 'inherit' }
  )
}

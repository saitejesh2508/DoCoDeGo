const [major, minor] = process.versions.node.split('.').map(Number)

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `pnpm dev requires Node.js 22.12 or newer; detected ${process.versions.node}. ` +
      'Install a supported Node version, then reopen your terminal.',
  )
  process.exitCode = 1
}

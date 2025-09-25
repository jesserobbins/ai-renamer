const fs = require('fs/promises')
const path = require('path')

async function discoverFiles (targetPath, includeSubdirectories) {
  const stats = await fs.stat(targetPath)
  if (stats.isFile()) {
    return [targetPath]
  }
  if (!stats.isDirectory()) {
    throw new Error(`Unsupported path: ${targetPath}`)
  }

  const files = []
  async function walk (dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (includeSubdirectories) {
          await walk(fullPath)
        }
        continue
      }
      if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }

  await walk(targetPath)
  return files
}

module.exports = {
  discoverFiles
}

const fs = require('fs/promises')

async function extractText (filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return raw.slice(0, 5000)
}

module.exports = {
  extractText
}

const fs = require('fs/promises')
const path = require('path')

async function extractImage (filePath) {
  const buffer = await fs.readFile(filePath)
  const base64 = buffer.toString('base64')
  const extension = path.extname(filePath).replace('.', '')
  return {
    base64,
    mediaType: `image/${extension === 'jpg' ? 'jpeg' : extension}`
  }
}

module.exports = {
  extractImage
}

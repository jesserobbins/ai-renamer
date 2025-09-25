const path = require('path')
const fs = require('fs/promises')
const { getFileCategory, getExtension } = require('../utils/fileType')
const { extractText } = require('./textExtractor')
const { extractPdf } = require('./pdfExtractor')
const { extractImage } = require('./imageExtractor')
const { extractFrames } = require('./videoExtractor')

async function extractContent (filePath, options) {
  const category = getFileCategory(filePath)
  const baseName = path.basename(filePath)
  const stats = await fs.stat(filePath)

  const baseContext = {
    fileName: baseName,
    extension: getExtension(filePath),
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString()
  }

  if (category === 'text') {
    const text = await extractText(filePath)
    return { ...baseContext, text }
  }

  if (category === 'pdf') {
    const { text, metadata } = await extractPdf(filePath)
    return { ...baseContext, text, metadata }
  }

  if (category === 'image') {
    const image = await extractImage(filePath)
    return { ...baseContext, image }
  }

  if (category === 'video') {
    const { frames, duration, frameCount, error } = await extractFrames({ filePath, frameCount: options.frames || 3 })
    return { ...baseContext, frames, duration, frameCount, frameError: error }
  }

  const buffer = await fs.readFile(filePath)
  return { ...baseContext, binarySnippet: buffer.slice(0, 4096).toString('base64') }
}

module.exports = {
  extractContent
}

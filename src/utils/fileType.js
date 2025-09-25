const path = require('path')

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log'])
const PDF_EXTENSIONS = new Set(['.pdf'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.svg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])

function getExtension (filePath) {
  return path.extname(filePath).toLowerCase()
}

function getFileCategory (filePath) {
  const ext = getExtension(filePath)
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'binary'
}

module.exports = {
  getExtension,
  getFileCategory,
  TEXT_EXTENSIONS,
  PDF_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS
}

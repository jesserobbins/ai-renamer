const path = require('path')

function sanitizeFilename (filename, extension = '') {
  const invalidChars = /[<>:"/\\|?*]/g
  const cleaned = filename.replace(invalidChars, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) {
    return `untitled${extension ? `.${extension}` : ''}`
  }
  const normalizedExtension = extension ? `.${extension.replace(/^\./, '')}` : ''
  return `${cleaned}${normalizedExtension}`
}

function truncateFilename (filename, maxChars) {
  if (!maxChars || filename.length <= maxChars) return filename
  return filename.slice(0, maxChars)
}

function ensureUniqueName (targetDir, filename, existsSync) {
  const { name, ext } = path.parse(filename)
  let candidate = filename
  let counter = 1
  while (existsSync(path.join(targetDir, candidate))) {
    candidate = `${name}-${counter}${ext}`
    counter += 1
  }
  return candidate
}

module.exports = {
  sanitizeFilename,
  truncateFilename,
  ensureUniqueName
}

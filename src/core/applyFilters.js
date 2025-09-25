const fs = require('fs/promises')
const path = require('path')
const { getExtension } = require('../utils/fileType')

function normalizeExtensions (value) {
  if (!value) return []
  return value.split(',').map(ext => ext.trim().toLowerCase()).filter(Boolean).map(ext => (ext.startsWith('.') ? ext : `.${ext}`))
}

async function applyFilters (filePath, options) {
  const stats = await fs.stat(filePath)
  const ext = getExtension(filePath)
  const baseName = path.basename(filePath)

  if (options.maxFileSize && stats.size > options.maxFileSize * 1024 * 1024) {
    return { skipped: true, reason: `File exceeds maximum size (${options.maxFileSize}MB)` }
  }

  const allow = normalizeExtensions(options.onlyExtensions)
  if (allow.length && !allow.includes(ext)) {
    return { skipped: true, reason: `Extension ${ext} not in onlyExtensions list` }
  }

  const deny = normalizeExtensions(options.ignoreExtensions)
  if (deny.includes(ext)) {
    return { skipped: true, reason: `Extension ${ext} is ignored` }
  }

  if (baseName.startsWith('.')) {
    return { skipped: true, reason: 'Hidden file' }
  }

  return { skipped: false, reason: '' }
}

module.exports = {
  applyFilters
}

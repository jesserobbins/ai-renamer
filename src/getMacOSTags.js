const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const sanitizeTag = (value) => {
  if (typeof value !== 'string') return null
  const normalized = value
    .split('\u0000').join('')
    .replace(/\r/g, '\n')
  const [primary] = normalized.split(/\n+/)
  if (!primary) return null
  const cleaned = primary.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || null
}

const parseMdlsOutput = (raw) => {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '(null)') return []

  const matches = []
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let match
  while ((match = regex.exec(trimmed)) !== null) {
    const candidate = match[1].replace(/\\"/g, '"')
    matches.push(candidate)
  }

  if (matches.length === 0) {
    const fallback = trimmed
      .replace(/^\(\s*/, '')
      .replace(/\s*\)$/, '')
      .split(/,\s*/)
      .map(entry => entry.replace(/^"|"$/g, ''))
    return fallback
  }

  return matches
}

module.exports = async ({ filePath, verboseLogger }) => {
  if (process.platform !== 'darwin') {
    return []
  }

  try {
    const { stdout } = await execFileAsync('mdls', ['-raw', '-name', 'kMDItemUserTags', filePath])
    const parsed = parseMdlsOutput(stdout)
    const sanitized = []
    const seen = new Set()

    for (const entry of parsed) {
      const cleaned = sanitizeTag(entry)
      if (!cleaned) continue
      const key = cleaned.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      sanitized.push(cleaned)
    }

    if (sanitized.length > 0 && typeof verboseLogger === 'function') {
      verboseLogger(`🏷️ Finder tags detected: ${sanitized.join(', ')}`)
    }

    return sanitized
  } catch (err) {
    if (typeof verboseLogger === 'function') {
      verboseLogger(`⚪ Unable to read Finder tags: ${err.message}`)
    }
    return []
  }
}

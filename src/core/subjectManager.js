const fs = require('fs/promises')
const path = require('path')
const { cleanSubjectName } = require('../utils/subject')

async function scanExistingSubjects (directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch (error) {
    return []
  }
}

function normalizeSubject (subject) {
  if (!subject) return ''
  const cleaned = cleanSubjectName(subject)
  if (!cleaned) return ''
  return cleaned.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function createSubjectManager ({ baseDirectory, moveUnknownSubjects }, logger) {
  const existing = await scanExistingSubjects(baseDirectory)
  const subjects = new Set(existing.map(normalizeSubject).filter(Boolean))
  const hints = Array.from(subjects).sort()

  async function ensureDirectory (dirPath) {
    await fs.mkdir(dirPath, { recursive: true })
  }

  function getHints () {
    return hints
  }

  async function resolveDestination ({ subject, confidence }) {
    const normalized = normalizeSubject(subject)
    if (!normalized) {
      if (!moveUnknownSubjects) {
        return null
      }
      const unknownDir = path.join(baseDirectory, 'Unknown')
      await ensureDirectory(unknownDir)
      return { directory: unknownDir, subject: 'Unknown', confidence }
    }

    if (!subjects.has(normalized)) {
      subjects.add(normalized)
      hints.push(normalized)
      hints.sort((a, b) => a.localeCompare(b))
    }

    const destination = path.join(baseDirectory, normalized)
    await ensureDirectory(destination)
    return { directory: destination, subject: normalized, confidence }
  }

  return {
    baseDirectory,
    getHints,
    resolveDestination
  }
}

module.exports = {
  createSubjectManager,
  normalizeSubject
}

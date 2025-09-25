const fs = require('fs/promises')
const path = require('path')
const { cleanSubjectName, DEFAULT_STOPWORDS } = require('../utils/subject')

const DEFAULT_SUBJECT_RULES = [
  'Subject names must only include the company, project, or person responsible for the artifact.',
  'If the material references financing, investors, or rounds without a clear subject, return null.',
  'Remove legal form suffixes only if they appear as noise (e.g. keep "Acme Labs Inc" but drop trailing financing descriptors).'
]

function uniqueList (values) {
  return Array.from(new Set(values.filter(Boolean)))
}

async function loadInstructionFile (filePath, logger) {
  if (!filePath) return ''
  try {
    const resolved = path.resolve(process.cwd(), filePath)
    const contents = await fs.readFile(resolved, 'utf8')
    return contents.trim()
  } catch (error) {
    if (logger) {
      logger.warn(`Unable to load instruction file at ${filePath}: ${error.message}`)
    }
    return ''
  }
}

function buildSystemMessage ({ caseStyle, language, subjectStopwords, extraSystem }) {
  const lines = []
  lines.push('You are an analyst tasked with renaming downloaded diligence artifacts.')
  lines.push('Analyse the supplied context and return ONLY valid JSON matching this schema:')
  lines.push('{')
  lines.push('  "filename": string,')
  lines.push('  "subject": string | null,')
  lines.push('  "subject_confidence": number (0-1),')
  lines.push('  "summary": string')
  lines.push('}')
  lines.push('Do not emit commentary outside the JSON object.')
  lines.push(`Filenames must be concise, descriptive, and prefer ${caseStyle}.`)
  lines.push(`Respond in ${language}.`)
  lines.push('Subject naming rules:')
  DEFAULT_SUBJECT_RULES.forEach(rule => lines.push(`- ${rule}`))
  if (subjectStopwords.length) {
    lines.push(`- Never include these tokens in the subject: ${subjectStopwords.join(', ')}.`)
  }
  lines.push('- If unsure about the subject, set "subject" to null and "subject_confidence" to 0.')
  if (extraSystem) {
    lines.push('Additional system instructions:')
    lines.push(extraSystem)
  }
  return lines.join('\n')
}

function parseStopwords (value) {
  if (!value) return []
  return value
    .split(',')
    .map(token => token.trim().toLowerCase())
    .filter(Boolean)
}

async function createInstructionSet (options, logger) {
  const caseStyle = options.case || 'kebabCase'
  const language = options.language || 'English'
  const customStopwords = parseStopwords(options.subjectStopwords)
  const externalSystem = await loadInstructionFile(options.instructionsFile, logger)
  const subjectStopwords = uniqueList([...DEFAULT_STOPWORDS, ...customStopwords])

  const systemMessage = buildSystemMessage({
    caseStyle,
    language,
    subjectStopwords,
    extraSystem: externalSystem
  })

  function sanitizeSubject (raw) {
    const cleaned = cleanSubjectName(raw, customStopwords)
    return cleaned || null
  }

  return {
    systemMessage,
    subjectStopwords,
    sanitizeSubject
  }
}

module.exports = {
  createInstructionSet
}

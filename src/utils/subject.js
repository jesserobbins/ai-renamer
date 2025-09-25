const DEFAULT_STOPWORDS = [
  'pitch',
  'deck',
  'teaser',
  'memo',
  'update',
  'overview',
  'summary',
  'investor',
  'investors',
  'investment',
  'funding',
  'fundraise',
  'fundraising',
  'round',
  'series',
  'confidential',
  'draft',
  'final'
]

function escapeRegex (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildStopwordPattern (stopwords) {
  if (!stopwords.length) return null
  const escaped = stopwords.map(escapeRegex).join('|')
  return new RegExp(`\\b(${escaped})\\b`, 'gi')
}

function removeFinanceDescriptors (value) {
  return value
    .replace(/\bseries[-\s]+[a-z0-9+-]+\b/gi, ' ')
    .replace(/\b(pre[\s-]?seed|seed|angel|bridge|growth|extension)[-\s]+(round|raise)\b/gi, ' ')
    .replace(/\b(round|raise)[-\s]+(series[-\s]+[a-z0-9+-]+)\b/gi, ' ')
    .replace(/\b(funding|fundraise|fundraising)[-\s]+(round|update)\b/gi, ' ')
}

function stripStopwords (value, stopwords) {
  const pattern = buildStopwordPattern(stopwords)
  if (!pattern) return value
  return value.replace(pattern, ' ')
}

function removeBannedParenthetical (value, stopwords) {
  const pattern = buildStopwordPattern(stopwords)
  if (!pattern) return value
  return value.replace(/\([^)]*\)/g, segment => {
    pattern.lastIndex = 0
    return pattern.test(segment) ? ' ' : segment
  })
}

function cleanSubjectName (rawSubject, extraStopwords = []) {
  if (!rawSubject || typeof rawSubject !== 'string') {
    return ''
  }

  const stopwords = Array.from(
    new Set([...DEFAULT_STOPWORDS, ...extraStopwords.map(word => word.toLowerCase())])
  )

  let value = rawSubject
  value = value.normalize('NFKC')
  value = removeBannedParenthetical(value, stopwords)
  value = removeFinanceDescriptors(value)
  value = stripStopwords(value, stopwords)

  value = value
    .replace(/[_-]{2,}/g, ' ')
    .replace(/[\s/]+/g, ' ')
    .replace(/["`]/g, '')
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/[^a-z0-9]+$/i, '')

  const cleaned = value.trim()
  if (!cleaned) {
    return ''
  }

  return cleaned
}

module.exports = {
  cleanSubjectName,
  DEFAULT_STOPWORDS
}

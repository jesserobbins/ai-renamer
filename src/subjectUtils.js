const LOW_SUBJECT_KEYS = new Set([
  'unknown',
  'misc',
  'various',
  'untitled',
  'na',
  'n-a',
  'other',
  'general'
])

// Recognize common company designators so we can stop parsing once the
// corporate suffix has been captured.  Everything is stored in lowercase and
// stripped of punctuation for easier comparisons.
const COMPANY_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'llc',
  'llp',
  'plc',
  'ltd',
  'limited',
  'gmbh',
  'sarl',
  'srl',
  'sa',
  'sas',
  'spa',
  'bv',
  'oy',
  'oyj',
  'pte',
  'pty',
  'ag',
  'ab',
  'pc',
  'pbc',
  'lp',
  'lllp'
])

const COMPANY_SUFFIXES_FORCE_UPPER = new Set([
  'llc',
  'llp',
  'plc',
  'gmbh',
  'sarl',
  'srl',
  'spa',
  'sas',
  'bv',
  'oy',
  'oyj',
  'pte',
  'pty',
  'ag',
  'ab',
  'pc',
  'pbc',
  'lp',
  'lllp'
])

// Document descriptors that frequently trail company names inside filenames.
// We use the list to trim noisy suffixes from subject candidates and to detect
// when the inferred subject still contains document-specific terminology.
const DOCUMENT_TERMS = [
  'financial',
  'financials',
  'finance',
  'finances',
  'deck',
  'pitch',
  'template',
  'presentation',
  'slide',
  'slides',
  'report',
  'update',
  'summary',
  'overview',
  'memo',
  'plan',
  'budget',
  'forecast',
  'model',
  'cap',
  'captable',
  'cap-table',
  'org',
  'orgchart',
  'org-chart',
  'chart',
  'roadmap',
  'brief',
  'sheet',
  'factsheet',
  'fact-sheet',
  'term-sheet',
  'termsheet',
  'agreement',
  'contract',
  'nda',
  'safe',
  'notes',
  'minutes',
  'press',
  'release',
  'invoice',
  'proposal',
  'pricing',
  'quote',
  'order',
  'worksheet',
  'analysis',
  'board',
  'packet',
  'package',
  'profile',
  'onepager',
  'one-page',
  'one-pager',
  'review',
  'status'
]

const DOCUMENT_TERM_SET = new Set(DOCUMENT_TERMS)

const stripDiacritics = (value) => {
  try {
    return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  } catch (err) {
    return value
  }
}

const collapseSeparators = (value) => {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const normalizeSubjectKey = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const ascii = stripDiacritics(text)
  const collapsed = collapseSeparators(ascii)
  return collapsed ? collapsed.toLowerCase() : null
}

const tokenizeForCompanySubject = (value) => {
  if (!value) return []

  const withoutExtension = value.replace(/\.[^.]+$/i, '')
  const sanitized = withoutExtension
    .replace(/[(){}\[\]]/g, ' ')
    .replace(/[,_]/g, ' ')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!sanitized) return []

  return sanitized.split(' ').map((raw) => {
    const cleaned = raw.replace(/[^a-z0-9&']+/gi, '')
    if (!cleaned) {
      return null
    }
    return {
      raw,
      cleaned,
      lower: cleaned.toLowerCase()
    }
  }).filter(Boolean)
}

const isNumericToken = (token) => {
  if (!token) return false
  return /^\d+$/.test(token.cleaned)
}

const looksLikeYearToken = (token) => {
  if (!token) return false
  if (!/^\d{4}$/.test(token.cleaned)) return false
  const year = Number.parseInt(token.cleaned, 10)
  return year >= 1900 && year <= 2099
}

const normalizeCompanyToken = (token) => {
  if (!token) return ''
  const { raw, cleaned } = token
  if (!cleaned) return ''

  if (raw && raw === raw.toUpperCase() && raw.length <= 6) {
    return raw
  }

  if (raw && /^[A-Z][a-z0-9&']*$/.test(raw)) {
    return raw
  }

  if (raw && /[A-Z]/.test(raw) && /[a-z]/.test(raw)) {
    return raw
  }

  const lowered = cleaned.toLowerCase()
  if (COMPANY_SUFFIXES.has(lowered)) {
    if (COMPANY_SUFFIXES_FORCE_UPPER.has(lowered)) {
      return cleaned.toUpperCase()
    }
    const canonical = cleaned.toLowerCase()
    return canonical[0].toUpperCase() + canonical.slice(1)
  }

  return cleaned[0].toUpperCase() + cleaned.slice(1)
}

const buildCompanySubjectFromTokens = (tokens) => {
  if (!Array.isArray(tokens) || tokens.length === 0) return ''

  const selected = []
  let started = false

  for (const token of tokens) {
    if (!token || !token.cleaned) continue

    const normalizedLower = token.lower

    if (!started) {
      if (isNumericToken(token) || looksLikeYearToken(token)) {
        continue
      }
      started = true
      selected.push(token)
      if (COMPANY_SUFFIXES.has(normalizedLower.replace(/\.+$/, ''))) {
        break
      }
      continue
    }

    if (DOCUMENT_TERM_SET.has(normalizedLower)) {
      break
    }

    selected.push(token)

    if (COMPANY_SUFFIXES.has(normalizedLower.replace(/\.+$/, ''))) {
      break
    }
  }

  if (!started && tokens.length > 0) {
    // No alphabetic tokens were detected before we exhausted the list.
    // Fall back to the first available cleaned token so we at least anchor on
    // something recognizable (useful for names like "7Bridges".)
    const firstTextual = tokens.find(token => token && token.cleaned)
    if (firstTextual) {
      selected.push(firstTextual)
    }
  }

  if (selected.length === 0) return ''

  return selected
    .map(normalizeCompanyToken)
    .filter(Boolean)
    .join(' ')
    .trim()
}

const extractCompanySubjectFromFilename = ({ originalFileName }) => {
  if (!originalFileName) {
    return { subject: null, normalizedKey: null, matchedHint: null }
  }

  const tokens = tokenizeForCompanySubject(originalFileName)
  if (tokens.length === 0) {
    return { subject: null, normalizedKey: null, matchedHint: null }
  }

  const candidate = buildCompanySubjectFromTokens(tokens)
  if (!candidate) {
    return { subject: null, normalizedKey: null, matchedHint: null }
  }

  const normalizedKey = normalizeSubjectKey(candidate)
  return { subject: candidate, normalizedKey, matchedHint: null }
}

const subjectKeyHasDocumentTerms = (key) => {
  if (!key) return false
  const normalized = key.toLowerCase()
  const segments = normalized.split('-').filter(Boolean)

  for (const segment of segments) {
    if (/^(19|20)\d{2}$/.test(segment)) {
      return true
    }

    if (DOCUMENT_TERM_SET.has(segment)) {
      return true
    }

    for (const term of DOCUMENT_TERMS) {
      if (segment.startsWith(term) || term.startsWith(segment)) {
        return true
      }
    }
  }

  return false
}

const sanitizeSubjectFolderName = (value, fallback = 'Subject') => {
  if (!value) return fallback
  const text = String(value).trim()
  if (!text) return fallback
  const ascii = stripDiacritics(text)
  const collapsed = collapseSeparators(ascii)
  return collapsed || fallback
}

const humanizeFolderName = (value) => {
  if (!value) return ''
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeSubjectConfidence = (value) => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  const lowered = text.toLowerCase()

  if (/(^|\b)(high|strong|certain|confident|definite|clear)/.test(lowered)) {
    return 'high'
  }
  if (/(^|\b)(medium|moderate|fair|balanced)/.test(lowered)) {
    return 'medium'
  }
  if (/(^|\b)(low|weak|uncertain|doubtful|tentative|guess|maybe|unsure)/.test(lowered)) {
    return 'low'
  }
  if (/(unknown|unsure|n\/a|not sure|unclear|indeterminate)/.test(lowered)) {
    return 'unknown'
  }

  const numeric = Number.parseFloat(lowered)
  if (!Number.isNaN(numeric)) {
    if (numeric >= 0.75) return 'high'
    if (numeric >= 0.4) return 'medium'
    if (numeric > 0) return 'low'
    return 'unknown'
  }

  return null
}

const isLowConfidenceSubject = ({ subject, confidence }) => {
  if (!subject) return true
  const normalizedKey = normalizeSubjectKey(subject)
  if (!normalizedKey) return true
  if (LOW_SUBJECT_KEYS.has(normalizedKey.replace(/-/g, ''))) {
    return true
  }

  const normalizedConfidence = normalizeSubjectConfidence(confidence)
  if (!normalizedConfidence) return false
  return normalizedConfidence === 'low' || normalizedConfidence === 'unknown'
}

module.exports = {
  humanizeFolderName,
  isLowConfidenceSubject,
  normalizeSubjectConfidence,
  normalizeSubjectKey,
  sanitizeSubjectFolderName,
  extractCompanySubjectFromFilename,
  subjectKeyHasDocumentTerms
}

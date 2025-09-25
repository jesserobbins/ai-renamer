/**
 * Responsible for composing the prompt, calling the model, and turning the
 * response into a safe filesystem name.  This file houses a number of helper
 * utilities that sanitize the model output, enforce user-configured limits, and
 * annotate the resulting suggestion with enough context to power logs and
 * interactive messaging.
 */

const changeCase = require('./changeCase')
const getModelResponse = require('./getModelResponse')
const {
  normalizeSubjectConfidence,
  normalizeSubjectKey,
  isLowConfidenceSubject,
  extractCompanySubjectFromFilename,
  subjectKeyHasDocumentTerms
} = require('./subjectUtils')

const LABEL_REGEX = /^(?:filename|file name|suggested filename|suggested file name|name|title)\s*(?:is|=|:)?\s*/i
const QUOTE_REGEX = /[`"'“”‘’]/g
const INVALID_FILENAME_CHARS = /[^\p{L}\p{N}\s_-]+/gu

const DEFAULT_MAX_CONTENT_CHARS = 8000
const DEFAULT_MAX_PROMPT_CHARS = 12000

/**
 * Strips common labels and punctuation artifacts that LLMs sprinkle around
 * filename suggestions so we can operate on a clean candidate string.
 */

const sanitizeSegment = (segment) => {
  if (!segment) return ''
  const withoutQuotes = segment.replace(QUOTE_REGEX, '')
  const withoutLabel = withoutQuotes.replace(LABEL_REGEX, '')
  return withoutLabel
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Performs a gentle truncation that respects word boundaries.  This keeps the
 * filename readable even when we must enforce conservative length limits.
 */

const shortenToLimit = (text, limit) => {
  if (!text || !limit || text.length <= limit) return text
  const words = text.split(/\s+/)
  let candidate = ''

  for (const word of words) {
    const next = candidate ? `${candidate} ${word}` : word
    if (next.length > limit) break
    candidate = next
  }

  return candidate || text.slice(0, limit)
}


/**
 * Walks the model response and returns the most promising filename segment.
 * The heuristics favour explicit "Filename:" style lines but gracefully fall
 * back to the full message if nothing else matches.
 */

const extractFilenameCandidate = ({ modelResult, maxChars }) => {
  if (!modelResult) return ''

  const normalized = modelResult
    .replace(/\r/g, '\n')
    .split('\u0000').join('')
    .trim()

  if (!normalized) return ''

  const segments = []
  const patternRegexes = [
    /(?:filename|file name)\s*(?:is|=|:)\s*([^\n]+)/i,
    /(?:suggested|proposed|recommended)\s*(?:filename|file name)\s*(?:is|=|:)?\s*([^\n]+)/i,
    /name\s*[:：]\s*([^\n]+)/i
  ]

  for (const regex of patternRegexes) {
    const match = normalized.match(regex)
    if (match && match[1]) segments.push(match[1])
  }

  segments.push(...normalized.split(/\r?\n/))
  segments.push(...normalized.split(/[,;]+/))

  const seen = new Set()

  for (const segment of segments) {
    const cleaned = sanitizeSegment(segment)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const shortened = shortenToLimit(cleaned, maxChars)
    if (shortened) return shortened
  }

  const fallback = sanitizeSegment(normalized)
  return shortenToLimit(fallback, maxChars)
}


/**
 * Ensures truncated names stop at a natural boundary (hyphen, underscore, or
 * word) whenever possible before falling back to a hard slice.
 */

const trimToBoundary = (text, limit) => {
  if (!text || !limit || text.length <= limit) return text

  const applySeparator = (separator) => {
    if (!text.includes(separator)) return ''
    const parts = text.split(separator)
    let result = ''

    for (const part of parts) {
      if (!part) continue
      const next = result ? `${result}${separator}${part}` : part
      if (next.length > limit) break
      result = next
    }

    return result
  }

  const byHyphen = applySeparator('-')
  if (byHyphen) return byHyphen

  const byUnderscore = applySeparator('_')
  if (byUnderscore) return byUnderscore

  return text.slice(0, limit).replace(/[-_]+$/g, '')
}

const looksLikeDateTokens = (tokens) => {
  if (!Array.isArray(tokens) || tokens.length !== 3) return false
  const [year, month, day] = tokens
  if (!/^\d{4}$/.test(year)) return false
  if (!/^\d{2}$/.test(month)) return false
  if (!/^\d{2}$/.test(day)) return false
  return true
}

const preserveTrailingDate = (value, limit) => {
  if (!value || !limit) return null

  const attempt = (separator) => {
    if (!value.includes(separator)) return null
    const rawParts = value.split(separator)
    const parts = rawParts.filter(part => part && part.length > 0)
    if (parts.length < 3) return null
    const dateTokens = parts.slice(-3)
    if (!looksLikeDateTokens(dateTokens)) return null

    const prefixTokens = parts.slice(0, -3)
    const candidate = [...prefixTokens, ...dateTokens].join(separator)
    if (candidate.length <= limit) {
      return candidate
    }

    const preserved = []
    for (const token of prefixTokens) {
      const nextTokens = [...preserved, token, ...dateTokens]
      const joined = nextTokens.join(separator)
      if (joined.length <= limit) {
        preserved.push(token)
      } else {
        break
      }
    }

    const finalTokens = [...preserved, ...dateTokens]
    const finalValue = finalTokens.join(separator)
    if (finalValue.length <= limit) {
      return finalValue
    }

    const dateOnly = dateTokens.join(separator)
    if (dateOnly.length <= limit) {
      return dateOnly
    }

    return null
  }

  return attempt('-') || attempt('_')
}


/**
 * Applies the configured character limit to the provided filename.  The helper
 * delegates the heavy lifting to trimToBoundary so the resulting name remains
 * cleanly formatted.
 */

const enforceLengthLimit = (value, limit) => {
  if (!value) return value
  if (!Number.isFinite(limit) || limit <= 0) return value
  if (value.length <= limit) return value
  const preservedDate = preserveTrailingDate(value, limit)
  if (preservedDate) {
    return preservedDate
  }
  return trimToBoundary(value, limit) || value.slice(0, limit)
}


/**
 * Truncates long context blocks for the prompt.  We prefer cutting at sentence
 * or paragraph boundaries to preserve readability for the model.
 */
const softTruncate = (text, limit) => {
  if (!text || !Number.isFinite(limit) || limit <= 0) return ''
  if (text.length <= limit) return text

  const slice = text.slice(0, limit)
  const lastNewline = slice.lastIndexOf('\n')
  if (lastNewline >= Math.floor(limit * 0.6)) {
    return slice.slice(0, lastNewline).trim()
  }

  const lastSentenceBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (lastSentenceBreak >= Math.floor(limit * 0.5)) {
    return slice.slice(0, lastSentenceBreak + 1).trim()
  }

  return slice.trim()
}

const formatDateForPrompt = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/**
 * Converts raw filesystem metadata into friendly sentences that can be fed
 * directly to the model.  The function also returns a fallback date that we can
 * append later if the model forgets to include one in the filename.
 */
const buildMetadataHint = ({ fileMetadata, metadataHints }) => {
  if (!metadataHints || !fileMetadata) {
    return { lines: [], fallbackDate: null }
  }

  const lines = []
  const created = formatDateForPrompt(fileMetadata.createdAt)
  const modified = formatDateForPrompt(fileMetadata.modifiedAt)

  if (created) {
    lines.push(`Created on ${created}`)
  }

  if (modified) {
    lines.push(`Last modified on ${modified}`)
  }

  if (fileMetadata.sizeLabel) {
    lines.push(`Approximate size ${fileMetadata.sizeLabel}`)
  } else if (Number.isFinite(fileMetadata.size)) {
    lines.push(`File size ${fileMetadata.size} bytes`)
  }

  if (Array.isArray(fileMetadata.tags) && fileMetadata.tags.length > 0) {
    lines.push(`Finder tags: ${fileMetadata.tags.join(', ')}`)
  }

  let fallbackDate = null
  if (created) {
    fallbackDate = { type: 'created', value: created }
  } else if (modified) {
    fallbackDate = { type: 'modified', value: modified }
  }

  return { lines, fallbackDate }
}

/**
 * Adds the filesystem-derived date to the filename when the model did not
 * supply one.  We only touch the string if doing so keeps us within the length
 * guard rails.
 */
const appendFallbackDate = ({ base, fallbackDate, limit }) => {
  if (!base) {
    return { text: base, applied: false }
  }

  if (!fallbackDate || !fallbackDate.value) {
    return { text: base, applied: false }
  }

  const hasYear = /(19|20)\d{2}/.test(base)
  if (hasYear) {
    return { text: base, applied: false }
  }

  const trimmedBase = base.trim()
  const dateFragment = fallbackDate.value
  const separator = trimmedBase ? ' ' : ''
  const appended = `${trimmedBase}${separator}${dateFragment}`

  if (!limit || appended.length <= limit) {
    return { text: appended, applied: true }
  }

  const maxBaseLength = Math.max(limit - dateFragment.length - separator.length, 0)
  const shortenedBase = maxBaseLength > 0 ? shortenToLimit(trimmedBase, maxBaseLength) : ''
  const safeSeparator = shortenedBase ? ' ' : ''
  const combined = `${shortenedBase}${safeSeparator}${dateFragment}`

  return { text: combined, applied: true }
}

/**
 * When Finder tag appending is enabled, fold the cleaned tag names into the
 * filename using ` - ` separators.  The return value records which tags were
 * included so the log can mention them explicitly.
 */
const appendFinderTags = ({ base, tags }) => {
  if (!Array.isArray(tags) || tags.length === 0) {
    return { text: base, applied: [] }
  }

  const sanitized = []
  const seen = new Set()

  for (const tag of tags) {
    const cleaned = sanitizeSegment(tag)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sanitized.push(cleaned)
  }

  if (sanitized.length === 0) {
    return { text: base, applied: [] }
  }

  const trimmedBase = typeof base === 'string' ? base.trim() : ''
  const tagsSegment = sanitized.join(' - ')
  const combined = trimmedBase ? `${trimmedBase} - ${tagsSegment}` : tagsSegment

  return { text: combined, applied: sanitized }
}

/**
 * Maps the selected prompt focus flag to an instruction sentence.  The message
 * is appended to the model prompt so the rename suggestion follows the desired
 * ordering (company-, people-, or project-first).
 */
const getFocusGuidance = (focus) => {
  switch (focus) {
    case 'company':
      return 'Lead with the company or organization responsible for the document before other elements.'
    case 'people':
      return 'Lead with the key people, teams, or committees mentioned before any other elements.'
    case 'project':
      return 'Lead with the project, initiative, or deliverable name before the other elements.'
    default:
      return 'Lead with the most relevant entity (company, project, team, or person) that anchors the document.'
  }
}

const describeFocusForSummary = (focus) => {
  switch (focus) {
    case 'company':
      return 'company-first prompt focus'
    case 'people':
      return 'people-first prompt focus'
    case 'project':
      return 'project-first prompt focus'
    default:
      return null
  }
}

/**
 * Builds the final prompt that is sent to the model.  The prompt is assembled
 * as an array of lines that we later join, which keeps the logic easy to read
 * and annotate.
 */
const getSubjectLineGuidance = (focus) => {
  switch (focus) {
    case 'company':
      return 'In the Subject line, output the company or organization name that anchors the document. Prefer existing subject folder names when they clearly match.'
    case 'people':
      return 'In the Subject line, output the key person, team, or committee most responsible for the document.'
    case 'project':
      return 'In the Subject line, output the project or initiative name most associated with the document.'
    default:
      return 'Choose the most helpful anchor entity for the Subject line (company, project, team, or person).'
  }
}

const composePromptLines = ({
  _case,
  chars,
  language,
  videoPrompt,
  useFilenameHint,
  originalFileName,
  metadataHintLines,
  metadataFallback,
  contentSnippet,
  contentOriginalLength,
  contentTruncated,
  customPrompt,
  promptFocus,
  pitchDeckMode,
  pitchDeckDetection,
  subjectHints
}) => {
  const lines = []

  if (pitchDeckMode) {
    lines.push(
      'You rename startup fundraising pitch decks. Your response must either be a structured filename or the single word SKIP.',
      'If the document is not a startup pitch deck, respond with SKIP (uppercase) and no additional text.',
      'When it is a pitch deck, output a filename following this structure: Startup - [Company or team] - [Funding round or investor focus] - Pitch Deck - [Version or iteration] - [Best available date in YYYY-MM-DD].',
      'Use only information that is clearly supported by the content or metadata. Prefer concise funding descriptors (Seed, Series A, Bridge, etc.) and realistic version labels (v1, Draft, Update).',
      'If a segment is unknown, use a brief factual placeholder such as Unknown or Draft rather than inventing details.'
    )
    lines.push(getFocusGuidance(promptFocus))
    lines.push(getSubjectLineGuidance(promptFocus))
  } else {
    lines.push(
      'You rename documents using descriptive structured filenames.',
      'Follow this order: [Primary subject] - [Purpose or title] - [Document type] - [Version identifier] - [Best available date in YYYY-MM-DD].',
      getFocusGuidance(promptFocus),
      getSubjectLineGuidance(promptFocus),
      'Use real wording from the document or metadata and omit any segment that is not clearly supported.',
      'Include authentic revision numbers or version labels (e.g., v1, draft, executed) when they appear.',
      'Prefer ISO-style dates (YYYY-MM-DD). If only month or year is known, use the most precise available format.',
      'Do not invent information, do not include the file extension, and avoid extra punctuation beyond hyphens or spaces.'
    )
  }

  lines.push(
    '',
    `Case style: ${_case}`,
    `Maximum characters: ${chars}`,
    `Language: ${language}`,
    'Output exactly three lines:',
    'Filename: <final name without extension>',
    'Subject: <best subject label, reuse existing names when relevant>',
    'Subject confidence: high | medium | low',
    ''
  )

  if (Array.isArray(subjectHints) && subjectHints.length > 0) {
    lines.push('', 'Existing subject directories already on disk. Only reuse a directory when the filename or document details clearly refer to the same organization:')
    lines.push(...subjectHints.slice(0, 20).map(name => `- ${name}`))
  }

  if (useFilenameHint && originalFileName) {
    lines.push('', `Current filename for context: ${originalFileName}`)
  }

  if (metadataHintLines && metadataHintLines.length > 0) {
    lines.push('', 'File metadata hints:')
    lines.push(...metadataHintLines.map(line => `- ${line}`))
    if (metadataFallback) {
      lines.push(`If the content lacks a clear date, fall back to the ${metadataFallback.type} date above.`)
    }
  }

  if (pitchDeckMode && pitchDeckDetection) {
    if (pitchDeckDetection.summary) {
      lines.push('', `Pitch deck heuristics: ${pitchDeckDetection.summary}`)
    }
    if (Array.isArray(pitchDeckDetection.companyCandidates) && pitchDeckDetection.companyCandidates.length > 0) {
      lines.push('', 'Potential company names:')
      lines.push(...pitchDeckDetection.companyCandidates.slice(0, 5).map(name => `- ${name}`))
    }
    if (Array.isArray(pitchDeckDetection.fundingMentions) && pitchDeckDetection.fundingMentions.length > 0) {
      lines.push('', 'Funding round references detected:')
      lines.push(...pitchDeckDetection.fundingMentions.slice(0, 5).map(term => `- ${term}`))
    }
    if (pitchDeckDetection.sampleTitle) {
      lines.push('', `Representative slide or heading: ${pitchDeckDetection.sampleTitle}`)
    }
  }

  if (videoPrompt) {
    lines.push('', 'Video summary:', videoPrompt)
  }

  if (contentSnippet) {
    if (contentTruncated && Number.isFinite(contentOriginalLength)) {
      lines.push('', `Content preview (first ${contentSnippet.length} of ${contentOriginalLength} characters):`, contentSnippet)
    } else {
      lines.push('', 'Content:', contentSnippet)
    }
  }

  if (customPrompt) {
    lines.push('', 'Custom instructions:', customPrompt)
  }

  return lines
}

const SUBJECT_LINE_REGEX = /^subject\s*(?:name)?\s*[:=]\s*(.+)$/i
const SUBJECT_CONFIDENCE_REGEX = /^subject\s*confidence\s*[:=]\s*(.+)$/i

const cleanSubjectCandidate = (value) => {
  if (!value) return ''
  return value
    .replace(QUOTE_REGEX, '')
    .replace(/^[\s:;,-]+/, '')
    .replace(/[\s:;,-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const formatSubjectFromFilename = (value) => {
  if (!value) return ''
  const spaced = String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return ''
  return spaced
    .split(' ')
    .map(word => (word ? word[0].toUpperCase() + word.slice(1) : ''))
    .join(' ')
    .trim()
}

const extractPrimarySubjectFromCandidate = (value) => {
  if (!value) return null
  const firstSegment = String(value).split(' - ')[0]
  if (!firstSegment) return null
  const cleaned = cleanSubjectCandidate(firstSegment)
  return cleaned || null
}

const deriveSubjectMetadata = ({
  modelResult,
  candidate,
  finalFilename,
  usedFallback,
  subjectHints,
  promptFocus,
  originalFileName
}) => {
  const hints = promptFocus === 'company'
    ? []
    : Array.isArray(subjectHints)
      ? subjectHints
      : []
  const hintEntries = hints
    .map(hint => ({ original: hint, key: normalizeSubjectKey(hint) }))
    .filter(entry => entry.key)

  let subject = null
  let confidence = null
  let source = null

  if (modelResult) {
    const lines = modelResult.replace(/\r/g, '\n').split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      if (!subject) {
        const subjectMatch = line.match(SUBJECT_LINE_REGEX)
        if (subjectMatch && subjectMatch[1]) {
          const cleaned = cleanSubjectCandidate(subjectMatch[1])
          if (cleaned) {
            subject = cleaned
            source = 'model'
          }
        }
      }

      if (!confidence) {
        const confidenceMatch = line.match(SUBJECT_CONFIDENCE_REGEX)
        if (confidenceMatch && confidenceMatch[1]) {
          confidence = normalizeSubjectConfidence(confidenceMatch[1])
        }
      }
    }
  }

  if (!subject) {
    const candidateSubject = candidate && candidate.toLowerCase() !== 'renamed file'
      ? cleanSubjectCandidate(candidate.split(' - ')[0])
      : ''
    if (candidateSubject) {
      subject = candidateSubject
      source = 'candidate'
    }
  }

  if (!subject && finalFilename) {
    const fromFilename = formatSubjectFromFilename(finalFilename)
    if (fromFilename) {
      subject = fromFilename
      source = 'filename'
    }
  }

  if (!subject) {
    return {
      subject: null,
      normalizedKey: null,
      confidence: confidence || 'unknown',
      source: source || 'none',
      matchedHint: null,
      focusOverrideApplied: false
    }
  }

  let normalizedKey = normalizeSubjectKey(subject)

  if (!confidence) {
    if (source === 'model') {
      confidence = usedFallback ? 'medium' : 'high'
    } else if (source === 'candidate') {
      confidence = usedFallback ? 'low' : 'medium'
    } else {
      confidence = usedFallback ? 'low' : 'medium'
    }
  }

  let matchedHint = null
  if (normalizedKey) {
    const hintMatch = hintEntries.find(entry => entry.key === normalizedKey)
    if (hintMatch) {
      matchedHint = hintMatch.original
    }
  }

  let focusOverrideApplied = false

  if (promptFocus === 'company') {
    const existingKeyHasNoise = subjectKeyHasDocumentTerms(normalizedKey)
    const primarySubject = extractPrimarySubjectFromCandidate(candidate)
    const primaryKey = primarySubject ? normalizeSubjectKey(primarySubject) : null
    const normalizedFilenameKey = originalFileName
      ? normalizeSubjectKey(originalFileName.replace(/\.[^.]+$/i, ''))
      : null
    const subjectAppearsInFilename = normalizedKey && normalizedFilenameKey
      ? normalizedFilenameKey.includes(normalizedKey)
      : false

    const companyFromFilename = extractCompanySubjectFromFilename({
      originalFileName
    })

    const preferredCandidates = []
    if (companyFromFilename.subject) {
      preferredCandidates.push({
        subject: companyFromFilename.subject,
        normalizedKey: companyFromFilename.normalizedKey || normalizeSubjectKey(companyFromFilename.subject),
        matchedHint: companyFromFilename.matchedHint,
        source: 'company-focus filename override'
      })
    }

    if (primarySubject) {
      preferredCandidates.push({
        subject: primarySubject,
        normalizedKey: primaryKey,
        matchedHint: primaryKey
          ? hintEntries.find(entry => entry.key === primaryKey)?.original || null
          : null,
        source: 'company-focus override'
      })
    }

    for (const option of preferredCandidates) {
      if (!option || !option.subject) continue
      if (!option.normalizedKey) continue

      const matchesExisting = normalizedKey && normalizedKey === option.normalizedKey
      const optionHasHint = Boolean(option.matchedHint)
      if (matchesExisting) {
        continue
      }

      const optionAppearsInFilename = option.normalizedKey && normalizedFilenameKey
        ? normalizedFilenameKey.includes(option.normalizedKey)
        : false

      let shouldReplace = false

      if (!normalizedKey) {
        shouldReplace = true
      } else if (existingKeyHasNoise) {
        shouldReplace = true
      } else if (!subjectAppearsInFilename && optionAppearsInFilename) {
        shouldReplace = true
      } else if (!subjectAppearsInFilename && !optionHasHint && option.normalizedKey && option.normalizedKey !== normalizedKey) {
        shouldReplace = true
      }

      if (!shouldReplace && !optionHasHint) {
        continue
      }

      if (
        optionHasHint &&
        normalizedKey &&
        option.normalizedKey &&
        normalizedKey !== option.normalizedKey &&
        !optionAppearsInFilename
      ) {
        continue
      }

      const previousSubject = subject
      const previousNormalized = normalizedKey
      const previousMatchedHint = matchedHint

      subject = option.subject
      normalizedKey = option.normalizedKey
      if (optionHasHint) {
        matchedHint = option.matchedHint
        confidence = 'high'
      } else if (!confidence || confidence === 'unknown' || confidence === 'low') {
        confidence = 'medium'
      }
      source = option.source
      if (
        subject !== previousSubject ||
        normalizedKey !== previousNormalized ||
        matchedHint !== previousMatchedHint
      ) {
        focusOverrideApplied = true
      }
      break
    }
  }

  if (isLowConfidenceSubject({ subject, confidence })) {
    confidence = 'low'
  }

  return {
    subject,
    normalizedKey,
    confidence,
    source,
    matchedHint,
    focusOverrideApplied
  }
}

/**
 * Entry point for filename generation.  Bundles the available context into a
 * prompt, calls the configured model, and returns a structured response that
 * downstream callers can use to display confirmation prompts and log
 * reasoning.
 */

module.exports = async options => {
  const {
    _case,
    chars,
    content,
    language,
    videoPrompt,
    customPrompt,
    relativeFilePath,
    originalFileName,
    fileMetadata,
    metadataHints = true,
    useFilenameHint = true,
    appendTags = false,
    macTags = [],
    promptFocus = 'balanced',
    pitchDeckMode = false,
    pitchDeckDetection = null
  } = options

  try {
    const originalContentLength = content ? content.length : 0
    const maxContentChars = Number.isFinite(options.maxPromptContentChars)
      ? Math.max(options.maxPromptContentChars, 0)
      : DEFAULT_MAX_CONTENT_CHARS
    const maxPromptChars = Number.isFinite(options.maxPromptChars)
      ? Math.max(options.maxPromptChars, 2000)
      : DEFAULT_MAX_PROMPT_CHARS

    let contentSnippet = content || ''
    let contentTruncated = false
    if (contentSnippet && contentSnippet.length > maxContentChars) {
      contentSnippet = softTruncate(contentSnippet, maxContentChars)
      contentTruncated = true
    }
    if (!contentSnippet) {
      contentSnippet = ''
    }

    const metadataInfo = buildMetadataHint({ fileMetadata, metadataHints })

    const assemblePrompt = () => composePromptLines({
      _case,
      chars,
      language,
      videoPrompt,
      useFilenameHint,
      originalFileName,
      metadataHintLines: metadataInfo.lines,
      metadataFallback: metadataInfo.fallbackDate,
      contentSnippet: contentSnippet || null,
      contentOriginalLength: originalContentLength,
      contentTruncated,
      customPrompt,
      promptFocus,
      pitchDeckMode,
      pitchDeckDetection,
      subjectHints: Array.isArray(options.subjectHints) ? options.subjectHints : []
    })

    let promptLines = assemblePrompt()
    let prompt = promptLines.join('\n')
    let promptTrimmed = false

    if (prompt.length > maxPromptChars && contentSnippet) {
      const overflow = prompt.length - maxPromptChars
      const targetLength = Math.max(0, contentSnippet.length - overflow - 200)
      const shortened = targetLength > 0 ? softTruncate(contentSnippet, targetLength) : ''
      if (shortened !== contentSnippet) {
        contentSnippet = shortened
        contentTruncated = true
        promptLines = assemblePrompt()
        prompt = promptLines.join('\n')
      }
    }

    if (prompt.length > maxPromptChars) {
      prompt = prompt.slice(0, maxPromptChars)
      promptTrimmed = true
    }

    const modelResult = await getModelResponse({ ...options, prompt })

    const safeCharLimit = Number.isFinite(chars) && chars > 0 ? Math.floor(chars) : 20

    const normalizedReply = typeof modelResult === 'string' ? modelResult.trim() : ''
    if (pitchDeckMode) {
      const skipCheck = normalizedReply.replace(/\s+/g, ' ').trim()
      if (!skipCheck || /^skip\b/i.test(skipCheck)) {
        const source = content
          ? 'text'
          : Array.isArray(options.images) && options.images.length > 0
            ? 'visual'
            : 'prompt-only'

        const summaryParts = ['Model indicated this document is not a startup pitch deck. Renaming was skipped.']
        if (!skipCheck) {
          summaryParts.push('The model returned an empty response while pitch deck mode was enabled.')
        }
        if (pitchDeckDetection && pitchDeckDetection.summary) {
          summaryParts.push(pitchDeckDetection.summary)
        }

        const skipContext = {
          summary: summaryParts.join(' '),
          candidate: null,
          usedFallback: false,
          caseStyle: _case,
          charLimit: safeCharLimit,
          truncated: false,
          finalName: null,
          source,
          modelResponse: modelResult,
          modelResponsePreview: modelResult ? modelResult.slice(0, 280) : null,
          customPromptIncluded: Boolean(customPrompt),
          videoSummaryIncluded: Boolean(videoPrompt),
          contentLength: content ? content.length : 0,
          contentSnippetLength: contentSnippet ? contentSnippet.length : 0,
          contentTruncated,
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 500),
          promptTrimmed,
          maxPromptChars,
          maxContentChars,
          filenameHintIncluded: Boolean(useFilenameHint && originalFileName),
          metadataHintIncluded: Boolean(metadataHints && fileMetadata),
          metadataFallback: metadataInfo.fallbackDate,
          metadataFallbackApplied: false,
          metadataFallbackValue: null,
          originalFileName,
          metadataSummary: metadataInfo.lines,
          appendTagsEnabled: Boolean(appendTags),
          finderTagsDetected: Array.isArray(macTags) ? [...macTags] : [],
          finderTagsApplied: [],
          promptFocus,
          pitchDeckMode: true,
          pitchDeckDetection,
          pitchDeckSkip: true
        }

        return { filename: null, skipped: true, context: skipContext }
      }
    }
    // Allow the model a little extra room beyond the user's visible limit so
    // we can sanitize before enforcing the final cap.
    const candidateLimit = (() => {
      if (!Number.isFinite(safeCharLimit) || safeCharLimit <= 0) return 120
      const allowance = Math.max(20, Math.floor(safeCharLimit * 0.25))
      return safeCharLimit + allowance
    })()
    const extractedCandidate = extractFilenameCandidate({ modelResult, maxChars: candidateLimit })
    let candidate = extractedCandidate || 'renamed file'

    let finderTagsApplied = []
    if (appendTags && Array.isArray(macTags) && macTags.length > 0) {
      const tagAppendResult = appendFinderTags({ base: candidate, tags: macTags })
      candidate = tagAppendResult.text
      finderTagsApplied = tagAppendResult.applied
    }

    const metadataFallbackApplication = appendFallbackDate({
      base: candidate,
      fallbackDate: metadataInfo.fallbackDate,
      limit: candidateLimit
    })
    candidate = metadataFallbackApplication.text
    const metadataFallbackApplied = metadataFallbackApplication.applied

    // Apply the desired casing before the final length enforcement so we do
    // not lop off case-generated separators later.
    let filename = await changeCase({ text: candidate, _case })
    const afterCase = filename
    filename = enforceLengthLimit(filename, safeCharLimit)

    let usedFallback = false
    if (!extractedCandidate) {
      usedFallback = true
    }

    let truncated = false
    if (afterCase && filename && afterCase !== filename) {
      truncated = true
    }

    if (!filename) {
      const fallbackName = await changeCase({ text: 'renamed file', _case })
      const enforcedFallback = enforceLengthLimit(fallbackName, safeCharLimit)
      if (enforcedFallback) {
        filename = enforcedFallback
        usedFallback = true
        truncated = enforcedFallback.length < fallbackName.length
      }
    }

    if (!filename) return null

    const subjectMetadata = deriveSubjectMetadata({
      modelResult,
      candidate,
      finalFilename: filename,
      usedFallback,
      subjectHints: Array.isArray(options.subjectHints) ? options.subjectHints : [],
      promptFocus,
      originalFileName
    })

    // Build a human-readable summary for the CLI and run log so operators can
    // understand how the name was produced.
    const summaryParts = []
    if (usedFallback) {
      summaryParts.push('Used fallback phrase because the model response did not include a clean filename.')
    } else {
      summaryParts.push(`Used model candidate "${candidate}".`)
    }
    summaryParts.push(`Applied ${_case} case and a ${safeCharLimit}-character limit.`)
    if (truncated) {
      summaryParts.push('The result was shortened to satisfy the length constraint.')
    }
    if (videoPrompt) {
      summaryParts.push('Video frame summary influenced the prompt.')
    }
    if (content) {
      const contentDetail = contentTruncated
        ? `Text was extracted from the source file and truncated to ${contentSnippet.length} characters to stay within the context limit.`
        : 'Text was extracted from the source file before generating the name.'
      summaryParts.push(contentDetail)
    }
    if (customPrompt) {
      summaryParts.push('Custom instructions were included in the prompt.')
    }
    if (useFilenameHint && originalFileName) {
      summaryParts.push(`Provided the original filename "${originalFileName}" as a hint.`)
    }
    if (appendTags) {
      if (finderTagsApplied.length > 0) {
        summaryParts.push(`Appended Finder tags (${finderTagsApplied.join(', ')}) before the date segment.`)
      } else if (Array.isArray(macTags) && macTags.length > 0) {
        summaryParts.push('Finder tags were available but removed after sanitization or length limits.')
      } else {
        summaryParts.push('Finder tag appending was enabled but no Finder tags were detected on the file.')
      }
    }
    if (pitchDeckMode) {
      summaryParts.push('Startup pitch deck mode enforced the dedicated naming template.')
      if (pitchDeckDetection && pitchDeckDetection.summary) {
        summaryParts.push(pitchDeckDetection.summary)
      }
      if (pitchDeckDetection && pitchDeckDetection.confidence) {
        summaryParts.push(`Heuristic confidence rated ${pitchDeckDetection.confidence}.`)
      }
    }
    const focusSummary = describeFocusForSummary(promptFocus)
    if (focusSummary) {
      summaryParts.push(`Used ${focusSummary} to guide the naming order.`)
    }
    if (metadataHints) {
      if (fileMetadata) {
        const parts = []
        if (metadataInfo.lines.length > 0) {
          parts.push('Shared file metadata with the model')
        }
        if (metadataInfo.fallbackDate) {
          parts.push(`Highlighted the ${metadataInfo.fallbackDate.type} date as a fallback reference.`)
        }
        if (metadataFallbackApplied) {
          parts.push(`Appended the ${metadataInfo.fallbackDate.type} date (${metadataInfo.fallbackDate.value}) because the suggested name lacked a clear timestamp.`)
        }
        if (parts.length > 0) {
          summaryParts.push(parts.join(' '))
        }
      } else {
        summaryParts.push('Metadata hints were enabled but no filesystem metadata was available.')
      }
    }
    if (promptTrimmed) {
      summaryParts.push('The composed prompt was trimmed to keep the total length within the context window.')
    }

    if (subjectMetadata.subject) {
      const confidenceLabel = subjectMetadata.confidence || 'unknown'
      const hintDetail = subjectMetadata.matchedHint ? ` Matched existing hint "${subjectMetadata.matchedHint}".` : ''
      summaryParts.push(`Inferred subject "${subjectMetadata.subject}" with ${confidenceLabel} confidence.${hintDetail}`)
    }

    if (subjectMetadata.focusOverrideApplied) {
      summaryParts.push('Company focus override replaced the model subject with a company-aligned folder name derived from the filename to keep organization consistent.')
    }


    const summary = summaryParts.join(' ')

    const source = content
      ? 'text'
      : Array.isArray(options.images) && options.images.length > 0
        ? 'visual'
        : 'prompt-only'

    // Bundle the collected reasoning into a payload that powers both CLI
    // summaries and the recovery log.
    const context = {
      summary,
      candidate,
      usedFallback,
      caseStyle: _case,
      charLimit: safeCharLimit,
      truncated,
      finalName: filename,
      source,
      modelResponse: modelResult,
      modelResponsePreview: modelResult ? modelResult.slice(0, 280) : null,
      customPromptIncluded: Boolean(customPrompt),
      videoSummaryIncluded: Boolean(videoPrompt),
      contentLength: content ? content.length : 0,
      contentSnippetLength: contentSnippet ? contentSnippet.length : 0,
      contentTruncated,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 500),
      promptTrimmed,
      maxPromptChars,
      maxContentChars,
      filenameHintIncluded: Boolean(useFilenameHint && originalFileName),
      metadataHintIncluded: Boolean(metadataHints && fileMetadata),
      metadataFallback: metadataInfo.fallbackDate,
      metadataFallbackApplied,
      metadataFallbackValue: metadataFallbackApplied && metadataInfo.fallbackDate
        ? metadataInfo.fallbackDate.value
        : null,
      originalFileName,
      metadataSummary: metadataInfo.lines,
      appendTagsEnabled: Boolean(appendTags),
      finderTagsDetected: Array.isArray(macTags) ? [...macTags] : [],
      finderTagsApplied,
      promptFocus,
      pitchDeckMode: Boolean(pitchDeckMode),
      pitchDeckDetection,
      pitchDeckSkip: false,
      subject: subjectMetadata.subject,
      subjectConfidence: subjectMetadata.confidence,
      subjectSource: subjectMetadata.source,
      subjectNormalized: subjectMetadata.normalizedKey,
      subjectMatchedHint: subjectMetadata.matchedHint,
      subjectFocusOverrideApplied: Boolean(subjectMetadata.focusOverrideApplied)
    }


    return { filename, context }
  } catch (err) {
    // Surfacing the model failure with the file path included makes it easier
    // to correlate the error with the on-disk artifact when scanning logs.
    console.log(`🔴 Model error: ${err.message} (${relativeFilePath})`)
  }
}

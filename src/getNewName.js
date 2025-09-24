const changeCase = require('./changeCase')
const getModelResponse = require('./getModelResponse')

const LABEL_REGEX = /^(?:filename|file name|suggested filename|suggested file name|name|title)\s*(?:is|=|:)?\s*/i
const QUOTE_REGEX = /[`"'“”‘’]/g
const INVALID_FILENAME_CHARS = /[^\p{L}\p{N}\s_-]+/gu
const DEFAULT_MAX_CONTENT_CHARS = 8000
const DEFAULT_MAX_PROMPT_CHARS = 12000

const sanitizeSegment = (segment) => {
  if (!segment) return ''
  const withoutQuotes = segment.replace(QUOTE_REGEX, '')
  const withoutLabel = withoutQuotes.replace(LABEL_REGEX, '')
  return withoutLabel
    .replace(INVALID_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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

const enforceLengthLimit = (value, limit) => {
  if (!value) return value
  if (!Number.isFinite(limit) || limit <= 0) return value
  if (value.length <= limit) return value
  return trimToBoundary(value, limit) || value.slice(0, limit)
}

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
  pitchDeckDetection
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
  } else {
    lines.push(
      'You rename documents using descriptive structured filenames.',
      'Follow this order: [Primary subject] - [Purpose or title] - [Document type] - [Version identifier] - [Best available date in YYYY-MM-DD].',
      getFocusGuidance(promptFocus),
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
    'Return only the filename text.',
    ''
  )

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
      pitchDeckDetection
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

    const summary = summaryParts.join(' ')

    const source = content
      ? 'text'
      : Array.isArray(options.images) && options.images.length > 0
        ? 'visual'
        : 'prompt-only'

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
      pitchDeckSkip: false
    }

    return { filename, context }
  } catch (err) {
    console.log(`🔴 Model error: ${err.message} (${relativeFilePath})`)
  }
}

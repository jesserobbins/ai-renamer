const COMPANY_REGEX = /([A-Z][A-Za-z0-9&']+(?:\s+[A-Z][A-Za-z0-9&']+)*)\s+(?:Inc\.?|Incorporated|Corp\.?|Corporation|LLC|L\.L\.C\.|Ltd\.?|Limited|Company|Co\.?)/g

const STRONG_KEYWORDS = [
  'pitch deck',
  'investor deck',
  'investor presentation',
  'fundraising deck',
  'fund raising deck',
  'fundraise deck'
]

const FUNDING_KEYWORDS = [
  'seed round',
  'pre-seed',
  'series a',
  'series b',
  'series c',
  'series d',
  'series e',
  'bridge round',
  'angel round',
  'vc round',
  'funding round',
  'capital raise',
  'venture round'
]

const INVESTOR_KEYWORDS = [
  'investor',
  'investment',
  'venture capital',
  'vc',
  'capital raise',
  'fundraising',
  'fund raising',
  'term sheet'
]

const SECTION_KEYWORDS = [
  'problem',
  'solution',
  'market',
  'market size',
  'market opportunity',
  'product',
  'business model',
  'traction',
  'financials',
  'financial projections',
  'go-to-market',
  'go to market',
  'competitive landscape',
  'competition',
  'team',
  'roadmap',
  'use of funds',
  'funds use',
  'revenue',
  'milestones',
  'ask',
  'summary'
]

const normalize = value => {
  if (!value) return ''
  return value.toString().toLowerCase()
}

const collectMatches = (text, keywords) => {
  const matches = []
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      matches.push(keyword)
    }
  }
  return matches
}

const extractCompanyCandidates = lines => {
  const candidates = []
  const seen = new Set()

  const consider = value => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed || trimmed.length < 3) return
    const normalized = trimmed.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(trimmed)
  }

  for (const line of lines) {
    let match
    while ((match = COMPANY_REGEX.exec(line)) !== null) {
      consider(match[1])
    }
  }

  if (candidates.length === 0) {
    for (const line of lines) {
      if (!line || line.length > 120) continue
      const words = line.trim().split(/\s+/)
      if (words.length < 2 || words.length > 8) continue
      const uppercaseRatio = words.filter(word => /^(?:[A-Z][A-Z0-9&']+)$/.test(word)).length / words.length
      if (uppercaseRatio >= 0.6) {
        consider(words.join(' '))
      }
    }
  }

  return candidates
}

const labelConfidence = score => {
  if (score >= 6) return 'high'
  if (score >= 4) return 'medium'
  if (score >= 2) return 'low'
  return 'none'
}

module.exports = ({ text, maxChars = 20000 } = {}) => {
  if (!text) {
    return {
      isPitchDeck: false,
      confidenceScore: 0,
      confidence: 'none',
      summary: 'No text content was available for analysis.',
      matchedKeywords: [],
      fundingMentions: [],
      investorMentions: [],
      sectionMentions: [],
      companyCandidates: [],
      sampleTitle: null
    }
  }

  const limited = text.slice(0, maxChars)
  const normalized = normalize(limited)
  const strongMatches = collectMatches(normalized, STRONG_KEYWORDS)
  const fundingMatches = collectMatches(normalized, FUNDING_KEYWORDS)
  const investorMatches = collectMatches(normalized, INVESTOR_KEYWORDS)
  const sectionMatches = collectMatches(normalized, SECTION_KEYWORDS)
  const hasMultipleSections = sectionMatches.length >= 4

  let score = 0
  if (strongMatches.length > 0) {
    score += 4
  }
  if (fundingMatches.length > 0) {
    score += Math.min(fundingMatches.length, 2) * 1.5
  }
  if (investorMatches.length > 0) {
    score += Math.min(investorMatches.length, 3) * 0.75
  }
  if (sectionMatches.length > 0) {
    score += Math.min(sectionMatches.length, 6) * 0.5
    if (hasMultipleSections) {
      score += 2
    }
  }

  const isPitchDeck = score >= 3.5 || strongMatches.length > 0 || hasMultipleSections

  const lines = limited
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const interestingLine = lines.find(line => /deck|presentation|investor|fund/i.test(line)) || lines[0] || null
  const companyCandidates = extractCompanyCandidates(lines.slice(0, 40))

  const details = []
  if (strongMatches.length > 0) {
    details.push(`strong keywords (${strongMatches.join(', ')})`)
  }
  if (fundingMatches.length > 0) {
    details.push(`funding references (${fundingMatches.join(', ')})`)
  }
  if (sectionMatches.length >= 3) {
    details.push(`multiple deck sections (${sectionMatches.slice(0, 5).join(', ')})`)
  }
  if (investorMatches.length > 0) {
    details.push(`investor language (${investorMatches.join(', ')})`)
  }

  const summary = details.length > 0
    ? `Detected ${details.join('; ')}.`
    : 'No strong pitch deck indicators detected.'

  return {
    isPitchDeck,
    confidenceScore: score,
    confidence: labelConfidence(score),
    summary,
    matchedKeywords: strongMatches,
    fundingMentions: fundingMatches,
    investorMentions: investorMatches,
    sectionMentions: sectionMatches,
    companyCandidates,
    sampleTitle: interestingLine
  }
}
